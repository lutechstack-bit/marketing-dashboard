// Debug: total counts for leads, form_submissions, payments — useful to track
// progress of bulk imports.
//
// GET /api/debug/counts

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const tables = ["leads", "form_submissions", "payments"];
  const counts: Record<string, number | string> = {};
  for (const t of tables) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    counts[t] = error ? `err:${error.message}` : (count ?? 0);
  }

  // Per-program + per-funnel-stage tally — paginated past Supabase's 1000-row
  // default cap.
  const programTally: Record<string, number> = {};
  const stageTally: Record<string, number> = {};
  const programStageTally: Record<string, Record<string, number>> = {};
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("leads")
      .select("program,funnel_stage")
      .range(from, from + pageSize - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const p = r.program || "unknown";
      const s = r.funnel_stage || "unknown";
      programTally[p] = (programTally[p] || 0) + 1;
      stageTally[s] = (stageTally[s] || 0) + 1;
      (programStageTally[p] ||= {})[s] = (programStageTally[p][s] || 0) + 1;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({
    counts,
    by_program: programTally,
    by_stage: stageTally,
    by_program_stage: programStageTally,
  });
}
