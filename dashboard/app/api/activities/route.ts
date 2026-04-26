// Lead activity logging — used by /queue and /leads/[id] when reps log calls,
// outcomes, notes, and status changes.
//
// POST body: { lead_id, rep_name?, action, notes? }
//   action MUST match either a StatusId (statuses.ts) OR a legacy outcome.
// GET ?lead_id=... → activities for one lead

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { STATUS_BY_ID } from "@/lib/statuses";

export const dynamic = "force-dynamic";

// All actions we accept. Includes the new StatusId values + legacy action names
// (kept for backward compat with rows already in lead_activities).
const VALID_ACTIONS = new Set([
  // New statuses
  "new",
  "called_no_answer", "called_dnp",
  "called_interested", "called_not_interested",
  "called_budget_issue", "called_wants_more_info",
  "scheduled_followup",
  "application_fee_paid", "interview_booked",
  "confirmed", "lost",
  // Legacy actions
  "called", "no_answer", "busy", "messaged",
  "interested", "objection", "converted",
  // Note
  "note",
]);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { lead_id, rep_name, action, notes } = body || {};
    if (!lead_id || !action) {
      return NextResponse.json({ error: "lead_id and action are required" }, { status: 400 });
    }
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("lead_activities")
      .insert({ lead_id, rep_name: rep_name || null, action, notes: notes || null })
      .select()
      .single();
    if (error) throw error;

    // Side-effects: bump last_activity, mutate funnel_stage if the chosen
    // status implies a stage change (defined in statuses.ts).
    const updates: Record<string, any> = { last_activity: new Date().toISOString() };
    const statusDef = STATUS_BY_ID[action];
    if (statusDef?.implies_stage) {
      updates.funnel_stage = statusDef.implies_stage;
    } else if (action === "converted") {
      updates.funnel_stage = "confirmed";
    } else if (action === "lost") {
      updates.funnel_stage = "lost";
    }
    await supabase.from("leads").update(updates).eq("id", lead_id);

    // TODO: when TeleCRM API key arrives, push the same status update here.
    // Estimated 30 minutes of work — gated on having the API key + endpoint docs.

    return NextResponse.json({ ok: true, activity: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");
  if (!leadId) return NextResponse.json({ error: "lead_id required" }, { status: 400 });
  const { data, error } = await supabase
    .from("lead_activities")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activities: data || [] });
}
