// One-shot maintenance: null out bogus first_seen / last_activity / submitted_at
// values that were set to "import time" because the CSV had no date column.
//
// Strategy:
//   1. Find form_submissions where form_id='csv_import' → set submitted_at to NULL
//   2. For leads that have ONLY csv_import form_submissions (no real Tally
//      submission), null out first_seen and last_activity. They get a "—" in
//      the UI until a real activity / payment fires for them.
//   3. For leads that have a real form_submission (form_id != csv_import),
//      keep the lead's first_seen as the earliest REAL submitted_at.
//
// Auth: ADMIN_BOOTSTRAP_TOKEN.
// POST /api/maintenance/null-bogus-dates?token=...

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });

  // Step 1: NULL out submitted_at on csv_import rows.
  // (We can't bulk-null via PostgREST patch in one call without filter; use update().)
  const { error: subErr, count: subUpdated } = await admin
    .from("form_submissions")
    .update({ submitted_at: null as any }, { count: "exact" })
    .eq("form_id", "csv_import");
  if (subErr) return NextResponse.json({ error: `step 1: ${subErr.message}` }, { status: 500 });

  // Step 2: find leads that have ONLY csv_import submissions.
  // Walk in pages so we don't OOM on 41k leads.
  const PAGE = 2000;
  let from = 0;
  let nullSubmittedLeadIds: string[] = [];
  let realSubmittedFirstByLead: Record<string, string> = {};

  while (true) {
    const { data: leads, error: lErr } = await admin
      .from("leads")
      .select("id")
      .range(from, from + PAGE - 1);
    if (lErr) return NextResponse.json({ error: `leads page ${from}: ${lErr.message}` }, { status: 500 });
    if (!leads || leads.length === 0) break;

    const leadIds = leads.map((l: any) => l.id);

    // Fetch form_submissions for this batch — we need to know form_id and
    // earliest non-null submitted_at per lead.
    const { data: subs } = await admin
      .from("form_submissions")
      .select("lead_id,form_id,submitted_at")
      .in("lead_id", leadIds);

    const realByLead: Record<string, string> = {};
    const hasAnyByLead: Record<string, boolean> = {};
    for (const s of (subs || []) as any[]) {
      hasAnyByLead[s.lead_id] = true;
      if (s.form_id !== "csv_import" && s.submitted_at) {
        const cur = realByLead[s.lead_id];
        if (!cur || s.submitted_at < cur) realByLead[s.lead_id] = s.submitted_at;
      }
    }
    for (const id of leadIds) {
      if (!realByLead[id]) nullSubmittedLeadIds.push(id);
      else realSubmittedFirstByLead[id] = realByLead[id];
    }

    if (leads.length < PAGE) break;
    from += PAGE;
  }

  // Step 3: NULL out first_seen + last_activity on the no-real-submission leads, in chunks
  let nullCount = 0;
  for (let i = 0; i < nullSubmittedLeadIds.length; i += 500) {
    const chunk = nullSubmittedLeadIds.slice(i, i + 500);
    const { error } = await admin.from("leads").update({
      first_seen: null as any,
      last_activity: null as any,
    }).in("id", chunk);
    if (!error) nullCount += chunk.length;
  }

  // Step 4: for leads that DO have real submissions, repair first_seen to
  // match the earliest real submitted_at (in case our import had clobbered it).
  const repairEntries = Object.entries(realSubmittedFirstByLead);
  let repairedCount = 0;
  for (const [leadId, ts] of repairEntries) {
    const { error } = await admin.from("leads").update({ first_seen: ts }).eq("id", leadId);
    if (!error) repairedCount++;
  }

  return NextResponse.json({
    ok: true,
    csv_import_subs_nulled: subUpdated || 0,
    leads_nulled: nullCount,
    leads_repaired_from_real_subs: repairedCount,
  });
}
