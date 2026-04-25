// Lead activity logging — used by /queue and /leads/[id] pages
// when reps mark calls / outcomes / notes.
//
// POST body: { lead_id, rep_name, action, notes? }
// GET ?lead_id=... → activities for one lead

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set([
  "called", "no_answer", "busy", "messaged",
  "interested", "objection", "scheduled_followup",
  "converted", "lost", "note",
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

    // Side-effects: bump last_activity, mutate funnel_stage on hard outcomes
    const updates: Record<string, any> = { last_activity: new Date().toISOString() };
    if (action === "converted") updates.funnel_stage = "confirmed";
    else if (action === "lost") updates.funnel_stage = "lost";
    await supabase.from("leads").update(updates).eq("id", lead_id);

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
