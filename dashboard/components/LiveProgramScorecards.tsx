// Live per-program scorecards — replaces the manually-maintained "Inputs" tab.
//
// Source: lib/program-scorecards.ts → fetchProgramScorecards()
// Shows the latest closed month per program + delta vs prior month, with all
// metrics the founder asked for: applications, app fees paid, converts,
// conversion rates, marketing spend, app fee revenue, total revenue, CPA, CAC.

import Link from "next/link";
import type { ProgramMonthScorecard } from "@/lib/program-scorecards";
import { inr, fmtInt } from "@/lib/format";
import { ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react";

const PROGRAM_STYLE: Record<string, { dot: string; ring: string; tag: string; name: string }> = {
  FFM: { dot: "bg-yellow-500",  ring: "ring-yellow-200",  tag: "text-yellow-800 bg-yellow-50 ring-1 ring-yellow-200",  name: "Forge Filmmaking" },
  FW:  { dot: "bg-sky-400",     ring: "ring-sky-200",     tag: "text-sky-700 bg-sky-50 ring-1 ring-sky-200",            name: "Forge Writing" },
  FC:  { dot: "bg-red-500",     ring: "ring-red-200",     tag: "text-red-700 bg-red-50 ring-1 ring-red-200",            name: "Forge Creators" },
  FAI: { dot: "bg-indigo-700",  ring: "ring-indigo-200",  tag: "text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200",   name: "Forge AI" },
  VE:  { dot: "bg-blue-500",    ring: "ring-blue-200",    tag: "text-blue-700 bg-blue-50 ring-1 ring-blue-200",         name: "Video Editing" },
  BFP: { dot: "bg-violet-500",  ring: "ring-violet-200",  tag: "text-violet-700 bg-violet-50 ring-1 ring-violet-200",   name: "BFP" },
  L3C: { dot: "bg-fuchsia-500", ring: "ring-fuchsia-200", tag: "text-fuchsia-700 bg-fuchsia-50 ring-1 ring-fuchsia-200", name: "L3 Creators" },
};

const MONTH_LABEL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function LiveProgramScorecards({
  cells,
}: {
  cells: ProgramMonthScorecard[];
}) {
  if (!cells || cells.length === 0) {
    return (
      <div className="surface-card p-6 mb-8 text-fg-muted text-sm">
        No program scorecard data yet — Meta API or Supabase didn't return any rows for the selected window.
      </div>
    );
  }

  // Group by program
  const byProgram = new Map<string, ProgramMonthScorecard[]>();
  for (const c of cells) {
    if (!byProgram.has(c.program)) byProgram.set(c.program, []);
    byProgram.get(c.program)!.push(c);
  }

  // Sort cells in each program by ym ascending so [last] is the latest month
  for (const [, arr] of byProgram) arr.sort((a, b) => a.ym.localeCompare(b.ym));

  // Order: Forge family first, then Live
  const orderedPrograms = ["FFM", "FW", "FC", "FAI", "VE", "BFP", "L3C"].filter(p => byProgram.has(p));

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-fg-text">Per-program scorecards</h2>
        <span className="text-xs text-fg-muted">Live — Meta API spend × Supabase funnel × Razorpay revenue · this month vs prior</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {orderedPrograms.map(code => {
          const arr = byProgram.get(code)!;
          const cur = arr[arr.length - 1];
          const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
          const style = PROGRAM_STYLE[code] || PROGRAM_STYLE.FFM;
          const monthLabel = `${MONTH_LABEL[cur.month - 1]} '${String(cur.year).slice(-2)}`;
          return (
            <Link
              key={code}
              href={`/leads?program=${code}`}
              className={`surface-card surface-card-hover p-5 ring-1 ${style.ring} animate-fade-in block group`}
              title={`View ${style.name} leads`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full ${style.dot} shrink-0`} />
                  <span className="font-semibold text-fg-text truncate">{style.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${style.tag}`}>{code}</span>
                  <ChevronRight className="w-4 h-4 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2">{monthLabel}</div>
              <div className="space-y-2">
                <Row label="Applications"     cur={cur.applications}        prev={prev?.applications}        format="int" />
                <Row label="App fee paid"     cur={cur.app_fees_paid}       prev={prev?.app_fees_paid}       format="int" />
                <Row label="Converts"         cur={cur.converts}            prev={prev?.converts}            format="int" />
                <div className="border-t border-fg-border/60 my-2" />
                <Row label="App-fee CR"       cur={cur.app_fee_conv_pct}    prev={prev?.app_fee_conv_pct}    format="pct" />
                <Row label="Conversion rate"  cur={cur.convert_rate_pct}    prev={prev?.convert_rate_pct}    format="pct" />
                <div className="border-t border-fg-border/60 my-2" />
                <Row label="App-fee revenue"  cur={cur.app_fee_revenue_inr} prev={prev?.app_fee_revenue_inr} format="inr" />
                <Row label="Booked revenue"   cur={cur.total_revenue_inr}   prev={prev?.total_revenue_inr}   format="inr" />
                <Row label="Marketing spend"  cur={cur.marketing_spend_inr} prev={prev?.marketing_spend_inr} format="inr" invert />
                <Row label="CPA"              cur={cur.cpa_inr}             prev={prev?.cpa_inr}             format="inr" invert />
                <Row label="CAC"              cur={cur.cac_inr}             prev={prev?.cac_inr}             format="inr" invert />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, cur, prev, format, invert }: {
  label: string; cur: number; prev?: number;
  format: "int" | "pct" | "inr";
  invert?: boolean;
}) {
  const fmt = format === "int" ? fmtInt
            : format === "pct" ? (n: number) => `${n.toFixed(1)}%`
            :                    (n: number) => inr(n, { compact: true });
  const showDelta = prev !== undefined && prev > 0;
  const d = showDelta ? Math.round(1000 * (cur - prev!) / prev!) / 10 : 0;
  const positive = invert ? d < 0 : d > 0;
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-fg-text">{cur > 0 ? fmt(cur) : "—"}</span>
        {showDelta && d !== 0 && (
          <span className={`inline-flex items-center text-[10px] font-medium ${
            positive ? "text-emerald-500" : "text-rose-500"
          }`}>
            {d > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(d).toFixed(1)}%
          </span>
        )}
      </span>
    </div>
  );
}
