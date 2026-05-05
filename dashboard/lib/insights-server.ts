// Server-side aggregation for /insights. All math runs here so the client
// receives small JSON (a few KB) instead of all 6,400 leads (~3MB).
//
// Pre-computes per (family × period × product) so client just renders.

import type { LeadRow, PaymentRow as PaymentRowFull } from "./supabase";
import { PRODUCTS_BY_FAMILY, PRODUCT_BY_CODE, type Family } from "./products";

// ----------------------------------------------------------------
// Types — what the client receives
// ----------------------------------------------------------------
export type InsightsPayload = {
  period: { id: string; label: string; startMs: number; endMs: number; prevStartMs: number; prevEndMs: number };
  family: Family;
  hero: {
    total_leads: number;
    leads_delta_pct: number;        // vs prior period
    avg_mql: number;                 // mean of scoreable leads
    median_mql: number;              // median of scoreable leads
    hot_count: number;
    super_hot_count: number;
    hot_pct: number;
    spend_inr: number;
    cpa_inr: number;                 // spend / actual_leads (DB-counted)
    revenue_inr: number;             // captured payments in period for this family
    scoreable_leads: number;         // leads with non-empty score_breakdown
  };
  products: ProductInsight[];
  trend_daily: { date: string; [productCode: string]: number | string }[];
  cashflow_daily: { date: string; total: number; [productCode: string]: number | string }[];
  marketing_12m: { label: string; ymKey: string; spend: number; leads_attr: number; leads_actual: number; cpa_attr: number; cpa_actual: number }[];
  reps: RepPerformance[];
  diagnostics: {
    explanation: string[];
  };
};

export type ProductInsight = {
  code: string;
  name: string;
  long_name: string;
  color: string;
  count: number;                     // leads in period
  scoreable: number;                 // with score_breakdown
  avg_mql: number;
  median_mql: number;
  hot_count: number;
  super_hot_count: number;
  hot_pct: number;
  delta_count: number;
  delta_avg_mql: number;
  delta_hot_pct: number;
  sparkline: number[];               // 14-day daily avg MQL
  spend_period_inr: number;
  cpa_period_inr: number;
  signals: {
    job:   { label: string; count: number; pct: number }[];
    age:   { label: string; count: number; pct: number }[];
    why:   { label: string; count: number; pct: number }[];
    grant: { label: string; count: number; pct: number }[];
  };
  tier_distribution: { tier: string; count: number; color: string }[];
  top10: { id: string; name: string | null; email: string | null; score: number; first_seen: string; funnel_stage: string | null }[];
};

export type RepPerformance = {
  rep_name: string;
  total_actions: number;
  distinct_leads: number;
  converted: number;
  lost: number;
  convert_rate: number;
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
const JOB_LABEL: Record<string, string> = {
  entrepreneur: "Entrepreneur", freelancer: "Freelancer", corporate: "Working pro",
  exploring: "Exploring options", working_other: "Working (other)", working: "Working",
  break: "Taking a break", student: "Student",
  other_professional: "Other professional", other: "Other", unknown: "Unknown",
};
const AGE_LABEL: Record<string, string> = {
  under_18: "<18", "18_24": "18-24", "24_28": "24-28", "28_32": "28-32",
  "32_45": "32-45", "45_60": "45-60", "60plus": "60+",
  unparsed: "Unparsed", unknown: "Unknown",
};
const WHY_LABEL: Record<string, string> = {
  empty: "No answer", under_30: "<30 chars", "31_100": "31-100", "101_250": "101-250",
  "251_500": "251-500", "501_1000": "501-1000", "1000plus": "1000+", unknown: "Unknown",
};
const GRANT_LABEL: Record<string, string> = {
  without_grant: "Without grant", with_grant: "With grant", unknown: "Not specified",
};

function bucketJob(bd: Record<string, number>): string {
  for (const k of Object.keys(bd)) if (k.startsWith("job_")) return k.replace("job_", "");
  return "unknown";
}
function bucketAge(bd: Record<string, number>): string {
  if (bd.age_under_18 != null) return "under_18";
  if (bd.age_18_24 != null)    return "18_24";
  if (bd.age_24_28 != null)    return "24_28";
  if (bd.age_28_32 != null)    return "28_32";
  if (bd.age_32_45 != null)    return "32_45";
  if (bd.age_45_60 != null)    return "45_60";
  if (bd.age_60plus != null)   return "60plus";
  if (bd.age_unparsed != null) return "unparsed";
  return "unknown";
}
function bucketWhy(bd: Record<string, number>): string {
  if (bd.why_empty != null)            return "empty";
  if (bd.why_under_30_chars != null)   return "under_30";
  if (bd.why_31_100_chars != null)     return "31_100";
  if (bd.why_101_250_chars != null)    return "101_250";
  if (bd.why_251_500_chars != null)    return "251_500";
  if (bd.why_501_1000_chars != null)   return "501_1000";
  if (bd.why_1000plus_chars != null)   return "1000plus";
  return "unknown";
}
function bucketGrant(bd: Record<string, number>): string {
  if (bd.without_grant != null) return "without_grant";
  if (bd.with_grant != null)    return "with_grant";
  return "unknown";
}

function distribute(buckets: Record<string, number>, labels: Record<string, string>, total: number) {
  return Object.entries(buckets)
    .map(([k, count]) => ({ label: labels[k] || k, count, pct: total > 0 ? Math.round(1000 * count / total) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[m - 1] + sorted[m]) / 2) : sorted[m];
}

function buildPeriod(id: string, customStart?: string, customEnd?: string) {
  const now = Date.now(), dayMs = 86400_000;
  let start: number, end = now, label = "";
  if (id === "today")        { const d = new Date(); d.setHours(0,0,0,0); start = d.getTime(); label = "Today"; }
  else if (id === "7d")      { start = now - 7  * dayMs; label = "Last 7 days"; }
  else if (id === "mtd")     { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); start = d.getTime(); label = "Month to date"; }
  else if (id === "custom")  { start = customStart ? new Date(customStart).getTime() : now - 30 * dayMs;
                                end = customEnd ? new Date(customEnd).getTime() : now;
                                label = `${new Date(start).toLocaleDateString("en-IN")} → ${new Date(end).toLocaleDateString("en-IN")}`; }
  else                       { start = now - 30 * dayMs; label = "Last 30 days"; }
  const len = end - start;
  return { id, label, startMs: start, endMs: end, prevStartMs: start - len, prevEndMs: start };
}

// ----------------------------------------------------------------
// Main builder
// ----------------------------------------------------------------
export function buildInsights(input: {
  leads: LeadRow[];
  payments: { paid_at: string; amount_inr: number; status: string; program: string | null; payment_type: string | null }[];
  activities: { rep_name: string | null; lead_id: string; action: string; created_at: string }[];
  marketingMonthly: any[];
  family: Family;
  periodId: string;
  customStart?: string;
  customEnd?: string;
}): InsightsPayload {
  const { leads, payments, activities, marketingMonthly, family, periodId, customStart, customEnd } = input;
  const period = buildPeriod(periodId, customStart, customEnd);
  const productCodes = PRODUCTS_BY_FAMILY[family].map(p => p.code);

  // --- Per-product aggregation
  const products: ProductInsight[] = productCodes.map(code => {
    const product = PRODUCT_BY_CODE[code]!;
    const inPeriod = (l: LeadRow) => l.program === code && l.first_seen
      && new Date(l.first_seen).getTime() >= period.startMs
      && new Date(l.first_seen).getTime() < period.endMs;
    const inPrev = (l: LeadRow) => l.program === code && l.first_seen
      && new Date(l.first_seen).getTime() >= period.prevStartMs
      && new Date(l.first_seen).getTime() < period.prevEndMs;

    const cur = leads.filter(inPeriod);
    const prev = leads.filter(inPrev);
    const scoreableCur = cur.filter(l => l.score_breakdown && Object.keys(l.score_breakdown).length > 0);
    const scoreableScores = scoreableCur.map(l => l.score || 0);
    const scoreablePrev = prev.filter(l => l.score_breakdown && Object.keys(l.score_breakdown).length > 0);

    const avg_mql = scoreableScores.length
      ? Math.round(scoreableScores.reduce((s, x) => s + x, 0) / scoreableScores.length) : 0;
    const median_mql = median(scoreableScores);
    // v3 thresholds (max 90): HOT 75+ · WARM 60-74 · OK 45-59 · COLD 30-44 · JUNK <30
    // hot_count = WARM+ ("qualified" = worth direct human outreach per methodology)
    const hot_count = scoreableCur.filter(l => l.score >= 60).length;
    const super_hot_count = scoreableCur.filter(l => l.score >= 75).length;
    const hot_pct = scoreableCur.length ? Math.round(1000 * hot_count / scoreableCur.length) / 10 : 0;

    // Signals (only across scoreable leads — non-scoreable have no breakdown)
    const sigBuckets = { job: {} as Record<string, number>, age: {} as Record<string, number>, why: {} as Record<string, number>, grant: {} as Record<string, number> };
    for (const l of scoreableCur) {
      const bd = l.score_breakdown || {};
      const j = bucketJob(bd);   sigBuckets.job[j]   = (sigBuckets.job[j]   || 0) + 1;
      const a = bucketAge(bd);   sigBuckets.age[a]   = (sigBuckets.age[a]   || 0) + 1;
      const w = bucketWhy(bd);   sigBuckets.why[w]   = (sigBuckets.why[w]   || 0) + 1;
      const g = bucketGrant(bd); sigBuckets.grant[g] = (sigBuckets.grant[g] || 0) + 1;
    }

    // Deltas
    const prevAvg = scoreablePrev.length
      ? Math.round(scoreablePrev.map(l => l.score || 0).reduce((s, x) => s + x, 0) / scoreablePrev.length) : 0;
    const prevHotPct = scoreablePrev.length
      ? Math.round(1000 * scoreablePrev.filter(l => l.score >= 60).length / scoreablePrev.length) / 10 : 0;
    const delta_count = cur.length - prev.length;
    const delta_avg_mql = avg_mql - prevAvg;
    const delta_hot_pct = Math.round(10 * (hot_pct - prevHotPct)) / 10;

    // Sparkline (14d trailing avg MQL)
    const dayMs = 86400_000, sparkPoints = 14;
    const sparkEnd = period.endMs;
    const sparkStart = sparkEnd - sparkPoints * dayMs;
    const sBuckets: { sum: number; n: number }[] = Array.from({ length: sparkPoints }, () => ({ sum: 0, n: 0 }));
    for (const l of leads) {
      if (l.program !== code || !l.first_seen) continue;
      const t = new Date(l.first_seen).getTime();
      if (t < sparkStart || t >= sparkEnd) continue;
      const idx = Math.floor((t - sparkStart) / dayMs);
      if (idx >= 0 && idx < sparkPoints) {
        sBuckets[idx].sum += (l.score || 0);
        sBuckets[idx].n += 1;
      }
    }
    const sparkline = sBuckets.map(b => b.n ? Math.round(b.sum / b.n) : 0);

    // MQL tier distribution
    // v3 thresholds (max 90)
    const t1 = scoreableCur.filter(l => (l.score || 0) < 30).length;                                                  // JUNK
    const t2 = scoreableCur.filter(l => (l.score || 0) >= 30 && (l.score || 0) < 45).length;                          // COLD
    const t3 = scoreableCur.filter(l => (l.score || 0) >= 45 && (l.score || 0) < 60).length;                          // OK
    const t4 = scoreableCur.filter(l => (l.score || 0) >= 60 && (l.score || 0) < 75).length;                          // WARM
    const t5 = scoreableCur.filter(l => (l.score || 0) >= 75).length;                                                 // HOT

    // Marketing spend for this product in period (from sheet, prorated by overlap)
    const start = period.startMs, end = period.endMs;
    let prodSpend = 0, prodLeadsAttr = 0;
    for (const m of marketingMonthly) {
      if (m.program !== code) continue;
      const monthStart = new Date(m.year, m.month - 1, 1).getTime();
      const monthEnd = new Date(m.year, m.month, 1).getTime();
      const overlapStart = Math.max(monthStart, start);
      const overlapEnd = Math.min(monthEnd, end);
      if (overlapEnd <= overlapStart) continue;
      const frac = (overlapEnd - overlapStart) / (monthEnd - monthStart);
      prodSpend += (m.spend_inr_incl_gst || 0) * frac;
      prodLeadsAttr += (m.leads || 0) * frac;
    }
    // CPA = spend / ACTUAL leads from DB (much more accurate than Meta-attributed)
    const cpa_period_inr = cur.length > 0 ? Math.round(prodSpend / cur.length) : 0;

    // Top 10 leads in period (by score)
    const top10 = [...cur]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10)
      .map(l => ({
        id: l.id,
        name: l.name,
        email: l.email,
        score: l.score || 0,
        first_seen: l.first_seen,
        funnel_stage: l.funnel_stage,
      }));

    return {
      code, name: product.name, long_name: product.longName, color: product.color,
      count: cur.length, scoreable: scoreableCur.length,
      avg_mql, median_mql, hot_count, super_hot_count, hot_pct,
      delta_count, delta_avg_mql, delta_hot_pct, sparkline,
      spend_period_inr: Math.round(prodSpend),
      cpa_period_inr,
      signals: {
        job:   distribute(sigBuckets.job,   JOB_LABEL,   scoreableCur.length).slice(0, 8),
        age:   distribute(sigBuckets.age,   AGE_LABEL,   scoreableCur.length).slice(0, 8),
        why:   distribute(sigBuckets.why,   WHY_LABEL,   scoreableCur.length).slice(0, 8),
        grant: distribute(sigBuckets.grant, GRANT_LABEL, scoreableCur.length).slice(0, 8),
      },
      tier_distribution: [
        { tier: "❄ Junk (<30)",   count: t1, color: "#CBD5E1" },
        { tier: "Cold (30-44)",   count: t2, color: "#94A3B8" },
        { tier: "OK (45-59)",     count: t3, color: "#06B6D4" },
        { tier: "⚡ Warm (60-74)", count: t4, color: "#10B981" },
        { tier: "🔥 Hot (75+)",    count: t5, color: "#F59E0B" },
      ],
      top10,
    };
  });

  // --- Hero (family-wide totals)
  const totalLeads = products.reduce((s, p) => s + p.count, 0);
  const totalScoreable = products.reduce((s, p) => s + p.scoreable, 0);
  const familyScoreableLeads = leads.filter(l => productCodes.includes(l.program || "")
    && l.first_seen
    && new Date(l.first_seen).getTime() >= period.startMs
    && new Date(l.first_seen).getTime() < period.endMs
    && l.score_breakdown && Object.keys(l.score_breakdown).length > 0);
  const familyScores = familyScoreableLeads.map(l => l.score || 0);
  const avgMql = familyScores.length ? Math.round(familyScores.reduce((s, x) => s + x, 0) / familyScores.length) : 0;
  const medianMql = median(familyScores);
  const hot = familyScoreableLeads.filter(l => (l.score || 0) >= 60).length;
  const superHot = familyScoreableLeads.filter(l => (l.score || 0) >= 75).length;
  const hotPct = familyScoreableLeads.length ? Math.round(1000 * hot / familyScoreableLeads.length) / 10 : 0;

  const prevTotalLeads = leads.filter(l => productCodes.includes(l.program || "")
    && l.first_seen
    && new Date(l.first_seen).getTime() >= period.prevStartMs
    && new Date(l.first_seen).getTime() < period.prevEndMs).length;
  const leadsDeltaPct = prevTotalLeads > 0 ? Math.round(1000 * (totalLeads - prevTotalLeads) / prevTotalLeads) / 10 : 0;

  // Family-wide marketing spend in period
  const totalSpend = products.reduce((s, p) => s + p.spend_period_inr, 0);
  // Family CPA — actual lead count
  const familyCpa = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0;

  // Captured revenue in period for this family
  let totalRevenue = 0;
  for (const p of payments) {
    if (p.status !== "captured") continue;
    if (!productCodes.includes(p.program || "")) continue;
    const t = new Date(p.paid_at).getTime();
    if (t >= period.startMs && t < period.endMs) totalRevenue += Number(p.amount_inr) || 0;
  }

  // --- Daily trend (avg MQL per program per day)
  const dayMs = 86400_000;
  const startDay = new Date(period.startMs); startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(period.endMs); endDay.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / dayMs));
  const trend_daily: any[] = [];
  for (let d = 0; d < Math.min(days, 90); d++) {
    const dStart = startDay.getTime() + d * dayMs;
    const dEnd = dStart + dayMs;
    const row: any = { date: new Date(dStart).toLocaleDateString("en-IN", { month: "short", day: "2-digit" }) };
    for (const code of productCodes) {
      const inDay = leads.filter(l => l.program === code && l.first_seen
        && new Date(l.first_seen).getTime() >= dStart
        && new Date(l.first_seen).getTime() < dEnd
        && l.score_breakdown && Object.keys(l.score_breakdown).length > 0);
      const sum = inDay.reduce((s, l) => s + (l.score || 0), 0);
      row[code] = inDay.length ? Math.round(sum / inDay.length) : 0;
    }
    trend_daily.push(row);
  }

  // --- Cash flow daily (captured payments)
  const cashflow_daily: any[] = [];
  for (let d = 0; d < Math.min(days, 90); d++) {
    const dStart = startDay.getTime() + d * dayMs;
    const dEnd = dStart + dayMs;
    const row: any = { date: new Date(dStart).toLocaleDateString("en-IN", { month: "short", day: "2-digit" }), total: 0 };
    for (const code of productCodes) row[code] = 0;
    for (const p of payments) {
      if (p.status !== "captured") continue;
      const t = new Date(p.paid_at).getTime();
      if (t < dStart || t >= dEnd) continue;
      const amt = Number(p.amount_inr) || 0;
      row.total += amt;
      if (p.program && productCodes.includes(p.program)) row[p.program] += amt;
    }
    cashflow_daily.push(row);
  }

  // --- 12-month marketing efficiency (with both attribution counts)
  const monthAgg: Record<string, { spend: number; leads_attr: number; year: number; month: number; ymKey: string; label: string }> = {};
  for (const m of marketingMonthly) {
    if (!productCodes.includes(m.program)) continue;
    const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
    monthAgg[key] ||= {
      spend: 0, leads_attr: 0,
      year: m.year, month: m.month, ymKey: key,
      label: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m.month-1]} ${String(m.year).slice(-2)}`
    };
    monthAgg[key].spend += m.spend_inr_incl_gst || 0;
    monthAgg[key].leads_attr += m.leads || 0;
  }
  const monthsSorted = Object.values(monthAgg).sort((a, b) => a.ymKey.localeCompare(b.ymKey)).slice(-12);
  const marketing_12m = monthsSorted.map(m => {
    // Count actual leads from DB in this month for the family
    const monthStart = new Date(m.year, m.month - 1, 1).getTime();
    const monthEnd = new Date(m.year, m.month, 1).getTime();
    const leadsActual = leads.filter(l => productCodes.includes(l.program || "")
      && l.first_seen
      && new Date(l.first_seen).getTime() >= monthStart
      && new Date(l.first_seen).getTime() < monthEnd).length;
    return {
      ymKey: m.ymKey, label: m.label,
      spend: Math.round(m.spend),
      leads_attr: Math.round(m.leads_attr),
      leads_actual: leadsActual,
      cpa_attr: m.leads_attr > 0 ? Math.round(m.spend / m.leads_attr) : 0,
      cpa_actual: leadsActual > 0 ? Math.round(m.spend / leadsActual) : 0,
    };
  });

  // --- Rep performance
  const repAgg: Record<string, { actions: number; leads: Set<string>; converted: number; lost: number }> = {};
  for (const a of activities) {
    if (!a.rep_name) continue;
    const t = new Date(a.created_at).getTime();
    if (t < period.startMs || t >= period.endMs) continue;
    const r = repAgg[a.rep_name] ||= { actions: 0, leads: new Set(), converted: 0, lost: 0 };
    r.actions++;
    r.leads.add(a.lead_id);
    if (a.action === "converted" || a.action === "confirmed") r.converted++;
    if (a.action === "lost" || a.action === "called_not_interested") r.lost++;
  }
  const reps: RepPerformance[] = Object.entries(repAgg).map(([name, d]) => ({
    rep_name: name,
    total_actions: d.actions,
    distinct_leads: d.leads.size,
    converted: d.converted,
    lost: d.lost,
    convert_rate: d.leads.size > 0 ? Math.round(1000 * d.converted / d.leads.size) / 10 : 0,
  })).sort((a, b) => b.distinct_leads - a.distinct_leads);

  // --- Diagnostics block (for transparency)
  const explanation = [
    `Period: ${period.label} · ${new Date(period.startMs).toLocaleString("en-IN")} → ${new Date(period.endMs).toLocaleString("en-IN")}`,
    `Total leads in DB matching family + period: ${totalLeads} (of which ${totalScoreable} have scoring data)`,
    `Family marketing spend (sum of months overlapping period, prorated): ${totalSpend.toLocaleString("en-IN")}`,
    `Family CPA = spend / actual_leads = ${totalSpend.toLocaleString("en-IN")} / ${totalLeads} = ${familyCpa.toLocaleString("en-IN")}`,
    `Avg MQL = mean of scores for ${familyScoreableLeads.length} scoreable leads = ${avgMql}; median = ${medianMql}`,
    `(Razorpay-only leads + leads ingested before Apr-26 webhook bug-fix may have stale first_seen and won't appear in recent periods.)`,
  ];

  return {
    period, family,
    hero: {
      total_leads: totalLeads, leads_delta_pct: leadsDeltaPct,
      avg_mql: avgMql, median_mql: medianMql,
      hot_count: hot, super_hot_count: superHot, hot_pct: hotPct,
      spend_inr: Math.round(totalSpend),
      cpa_inr: familyCpa,
      revenue_inr: Math.round(totalRevenue),
      scoreable_leads: familyScoreableLeads.length,
    },
    products, trend_daily, cashflow_daily, marketing_12m, reps,
    diagnostics: { explanation },
  };
}
