// One-off maintenance: re-extract phone numbers from form_submissions.responses
// for leads where lead.phone IS NULL. Old leads ingested via the Python script
// (before the webhook receivers existed) often had phones in their form responses
// but the script's extractor missed them — newer extractor in webhook-helpers
// is more permissive, so we run it retroactively here.
//
// GET /api/maintenance/backfill-phones?limit=1000

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { tallyExtractFields, normalizePhone } from "@/lib/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500"), 5000);

  try {
    // 1. Find leads with NULL phone
    const { data: nullPhoneLeads, error: lerr } = await supabase
      .from("leads")
      .select("id,email")
      .is("phone", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (lerr) throw lerr;

    const leadIds = (nullPhoneLeads || []).map(l => l.id);
    if (leadIds.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, fixed: 0, message: "no null-phone leads" });
    }

    // 2. Fetch their form submissions in chunks (raw payload + responses)
    const subsByLead: Record<string, any[]> = {};
    const CHUNK = 200;
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const chunk = leadIds.slice(i, i + CHUNK);
      const { data: subs, error: serr } = await supabase
        .from("form_submissions")
        .select("lead_id,responses,raw")
        .in("lead_id", chunk);
      if (serr) throw serr;
      for (const s of (subs || [])) {
        if (s.lead_id) (subsByLead[s.lead_id] ||= []).push(s);
      }
    }

    // 3. For each lead, try to extract phone
    const updates: { id: string; phone: string }[] = [];
    for (const lead of nullPhoneLeads || []) {
      const subs = subsByLead[lead.id] || [];
      let phone: string | null = null;
      for (const s of subs) {
        // First try the raw fields[] structure (richer signal than responses dict)
        const rawFields = s.raw?.data?.fields || [];
        if (rawFields.length) {
          const ext = tallyExtractFields(rawFields);
          if (ext.phone) { phone = ext.phone; break; }
        }
        // Fallback: scan the flat responses dict for phone-ish keys
        if (!phone && s.responses) {
          for (const [k, v] of Object.entries(s.responses)) {
            if (/phone|mobile|whatsapp|contact\s*num|cell|^number$/i.test(k)) {
              const candidate = String(v ?? "").replace(/[^\d+]/g, "");
              if (candidate.length >= 8) { phone = candidate; break; }
            }
          }
        }
        if (phone) break;
      }
      if (phone) {
        const normalized = normalizePhone(phone);
        if (normalized) updates.push({ id: lead.id, phone: normalized });
      }
    }

    // 4. Apply updates in chunks
    let updated = 0;
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      // Supabase doesn't support multi-row UPDATE via REST without upsert.
      // Use upsert on id.
      const { error } = await supabase.from("leads").upsert(batch, { onConflict: "id" });
      if (error) console.error("[backfill-phones] batch error:", error.message);
      else updated += batch.length;
    }

    return NextResponse.json({
      ok: true,
      scanned: leadIds.length,
      had_submissions: Object.keys(subsByLead).length,
      fixed: updated,
      sample_fix: updates.slice(0, 5),
    });
  } catch (e: any) {
    console.error("[backfill-phones] error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
