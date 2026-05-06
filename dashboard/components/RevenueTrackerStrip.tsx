// Revenue / Cash Flow strip — sources from the LevelUp Revenue Tracker sheet.
// Shows booked-vs-collected, collection %, outstanding, app→enrollment funnel,
// and per-student averages. Numbers come pre-aggregated from the sheet so
// the team's weekly close is the source of truth.
//
// Used on both Overview and Insights pages so the headline finance numbers
// match across pages.

import type { RevenueMetrics } from "@/lib/revenue-tracker";
import { inr } from "@/lib/format";
import { Wallet, IndianRupee, Banknote, Users, TrendingUp, AlertTriangle, RefreshCw, Receipt } from "lucide-react";

export default function RevenueTrackerStrip({ metrics }: { metrics: RevenueMetrics | null }) {
  if (!metrics || !metrics.ok) {
    return (
      <div className="surface-card p-4 mb-6 border-l-4 border-l-amber-400 bg-amber-500/[0.06]">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-fg-text">Revenue Tracker not connected</h3>
            <p className="text-xs text-fg-muted mt-1">
              {metrics?.error
                ? `Error: ${metrics.error}`
                : "Share the Revenue Tracker sheet with the dashboard service account to see Booked Revenue, Cash Received, Collection %, and Outstanding Balance here."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const tiles: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: "indigo"|"emerald"|"amber"|"rose"|"cyan"|"violet" }[] = [
    {
      label: "Booked Revenue",
      value: inr(metrics.booked_revenue_inr, { compact: true }),
      sub: `${metrics.applications} applications`,
      icon: <Receipt className="w-4 h-4" />, accent: "indigo",
    },
    {
      label: "Cash Received",
      value: inr(metrics.cash_received_inr, { compact: true }),
      sub: `${metrics.collection_pct}% collected`,
      icon: <Banknote className="w-4 h-4" />, accent: "emerald",
    },
    {
      label: "Outstanding",
      value: inr(metrics.outstanding_balance_inr, { compact: true }),
      sub: metrics.failed_transactions > 0 ? `${metrics.failed_transactions} failed tx` : "all current",
      icon: <Wallet className="w-4 h-4" />, accent: "amber",
    },
    {
      label: "Net Cash In",
      value: inr(metrics.net_cash_in_inr, { compact: true }),
      sub: metrics.refunds_inr > 0 ? `${inr(metrics.refunds_inr, { compact: true })} refunded` : "no refunds",
      icon: <IndianRupee className="w-4 h-4" />, accent: "cyan",
    },
    {
      label: "Conversions",
      value: String(metrics.conversions),
      sub: `${metrics.conversion_rate_pct}% conversion`,
      icon: <TrendingUp className="w-4 h-4" />, accent: "violet",
    },
    {
      label: "Avg / Student",
      value: inr(metrics.avg_revenue_per_student_inr, { compact: true }),
      sub: `${inr(metrics.avg_collected_per_student_inr, { compact: true })} collected`,
      icon: <Users className="w-4 h-4" />, accent: "rose",
    },
  ];

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-fg-text inline-flex items-center gap-2">
            <Receipt className="w-4 h-4 text-fg-muted" />
            Revenue & Cash Flow
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">Live from the LevelUp Revenue Tracker · refreshed hourly</p>
        </div>
        <span className="text-[11px] text-fg-subtle inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" />
          {new Date(metrics.fetched_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {tiles.map((t, i) => <Tile key={i} {...t} />)}
      </div>
    </div>
  );
}

const ACCENT_BG: Record<string, string> = {
  amber:   "bg-amber-500/[0.07] border-amber-500/30",
  indigo:  "bg-indigo-500/[0.07] border-indigo-500/30",
  emerald: "bg-emerald-500/[0.07] border-emerald-500/30",
  rose:    "bg-rose-500/[0.07] border-rose-500/30",
  cyan:    "bg-cyan-500/[0.07] border-cyan-500/30",
  violet:  "bg-violet-500/[0.07] border-violet-500/30",
};
const ACCENT_FG: Record<string, string> = {
  amber:   "text-amber-500",
  indigo:  "text-indigo-400",
  emerald: "text-emerald-500",
  rose:    "text-rose-400",
  cyan:    "text-cyan-400",
  violet:  "text-violet-400",
};

function Tile({ label, value, sub, icon, accent }: any) {
  return (
    <div className={`surface-card relative rounded-xl border p-4 ${ACCENT_BG[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">{label}</span>
        <span className={ACCENT_FG[accent]}>{icon}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-fg-text leading-none">{value}</div>
      {sub && <div className="text-[11px] text-fg-muted mt-1.5">{sub}</div>}
    </div>
  );
}
