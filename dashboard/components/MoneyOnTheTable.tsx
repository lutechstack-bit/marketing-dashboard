// "Money on the Table" — for sales reps on /queue.
//
// Shows the total potential incentive earnings from abandoned leads (form_
// submitted stage) across the rep's assigned programs. Per founder spec:
// reps earn ONLY on form_submitted → app_fee_paid conversion. So abandoned
// leads × per-program incentive = the "earnable right now" pool.
//
// Hero number = motivational anchor. Per-program breakdown shows where to
// focus. Top leads = what to call first.

import Link from "next/link";
import { Banknote, Phone, MessageCircle, ChevronRight, TrendingUp } from "lucide-react";
import { fetchEarnableNow } from "@/lib/sales-stats";
import { inr } from "@/lib/format";

export default async function MoneyOnTheTable({ repId }: { repId: string }) {
  const data = await fetchEarnableNow(repId);
  if (data.total_count === 0) return null;

  return (
    <div className="surface-card mb-5 overflow-hidden relative">
      {/* Top stripe gradient */}
      <div className="h-1 bg-forge-gradient" />

      {/* Hero — the big italic number */}
      <div className="px-5 py-5 bg-forge-radial relative overflow-hidden">
        <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
        <div className="absolute right-6 top-3 opacity-[0.06] pointer-events-none">
          <Banknote className="w-32 h-32 text-forge-orange-deep" strokeWidth={1.2} />
        </div>
        <div className="relative">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold inline-flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" />Earnable right now · partials + abandoned
          </div>
          <div className="font-display text-5xl font-extrabold italic text-forge-black mt-1 leading-none tabular-nums">
            {inr(data.total_potential_earnings, { compact: true })}
          </div>
          <div className="text-sm text-fg-muted mt-2 max-w-2xl">
            <span className="font-semibold text-forge-black">{data.total_count.toLocaleString("en-IN")} leads</span> haven&apos;t paid the app fee yet (started or completed the form). Each one you convert to app-fee-paid{" "}
            <span className="font-semibold text-forge-orange-deep">locks ₹{topAvg(data).toLocaleString("en-IN")} into your earnings</span>{" "}
            (released when they pay balance).
          </div>
        </div>
      </div>

      {/* Per-program breakdown */}
      <div className="px-5 py-3 border-t border-fg-border/60">
        <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold mb-2">Where the money is</div>
        <div className="flex flex-wrap gap-2">
          {data.by_program.map(p => (
            <div key={p.program} className="px-3 py-2 rounded-lg bg-forge-yellow-pale ring-1 ring-forge-yellow-soft min-w-[160px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.1em] text-forge-orange-deep">{p.program}</span>
                <span className="text-[10px] text-fg-muted tabular-nums">@ {inr(p.incentive_per_lead, { compact: true })}/lead</span>
              </div>
              <div className="font-display text-xl font-extrabold italic text-forge-black tabular-nums">
                {inr(p.total, { compact: true })}
              </div>
              <div className="text-[10px] text-fg-muted">{p.count.toLocaleString("en-IN")} abandoned</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top 8 highest-MQL leads to call */}
      <div className="border-t border-fg-border/60">
        <div className="px-5 py-2 text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold bg-forge-cream/40">
          Call these first · highest MQL score
        </div>
        <div className="divide-y divide-fg-border/60">
          {data.top_leads.map((o, i) => (
            <div key={o.lead_id} className="px-5 py-2.5 flex items-center gap-3 flex-wrap text-sm">
              <span className="text-[10px] font-bold tabular-nums text-fg-subtle w-5">#{i + 1}</span>

              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold tabular-nums text-xs ${
                o.score >= 75 ? "bg-forge-gradient text-forge-black"
                : o.score >= 60 ? "bg-forge-yellow-soft text-forge-orange-deep"
                : "bg-fg-surface text-fg-muted"
              }`}>{o.score}</span>

              <div className="flex-1 min-w-0">
                <Link href={`/leads/${o.lead_id}`} className="font-semibold text-forge-black hover:text-forge-orange-deep">
                  {o.name || o.email || o.phone || "—"}
                </Link>
                <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                  <span className="font-semibold uppercase tracking-[0.1em] text-[10px]">{o.program}</span>
                  <span className="text-fg-subtle">·</span>
                  <span>{o.hours_since_activity > 24 ? `${Math.round(o.hours_since_activity / 24)}d cold` : `${Math.round(o.hours_since_activity)}h ago`}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted font-semibold">If they pay app fee</div>
                <div className="font-bold text-forge-orange-deep tabular-nums">+{inr(o.incentive_amount)}</div>
              </div>

              <div className="flex items-center gap-1">
                {o.phone && (
                  <a href={`tel:${o.phone}`} title="Call" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                    <Phone className="w-4 h-4" />
                  </a>
                )}
                {o.phone && (
                  <a href={`https://wa.me/${o.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" title="WhatsApp" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                    <MessageCircle className="w-4 h-4" />
                  </a>
                )}
                <Link href={`/leads/${o.lead_id}`} className="p-1.5 rounded text-fg-muted hover:text-forge-orange-deep hover:bg-forge-yellow-pale">
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Average incentive across the rep's programs — used in the hero subtitle. */
function topAvg(data: { by_program: Array<{ incentive_per_lead: number; count: number }> }): number {
  const totalLeads = data.by_program.reduce((s, p) => s + p.count, 0);
  if (totalLeads === 0) return 0;
  const weighted = data.by_program.reduce((s, p) => s + p.incentive_per_lead * p.count, 0);
  return Math.round(weighted / totalLeads);
}
