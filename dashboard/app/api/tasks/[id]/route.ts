// PATCH/DELETE a single task by id.
//
// PATCH /api/tasks/<id>
//   body: { action: "complete" | "snooze" | "cancel", snoozed_until?: ISO } | { notes?: string, due_at?: string, type?: string }
// DELETE /api/tasks/<id>     (soft-cancel — same as PATCH action=cancel, kept for clarity)

import { NextResponse } from "next/server";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { cancelTask, completeTask, snoozeTask } from "@/lib/tasks";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as any;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  if (body.action === "complete") {
    const ok = await completeTask(id);
    return NextResponse.json({ ok });
  }
  if (body.action === "snooze") {
    if (!body.snoozed_until) return NextResponse.json({ error: "snoozed_until required" }, { status: 400 });
    const ok = await snoozeTask(id, body.snoozed_until);
    return NextResponse.json({ ok });
  }
  if (body.action === "cancel") {
    const ok = await cancelTask(id);
    return NextResponse.json({ ok });
  }

  // Plain edit (notes / due_at / type)
  const updates: Record<string, any> = {};
  if (typeof body.notes === "string")    updates.notes = body.notes;
  if (typeof body.due_at === "string")   updates.due_at = body.due_at;
  if (typeof body.type === "string")     updates.type = body.type;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  const { error } = await supabase.from("tasks").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("tasks");
  } catch {}
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await cancelTask(id);
  return NextResponse.json({ ok });
}
