// Bulk re-score endpoint — runs the new data-driven scoring across all
// "abandoned" leads (funnel_stage = form_submitted) and writes the score +
// breakdown back to Supabase.
//
// Run once after deploy:
//   GET /api/maintenance/rescore?limit=2000
//
// Idempotent — re-running just refreshes scores. Skips leads with no submissions.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000"), 5000);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));
  const stagesParam = url.searchParams.get("stages") || "form_submitted,form_partial,accepted";
  const stages = stagesParam.split(",").map(s => s.trim()).filter(Boolean);

  try {
    // 1. Pull leads in target stages — paginated via offset
    const { data: leads, error: lerr, count } = await supabase
      .from("leads")
      .select("id,program,funnel_stage,score", { count: "exact" })
      .in("funnel_stage", stages)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (lerr) throw lerr;
    const leadIds = (leads || []).map(l => l.id);
    if (leadIds.length === 0) {
      return NextResponse.json({ ok: true, scanned: 0, updated: 0, message: "no leads in selected stages" });
    }

    // 2. Pull their form submissions in chunks
    const subsByLead: Record<string, { responses: any; submitted_at: string }[]> = {};
    const CHUNK = 200;
    for (let i = 0; i < leadIds.length; i += CHUNK) {
      const chunk = leadIds.slice(i, i + CHUNK);
      const { data: subs, error: serr } = await supabase
        .from("form_submissions")
        .select("lead_id,responses,submitted_at")
        .in("lead_id", chunk);
      if (serr) throw serr;
      for (const s of (subs || [])) {
        if (s.lead_id) (subsByLead[s.lead_id] ||= []).push({
          responses: s.responses || {},
          submitted_at: s.submitted_at,
        });
      }
    }

    // 3. Compute new scores
    type Update = { id: string; score: number; score_breakdown: any };
    const updates: Update[] = [];
    let withSubs = 0, withoutSubs = 0, distChange: Record<string, number> = {};
    for (const lead of (leads || [])) {
      const subs = subsByLead[lead.id];
      if (!subs || subs.length === 0) { withoutSubs++; continue; }
      withSubs++;
      // Merge all responses (in case lead has multiple submissions)
      const responses: Record<string, any> = {};
      let earliest: string | null = null;
      for (const s of subs) {
        Object.assign(responses, s.responses);
        if (!earliest || s.submitted_at < earliest) earliest = s.submitted_at;
      }
      const { score, breakdown } = scoreLead({
        responses,
        submittedAt: earliest,
        programCode: lead.program || "FFM", // fallback to FFM if program missing
      });
      updates.push({ id: lead.id, score, score_breakdown: breakdown });

      // Track movement vs new thresholds (60+ = WARM or HOT)
      const oldT = (lead.score || 0) >= 60 ? "warm+" : "below";
      const newT = score >= 60 ? "warm+" : "below";
      const move = `${oldT}->${newT}`;
      distChange[move] = (distChange[move] || 0) + 1;
    }

    // 4. Bulk update
    let updated = 0;
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      const { error } = await supabase.from("leads").upsert(batch, { onConflict: "id" });
      if (error) console.error("[rescore] batch error:", error.message);
      else updated += batch.length;
    }

    // v3 thresholds, max 90
    const buckets = { "junk_0-29": 0, "cold_30-44": 0, "ok_45-59": 0, "warm_60-74": 0, "hot_75plus": 0 };
    for (const u of updates) {
      if (u.score < 30) buckets["junk_0-29"]++;
      else if (u.score < 45) buckets["cold_30-44"]++;
      else if (u.score < 60) buckets["ok_45-59"]++;
      else if (u.score < 75) buckets["warm_60-74"]++;
      else buckets["hot_75plus"]++;
    }

    return NextResponse.json({
      ok: true,
      window: { offset, limit, returned: leadIds.length },
      total_in_stages: count ?? null,
      next_offset: leadIds.length === limit ? offset + limit : null,
      with_submissions: withSubs,
      no_submissions: withoutSubs,
      updated,
      score_distribution_after: buckets,
      sample_top10: updates
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(u => ({ id: u.id, score: u.score, signals: Object.keys(u.score_breakdown).filter(k => u.score_breakdown[k] > 0) })),
    });
  } catch (e: any) {
    console.error("[rescore] error:", e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
