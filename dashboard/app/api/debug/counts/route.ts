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

  // Per-program leads
  const { data: byProgram } = await admin
    .from("leads")
    .select("program")
    .limit(50000);
  const programTally: Record<string, number> = {};
  for (const r of byProgram || []) {
    const p = (r as any).program || "unknown";
    programTally[p] = (programTally[p] || 0) + 1;
  }

  // Per-funnel-stage
  const { data: byStage } = await admin
    .from("leads")
    .select("funnel_stage")
    .limit(50000);
  const stageTally: Record<string, number> = {};
  for (const r of byStage || []) {
    const s = (r as any).funnel_stage || "unknown";
    stageTally[s] = (stageTally[s] || 0) + 1;
  }

  return NextResponse.json({ counts, by_program: programTally, by_stage: stageTally });
}
