import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  last_action?: string | null;
  last_payment_amount?: number | null;
  last_payment_at?: string | null;
  captured_payment_count?: number;
};

export async function fetchLeads(opts: {
  programs?: string[];
  stages?: string[];
  minScore?: number;
  limit?: number;
} = {}): Promise<LeadRow[]> {
  // Query leads table directly (much faster than lead_view which runs per-row subqueries)
  let q = supabase
    .from("leads")
    .select("id,email,phone,name,program,source_campaign_id,source_campaign_name,source_utm_source,funnel_stage,score,score_breakdown,first_seen,last_activity")
    .order("score", { ascending: false })
    .order("last_activity", { ascending: false, nullsFirst: false })
    .limit(opts.limit || 500);

  if (opts.programs && opts.programs.length) q = q.in("program", opts.programs);
  if (opts.stages && opts.stages.length)     q = q.in("funnel_stage", opts.stages);
  if (opts.minScore !== undefined)           q = q.gte("score", opts.minScore);

  const { data, error } = await q;
  if (error) throw error;
  const leads = (data as LeadRow[]) || [];

  // Batch-fetch payment summaries for visible leads
  if (leads.length) {
    const ids = leads.map(l => l.id);
    const { data: pays } = await supabase
      .from("payments")
      .select("lead_id,amount_inr,paid_at,status")
      .in("lead_id", ids)
      .eq("status", "captured");
    const byLead: Record<string, { count: number; last_amt?: number; last_at?: string }> = {};
    for (const p of (pays || [])) {
      const k = (p as any).lead_id;
      if (!byLead[k]) byLead[k] = { count: 0 };
      byLead[k].count++;
      if (!byLead[k].last_at || (p as any).paid_at > byLead[k].last_at!) {
        byLead[k].last_at = (p as any).paid_at;
        byLead[k].last_amt = (p as any).amount_inr;
      }
    }
    for (const l of leads) {
      const s = byLead[l.id];
      if (s) {
        l.captured_payment_count = s.count;
        l.last_payment_amount    = s.last_amt;
        l.last_payment_at        = s.last_at;
      }
    }
  }

  return leads;
}

export async function getLeadDetail(leadId: string) {
  const [lead, subs, pays, acts] = await Promise.all([
    supabase.from("lead_view").select("*").eq("id", leadId).single(),
    supabase.from("form_submissions").select("*").eq("lead_id", leadId).order("submitted_at", { ascending: false }),
    supabase.from("payments").select("*").eq("lead_id", leadId).order("paid_at", { ascending: false }),
    supabase.from("lead_activities").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
  ]);
  return {
    lead: lead.data as LeadRow,
    submissions: subs.data || [],
    payments: pays.data || [],
    activities: acts.data || [],
  };
}

export async function fetchLeadStats() {
  // Use count-only queries (head: true) to bypass Supabase's default 1000-row fetch limit.
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
}
