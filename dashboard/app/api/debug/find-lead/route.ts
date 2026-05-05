// Debug: find a lead by name or email/phone fragment + dump full state.
// Useful for "user X says they paid but they're in abandoned" kind of cases.
//
// GET /api/debug/find-lead?q=siddhartha&token=...

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  const admin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: leads } = await admin
    .from("leads")
    .select("id,email,phone,name,program,funnel_stage,score,first_seen,last_activity,source_campaign_name")
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
    .order("last_activity", { ascending: false })
    .limit(20);

  const enriched: any[] = [];
  for (const l of (leads || []) as any[]) {
    const [pays, subs, acts] = await Promise.all([
      admin.from("payments").select("payment_type,amount_inr,status,paid_at,email,phone")
        .or(`lead_id.eq.${l.id},email.eq.${l.email || "_"},phone.eq.${l.phone || "_"}`),
      admin.from("form_submissions").select("form_id,program,submitted_at,responses").eq("lead_id", l.id),
      admin.from("lead_activities").select("action,rep_name,notes,created_at").eq("lead_id", l.id).order("created_at", { ascending: false }).limit(5),
    ]);
    enriched.push({
      lead: l,
      payments: (pays.data || []),
      submissions: (subs.data || []).map((s: any) => ({ ...s, responses_keys: Object.keys(s.responses || {}) })),
      activities: (acts.data || []),
    });
  }

  return NextResponse.json({ q, count: enriched.length, results: enriched });
}
