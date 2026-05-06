// Debug: full state of a lead by id, including form_submissions + payments + raw.
// GET /api/debug/lead-by-id?id=<id-prefix-or-full>

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "?id= required" }, { status: 400 });

  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Allow prefix lookup if id is < 36 chars
  const { data: leads } = id.length >= 36
    ? await admin.from("leads").select("*").eq("id", id).limit(1)
    : await admin.from("leads").select("*").like("id", `${id}%`).limit(1);
  const lead = (leads || [])[0];
  if (!lead) return NextResponse.json({ error: "lead not found", queried: id }, { status: 404 });

  const [{ data: subs }, { data: pays }, { data: acts }] = await Promise.all([
    admin.from("form_submissions").select("id,form_id,form_name,program,submitted_at,responses,raw").eq("lead_id", lead.id),
    admin.from("payments").select("id,amount_inr,program,payment_type,status,paid_at,raw,email,phone").eq("lead_id", lead.id),
    admin.from("lead_activities").select("action,rep_name,created_at,details").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(10),
  ]);

  return NextResponse.json({
    lead,
    submissions: subs || [],
    payments: pays || [],
    activities: acts || [],
  }, { headers: { "Cache-Control": "no-store" } });
}
