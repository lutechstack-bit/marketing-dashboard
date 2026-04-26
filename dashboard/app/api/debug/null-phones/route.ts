// Diagnostic — shows how many leads still have NULL phone, and dumps the
// form_submissions responses + raw payload for a few of them so we can see
// exactly why the extractor missed.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sample = parseInt(url.searchParams.get("sample") || "10");

  // Count NULL-phone leads (paginate via head:true count)
  const totalRes = await supabase.from("leads").select("*", { count: "exact", head: true });
  const nullRes = await supabase.from("leads").select("*", { count: "exact", head: true }).is("phone", null);
  const nullWithSubsRes = await supabase.from("leads")
    .select("id", { count: "exact", head: false })
    .is("phone", null)
    .limit(0); // just count

  // Get sample of NULL-phone leads with their submissions
  const { data: nullLeads } = await supabase.from("leads")
    .select("id,email,name,program,created_at")
    .is("phone", null)
    .order("created_at", { ascending: false })
    .limit(sample);

  const samples: any[] = [];
  for (const lead of (nullLeads || [])) {
    const { data: subs } = await supabase.from("form_submissions")
      .select("id,form_id,responses,raw,submitted_at")
      .eq("lead_id", lead.id)
      .limit(2);
    samples.push({
      lead: { id: lead.id, name: lead.name, email: lead.email, program: lead.program },
      submissions: (subs || []).map(s => ({
        form_id: s.form_id,
        submitted_at: s.submitted_at,
        // Show response keys (without spammy values)
        response_keys: Object.keys(s.responses || {}),
        // Show keys that COULD be phones (any field with digits in the value)
        phone_candidate_keys: Object.entries(s.responses || {})
          .filter(([_k, v]) => {
            const s = Array.isArray(v) ? v.join(" ") : String(v ?? "");
            const digits = s.replace(/\D/g, "");
            return digits.length >= 8;
          })
          .map(([k, v]) => ({ key: k, value_preview: String(Array.isArray(v) ? v.join(", ") : (v ?? "")).slice(0, 60) })),
        // Show raw fields[] structure if present
        raw_fields_summary: Array.isArray(s.raw?.data?.fields) ? s.raw.data.fields.slice(0, 30).map((f: any) => ({
          type: f.type,
          label: (f.label || "").slice(0, 60),
          key: f.key,
          value_preview: typeof f.value === "string" ? f.value.slice(0, 60) :
            Array.isArray(f.value) ? f.value.join(", ").slice(0, 60) :
            String(f.value ?? "").slice(0, 60),
        })) : null,
      })),
    });
  }

  return NextResponse.json({
    counts: {
      total_leads: totalRes.count,
      null_phone_leads: nullRes.count,
      pct_null: totalRes.count ? Math.round(1000 * (nullRes.count || 0) / totalRes.count) / 10 : 0,
    },
    samples,
  });
}
