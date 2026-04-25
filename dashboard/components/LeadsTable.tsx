"use client";

import { useState } from "react";
import { LeadRow } from "@/lib/supabase";
import { fmtDate, inr } from "@/lib/format";
import { Phone, Mail, ChevronDown, ChevronUp, Flame, Clock } from "lucide-react";

const PROG_TAG: Record<string, string> = {
  FFM: "text-rose-400 bg-rose-500/15",
  FW:  "text-cyan-400 bg-cyan-500/15",
  FC:  "text-lime-400 bg-lime-500/15",
  FAI: "text-amber-400 bg-amber-500/15",
};

const STAGE_LABEL: Record<string, { label: string; color: string }> = {
  form_partial:   { label: "Form partial",   color: "text-fg-muted bg-fg-border/50" },
  form_submitted: { label: "Form submitted", color: "text-cyan-400 bg-cyan-500/10" },
  app_fee_paid:   { label: "App fee paid",   color: "text-amber-400 bg-amber-500/10" },
  accepted:       { label: "🔥 Rescue zone", color: "text-amber-400 bg-amber-500/15" },
  confirmed:      { label: "Confirmed",      color: "text-emerald-400 bg-emerald-500/10" },
  balance_paid:   { label: "Balance paid",   color: "text-emerald-300 bg-emerald-500/15" },
  lost:           { label: "Lost",           color: "text-rose-400 bg-rose-500/10" },
};

function ScoreBadge({ score }: { score: number }) {
  let bg = "bg-fg-border text-fg-muted";
  if (score >= 75) bg = "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40";
  else if (score >= 50) bg = "bg-emerald-500/15 text-emerald-300";
  else if (score >= 25) bg = "bg-cyan-500/10 text-cyan-300";
  return (
    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg font-bold text-base ${bg}`}>
      {score}
    </div>
  );
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec/86400)}d ago`;
  return fmtDate(iso);
}

export default function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!leads.length) {
    return (
      <div className="glow-card rounded-xl p-12 text-center text-fg-muted">
        No leads match your filters. Try widening the search.
      </div>
    );
  }

  return (
    <div className="glow-card rounded-xl overflow-hidden animate-fade-in">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-muted uppercase tracking-wider border-b border-fg-border bg-fg-card/50">
            <th className="py-3 px-4 font-medium">Score</th>
            <th className="py-3 px-2 font-medium">Lead</th>
            <th className="py-3 px-2 font-medium">Program</th>
            <th className="py-3 px-2 font-medium">Stage</th>
            <th className="py-3 px-2 font-medium">Last activity</th>
            <th className="py-3 px-2 font-medium">Contact</th>
            <th className="py-3 px-4 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l, i) => {
            const isOpen = expanded === l.id;
            const stage = STAGE_LABEL[l.funnel_stage || ""] || { label: l.funnel_stage || "—", color: "text-fg-muted bg-fg-border/50" };
            const isHot = l.score >= 75 || l.funnel_stage === "accepted";
            return (
              <>
                <tr
                  key={l.id}
                  className={`border-b border-fg-border/40 hover:bg-fg-card/30 transition-colors ${isHot ? "bg-amber-500/[0.03]" : ""}`}
                >
                  <td className="py-3 px-4"><ScoreBadge score={l.score} /></td>
                  <td className="py-3 px-2">
                    <div className="font-medium">{l.name || <span className="text-fg-muted italic">no name</span>}</div>
                    <div className="text-xs text-fg-muted truncate max-w-[220px]">{l.email || l.phone || "—"}</div>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${PROG_TAG[l.program || ""] || "text-fg-muted bg-fg-border"}`}>
                      {l.program || "—"}
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${stage.color}`}>
                      {stage.label}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-xs text-fg-muted whitespace-nowrap">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {timeAgo(l.last_activity)}
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex gap-1">
                      {l.phone && (
                        <a href={`tel:${l.phone}`} className="p-1.5 rounded hover:bg-fg-card text-fg-muted hover:text-emerald-400" title={l.phone}>
                          <Phone className="w-4 h-4" />
                        </a>
                      )}
                      {l.email && (
                        <a href={`mailto:${l.email}`} className="p-1.5 rounded hover:bg-fg-card text-fg-muted hover:text-cyan-400" title={l.email}>
                          <Mail className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => setExpanded(isOpen ? null : l.id)}
                      className="text-fg-muted hover:text-fg-text transition-colors"
                    >
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
                {isOpen && <LeadDetailRow lead={l} />}
              </>
            );
          })}
        </tbody>
      </table>
      <div className="px-4 py-3 text-xs text-fg-muted bg-fg-card/30 border-t border-fg-border">
        Showing {leads.length} leads. Click a row to expand.
      </div>
    </div>
  );
}

function LeadDetailRow({ lead }: { lead: LeadRow }) {
  const breakdown = lead.score_breakdown || {};
  const sortedSignals = Object.entries(breakdown)
    .filter(([_, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <tr className="bg-fg-card/40 border-b border-fg-border">
      <td colSpan={7} className="px-6 py-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Score breakdown */}
          <div>
            <div className="text-xs uppercase tracking-wider text-fg-muted mb-3">Score breakdown</div>
            <div className="space-y-1.5">
              {sortedSignals.length ? sortedSignals.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-fg-text/80">{k.replace(/_/g, " ")}</span>
                  <span className="font-mono text-emerald-400">+{v}</span>
                </div>
              )) : <div className="text-fg-muted text-sm italic">No signals yet</div>}
            </div>
          </div>

          {/* Source / attribution */}
          <div>
            <div className="text-xs uppercase tracking-wider text-fg-muted mb-3">Source</div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-fg-muted">Campaign</span>
                <span className="text-fg-text/80 truncate ml-2">{lead.source_campaign_name || "—"}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-fg-muted">UTM source</span>
                <span className="text-fg-text/80">{lead.source_utm_source || "—"}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-fg-muted">First seen</span>
                <span className="text-fg-text/80">{fmtDate(lead.first_seen)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-fg-muted">Payments captured</span>
                <span className="text-fg-text/80">{lead.captured_payment_count || 0}</span>
              </div>
              {lead.last_payment_amount && (
                <div className="flex items-baseline justify-between">
                  <span className="text-fg-muted">Last payment</span>
                  <span className="text-emerald-300">{inr(lead.last_payment_amount)} · {fmtDate(lead.last_payment_at)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Suggested action */}
          <div>
            <div className="text-xs uppercase tracking-wider text-fg-muted mb-3">Suggested action</div>
            <SuggestedAction lead={lead} />
          </div>
        </div>
      </td>
    </tr>
  );
}

function SuggestedAction({ lead }: { lead: LeadRow }) {
  const stage = lead.funnel_stage;
  let title = "", body = "", tone: "hot" | "warm" | "cool" = "cool";
  if (stage === "accepted") {
    tone = "hot";
    title = "Call NOW — rescue zone";
    body = "Paid app fee but hasn't paid confirmation. Highest conversion probability.";
  } else if (stage === "form_submitted" && lead.score >= 50) {
    tone = "warm";
    title = "Call this week";
    body = "Strong signals from form, just needs a nudge to pay app fee.";
  } else if (stage === "form_submitted") {
    tone = "warm";
    title = "Add to nurture";
    body = "Submitted form but lower-fit. Email cadence may convert.";
  } else if (stage === "form_partial") {
    tone = "cool";
    title = "Email reminder";
    body = "Started form, didn't finish. Re-engage with a finish-your-application email.";
  } else if (stage === "confirmed") {
    title = "Already converted";
    body = "Move into program ops queue.";
  }
  const toneClass = tone === "hot" ? "border-amber-500/50 bg-amber-500/10 text-amber-300" :
                    tone === "warm" ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-300" :
                                       "border-fg-border bg-fg-card text-fg-muted";
  return (
    <div className={`border rounded-lg p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 mb-1">
        <Flame className="w-4 h-4" />
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <div className="text-xs opacity-80">{body}</div>
    </div>
  );
}
