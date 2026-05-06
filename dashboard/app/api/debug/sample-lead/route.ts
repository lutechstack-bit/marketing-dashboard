// Debug: fetch one lead by email + the latest synced form_submission row
// so we can verify the TeleCRM sync wrote the rich attribution.
//
// GET /api/debug/sample-lead?email=foo@bar.com

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "?email= required" }, { status: 400 });

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: leads } = await admin
    .from("leads")
    .select("id,email,phone,name,program,funnel_stage,score,score_breakdown,first_seen,last_activity,source_campaign_id,source_campaign_name,source_utm_source")
    .eq("email", email.toLowerCase())
    .limit(5);

  const ids = (leads || []).map(l => l.id);
  const subs = ids.length
    ? (await admin
        .from("form_submissions")
        .select("id,form_id,form_name,program,submitted_at,responses")
        .in("lead_id", ids)
        .order("submitted_at", { ascending: false })
      ).data
    : [];

  return NextResponse.json({ leads, submissions: subs }, { headers: { "Cache-Control": "no-store" } });
}
