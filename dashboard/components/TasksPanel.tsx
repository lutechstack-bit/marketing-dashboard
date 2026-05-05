"use client";

// Tasks panel — shows my pending + overdue tasks oldest-due-first.
// Used at the top of /queue so reps see their follow-up list first thing.
//
// Each task row supports inline complete / snooze / open lead.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, Clock, ChevronRight, Pause, Loader2, Phone, MessageCircle } from "lucide-react";

type Task = {
  id: string;
  lead_id: string | null;
  assigned_to: string | null;
  due_at: string;
  type: "callback" | "follow_up" | "interview" | "whatsapp" | "email" | "custom";
  notes: string | null;
  status: string;
  source: string;
};

type LeadStub = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  program: string | null;
};

export default function TasksPanel({ leadsById = {} }: { leadsById?: Record<string, LeadStub> }) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/tasks", { cache: "no-store" });
      const j = await r.json();
      setTasks(j.tasks || []);
    } catch { /* keep prev */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(taskId: string, action: "complete" | "snooze" | "cancel", extra?: any) {
    setBusy(taskId);
    try {
      const r = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(extra || {}) }),
      });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }

  if (loading) {
    return (
      <div className="surface-card p-4 mb-5 flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin" />Loading your tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return null; // nothing to do — don't take up space
  }

  const now = Date.now();
  const overdue = tasks.filter(t => new Date(t.due_at).getTime() < now);
  const upcoming = tasks.filter(t => new Date(t.due_at).getTime() >= now);

  return (
    <div className="surface-card mb-5 overflow-hidden border-l-4 border-l-forge-orange-deep">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 bg-forge-radial relative hover:bg-forge-yellow-pale transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-forge-orange-deep" />
          <span className="font-display text-lg font-extrabold italic text-forge-black">Your follow-ups</span>
          {overdue.length > 0 && (
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded bg-rose-100 text-rose-700">
              {overdue.length} overdue
            </span>
          )}
          <span className="text-xs text-fg-muted">
            {upcoming.length > 0 && `· ${upcoming.length} upcoming`}
          </span>
        </div>
        <ChevronRight className={`w-4 h-4 text-fg-muted transition-transform ${collapsed ? "" : "rotate-90"}`} />
      </button>

      {!collapsed && (
        <div className="divide-y divide-fg-border/60">
          {tasks.slice(0, 12).map(t => {
            const lead = t.lead_id ? leadsById[t.lead_id] : null;
            const isOverdue = new Date(t.due_at).getTime() < now;
            const due = new Date(t.due_at);
            const dueLabel = formatDue(due, now);
            return (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3 flex-wrap text-sm">
                <div className="flex items-center gap-1.5 min-w-[110px]">
                  <Clock className={`w-3.5 h-3.5 ${isOverdue ? "text-rose-600" : "text-fg-muted"}`} />
                  <span className={`text-xs tabular-nums ${isOverdue ? "text-rose-700 font-semibold" : "text-fg-muted"}`}>
                    {dueLabel}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  {lead ? (
                    <Link href={`/leads/${lead.id}`} className="font-semibold text-forge-black hover:text-forge-orange-deep">
                      {lead.name || lead.email || lead.phone || "—"}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle italic">no lead linked</span>
                  )}
                  {lead?.program && (
                    <span className="ml-2 text-[10px] uppercase tracking-[0.1em] font-semibold text-fg-muted">
                      {lead.program}
                    </span>
                  )}
                  {t.notes && <div className="text-xs text-fg-muted truncate mt-0.5">{t.notes}</div>}
                </div>

                <div className="flex items-center gap-1">
                  {lead?.phone && (
                    <a href={`tel:${lead.phone}`} title="Call" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                  {lead?.phone && (
                    <a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" title="WhatsApp" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => {
                      const next = new Date(); next.setHours(next.getHours() + 4, 0, 0, 0);
                      act(t.id, "snooze", { snoozed_until: next.toISOString() });
                    }}
                    disabled={busy === t.id}
                    title="Snooze 4h"
                    className="p-1.5 rounded text-fg-muted hover:text-forge-orange-deep hover:bg-forge-yellow-pale disabled:opacity-40"
                  >
                    {busy === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => act(t.id, "complete")}
                    disabled={busy === t.id}
                    title="Mark done"
                    className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
          {tasks.length > 12 && (
            <div className="px-5 py-2 text-xs text-fg-muted bg-forge-cream/40">
              +{tasks.length - 12} more — open a lead to view its task list
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDue(due: Date, nowMs: number): string {
  const diffMs = due.getTime() - nowMs;
  const diffMin = Math.round(diffMs / 60000);
  if (diffMs < 0) {
    const ago = -diffMin;
    if (ago < 60) return `${ago}m late`;
    if (ago < 60 * 24) return `${Math.round(ago / 60)}h late`;
    return `${Math.round(ago / (60 * 24))}d late`;
  }
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 60 * 24) return `in ${Math.round(diffMin / 60)}h`;
  return due.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
