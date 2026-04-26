import Link from "next/link";
import { ProgramScorecard } from "@/lib/data";
import { inr, pct, fmtInt, deltaPct } from "@/lib/format";
import { ArrowUpRight, ArrowDownRight, ChevronRight } from "lucide-react";

const PROGRAM_STYLE: Record<string, { dot: string; ring: string; tag: string }> = {
  FFM: { dot: "bg-yellow-500", ring: "ring-yellow-200", tag: "text-yellow-800 bg-yellow-50 ring-1 ring-yellow-200" },
  FW:  { dot: "bg-sky-400",    ring: "ring-sky-200",    tag: "text-sky-700 bg-sky-50 ring-1 ring-sky-200" },
  FC:  { dot: "bg-red-500",    ring: "ring-red-200",    tag: "text-red-700 bg-red-50 ring-1 ring-red-200" },
  FAI: { dot: "bg-indigo-700", ring: "ring-indigo-200", tag: "text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200" },
};

function MetricRow({ label, now, prev, format = "inr", invert = false }: {
  label: string; now: number; prev?: number;
  format?: "inr" | "int" | "pct"; invert?: boolean;
}) {
  const fmt = format === "int" ? fmtInt : format === "pct" ? (n: number) => pct(n*100) : (n: number) => inr(n, { compact: true });
  const showDelta = prev !== undefined && prev > 0;
  const d = showDelta ? deltaPct(now, prev!) : 0;
  const positive = invert ? d < 0 : d > 0;

  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-fg-text">{now > 0 ? fmt(now) : "—"}</span>
        {showDelta && (
          <span className={`inline-flex items-center text-[10px] font-medium ${
            positive ? "text-emerald-600" : d === 0 ? "text-fg-subtle" : "text-rose-600"
          }`}>
            {d > 0 ? <ArrowUpRight className="w-2.5 h-2.5" /> : d < 0 ? <ArrowDownRight className="w-2.5 h-2.5" /> : null}
            {Math.abs(d).toFixed(0)}%
          </span>
        )}
      </span>
    </div>
  );
}

export default function ProgramScorecards({
  scorecards, monthLabel,
}: {
  scorecards: ProgramScorecard[]; monthLabel?: string;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-fg-text">Per-program scorecards</h2>
        <span className="text-xs text-fg-muted">{monthLabel} · vs previous month</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {scorecards.map((s) => {
          const style = PROGRAM_STYLE[s.program];
          const tm = s.this_month;
          const pm = s.prev_month;
          return (
            <Link
              key={s.program}
              href={`/leads?program=${s.program}`}
              className={`surface-card surface-card-hover p-5 ring-1 ${style.ring} animate-fade-in block group`}
              title={`View ${s.name} leads`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                  <span className="font-semibold text-fg-text">{s.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${style.tag}`}>{s.program}</span>
                  <ChevronRight className="w-4 h-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              <div className="space-y-2.5">
                <MetricRow label="Applicants"      now={tm.applicants}     prev={pm.applicants}     format="int" />
                <MetricRow label="App fee paid"    now={tm.app_fee_count}  prev={pm.app_fee_count}  format="int" />
                <MetricRow label="Converts"        now={tm.converts}       prev={pm.converts}       format="int" />
                <div className="border-t border-fg-border my-2" />
                <MetricRow label="App fee CR"      now={tm.app_fee_cr}     prev={pm.app_fee_cr}     format="pct" />
                <MetricRow label="Conversion rate" now={tm.conversion_rate} prev={pm.conversion_rate} format="pct" />
                <div className="border-t border-fg-border my-2" />
                <MetricRow label="Total Revenue"   now={tm.total_rev}      prev={pm.total_rev} />
                <MetricRow label="Marketing spend" now={tm.ads_spend + tm.influencer_spend} prev={pm.ads_spend + pm.influencer_spend} invert />
                <MetricRow label="CAQ"             now={tm.caq}            prev={pm.caq} invert />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
