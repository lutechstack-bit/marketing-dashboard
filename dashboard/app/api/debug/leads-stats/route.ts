// Sanity-test the new lib/leads-stats vs the legacy fetch functions.
// Used during the consistency-layer migration to verify totals match before
// flipping callers over.
//
// GET /api/debug/leads-stats?family=forge&period=all

import { NextResponse } from "next/server";
import { fetchLeadsStats } from "@/lib/leads-stats";
import { fetchLeadStats, fetchQueueCounts } from "@/lib/supabase";
import type { Family } from "@/lib/products";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const family = (url.searchParams.get("family") as Family | "all" | null) ?? "all";
  const period = (url.searchParams.get("period") as any) || "all";

  const t0 = Date.now();
  const [stats, legacyStats, legacyQueueCounts] = await Promise.all([
    fetchLeadsStats({ family, period }),
    fetchLeadStats(),
    fetchQueueCounts(),
  ]);
  const took = Date.now() - t0;

  // Cross-reference the legacy queue counts (per program × per stage, exact
  // match) against the new lib's by_program[code].by_stage[stage].
  const queueDelta: Record<string, any> = {};
  for (const [program, legacyStages] of Object.entries(legacyQueueCounts || {})) {
    const newStages = stats.by_program[program]?.by_stage || {};
    for (const [stage, n] of Object.entries(legacyStages)) {
      const m = newStages[stage] || 0;
      if (n !== m) {
        queueDelta[`${program}/${stage}`] = { legacy: n, new: m, diff: m - n };
      }
    }
  }

  return NextResponse.json({
    took_ms: took,
    family, period,
    headline: {
      total: stats.total,
      scoreable: stats.scoreable,
      qualified_60: stats.qualified,
      hot_75: stats.hot,
      qualified_pct: stats.qualified_pct,
      hot_pct: stats.hot_pct,
      delta_pct: stats.delta_pct,
    },
    by_tier: stats.by_tier,
    by_program_totals: Object.fromEntries(
      Object.entries(stats.by_program).map(([k, v]) => [k, { total: v.total, scoreable: v.scoreable, qualified: v.qualified, hot: v.hot }])
    ),
    by_stage_exact: stats.by_stage,
    by_stage_cumulative: stats.by_stage_cumulative,
    lost_reasons: stats.lost_reasons.slice(0, 12),
    legacy_compare: {
      legacy_total:        legacyStats.total,
      legacy_hot_75plus:   legacyStats.hot_75plus,
      legacy_rescue_zone:  legacyStats.rescue_zone,
      legacy_by_stage:     legacyStats.by_stage,
      legacy_by_program:   legacyStats.by_program,
      queue_count_deltas:  queueDelta,        // empty = perfect match
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
