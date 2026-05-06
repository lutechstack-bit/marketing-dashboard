import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Invalidate the lead-list cache. Call from webhooks when leads change. */
export async function invalidateLeadsCache() {
  const { revalidateTag } = await import("next/cache");
  revalidateTag("leads");
}

export type LeadRow = {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  program: string | null;
  source_campaign_id: string | null;
  source_campaign_name: string | null;
  source_utm_source: string | null;
  funnel_stage: string | null;
  score: number;
  score_breakdown: Record<string, number>;
  first_seen: string;
  last_activity: string | null;
  // joined from view:
  last_contacted_at?: string | null;
  last_contacted_by?: string | null;
  last_action?: string | null;       // raw lead_activities.action (latest non-note)
  last_payment_amount?: number | null;
  last_payment_at?: string | null;
  captured_payment_count?: number;
};

export type FormSubmissionRow = {
  id: string;
  lead_id: string | null;
  form_id: string;
  form_name: string | null;
  program: string | null;
  is_completed: boolean;
  submitted_at: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  responses: Record<string, any> | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  lead_id: string | null;
  account: string;
  program: string | null;
  payment_type: string | null;
  amount_inr: number;
  status: string | null;
  email: string | null;
  phone: string | null;
  paid_at: string;
  created_at: string;
};

export type LeadActivityRow = {
  id: string;
  lead_id: string;
  rep_name: string | null;
  action: string;
  notes: string | null;
  created_at: string;
};

/**
 * Fetch leads + optionally enrich with payment / activity / submission joins.
 *
 * PERFORMANCE NOTES
 * · Base query is a single paginated SELECT with stage/program/score filters
 *   pushed down to SQL (so we never load 27k rows just to filter to a bucket).
 * · Enrichment queries run in PARALLEL via Promise.all instead of nested
 *   sequential loops. Three enrichments × 7-8 chunks = 21-24 queries → all
 *   fired at once = ~1 round-trip instead of 21.
 * · Each enrichment is opt-in — pages should request only what they show
 *   on screen. /queue needs activities (last_action). /leads needs payments
 *   + activities. /insights needs nothing → use fetchLeadsLight.
 * · Wrapped in unstable_cache (30s TTL) so navigating between dashboard
 *   tabs doesn't re-run the same heavy queries. Webhooks should call
 *   invalidateLeadsCache() to bust the cache when leads change.
 *
 * Default enrichments = [] (none) for new callers. Pass enrichments to opt in.
 */
type EnrichmentKey = "payments" | "activities" | "submissions";

export async function fetchLeads(opts: {
  programs?: string[];
  stages?: string[];
  minScore?: number;
  limit?: number;
  enrichments?: EnrichmentKey[];
  sort?: "score" | "recent";
} = {}): Promise<LeadRow[]> {
  // CRITICAL: the cache key MUST be inside keyParts. unstable_cache hashes
  // keyParts strictly; passing args to the wrapped function does NOT make
  // the cache distinguish calls reliably. Earlier we passed the JSON key
  // as a function arg + had keyParts=["fetch-leads-v3"] — that caused
  // three parallel fetches with different `stages` to all return the same
  // cached result, which surfaced as "same leads in every bucket on FW".
  //
  // Building unstable_cache inside the function looks wrong but is correct:
  // Next.js dedupes by keyParts so calls with identical keys still share
  // a cache entry across requests. Different opts → different keyParts →
  // different cache entry.
  const key = JSON.stringify({
    programs: (opts.programs || []).slice().sort(),
    stages: (opts.stages || []).slice().sort(),
    minScore: opts.minScore ?? null,
    limit: opts.limit ?? 500,
    enrichments: (opts.enrichments || []).slice().sort(),
    sort: opts.sort ?? "score",
  });
  const cached = unstable_cache(
    () => fetchLeadsImpl(opts),
    ["fetch-leads-v4", key],
    { revalidate: 30, tags: ["leads"] },
  );
  return cached();
}

async function fetchLeadsImpl(opts: {
  programs?: string[];
  stages?: string[];
  minScore?: number;
  limit?: number;
  enrichments?: EnrichmentKey[];
  /**
   * "score" — top-scoring leads first (default; good for "show me the
   *   highest-priority ones" bucket views)
   * "recent" — newest activity first (good for the queue's "show recent
   *   leads from every program/stage" use case so partials and small
   *   programs aren't squeezed out)
   */
  sort?: "score" | "recent";
} = {}): Promise<LeadRow[]> {
  const targetLimit = opts.limit || 500;
  const enrichments = opts.enrichments || [];
  const sortMode = opts.sort || "score";
  const leads: LeadRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (leads.length < targetLimit) {
    const upper = Math.min(offset + PAGE - 1, offset + (targetLimit - leads.length) - 1);
    let q = supabase
      .from("leads")
      .select("id,email,phone,name,program,source_campaign_id,source_campaign_name,source_utm_source,funnel_stage,score,score_breakdown,first_seen,last_activity")
      .range(offset, upper);

    if (sortMode === "recent") {
      q = q
        .order("last_activity", { ascending: false, nullsFirst: false })
        .order("score", { ascending: false });
    } else {
      q = q
        .order("score", { ascending: false })
        .order("last_activity", { ascending: false, nullsFirst: false });
    }

    if (opts.programs && opts.programs.length) q = q.in("program", opts.programs);
    if (opts.stages && opts.stages.length)     q = q.in("funnel_stage", opts.stages);
    if (opts.minScore !== undefined)           q = q.gte("score", opts.minScore);

    const { data, error } = await q;
    if (error) throw error;
    const page = (data as LeadRow[]) || [];
    leads.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  if (!leads.length || enrichments.length === 0) return leads;

  // Run all requested enrichments in parallel. Each enrichment chunks its
  // ID list and fires those chunks concurrently too — bounded by ~200 IDs
  // per query (PostgREST URL length limit).
  const ids = leads.map(l => l.id);
  const chunks = chunkArray(ids, 200);

  const tasks: Promise<void>[] = [];
  let pays: any[] = [];
  let acts: any[] = [];
  let subs: any[] = [];

  if (enrichments.includes("payments")) {
    tasks.push((async () => {
      const results = await Promise.all(
        chunks.map(c =>
          supabase
            .from("payments")
            .select("lead_id,amount_inr,paid_at,status")
            .in("lead_id", c)
            .eq("status", "captured")
        )
      );
      pays = results.flatMap(r => r.data || []);
    })());
  }
  if (enrichments.includes("activities")) {
    tasks.push((async () => {
      const results = await Promise.all(
        chunks.map(c =>
          supabase
            .from("lead_activities")
            .select("lead_id,action,rep_name,created_at")
            .in("lead_id", c)
            .neq("action", "note")
            .order("created_at", { ascending: false })
        )
      );
      acts = results.flatMap(r => r.data || []);
    })());
  }
  if (enrichments.includes("submissions")) {
    tasks.push((async () => {
      const results = await Promise.all(
        chunks.map(c =>
          supabase
            .from("form_submissions")
            .select("lead_id,submitted_at")
            .in("lead_id", c)
            .order("submitted_at", { ascending: true })
        )
      );
      subs = results.flatMap(r => r.data || []);
    })());
  }

  await Promise.all(tasks);

  // Index + apply
  if (enrichments.includes("payments")) {
    const byLead: Record<string, { count: number; last_amt?: number; last_at?: string }> = {};
    for (const p of pays) {
      const k = p.lead_id;
      if (!byLead[k]) byLead[k] = { count: 0 };
      byLead[k].count++;
      if (!byLead[k].last_at || p.paid_at > byLead[k].last_at!) {
        byLead[k].last_at = p.paid_at;
        byLead[k].last_amt = p.amount_inr;
      }
    }
    for (const l of leads) {
      const p = byLead[l.id];
      if (p) {
        l.captured_payment_count = p.count;
        l.last_payment_amount    = p.last_amt;
        l.last_payment_at        = p.last_at;
      }
    }
  }
  if (enrichments.includes("activities")) {
    const byLead: Record<string, { action: string; rep_name: string | null; created_at: string }> = {};
    for (const a of acts) {
      if (!byLead[a.lead_id]) {
        byLead[a.lead_id] = { action: a.action, rep_name: a.rep_name, created_at: a.created_at };
      }
    }
    for (const l of leads) {
      const a = byLead[l.id];
      if (a) {
        l.last_action       = a.action;
        l.last_contacted_by = a.rep_name;
        l.last_contacted_at = a.created_at;
      }
    }
  }
  if (enrichments.includes("submissions")) {
    const earliestByLead: Record<string, string> = {};
    for (const s of subs) {
      if (s.lead_id && !earliestByLead[s.lead_id]) {
        earliestByLead[s.lead_id] = s.submitted_at;
      }
    }
    for (const l of leads) {
      if (earliestByLead[l.id]) l.first_seen = earliestByLead[l.id];
    }
  }

  return leads;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Lightweight version of fetchLeads — used by /insights for fast aggregation.
 * Skips per-lead enrichment (payments, activities, submission joins) since
 * /insights only needs score + program + first_seen + funnel_stage + breakdown.
 *
 * For 6.4K leads this is ~10x faster than fetchLeads (1 query vs ~100).
 */
export async function fetchLeadsLight(opts: { limit?: number } = {}): Promise<LeadRow[]> {
  // Default 50k so /insights aggregations see the full table (41k leads
  // currently). Was 10k which silently truncated 75% of leads.
  const targetLimit = opts.limit || 50000;
  const leads: LeadRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (leads.length < targetLimit) {
    const upper = Math.min(offset + PAGE - 1, offset + (targetLimit - leads.length) - 1);
    const { data, error } = await supabase
      .from("leads")
      // created_at MUST be selected so inPeriod can fall back to it when
      // first_seen is null (CSV-imported leads have no original date).
      .select("id,email,phone,name,program,funnel_stage,score,score_breakdown,first_seen,last_activity,created_at,source_campaign_id,source_campaign_name,source_utm_source")
      .order("created_at", { ascending: false })
      .range(offset, upper);
    if (error) throw error;
    const page = (data as LeadRow[]) || [];
    leads.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return leads;
}

export async function getLeadDetail(leadId: string) {
  const [lead, subs, pays, acts] = await Promise.all([
    supabase.from("leads").select("*").eq("id", leadId).maybeSingle(),
    supabase.from("form_submissions").select("*").eq("lead_id", leadId).order("submitted_at", { ascending: false }),
    supabase.from("payments").select("*").eq("lead_id", leadId).order("paid_at", { ascending: false }),
    supabase.from("lead_activities").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
  ]);
  return {
    lead: (lead.data as LeadRow) || null,
    submissions: (subs.data as FormSubmissionRow[]) || [],
    payments: (pays.data as PaymentRow[]) || [],
    activities: (acts.data as LeadActivityRow[]) || [],
  };
}

/**
 * Per-program-per-bucket counts for the queue tabs. Computed via aggregate
 * COUNT queries instead of from the loaded leads slice — so the tabs show the
 * REAL number of leads per program/stage, not just "how many made it into
 * the top N loaded by the queue page".
 *
 * Returns: counts[program][stage] = N
 *
 * Cached 30s, tag "leads" so webhook lead-writes invalidate.
 */
export const fetchQueueCounts = unstable_cache(
  async () => {
    const programs = ["FFM", "FW", "FC", "FAI", "BFP", "VE", "L3C"];
    const stages = ["form_partial", "form_submitted", "app_fee_paid", "accepted"];

    // 7 programs × 4 stages = 28 count queries — fired in parallel
    const tasks: Array<Promise<{ program: string; stage: string; count: number }>> = [];
    for (const p of programs) {
      for (const s of stages) {
        tasks.push((async () => {
          const r = await supabase.from("leads").select("*", { count: "exact", head: true })
            .eq("program", p).eq("funnel_stage", s);
          return { program: p, stage: s, count: r.count || 0 };
        })());
      }
    }
    const rows = await Promise.all(tasks);

    const counts: Record<string, Record<string, number>> = {};
    for (const p of programs) counts[p] = { form_partial: 0, form_submitted: 0, app_fee_paid: 0, accepted: 0 };
    for (const r of rows) counts[r.program][r.stage] = r.count;
    return counts;
  },
  ["fetch-queue-counts-v1"],
  { revalidate: 30, tags: ["leads"] },
);

// Cached: 60s TTL. The numbers don't change frequently and the underlying
// 13 parallel count queries are still expensive on a 41k-row table.
export const fetchLeadStats = unstable_cache(
  async () => {
    const stages = ["form_partial","form_submitted","app_fee_paid","accepted","confirmed","balance_paid","lost"];
    const programs = ["FFM","FW","FC","FAI"];

    const [totalRes, hotRes, ...rest] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true }),
      supabase.from("leads").select("*", { count: "exact", head: true }).gte("score", 75),
      ...stages.map(s => supabase.from("leads").select("*", { count: "exact", head: true }).eq("funnel_stage", s)),
      ...programs.map(p => supabase.from("leads").select("*", { count: "exact", head: true }).eq("program", p)),
    ]);

    const stageResults = rest.slice(0, stages.length);
    const programResults = rest.slice(stages.length);

    const by_stage: Record<string, number> = {};
    stages.forEach((s, i) => { by_stage[s] = stageResults[i].count || 0; });
    const by_program: Record<string, number> = {};
    programs.forEach((p, i) => { by_program[p] = programResults[i].count || 0; });

    return {
      total: totalRes.count || 0,
      by_stage,
      by_program,
      rescue_zone: by_stage["accepted"] || 0,
      hot_75plus: hotRes.count || 0,
    };
  },
  ["fetch-lead-stats-v1"],
  { revalidate: 60, tags: ["leads"] },
);
