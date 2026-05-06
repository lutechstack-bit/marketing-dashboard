// Debug: dump the live program scorecards (program × month) so we can
// verify Meta-spend × Supabase-funnel × Razorpay-revenue all line up.
//
// GET /api/debug/scorecards?monthsBack=6

import { NextResponse } from "next/server";
import { fetchProgramScorecards } from "@/lib/program-scorecards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const monthsBack = parseInt(url.searchParams.get("monthsBack") || "6") || 6;
  const t0 = Date.now();
  const cells = await fetchProgramScorecards(monthsBack);
  return NextResponse.json({
    months_back: monthsBack,
    cell_count: cells.length,
    cells,
    duration_ms: Date.now() - t0,
  }, { headers: { "Cache-Control": "no-store" } });
}
