// Tasks API — create, list, mutate.
//
// GET /api/tasks                         → my pending tasks (oldest-due first)
// GET /api/tasks?lead_id=<uuid>          → tasks for a specific lead (admins/founders see all)
// POST /api/tasks                        → create a task
//   body: { lead_id?, assigned_to?, due_at, type?, notes? }
// PATCH /api/tasks/<id>                  → see ./[id]/route.ts

import { NextResponse } from "next/server";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { createTask, fetchTasksForLead, fetchTasksForRep } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");
  if (leadId) {
    const tasks = await fetchTasksForLead(leadId);
    return NextResponse.json({ tasks });
  }
  const tasks = await fetchTasksForRep(rep.id);
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as any;
  if (!body || !body.due_at) return NextResponse.json({ error: "due_at required" }, { status: 400 });

  // Default assignment: the lead's current owner if known, else the creator.
  // The UI will usually pass assigned_to explicitly.
  const task = await createTask({
    lead_id: body.lead_id || null,
    assigned_to: body.assigned_to || rep.id,
    due_at: body.due_at,
    type: body.type || "callback",
    notes: body.notes || null,
    created_by: rep.id,
    source: "manual",
  });
  if (!task) return NextResponse.json({ error: "create failed" }, { status: 500 });
  return NextResponse.json({ ok: true, task });
}
