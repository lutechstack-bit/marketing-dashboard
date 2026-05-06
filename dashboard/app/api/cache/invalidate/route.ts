// Cache invalidation endpoint for the Refresh button.
//
// POST /api/cache/invalidate?tags=leads,meta-ads,revenue-tracker
//
// No auth required — invalidating the cache only forces a re-fetch from
// upstream sources (Sheets, Meta, Supabase) which the user is already
// authorized to view via their session.

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

export const dynamic = "force-dynamic";

const ALLOWED_TAGS = new Set(["leads", "meta-ads", "revenue-tracker"]);

export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("tags") || "";
  const tags = raw.split(",").map(t => t.trim()).filter(t => ALLOWED_TAGS.has(t));
  for (const t of tags) {
    try { revalidateTag(t); } catch { /* swallow */ }
  }
  return NextResponse.json({
    ok: true,
    invalidated: tags,
    rejected: raw.split(",").filter(t => !ALLOWED_TAGS.has(t.trim())),
  });
}

export async function GET() {
  return NextResponse.json({ docs: "POST ?tags=leads,meta-ads,revenue-tracker" });
}
