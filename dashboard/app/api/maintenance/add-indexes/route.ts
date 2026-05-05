// One-shot maintenance endpoint: add composite indexes that the queue/leads
// pages depend on for sub-second response times.
//
// Auth: ADMIN_BOOTSTRAP_TOKEN.
// POST /api/maintenance/add-indexes?token=...

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATEMENTS: { name: string; sql: string }[] = [
  // Queue: SELECT … WHERE funnel_stage IN (…) ORDER BY score DESC, last_activity DESC
  {
    name: "idx_leads_stage_score",
    sql: `CREATE INDEX IF NOT EXISTS idx_leads_stage_score ON leads (funnel_stage, score DESC, last_activity DESC NULLS LAST);`,
  },
  // Leads: SELECT … ORDER BY score DESC + program filter
  {
    name: "idx_leads_program_score",
    sql: `CREATE INDEX IF NOT EXISTS idx_leads_program_score ON leads (program, score DESC, last_activity DESC NULLS LAST);`,
  },
  // form_submissions: SELECT … WHERE lead_id IN (…)
  // (single-column idx already exists per schema, but composite with submitted_at helps the queue's earliest-sub lookup)
  {
    name: "idx_form_subs_lead_submitted",
    sql: `CREATE INDEX IF NOT EXISTS idx_form_subs_lead_submitted ON form_submissions (lead_id, submitted_at);`,
  },
  // payments: SELECT … WHERE lead_id IN (…) AND status='captured'
  {
    name: "idx_payments_lead_status",
    sql: `CREATE INDEX IF NOT EXISTS idx_payments_lead_status ON payments (lead_id, status);`,
  },
  // lead_activities: SELECT … WHERE lead_id IN (…) AND action != 'note' ORDER BY created_at DESC
  {
    name: "idx_activities_lead_created",
    sql: `CREATE INDEX IF NOT EXISTS idx_activities_lead_created ON lead_activities (lead_id, created_at DESC);`,
  },
];

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }

  // We can't run raw DDL through PostgREST. Use Supabase's SQL execution via
  // the management API endpoint (pg-meta or similar), but the simplest
  // portable path is to issue queries via fetch to the postgres rest endpoint
  // with prefer: tx=commit. Alas PostgREST doesn't support DDL.
  //
  // Instead, return the SQL the operator should paste into the Supabase SQL
  // editor — this is rare ops, not something we want to gate behind a hidden
  // endpoint anyway.
  return NextResponse.json({
    ok: true,
    instructions: "Paste the following SQL into Supabase Studio → SQL Editor → Run.",
    sql: STATEMENTS.map(s => s.sql).join("\n\n"),
    statements: STATEMENTS,
  });
}
