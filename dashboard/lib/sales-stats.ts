// Per-rep sales stats — drives the motivation widgets on /queue.
//
// Today's metrics (calls / conversions / earnings) + the rep's "closest to
// converting" pipeline. Everything is cached for 30s with tag "leads" so it
// invalidates whenever a webhook writes a payment / lead change.

import { supabase } from "./supabase";
import { unstable_cache } from "next/cache";

export type TodaysActivity = {
  calls_today: number;          // count of "called*" or "no_answer" activities today
  conversions_today: number;    // count of "converted" or "application_fee_paid" today
  earnings_today_locked: number;// sum of incentive_earnings.amount_inr locked today
  earnings_today_unlocked: number;
  pipeline_locked: number;       // total locked earnings (waiting on balance)
  pipeline_count: number;        // count of leads in locked
};

export type TopOpportunity = {
  lead_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  program: string | null;
  score: number;
  funnel_stage: string | null;
  last_activity: string | null;
  hours_since_activity: number;
  incentive_amount: number;     // what the rep earns if this converts
  reason: string;                // human-readable "why this lead now"
};

const todayStartIso = () => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.toISOString();
};

/**
 * Today's activity tally + pipeline summary for a single rep.
 *
 * Cached 30s, tag "leads" + "tasks" so any write that affects revenue or
 * pipeline invalidates this.
 */
export const fetchTodaysActivity = unstable_cache(
  async (repId: string, repName: string | null): Promise<TodaysActivity> => {
    const since = todayStartIso();

    // We log activities with `rep_name` (legacy) — the lookup matches on either
    // sales_reps.id (if the system ever starts setting that) or rep_name match.
    // For now, rep_name is the source of truth.
    const repNameMatch = repName || "__never__";

    const [calls, conversions, lockedToday, unlockedToday, lockedAll] = await Promise.all([
      supabase.from("lead_activities").select("*", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("rep_name", repNameMatch)
        .in("action", ["called", "called_no_answer", "called_dnp", "called_interested",
                       "called_not_interested", "called_budget_issue", "called_wants_more_info",
                       "no_answer", "busy", "messaged"]),

      supabase.from("lead_activities").select("*", { count: "exact", head: true })
        .gte("created_at", since)
        .eq("rep_name", repNameMatch)
        .in("action", ["converted", "application_fee_paid", "interview_booked", "confirmed"]),

      supabase.from("incentive_earnings").select("amount_inr")
        .eq("rep_id", repId).eq("status", "locked").gte("locked_at", since),

      supabase.from("incentive_earnings").select("amount_inr")
        .eq("rep_id", repId).eq("status", "unlocked").gte("unlocked_at", since),

      supabase.from("incentive_earnings").select("amount_inr,id")
        .eq("rep_id", repId).eq("status", "locked"),
    ]);

    const lockedTodaySum = (lockedToday.data || []).reduce((s, r: any) => s + Number(r.amount_inr || 0), 0);
    const unlockedTodaySum = (unlockedToday.data || []).reduce((s, r: any) => s + Number(r.amount_inr || 0), 0);
    const pipelineSum = (lockedAll.data || []).reduce((s, r: any) => s + Number(r.amount_inr || 0), 0);

    return {
      calls_today: calls.count || 0,
      conversions_today: conversions.count || 0,
      earnings_today_locked: lockedTodaySum,
      earnings_today_unlocked: unlockedTodaySum,
      pipeline_locked: pipelineSum,
      pipeline_count: (lockedAll.data || []).length,
    };
  },
  ["fetch-todays-activity-v1"],
  { revalidate: 30, tags: ["leads", "tasks"] },
);

/**
 * Top 5 "closest to converting" leads for a rep.
 *
 * Heuristic: leads in app_fee_paid stage (paid app fee, haven't been
 * confirmed yet), ordered by score DESC + last_activity ASC (high-MQL leads
 * that haven't been touched recently bubble to the top).
 *
 * Returns leads from the rep's assigned programs only (via rep_assignments).
 */
export const fetchTopOpportunities = unstable_cache(
  async (repId: string): Promise<TopOpportunity[]> => {
    // First find what programs this rep owns
    const { data: assignments } = await supabase
      .from("rep_assignments")
      .select("product_code,incentive_inr,edition_match,edition_label")
      .eq("rep_id", repId).eq("active", true);
    if (!assignments || assignments.length === 0) return [];

    const programs = Array.from(new Set(assignments.map((a: any) => a.product_code)));
    // Default incentive per product (ignore edition matches for the simple case;
    // edition lookup happens in the queue rendering anyway).
    const incentiveByProgram: Record<string, number> = {};
    for (const a of assignments as any[]) {
      // First-found wins for default
      if (!incentiveByProgram[a.product_code]) incentiveByProgram[a.product_code] = a.incentive_inr;
    }

    // Pull paid app-fee leads in those programs, top 20 by score, then we
    // pick the 5 with stalest activity (highest score × longest gap = best
    // candidates for outreach).
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id,name,email,phone,program,score,funnel_stage,last_activity")
      .eq("funnel_stage", "app_fee_paid")
      .in("program", programs)
      .order("score", { ascending: false })
      .limit(20);
    if (error || !leads) return [];

    const now = Date.now();
    const scored = leads.map((l: any) => {
      const hours = l.last_activity ? Math.max(0, (now - new Date(l.last_activity).getTime()) / 3_600_000) : 999;
      return {
        lead_id: l.id,
        name: l.name, email: l.email, phone: l.phone, program: l.program,
        score: l.score || 0, funnel_stage: l.funnel_stage,
        last_activity: l.last_activity,
        hours_since_activity: hours,
        incentive_amount: incentiveByProgram[l.program || ""] || 0,
        reason: hours > 48
          ? `Score ${l.score}. ${Math.round(hours / 24)}d since last touch — needs a nudge.`
          : `Score ${l.score}. Paid app fee, hot moment.`,
      } as TopOpportunity;
    });

    // Sort: high score × stale activity. Simple weighted score.
    scored.sort((a, b) => {
      const wa = a.score + Math.min(48, a.hours_since_activity) * 0.5;
      const wb = b.score + Math.min(48, b.hours_since_activity) * 0.5;
      return wb - wa;
    });

    return scored.slice(0, 5);
  },
  ["fetch-top-opportunities-v1"],
  { revalidate: 60, tags: ["leads"] },
);

// ============================================================================
// MONEY ON THE TABLE — abandoned leads × this rep's incentive amount
// ============================================================================
// Incentive rule (founder-confirmed): rep earns when they push a lead from
// form_submitted (Abandoned) → app_fee_paid (paid app fee). NO incentive for
// partials filling the form, NO incentive for booking interview. The earning
// LOCKS at app_fee_paid and UNLOCKS when the lead pays balance.
//
// So the "earn-able right now" pool = abandoned leads × the rep's per-program
// incentive amount. This is the primary motivational number.

export type EarnableNow = {
  total_count: number;
  total_potential_earnings: number;
  by_program: Array<{
    program: string;
    count: number;
    incentive_per_lead: number;
    total: number;
  }>;
  top_leads: Array<{
    lead_id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    program: string;
    score: number;
    last_activity: string | null;
    incentive_amount: number;
    hours_since_activity: number;
  }>;
};

export const fetchEarnableNow = unstable_cache(
  async (repId: string): Promise<EarnableNow> => {
    const empty: EarnableNow = { total_count: 0, total_potential_earnings: 0, by_program: [], top_leads: [] };

    // 1. What programs is this rep assigned to + their per-product incentive?
    const { data: assignments } = await supabase
      .from("rep_assignments")
      .select("product_code,incentive_inr")
      .eq("rep_id", repId).eq("active", true);
    if (!assignments || assignments.length === 0) return empty;

    // If rep has multiple assignment rows for the same product (e.g. FC Goa +
    // FC Bali), use the highest. Bulk forecast can't know which edition each
    // lead picked without joining form_submissions; the highest amount is the
    // motivationally honest "best case" framing.
    const incentiveByProgram: Record<string, number> = {};
    for (const a of assignments as any[]) {
      const cur = incentiveByProgram[a.product_code] || 0;
      if (a.incentive_inr > cur) incentiveByProgram[a.product_code] = a.incentive_inr;
    }
    const programs = Object.keys(incentiveByProgram);
    if (programs.length === 0) return empty;

    // 2. Per-program count of abandoned leads (form_submitted)
    const counts = await Promise.all(programs.map(async (p) => {
      const { count } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("program", p)
        .eq("funnel_stage", "form_submitted");
      return { program: p, count: count || 0 };
    }));

    const by_program = counts
      .map(c => ({
        program: c.program,
        count: c.count,
        incentive_per_lead: incentiveByProgram[c.program] || 0,
        total: c.count * (incentiveByProgram[c.program] || 0),
      }))
      .sort((a, b) => b.total - a.total);

    const total_count = by_program.reduce((s, p) => s + p.count, 0);
    const total_potential_earnings = by_program.reduce((s, p) => s + p.total, 0);

    // 3. Top 8 abandoned leads to call (highest score across rep's programs)
    const { data: topLeads } = await supabase
      .from("leads")
      .select("id,name,email,phone,program,score,last_activity")
      .eq("funnel_stage", "form_submitted")
      .in("program", programs)
      .order("score", { ascending: false })
      .order("last_activity", { ascending: false, nullsFirst: false })
      .limit(8);

    const now = Date.now();
    const top_leads = (topLeads || []).map((l: any) => ({
      lead_id: l.id,
      name: l.name, email: l.email, phone: l.phone,
      program: l.program,
      score: l.score || 0,
      last_activity: l.last_activity,
      incentive_amount: incentiveByProgram[l.program || ""] || 0,
      hours_since_activity: l.last_activity ? (now - new Date(l.last_activity).getTime()) / 3_600_000 : 999,
    }));

    return { total_count, total_potential_earnings, by_program, top_leads };
  },
  ["fetch-earnable-now-v1"],
  { revalidate: 60, tags: ["leads"] },
);
