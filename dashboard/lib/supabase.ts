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

export async function fetchLeads(opts: {
  programs?: string[];
  stages?: string[];
  minScore?: number;
  limit?: number;
} = {}): Promise<LeadRow[]> {
  const targetLimit = opts.limit || 500;
  const leads: LeadRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (leads.length < targetLimit) {
    const upper = Math.min(offset + PAGE - 1, offset + (targetLimit - leads.length) - 1);
    let q = supabase
      .from("leads")
      .select("id,email,phone,name,program,source_campaign_id,source_campaign_name,source_utm_source,funnel_stage,score,score_breakdown,first_seen,last_activity")
      .order("score", { ascending: false })
      .order("last_activity", { ascending: false, nullsFirst: false })
      .range(offset, upper);

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

  // Batch payment summaries + latest status + REAL submitted_at per lead
  if (leads.length) {
    const ids = leads.map(l => l.id);
    const pays: any[] = [];
    const acts: any[] = [];
    const subs: any[] = [];
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const idChunk = ids.slice(i, i + CHUNK);
      // payments
      let off2 = 0;
      while (true) {
        const { data, error } = await supabase
          .from("payments")
          .select("lead_id,amount_inr,paid_at,status")
          .in("lead_id", idChunk)
          .eq("status", "captured")
          .range(off2, off2 + 999);
        if (error) break;
        pays.push(...(data || []));
        if (!data || data.length < 1000) break;
        off2 += 1000;
      }
      // activities — latest non-note per lead
      let off3 = 0;
      while (true) {
        const { data, error } = await supabase
          .from("lead_activities")
          .select("lead_id,action,rep_name,created_at")
          .in("lead_id", idChunk)
          .neq("action", "note")
          .order("created_at", { ascending: false })
          .range(off3, off3 + 999);
        if (error) break;
        acts.push(...(data || []));
        if (!data || data.length < 1000) break;
        off3 += 1000;
      }
      // form_submissions — earliest submitted_at per lead (REAL submission time)
      // Bug fix: previously we used leads.first_seen which equals the Python-script
      // bulk-insert time, making thousands of leads share the same timestamp.
      // submitted_at comes from Tally itself — accurate per submission.
      let off4 = 0;
      while (true) {
        const { data, error } = await supabase
          .from("form_submissions")
          .select("lead_id,submitted_at")
          .in("lead_id", idChunk)
          .order("submitted_at", { ascending: true })
          .range(off4, off4 + 999);
        if (error) break;
        subs.push(...(data || []));
        if (!data || data.length < 1000) break;
        off4 += 1000;
      }
    }
    // Index payments
    const byLeadPay: Record<string, { count: number; last_amt?: number; last_at?: string }> = {};
    for (const p of pays) {
      const k = p.lead_id;
      if (!byLeadPay[k]) byLeadPay[k] = { count: 0 };
      byLeadPay[k].count++;
      if (!byLeadPay[k].last_at || p.paid_at > byLeadPay[k].last_at!) {
        byLeadPay[k].last_at = p.paid_at;
        byLeadPay[k].last_amt = p.amount_inr;
      }
    }
    const byLeadAct: Record<string, { action: string; rep_name: string | null; created_at: string }> = {};
    for (const a of acts) {
      if (!byLeadAct[a.lead_id]) {
        byLeadAct[a.lead_id] = { action: a.action, rep_name: a.rep_name, created_at: a.created_at };
      }
    }
    // Earliest submitted_at per lead (subs already sorted asc, so first wins)
    const earliestSubByLead: Record<string, string> = {};
    for (const s of subs) {
      if (s.lead_id && !earliestSubByLead[s.lead_id]) {
        earliestSubByLead[s.lead_id] = s.submitted_at;
      }
    }
    for (const l of leads) {
      const p = byLeadPay[l.id];
      if (p) {
        l.captured_payment_count = p.count;
        l.last_payment_amount    = p.last_amt;
        l.last_payment_at        = p.last_at;
      }
      const a = byLeadAct[l.id];
      if (a) {
        l.last_action       = a.action;
        l.last_contacted_by = a.rep_name;
        l.last_contacted_at = a.created_at;
      }
      // Override first_seen with the REAL submission time when available
      if (earliestSubByLead[l.id]) {
        l.first_seen = earliestSubByLead[l.id];
      }
    }
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

export async function fetchLeadStats() {
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
