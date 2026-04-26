// Client-callable AI brief endpoint. The lead detail page now defers this to a
// post-render fetch so the page itself loads instantly while the brief warms up.
//
// GET /api/ai/why-hot?lead_id=<uuid>
// Returns: { brief: AiWhyHot | null }

import { NextResponse } from "next/server";
import { getLeadDetail } from "@/lib/supabase";
import { aiWhyHotCached } from "@/lib/ai-insights";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");
  if (!leadId) return NextResponse.json({ error: "lead_id required" }, { status: 400 });

  try {
    const detail = await getLeadDetail(leadId);
    if (!detail.lead) return NextResponse.json({ brief: null, reason: "lead not found" });
    const brief = await aiWhyHotCached(detail.lead, detail.submissions);
    return NextResponse.json({ brief });
  } catch (e: any) {
    console.error("[ai-why-hot] error:", e?.message);
    return NextResponse.json({ brief: null, error: e?.message }, { status: 500 });
  }
}
