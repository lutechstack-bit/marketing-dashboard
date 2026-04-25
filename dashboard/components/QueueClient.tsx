"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Phone, MessageCircle, Mail, Flame, Zap, Clock, AlertCircle, CheckCircle2,
  ChevronRight, X,
} from "lucide-react";
import type { LeadRow } from "@/lib/supabase";
import { whyHotReason, suggestTalkingPoints } from "@/lib/insights";

const REPS = [
  { name: "Pranaush", programs: ["FFM","FW"]   },
  { name: "Sashank",  programs: ["FC","BFP"]   },
  { name: "Wilson",   programs: ["VE","L3C"]   },
];

type Bucket = "rescue" | "hot_today" | "fresh" | "follow_up";

const BUCKET_META: Record<Bucket, { label: string; icon: React.ReactNode; cls: string; description: string }> = {
  rescue: {
    label: "Call NOW · Rescue zone",
    icon: <Flame className="w-4 h-4" />,
    cls: "border-amber-300 text-amber-900 bg-amber-50",
    description: "Paid the application fee but hasn't confirmed the slot. Highest conversion probability — call within the hour.",
  },
  hot_today: {
    label: "Hot today",
    icon: <Zap className="w-4 h-4" />,
    cls: "border-emerald-300 text-emerald-900 bg-emerald-50",
    description: "High score, recent activity. Strike while they're warm.",
  },
  fresh: {
    label: "Fresh applications",
    icon: <Clock className="w-4 h-4" />,
    cls: "border-cyan-300 text-cyan-900 bg-cyan-50",
    description: "Just submitted the form in the last 24h. Reach them before competitors do.",
  },
  follow_up: {
    label: "Follow up",
    icon: <AlertCircle className="w-4 h-4" />,
    cls: "border-slate-200 text-slate-700 bg-slate-50",
    description: "Stale — submitted earlier but no recent activity. Re-engage with a soft nudge.",
  },
};

function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function fmtAgo(iso?: string | null): string {
  const h = hoursSince(iso);
  if (!Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (h < 24 * 7) return `${Math.round(h / 24)}d ago`;
  return `${Math.round(h / (24 * 7))}w ago`;
}

function bucketFor(l: LeadRow): Bucket | null {
  const stage = l.funnel_stage || "form_partial";
  const ago = hoursSince(l.last_activity);

  if (stage === "accepted") return "rescue";
  if (stage === "form_submitted" && l.score >= 75 && ago <= 24) return "hot_today";
  if (stage === "form_submitted" && ago <= 24) return "fresh";
  if (stage === "form_submitted" && ago > 24 * 7 && l.score >= 25) return "follow_up";
  if (stage === "app_fee_paid" && ago > 18) return "rescue";
  return null;
}

export default function QueueClient({ initialLeads }: { initialLeads: LeadRow[] }) {
  const [rep, setRep] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("levelup-current-rep") : null;
    if (saved && REPS.find(r => r.name === saved)) setRep(saved);
    setMounted(true);
  }, []);

  const setRepAndPersist = (r: string | null) => {
    setRep(r);
    if (r) localStorage.setItem("levelup-current-rep", r);
  };

  // Filter by rep's assigned programs
  const myLeads = useMemo(() => {
    if (!rep) return initialLeads;
    const allowed = REPS.find(r => r.name === rep)?.programs || [];
    return initialLeads.filter(l => l.program && allowed.includes(l.program));
  }, [initialLeads, rep]);

  // Bucket each lead
  const buckets = useMemo(() => {
    const out: Record<Bucket, LeadRow[]> = { rescue: [], hot_today: [], fresh: [], follow_up: [] };
    for (const l of myLeads) {
      const b = bucketFor(l);
      if (b) out[b].push(l);
    }
    // Within each bucket, rank by score then recency
    for (const k of Object.keys(out) as Bucket[]) {
      out[k].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return hoursSince(a.last_activity) - hoursSince(b.last_activity);
      });
    }
    return out;
  }, [myLeads]);

  const totalCalls = buckets.rescue.length + buckets.hot_today.length + buckets.fresh.length + buckets.follow_up.length;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg-text">Today&apos;s Call Queue</h1>
          <p className="text-sm text-fg-muted mt-1">{today} · {totalCalls.toLocaleString("en-IN")} leads ranked by urgency</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Showing for</span>
          <div className="flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5">
            <button
              onClick={() => setRepAndPersist(null)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${!rep ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}
            >All reps</button>
            {REPS.map(r => (
              <button
                key={r.name}
                onClick={() => setRepAndPersist(r.name)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${rep === r.name ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Nudge banner — counts of urgent buckets */}
      {mounted && (buckets.rescue.length > 0 || buckets.hot_today.length > 0) && (
        <NudgeBanner
          rescueCount={buckets.rescue.length}
          hotCount={buckets.hot_today.length}
          freshCount={buckets.fresh.length}
        />
      )}

      {/* Buckets */}
      <div className="space-y-7 mt-6">
        {(["rescue", "hot_today", "fresh", "follow_up"] as Bucket[]).map(b => (
          <BucketSection key={b} bucket={b} leads={buckets[b]} />
        ))}
      </div>

      {totalCalls === 0 && (
        <div className="surface-card p-12 text-center mt-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-fg-text">No calls in the queue right now</h2>
          <p className="text-sm text-fg-muted mt-1">
            {rep ? `${rep}'s assigned programs (${REPS.find(r => r.name === rep)?.programs.join(", ")}) have no urgent leads.` : "All clear across all reps."}
          </p>
          <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 mt-4">
            Browse all leads <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function NudgeBanner({ rescueCount, hotCount, freshCount }: { rescueCount: number; hotCount: number; freshCount: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const messages: string[] = [];
  if (rescueCount > 0) messages.push(`🔥 ${rescueCount} ${rescueCount === 1 ? "lead is" : "leads are"} in the rescue zone — paid app fee, no confirmation`);
  if (hotCount > 0)    messages.push(`⚡ ${hotCount} hot ${hotCount === 1 ? "lead" : "leads"} (score 75+) active in last 24h`);
  if (freshCount > 0)  messages.push(`📥 ${freshCount} fresh ${freshCount === 1 ? "application" : "applications"} from today`);

  return (
    <div className="surface-card p-4 border-l-4 border-l-amber-500 flex items-start gap-3">
      <Flame className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-fg-text mb-1">Heads up — start your day here</div>
        <ul className="text-sm text-fg-muted space-y-0.5">
          {messages.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      </div>
      <button onClick={() => setDismissed(true)} className="text-fg-subtle hover:text-fg-text shrink-0" title="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function BucketSection({ bucket, leads }: { bucket: Bucket; leads: LeadRow[] }) {
  if (!leads.length) return null;
  const meta = BUCKET_META[bucket];
  const max = bucket === "follow_up" ? 5 : 12;
  const visible = leads.slice(0, max);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${meta.cls}`}>
            {meta.icon}{meta.label}
          </span>
          <span className="text-xs text-fg-muted tabular-nums">{leads.length}</span>
        </div>
        {leads.length > visible.length && (
          <Link href={`/leads`} className="text-xs text-fg-muted hover:text-fg-text">View all {leads.length} →</Link>
        )}
      </div>
      <p className="text-xs text-fg-muted mb-3">{meta.description}</p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {visible.map((l, i) => <QueueCard key={l.id} lead={l} rank={i + 1} />)}
      </div>
    </section>
  );
}

function QueueCard({ lead, rank }: { lead: LeadRow; rank: number }) {
  const why = whyHotReason(lead);
  const tips = suggestTalkingPoints(lead);
  const programColor: Record<string, string> = {
    FFM: "text-rose-700 bg-rose-50 ring-1 ring-rose-200",
    FW:  "text-cyan-700 bg-cyan-50 ring-1 ring-cyan-200",
    FC:  "text-lime-700 bg-lime-50 ring-1 ring-lime-200",
    FAI: "text-amber-700 bg-amber-50 ring-1 ring-amber-200",
  };
  const progCls = programColor[lead.program || ""] || "text-fg-muted bg-fg-surface ring-1 ring-fg-border";

  return (
    <div className="surface-card surface-card-hover p-4 group">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-fg-surface border border-fg-border flex items-center justify-center text-xs font-bold text-fg-muted tabular-nums">
          #{rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <div className="flex items-baseline gap-2 min-w-0">
              <Link href={`/leads/${lead.id}`} className="font-semibold text-fg-text truncate hover:text-amber-700 hover:underline">
                {lead.name || <span className="italic text-fg-subtle">No name</span>}
              </Link>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${progCls} shrink-0`}>{lead.program || "—"}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ScoreBadge score={lead.score} />
              <span className="text-[11px] text-fg-muted tabular-nums">{fmtAgo(lead.last_activity)}</span>
            </div>
          </div>
          <p className="text-xs text-fg-text/85 leading-snug mb-2">{why}</p>
          {tips.length > 0 && (
            <div className="text-[11px] text-fg-muted bg-fg-surface rounded px-2.5 py-1.5 mb-3 border border-fg-border/70">
              <span className="font-semibold text-fg-text/80">💡 Open with:</span> {tips[0]}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50">
                  <Phone className="w-3.5 h-3.5" />Call
                </a>
              )}
              {lead.phone && (
                <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-green-200 text-green-700 bg-white hover:bg-green-50">
                  <MessageCircle className="w-3.5 h-3.5" />WA
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-cyan-200 text-cyan-700 bg-white hover:bg-cyan-50">
                  <Mail className="w-3.5 h-3.5" />Email
                </a>
              )}
            </div>
            <Link
              href={`/leads/${lead.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-fg-muted hover:text-fg-text hover:bg-fg-surface"
            >
              Open <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let cls;
  if (score >= 75)      cls = "bg-amber-500 text-white shadow-sm shadow-amber-500/30";
  else if (score >= 50) cls = "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300";
  else if (score >= 25) cls = "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200";
  else                  cls = "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
  return (
    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-xs tabular-nums ${cls}`}>
      {score}
    </div>
  );
}
