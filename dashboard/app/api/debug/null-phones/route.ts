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
      submissions: (subs || []).map(s => {
        // Show actual values for phone-related keys (even if empty)
        const phoneRelatedEntries = Object.entries(s.responses || {})
          .filter(([k]) => /phone|mobile|whatsapp|contact|cell|number/i.test(k))
          .map(([k, v]) => ({
            key: k,
            value_type: typeof v,
            is_array: Array.isArray(v),
            value_raw: v,
            value_str: String(Array.isArray(v) ? v.join(", ") : (v ?? "")),
          }));
        // Find ANY value across all responses that looks phone-like
        const phoneShapedValues = Object.entries(s.responses || {})
          .map(([k, v]) => {
            const s = Array.isArray(v) ? v.join(" ") : String(v ?? "");
            const digits = s.replace(/\D/g, "");
            return { key: k, digits_count: digits.length, value_preview: s.slice(0, 60), digit_preview: digits.slice(0, 15) };
          })
          .filter(x => x.digits_count >= 8 && x.digits_count <= 15);
        return {
          form_id: s.form_id,
          submitted_at: s.submitted_at,
          response_keys: Object.keys(s.responses || {}),
          phone_related_entries: phoneRelatedEntries,
          phone_shaped_values: phoneShapedValues,
          has_raw_fields: Array.isArray(s.raw?.data?.fields),
        };
      }),
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
