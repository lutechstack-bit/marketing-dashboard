// Debug: probe the Revenue Tracker sheet. Returns the parsed metrics or
// the access error if the service account hasn't been shared yet.
//
// GET /api/debug/revenue-tracker

import { NextResponse } from "next/server";
import { fetchRevenueMetrics } from "@/lib/revenue-tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const t0 = Date.now();
  const metrics = await fetchRevenueMetrics();
  return NextResponse.json({
    ...metrics,
    duration_ms: Date.now() - t0,
  }, { headers: { "Cache-Control": "no-store" } });
}
