// Single source of truth for lead-count metrics across the dashboard.
//
// Why this exists: prior to this file, /, /insights, /queue, /leads each had
// their own bespoke count logic. Programs were hardcoded in 3 different lists
// (one of them missing VE/BFP/L3C). Period defaults differed per page. Stage
// counts were sometimes exact ("at this stage now") and sometimes cumulative
// ("ever reached this stage"). Cache TTLs were 30s/60s mixed. Net result: the
// founder seeing different numbers for the same lead population on adjacent
// pages.
//
// The fix: every page calls fetchLeadsStats(opts) and renders from the same
// canonical shape. One Postgres pull, in-memory aggregation, cached 60s with
// the "leads" tag (so webhooks invalidate correctly).
//
// Threshold conventions (locked to lib/scoring.ts v3 framework):
//   · HOT       = score >= 75   (21% conversion in historical data)
//   · QUALIFIED = score >= 60   (warm-or-hot, 9.7% conversion)
//   · SCOREABLE = has non-empty score_breakdown
//
// Period falls back to created_at when first_seen is null (CSV/TeleCRM-imported
// leads frequently don't have first_seen populated). All four pages must use
// the same fallback or "30d" filters silently exclude historical leads.

import { unstable_cache } from "next/cache";
import { supabase } from "./supabase";
import { PRODUCTS, PRODUCTS_BY_FAMILY, type Family } from "./products";
import { STAGE_RANK } from "./telecrm-mapping";

// ---------------------------------------------------------------- types

export type PeriodId = "all" | "today" | "7d" | "30d" | "mtd" | "custom";

export type Period = {
  id: PeriodId;
  label: string;
  isAll: boolean;
  startMs: number | null;     // null when isAll
  endMs: number;
  prevStartMs: number | null; // for delta vs prior period of same length
  prevEndMs: number | null;
};

export type LeadsStatsOpts = {
  family?: Family | "all";        // shorthand for programs
  programs?: string[];            // overrides family
  period?: PeriodId;
  customStart?: string;           // ISO; only when period === "custom"
  customEnd?: string;
  includeLost?: boolean;          // default true
};

export type ProgramStats = {
  program: string;
  total: number;
  scoreable: number;
  qualified: number;        // >= 60
  hot: number;              // >= 75
  by_stage: Record<string, number>;            // current-stage exact
  by_stage_cumulative: Record<string, number>; // ever-reached stage or further
};

export type LeadsStats = {
  period: Period;
  filters: { programs: string[]; includeLost: boolean };

  // Headline counts
  total: number;
  scoreable: number;
  qualified: number;        // >= 60
  hot: number;              // >= 75
  qualified_pct: number;    // qualified / scoreable
  hot_pct: number;          // hot / scoreable
  prev_total: number;
  delta_pct: number;        // (total - prev) / prev * 100

  // Score-tier distribution (across scoreable leads)
  by_tier: { junk: number; cold: number; ok: number; warm: number; hot: number };

  // Per-program breakdown
  by_program: Record<string, ProgramStats>;

  // Funnel stage breakdown (across all selected programs in period)
  by_stage: Record<string, number>;             // exact: leads CURRENTLY at this stage
  by_stage_cumulative: Record<string, number>;  // ≥ this stage's rank

  // Lost-reason breakdown (top reasons + Other)
  // Pulled from form_submissions.responses since that's where TeleCRM sync
  // wrote it. Not always populated (only available for TeleCRM-synced leads).
  lost_reasons: { reason: string | null; count: number }[];
};

// ---------------------------------------------------------------- helpers

const dayMs = 86400_000;

export function buildPeriod(id: PeriodId, customStart?: string, customEnd?: string): Period {
  const now = Date.now();
  const labelPrev = "vs prior period";
  if (id === "all")    return { id, label: "All time",     isAll: true,  startMs: null,            endMs: now, prevStartMs: null, prevEndMs: null };
  if (id === "today")  { const d = new Date(); d.setHours(0,0,0,0);                  return periodOf(id, "Today",          d.getTime(), now); }
  if (id === "7d")     return periodOf(id, "Last 7 days",  now - 7  * dayMs, now);
  if (id === "30d")    return periodOf(id, "Last 30 days", now - 30 * dayMs, now);
  if (id === "mtd")    { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);    return periodOf(id, "Month to date", d.getTime(), now); }
  if (id === "custom") {
    const s = customStart ? new Date(customStart).getTime() : now - 30 * dayMs;
    const e = customEnd   ? new Date(customEnd).getTime()   : now;
    return periodOf(id, `${new Date(s).toLocaleDateString("en-IN")} → ${new Date(e).toLocaleDateString("en-IN")}`, s, e);
  }
  return { id: "all", label: "All time", isAll: true, startMs: null, endMs: now, prevStartMs: null, prevEndMs: null };
}

function periodOf(id: PeriodId, label: string, start: number, end: number): Period {
  const len = end - start;
  return { id, label, isAll: false, startMs: start, endMs: end, prevStartMs: start - len, prevEndMs: start };
}

function tierOf(score: number): keyof LeadsStats["by_tier"] {
  if (score >= 75) return "hot";
  if (score >= 60) return "warm";
  if (score >= 45) return "ok";
  if (score >= 30) return "cold";
  return "junk";
}

function resolvePrograms(opts: LeadsStatsOpts): string[] {
  if (opts.programs?.length) return opts.programs.slice().sort();
  if (opts.family === "all" || !opts.family) return PRODUCTS.map(p => p.code).sort();
  return PRODUCTS_BY_FAMILY[opts.family].map(p => p.code).sort();
}

// ---------------------------------------------------------------- main

/**
 * Pull all leads in the requested program scope (with their relevant columns),
 * compute every counter the dashboard needs in one in-memory pass, return.
 *
 * 60s cache, "leads" tag — webhooks (Razorpay, Tally, TeleCRM) invalidate.
 */
export async function fetchLeadsStats(opts: LeadsStatsOpts = {}): Promise<LeadsStats> {
  const programs = resolvePrograms(opts);
  const includeLost = opts.includeLost !== false; // default true
  const period = buildPeriod(opts.period || "all", opts.customStart, opts.customEnd);

  const cacheKey = JSON.stringify({
    programs,
    includeLost,
    p: opts.period || "all",
    s: opts.customStart || null,
    e: opts.customEnd || null,
  });

  return unstable_cache(
    () => computeLeadsStats({ programs, includeLost, period }),
    ["leads-stats-v1", cacheKey],
    { revalidate: 60, tags: ["leads"] },
  )();
}

async function computeLeadsStats(args: {
  programs: string[];
  includeLost: boolean;
  period: Period;
}): Promise<LeadsStats> {
  const { programs, includeLost, period } = args;

  // Pull leads in the program scope. We select the minimum needed for every
  // counter (id, program, funnel_stage, score, score_breakdown, first_seen,
  // created_at). 42k rows × ~80 bytes/row = ~3 MB — fine in memory.
  const PAGE = 1000;
  const allLeads: any[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from("leads")
      .select("id,program,funnel_stage,score,score_breakdown,first_seen,created_at")
      .in("program", programs)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`leads-stats fetch: ${error.message}`);
    const page = data || [];
    allLeads.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
    if (offset > 200_000) break; // safety
  }

  // Period filter — uses first_seen || created_at as the lead's "born" date
  const inPeriod = (l: any): boolean => {
    if (period.isAll) return true;
    const ts = l.first_seen || l.created_at;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && t >= period.startMs! && t < period.endMs;
  };
  const inPrevPeriod = (l: any): boolean => {
    if (period.isAll || period.prevStartMs == null || period.prevEndMs == null) return false;
    const ts = l.first_seen || l.created_at;
    if (!ts) return false;
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && t >= period.prevStartMs && t < period.prevEndMs;
  };

  const includeLead = (l: any): boolean => {
    if (!includeLost && l.funnel_stage === "lost") return false;
    return true;
  };

  // Cumulative stage check — "leads at >= this rank"
  const cumStages = ["form_partial", "form_submitted", "app_fee_paid", "accepted", "confirmed", "balance_paid"];

  // ---------- Aggregate ----------
  let total = 0;
  let scoreable = 0;
  let qualified = 0;
  let hot = 0;
  const by_tier = { junk: 0, cold: 0, ok: 0, warm: 0, hot: 0 };
  const by_program: Record<string, ProgramStats> = {};
  const by_stage: Record<string, number> = {};
  const by_stage_cumulative: Record<string, number> = {};
  for (const s of cumStages) by_stage_cumulative[s] = 0;

  let prev_total = 0;

  for (const l of allLeads) {
    if (inPrevPeriod(l) && includeLead(l)) prev_total++;
    if (!inPeriod(l)) continue;
    if (!includeLead(l)) continue;
    total++;

    // Per-program
    const prog = l.program;
    if (!by_program[prog]) {
      by_program[prog] = {
        program: prog, total: 0, scoreable: 0, qualified: 0, hot: 0,
        by_stage: {}, by_stage_cumulative: {},
      };
      for (const s of cumStages) by_program[prog].by_stage_cumulative[s] = 0;
    }
    const p = by_program[prog];
    p.total++;

    // Stage — exact
    const stage = l.funnel_stage || "form_submitted";
    by_stage[stage] = (by_stage[stage] || 0) + 1;
    p.by_stage[stage] = (p.by_stage[stage] || 0) + 1;

    // Stage — cumulative ("ever reached this stage or further")
    const myRank = STAGE_RANK[stage] ?? 0;
    for (const s of cumStages) {
      const sRank = STAGE_RANK[s] ?? 0;
      if (myRank >= sRank) {
        by_stage_cumulative[s]++;
        p.by_stage_cumulative[s]++;
      }
    }

    // Score / scoreable / tier
    const breakdown = l.score_breakdown;
    const isScoreable = breakdown && typeof breakdown === "object" && Object.keys(breakdown).length > 0;
    if (isScoreable) {
      scoreable++;
      p.scoreable++;
      const score = Number(l.score) || 0;
      const tier = tierOf(score);
      by_tier[tier]++;
      if (score >= 60) { qualified++; p.qualified++; }
      if (score >= 75) { hot++;       p.hot++; }
    }
  }

  // ---------- Lost reasons ----------
  // Pulled from form_submissions.responses.lost_reason (TeleCRM-synced). For
  // leads not synced from TeleCRM, lost_reason is null.
  // We query distinct lost_reason values in scope and count them. Not cached
  // separately — same cache cycle as the main aggregation.
  const lostReasonCounts = new Map<string | null, number>();
  if (includeLost) {
    // Pull form_submissions.responses for lost leads only. For ~6500 lost
    // leads this is a single paginated query.
    const lostIds = allLeads
      .filter(l => inPeriod(l) && l.funnel_stage === "lost")
      .map(l => l.id);
    if (lostIds.length > 0) {
      // Chunk by 200 to stay under PostgREST URL limit
      for (let i = 0; i < lostIds.length; i += 200) {
        const chunk = lostIds.slice(i, i + 200);
        const { data } = await supabase
          .from("form_submissions")
          .select("lead_id,responses")
          .in("lead_id", chunk);
        for (const row of (data || [])) {
          const reason = (row as any).responses?.lost_reason || null;
          lostReasonCounts.set(reason, (lostReasonCounts.get(reason) || 0) + 1);
        }
      }
    }
  }
  const lost_reasons = [...lostReasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ---------- Final shape ----------
  const qualified_pct = scoreable > 0 ? Math.round(1000 * qualified / scoreable) / 10 : 0;
  const hot_pct       = scoreable > 0 ? Math.round(1000 * hot       / scoreable) / 10 : 0;
  const delta_pct     = prev_total > 0 ? Math.round(1000 * (total - prev_total) / prev_total) / 10 : 0;

  return {
    period,
    filters: { programs, includeLost },
    total,
    scoreable,
    qualified,
    hot,
    qualified_pct,
    hot_pct,
    prev_total,
    delta_pct,
    by_tier,
    by_program,
    by_stage,
    by_stage_cumulative,
    lost_reasons,
  };
}
