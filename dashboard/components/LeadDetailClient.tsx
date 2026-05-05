"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Phone, Mail, MessageCircle, FileText, IndianRupee, Sparkles, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, PhoneOff, Clock, MessageSquare, Flame, Send, Calendar,
} from "lucide-react";
import type { LeadRow, FormSubmissionRow, PaymentRow, LeadActivityRow } from "@/lib/supabase";
import { inr, fmtDate } from "@/lib/format";
import { suggestTalkingPoints, whyHotReason } from "@/lib/insights";
import type { CalendlyBooking } from "@/lib/calendly";
import type { AiWhyHot } from "@/lib/ai-insights";
import { useEffect } from "react";
import StatusDropdown from "./StatusDropdown";
import ScheduleCallback from "./ScheduleCallback";

const STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  form_partial:   { label: "Form partial",   cls: "bg-forge-cream text-forge-black/70 ring-1 ring-fg-border" },
  form_submitted: { label: "Form submitted", cls: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200" },
  app_fee_paid:   { label: "App fee paid",   cls: "bg-forge-yellow-soft text-forge-orange-deep ring-1 ring-forge-yellow" },
  accepted:       { label: "App fee paid · need interview booking", cls: "bg-forge-yellow-soft text-forge-orange-deep ring-1 ring-forge-yellow" },
  confirmed:      { label: "Confirmed",      cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  balance_paid:   { label: "Paid in full",   cls: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300" },
  lost:           { label: "Lost",           cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
};

const PROGRAM_NAME: Record<string, string> = {
  FFM: "Forge Filmmaking", FW: "Forge Writing", FC: "Forge Creators", FAI: "Forge AI",
  BFP: "Business Foundations", VE: "Venture Engine", L3C: "L3 Creators",
};

type Props = {
  detail: {
    lead: LeadRow;
    submissions: FormSubmissionRow[];
    payments: PaymentRow[];
    activities: LeadActivityRow[];
  };
  calendlyBookings?: CalendlyBooking[];
  /** Auto-detected from the logged-in session — replaces the old manual dropdown. */
  currentRepName?: string | null;
};

export default function LeadDetailClient({ detail, calendlyBookings = [], currentRepName }: Props) {
  const router = useRouter();
  const [activities, setActivities] = useState<LeadActivityRow[]>(detail.activities);
  const [submitting, setSubmitting] = useState(false);
  const [noteText, setNoteText] = useState("");
  const repName = currentRepName || "Unknown";
  const [responsesOpen, setResponsesOpen] = useState(true); // OPEN by default per founder feedback

  // Deferred AI brief — fetches client-side after page render so page loads fast
  const [aiBrief, setAiBrief] = useState<AiWhyHot | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  useEffect(() => {
    let canceled = false;
    setAiLoading(true);
    fetch(`/api/ai/why-hot?lead_id=${detail.lead.id}`)
      .then(r => r.json())
      .then(j => { if (!canceled) { setAiBrief(j.brief || null); setAiLoading(false); } })
      .catch(() => { if (!canceled) setAiLoading(false); });
    return () => { canceled = true; };
  }, [detail.lead.id]);

  const lead = detail.lead;
  const stage = STAGE_LABEL[lead.funnel_stage || ""] || STAGE_LABEL.form_partial;
  const programName = PROGRAM_NAME[lead.program || ""] || lead.program || "—";

  const why = useMemo(() => whyHotReason(lead), [lead]);
  const talking = useMemo(() => suggestTalkingPoints(lead, detail.submissions), [lead, detail.submissions]);

  // Combined timeline (form + payment + activity + calendly booking)
  const timeline = useMemo(() => {
    type Event = { ts: string; type: "form" | "payment" | "activity" | "booking"; body: any };
    const evts: Event[] = [];
    for (const s of detail.submissions) {
      evts.push({ ts: s.submitted_at, type: "form", body: s });
    }
    for (const p of detail.payments) {
      evts.push({ ts: p.paid_at, type: "payment", body: p });
    }
    for (const a of activities) {
      evts.push({ ts: a.created_at, type: "activity", body: a });
    }
    for (const b of calendlyBookings) {
      evts.push({ ts: b.created_at || b.start_time, type: "booking", body: b });
    }
    evts.sort((a, b) => b.ts.localeCompare(a.ts));
    return evts;
  }, [detail.submissions, detail.payments, activities, calendlyBookings]);

  const activeBookings = calendlyBookings.filter(b => b.status !== "canceled");

  const allResponses = useMemo(() => {
    const merged: Record<string, any> = {};
    for (const s of detail.submissions) {
      if (s.responses) Object.assign(merged, s.responses);
    }
    return merged;
  }, [detail.submissions]);

  async function logActivity(action: string, notes?: string) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, rep_name: repName, action, notes: notes || null }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "Failed to log");
      setActivities([json.activity, ...activities]);
      if (action === "converted" || action === "lost") {
        // Refresh page so lead.funnel_stage reflects the new state
        setTimeout(() => router.refresh(), 200);
      }
    } catch (e: any) {
      alert("Failed to log: " + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    await logActivity("note", noteText.trim());
    setNoteText("");
  }

  return (
    <div className="space-y-5">
      {/* HEADER CARD */}
      <div className="surface-card p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h1 className="font-display text-3xl font-extrabold italic text-forge-black tracking-tight truncate">
                {lead.name || <span className="italic text-fg-subtle">No name</span>}
              </h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded ${stage.cls}`}>{stage.label}</span>
              {activeBookings.length > 0 && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />Interview booked
                </span>
              )}
            </div>
            <div className="text-sm text-fg-muted">
              {programName}{lead.source_campaign_name ? ` · from ${lead.source_campaign_name}` : ""}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-3 text-sm">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 text-forge-black hover:text-forge-orange-deep">
                  <Phone className="w-4 h-4" />+{lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 text-forge-black hover:text-forge-orange-deep truncate max-w-xs">
                  <Mail className="w-4 h-4" />{lead.email}
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center justify-center shrink-0 px-5 py-3 rounded-xl bg-forge-yellow-pale border border-forge-yellow-soft min-w-[120px]">
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold">MQL Score</div>
            <ScoreBig score={lead.score} />
            <div className="text-[10px] text-fg-subtle mt-0.5">out of 100</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-5 pt-5 border-t border-fg-border flex-wrap">
          {lead.phone && <ActionLink href={`tel:${lead.phone}`} icon={<Phone className="w-4 h-4"/>} label="Call" tone="emerald" />}
          {lead.phone && <ActionLink href={`https://wa.me/${lead.phone}`} icon={<MessageCircle className="w-4 h-4"/>} label="WhatsApp" tone="green" external />}
          {lead.email && <ActionLink href={`mailto:${lead.email}`} icon={<Mail className="w-4 h-4"/>} label="Email" tone="cyan" />}
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-muted">Status</span>
              <StatusDropdown leadId={lead.id} initialStatus={lead.last_action} repName={repName} />
            </div>
            {/* Logged-in rep — auto-detected from session, no manual dropdown */}
            {currentRepName && (
              <div className="text-xs text-fg-muted">
                logging as <span className="font-semibold text-forge-black">{currentRepName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI BRIEF (deferred load — page renders fast, brief loads after) */}
      <div className="surface-card p-5 bg-forge-radial border-l-4 border-l-forge-yellow relative overflow-hidden">
        <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
        <div className="flex items-center gap-2 mb-3 text-forge-black relative">
          <Sparkles className="w-4 h-4 text-forge-orange-deep" />
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">AI brief</h2>
          {aiLoading && <span className="text-[10px] text-fg-subtle ml-auto inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-forge-orange animate-pulse" />Generating…</span>}
        </div>
        {aiLoading ? (
          <div className="space-y-2 animate-pulse relative">
            <div className="h-4 bg-forge-yellow-soft rounded w-3/4"></div>
            <div className="h-4 bg-forge-yellow-soft rounded w-1/2"></div>
            <div className="h-4 bg-forge-yellow-pale rounded w-2/3 mt-3"></div>
          </div>
        ) : aiBrief ? (
          <div className="space-y-2.5 relative">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-forge-orange-deep font-semibold mb-0.5">Why call NOW</div>
              <p className="text-base text-forge-black leading-relaxed">{aiBrief.why_now}</p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-forge-orange-deep font-semibold mb-0.5">Best opener</div>
              <p className="font-display text-base text-forge-black leading-relaxed italic">&ldquo;{aiBrief.best_opener}&rdquo;</p>
            </div>
            {aiBrief.flag && (
              <div className="mt-2 px-3 py-2 rounded bg-forge-yellow-soft ring-1 ring-forge-yellow text-sm text-forge-orange-deep">
                ⚑ {aiBrief.flag}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-muted italic relative">No AI brief available — lead has no form responses to analyze yet.</p>
        )}
      </div>

      {/* RULE-BASED REASONING + TALKING POINTS (always visible, complements AI brief) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-3 text-forge-black">
            <Flame className="w-4 h-4 text-forge-orange-deep" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">Why this lead matters</h2>
          </div>
          <p className="text-base text-forge-black leading-relaxed">{why}</p>
          <ScoreBreakdown breakdown={lead.score_breakdown || {}} />
        </div>
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-3 text-forge-black">
            <Sparkles className="w-4 h-4 text-forge-orange-deep" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em]">Talking points</h2>
          </div>
          <ul className="space-y-2">
            {talking.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-forge-black">
                <span className="text-forge-orange mt-1">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 pt-4 border-t border-fg-border text-xs text-fg-muted">
            Source: <span className="text-fg-text/85">{lead.source_campaign_name || "Direct / unknown"}</span>
            {lead.source_utm_source && <> · UTM: <span className="text-fg-text/85">{lead.source_utm_source}</span></>}
            <br/>First seen {fmtDate(lead.first_seen)} · Last activity {fmtDate(lead.last_activity)}
          </div>
        </div>
      </div>

      {/* OUTCOME BUTTONS + NOTES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="surface-card p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-fg-text">After your call, log outcome</h2>
          <div className="grid grid-cols-2 gap-2">
            <OutcomeBtn icon={<Phone className="w-4 h-4"/>}  tone="slate"   label="Called"      onClick={() => logActivity("called")} />
            <OutcomeBtn icon={<PhoneOff className="w-4 h-4"/>}tone="slate"   label="No answer"   onClick={() => logActivity("no_answer")} />
            <OutcomeBtn icon={<CheckCircle2 className="w-4 h-4"/>} tone="emerald" label="Interested"  onClick={() => logActivity("interested")} />
            <OutcomeBtn icon={<XCircle className="w-4 h-4"/>} tone="rose"    label="Not interested" onClick={() => logActivity("objection")} />
            <OutcomeBtn icon={<Clock className="w-4 h-4"/>}  tone="cyan"    label="Follow up"   onClick={() => logActivity("scheduled_followup")} />
            <OutcomeBtn icon={<CheckCircle2 className="w-4 h-4"/>} tone="emeraldFilled" label="Converted ✓" onClick={() => logActivity("converted")} />
          </div>
          <button
            onClick={() => logActivity("lost")}
            disabled={submitting}
            className="w-full mt-2 px-3 py-2 text-sm rounded-md border border-rose-200 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50"
          >Mark lost</button>

          <div className="mt-3 pt-3 border-t border-fg-border/70">
            <ScheduleCallback leadId={lead.id} onScheduled={() => router.refresh()} />
          </div>
        </div>
        <div className="surface-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-3 text-fg-text">Notes</h2>
          <div className="flex gap-2 mb-4">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Anything worth remembering — objections, family dynamic, follow-up date…"
              className="flex-1 text-sm px-3 py-2 rounded-md border border-fg-border bg-white focus:border-forge-yellow focus:outline-none resize-none min-h-[64px]"
            />
            <button
              onClick={submitNote}
              disabled={submitting || !noteText.trim()}
              className="self-end px-4 py-2 text-sm font-medium rounded-md bg-forge-yellow text-forge-black hover:bg-forge-orange disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5"/>Save
            </button>
          </div>
          <div className="space-y-2">
            {activities.filter(a => a.action === "note" && a.notes).slice(0, 5).map(n => (
              <div key={n.id} className="text-sm text-forge-black bg-forge-yellow-pale border border-forge-yellow-soft rounded-md p-3">
                <div className="text-[11px] text-fg-muted mb-1">
                  {n.rep_name || "—"} · {fmtDate(n.created_at)}
                </div>
                {n.notes}
              </div>
            ))}
            {activities.filter(a => a.action === "note").length === 0 && (
              <div className="text-sm text-fg-subtle italic">No notes yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* PAYMENTS (prominent section — was previously buried in timeline) */}
      {detail.payments.length > 0 && (
        <PaymentsCard payments={detail.payments} />
      )}

      {/* TIMELINE */}
      <div className="surface-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 text-fg-text">Timeline</h2>
        <div className="space-y-3">
          {timeline.length === 0 && <div className="text-sm text-fg-subtle italic">No events recorded yet.</div>}
          {timeline.map((e, i) => <TimelineRow key={i} event={e} />)}
        </div>
      </div>

      {/* FORM RESPONSES — open by default per founder feedback */}
      {Object.keys(allResponses).length > 0 && (
        <div className="surface-card overflow-hidden">
          <button
            onClick={() => setResponsesOpen(!responsesOpen)}
            className="w-full px-6 py-4 flex items-center justify-between text-fg-text hover:bg-fg-surface transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-fg-muted" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Application form · {Object.keys(allResponses).length} answers</h2>
            </div>
            {responsesOpen ? <ChevronUp className="w-4 h-4 text-fg-muted"/> : <ChevronDown className="w-4 h-4 text-fg-muted"/>}
          </button>
          {responsesOpen && (
            <div className="px-6 pb-6 border-t border-fg-border pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                {Object.entries(allResponses).map(([q, a], i) => {
                  const valStr = Array.isArray(a) ? a.join(", ") : (a == null ? "" : String(a));
                  const isLong = valStr.length > 120;
                  return (
                    <div key={i} className={`text-sm ${isLong ? "md:col-span-2" : ""}`}>
                      <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-1 font-medium">{q}</div>
                      <div className="text-fg-text leading-relaxed whitespace-pre-wrap bg-fg-surface/40 px-3 py-2 rounded border border-fg-border/70">
                        {valStr || <span className="text-fg-subtle italic">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentsCard({ payments }: { payments: PaymentRow[] }) {
  const captured = payments.filter(p => p.status === "captured");
  const total = captured.reduce((s, p) => s + Number(p.amount_inr || 0), 0);
  return (
    <div className="surface-card p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-text inline-flex items-center gap-2">
          <IndianRupee className="w-4 h-4 text-emerald-600" />
          Payments · {payments.length}
        </h2>
        <div className="text-sm text-fg-muted">
          Total captured: <span className="font-semibold text-emerald-700 tabular-nums">{inr(total)}</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-fg-border">
        <table className="w-full text-sm">
          <thead className="bg-fg-surface text-[11px] uppercase tracking-wider text-fg-muted">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Date</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Account</th>
              <th className="text-left px-3 py-2 font-medium">Razorpay ID</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id} className="border-t border-fg-border/70">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(p.paid_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium text-fg-text">{(p.payment_type || "—").replace(/_/g, " ")}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{inr(p.amount_inr)}</td>
                <td className="px-3 py-2">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${p.status === "captured" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : p.status === "failed" ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-fg-surface text-fg-text ring-1 ring-fg-border"}`}>
                    {p.status || "—"}
                  </span>
                </td>
                <td className="px-3 py-2 text-fg-muted whitespace-nowrap">{p.account}</td>
                <td className="px-3 py-2 text-fg-subtle text-[11px] font-mono">{p.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreBig({ score }: { score: number }) {
  let color = "text-fg-muted";
  if (score >= 75) color = "text-forge-orange-deep";
  else if (score >= 50) color = "text-forge-orange";
  else if (score >= 25) color = "text-forge-yellow";
  return <div className={`font-display text-4xl font-extrabold italic tabular-nums ${color}`}>{score}</div>;
}

function ScoreBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const sorted = Object.entries(breakdown).filter(([_, v]) => Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!sorted.length) return null;
  return (
    <div className="mt-4 pt-4 border-t border-fg-border">
      <div className="text-[11px] text-fg-muted uppercase tracking-wider mb-2">Score breakdown</div>
      <div className="space-y-1">
        {sorted.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <span className="text-fg-text/80">{k.replace(/_/g, " ")}</span>
            <span className="font-mono text-emerald-700 tabular-nums">+{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionLink({ href, icon, label, tone, external }: { href: string; icon: React.ReactNode; label: string; tone: "emerald" | "green" | "cyan"; external?: boolean }) {
  const cls = tone === "emerald" ? "border-forge-orange-deep text-forge-black bg-forge-yellow hover:bg-forge-orange shadow-soft"
            : tone === "green"   ? "border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
            :                       "border-forge-yellow-soft text-forge-orange-deep bg-forge-yellow-pale hover:bg-forge-yellow-soft";
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener" : undefined}
      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-md border transition-colors ${cls}`}
    >
      {icon}{label}
    </a>
  );
}

function OutcomeBtn({ icon, label, tone, onClick }: { icon: React.ReactNode; label: string; tone: "slate" | "emerald" | "rose" | "cyan" | "emeraldFilled"; onClick: () => void }) {
  const cls = tone === "emerald"        ? "border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50"
            : tone === "emeraldFilled"  ? "border-forge-orange-deep text-forge-black bg-forge-yellow hover:bg-forge-orange shadow-soft"
            : tone === "rose"           ? "border-rose-200 text-rose-700 bg-white hover:bg-rose-50"
            : tone === "cyan"           ? "border-forge-yellow-soft text-forge-orange-deep bg-white hover:bg-forge-yellow-pale"
            :                              "border-fg-border text-forge-black bg-white hover:bg-fg-surface";
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border transition-colors ${cls}`}>
      {icon}{label}
    </button>
  );
}

function TimelineRow({ event }: { event: { ts: string; type: string; body: any } }) {
  const ago = timeAgo(event.ts);
  if (event.type === "form") {
    const s = event.body as FormSubmissionRow;
    const isCsv = s.form_id === "csv_import";
    return (
      <Row
        icon={<FileText className="w-4 h-4 text-cyan-600"/>}
        title={isCsv ? "Lead imported from TeleCRM" : (s.is_completed ? "Form submitted" : "Form started (partial)")}
        subtitle={isCsv ? "(original submission date unknown)" : (s.form_name || s.form_id)}
        ts={event.ts}
        ago={isCsv ? "" : ago}
      />
    );
  }
  if (event.type === "payment") {
    const p = event.body as PaymentRow;
    return (
      <Row icon={<IndianRupee className="w-4 h-4 text-emerald-600"/>} title={`${(p.payment_type || "Payment").replace(/_/g," ")} — ${inr(p.amount_inr)}`} subtitle={`${p.account} account · ${p.status || ""}`} ts={event.ts} ago={ago} />
    );
  }
  if (event.type === "booking") {
    const b = event.body as CalendlyBooking;
    const canceled = b.status === "canceled";
    const startTime = new Date(b.start_time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
    return (
      <Row
        icon={<Calendar className={`w-4 h-4 ${canceled ? "text-rose-600" : "text-emerald-600"}`}/>}
        title={canceled ? `📅 Booking canceled — ${b.event_name}` : `📅 Booked: ${b.event_name}`}
        subtitle={`Interview at ${startTime} IST`}
        ts={event.ts}
        ago={ago}
      />
    );
  }
  const a = event.body as LeadActivityRow;
  const labels: Record<string,string> = {
    called: "📞 Called", no_answer: "📵 No answer", busy: "🔕 Busy", messaged: "💬 Messaged",
    interested: "✅ Interested", objection: "❗ Objection", scheduled_followup: "⏰ Follow-up scheduled",
    converted: "🎉 Converted", lost: "❌ Lost", note: "📝 Note",
  };
  return (
    <Row icon={<MessageSquare className="w-4 h-4 text-amber-600"/>} title={labels[a.action] || a.action} subtitle={a.rep_name ? `by ${a.rep_name}${a.notes ? ` — ${a.notes}` : ""}` : a.notes || ""} ts={event.ts} ago={ago} />
  );
}

function Row({ icon, title, subtitle, ts, ago }: { icon: React.ReactNode; title: string; subtitle?: string; ts: string; ago: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-fg-surface border border-fg-border flex items-center justify-center">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium text-fg-text">{title}</div>
          <div className="text-xs text-fg-muted shrink-0 tabular-nums">{ago}</div>
        </div>
        {subtitle && <div className="text-xs text-fg-muted mt-0.5 truncate">{subtitle}</div>}
        <div className="text-[10px] text-fg-subtle mt-0.5">{fmtDate(ts)}</div>
      </div>
    </div>
  );
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec/86400)}d ago`;
  if (sec < 30 * 86400) return `${Math.floor(sec/(7*86400))}w ago`;
  return `${Math.floor(sec/(30*86400))}mo ago`;
}
