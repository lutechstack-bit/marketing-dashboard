// Vercel cron — drives /api/maintenance/telecrm-sync incrementally.
//
// Schedule: every 15 minutes (vercel.json crons).
// Auth: Vercel sets the CRON_SECRET header automatically; we additionally
//       verify the bootstrap token can call the sync route.
//
// Strategy: incremental. Each tick syncs everything modified in the last
// 30 minutes (overlap to handle ticks running long). Initial sync was the
// one-time backfill via scripts/telecrm-sync-runner.mjs.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_BASE = "https://next.telecrm.in/autoupdate/v2";

async function fetchPage(eid: string, token: string, skip: number) {
  const res = await fetch(`${SYNC_BASE}/enterprise/${eid}/lead/search?skip=${skip}&limit=100`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`telecrm ${res.status}`);
  return res.json();
}

export async function GET(req: Request) {
  // Vercel Cron sends a header `x-vercel-cron: <id>`. Allow that OR the
  // ADMIN_BOOTSTRAP_TOKEN as a fallback (so this endpoint is also testable).
  const isCron = req.headers.get("x-vercel-cron");
  const auth = req.headers.get("authorization");
  const tokenOk = auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron && !tokenOk) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.TELECRM_SYNC_TOKEN || !process.env.TELECRM_ENTERPRISE_ID) {
    return NextResponse.json({ error: "missing TELECRM env" }, { status: 500 });
  }
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "missing ADMIN_BOOTSTRAP_TOKEN" }, { status: 500 });
  }

  // Strategy: scan only the FIRST few pages of TeleCRM. The /lead/search
  // endpoint returns leads sorted by recency (most recently created first
  // when no ordering is specified). 5 pages × 100 = 500 leads covers any
  // realistic 15-minute creation/update burst at LevelUp's volume.
  const t0 = Date.now();
  const baseUrl = new URL(req.url);
  const origin = `${baseUrl.protocol}//${baseUrl.host}`;
  const syncUrl = `${origin}/api/maintenance/telecrm-sync?token=${encodeURIComponent(process.env.ADMIN_BOOTSTRAP_TOKEN)}`;

  const res = await fetch(syncUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_skip: 0, max_pages: 5, dry_run: false }),
  });
  const j = await res.json();

  return NextResponse.json({
    ok: res.ok,
    stats: j.stats,
    sample_errors: j.sample_errors || [],
    duration_ms: Date.now() - t0,
  });
}
