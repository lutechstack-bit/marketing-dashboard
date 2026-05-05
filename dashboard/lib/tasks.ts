// Task / reminder data layer.
//
// A task is "do X about lead Y by time Z". Reps see their pending + overdue
// tasks at the top of /queue and as a notification bell count in the header.
//
// Status flow:
//   pending  →  completed | snoozed (with snoozed_until → becomes new due_at) | cancelled

import { supabase } from "./supabase";
import { unstable_cache } from "next/cache";

export type TaskType = "callback" | "follow_up" | "interview" | "whatsapp" | "email" | "custom";
export type TaskStatus = "pending" | "completed" | "snoozed" | "cancelled";
export type TaskSource = "manual" | "activity_followup" | "auto_rule" | "webhook";

export type TaskRow = {
  id: string;
  lead_id: string | null;
  assigned_to: string | null;
  due_at: string;
  type: TaskType;
  notes: string | null;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
  snoozed_until: string | null;
  created_by: string | null;
  source: TaskSource;
};

/** Pending + overdue tasks for a single rep, oldest-due first. */
export async function fetchTasksForRep(repId: string, opts: { limit?: number } = {}): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("assigned_to", repId)
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(opts.limit ?? 50);
  if (error) { console.error("[tasks] fetchTasksForRep:", error.message); return []; }
  return (data || []) as TaskRow[];
}

/** All open tasks for a lead — for the lead detail timeline. */
export async function fetchTasksForLead(leadId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("lead_id", leadId)
    .order("due_at", { ascending: true });
  if (error) { console.error("[tasks] fetchTasksForLead:", error.message); return []; }
  return (data || []) as TaskRow[];
}

/**
 * Cached count of overdue + due-today tasks per rep — drives the header bell
 * badge. 30s cache, tag "tasks" so writes can revalidate.
 */
export const fetchTaskCountForRep = unstable_cache(
  async (repId: string): Promise<{ overdue: number; today: number; total: number }> => {
    const now = new Date();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const [overdueRes, todayRes] = await Promise.all([
      supabase.from("tasks").select("*", { count: "exact", head: true })
        .eq("assigned_to", repId).eq("status", "pending")
        .lt("due_at", now.toISOString()),
      supabase.from("tasks").select("*", { count: "exact", head: true })
        .eq("assigned_to", repId).eq("status", "pending")
        .gte("due_at", now.toISOString())
        .lte("due_at", todayEnd.toISOString()),
    ]);

    const overdue = overdueRes.count || 0;
    const today = todayRes.count || 0;
    return { overdue, today, total: overdue + today };
  },
  ["fetch-task-count-v1"],
  { revalidate: 30, tags: ["tasks"] },
);

/** Create a task. Used by both the API route and webhook auto-rules. */
export async function createTask(input: {
  lead_id?: string | null;
  assigned_to?: string | null;
  due_at: string;
  type?: TaskType;
  notes?: string | null;
  created_by?: string | null;
  source?: TaskSource;
}): Promise<TaskRow | null> {
  const { data, error } = await supabase.from("tasks").insert({
    lead_id: input.lead_id || null,
    assigned_to: input.assigned_to || null,
    due_at: input.due_at,
    type: input.type || "callback",
    notes: input.notes || null,
    created_by: input.created_by || null,
    source: input.source || "manual",
  }).select().single();
  if (error) { console.error("[tasks] createTask:", error.message); return null; }
  await invalidate();
  return data as TaskRow;
}

export async function completeTask(id: string): Promise<boolean> {
  const { error } = await supabase.from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { console.error("[tasks] completeTask:", error.message); return false; }
  await invalidate();
  return true;
}

export async function snoozeTask(id: string, snoozedUntil: string): Promise<boolean> {
  // We snooze by pushing due_at forward (no separate snoozed status — keeps
  // the index simple and the rep sees it pop back when due).
  const { error } = await supabase.from("tasks")
    .update({ due_at: snoozedUntil, snoozed_until: snoozedUntil })
    .eq("id", id);
  if (error) { console.error("[tasks] snoozeTask:", error.message); return false; }
  await invalidate();
  return true;
}

export async function cancelTask(id: string): Promise<boolean> {
  const { error } = await supabase.from("tasks").update({ status: "cancelled" }).eq("id", id);
  if (error) { console.error("[tasks] cancelTask:", error.message); return false; }
  await invalidate();
  return true;
}

async function invalidate() {
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("tasks");
  } catch { /* not in app context */ }
}
