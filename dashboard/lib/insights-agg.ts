// Aggregation helpers for the founder /insights dashboard.
// Pure functions — take the raw lead + payment + spend rows, slice by period
// and product, return objects ready for the UI to render.

import type { LeadRow } from "./supabase";
import { tier } from "./scoring";

// ---------------------------------------------------------------- types

export type Period = {
  id: "today" | "7d" | "30d" | "mtd" | "custom";
  label: string;
  startMs: number;
  endMs: number;        // exclusive
  prevStartMs?: number; // matched-length previous period for delta calc
  prevEndMs?: number;
};

export type ProductAgg = {
  code: string;
  count: number;
  avg_mql: number;
  median_mql: number;
  hot_count: number;     // >=50
  super_hot_count: number; // >=70
  hot_pct: number;       // 0-100
  // Signal distributions — counts of each signal across leads in the period
  signals: {
    job:   Record<string, number>;
    age:   Record<string, number>;
    why:   Record<string, number>;  // bucket
    grant: Record<string, number>;
  };
  delta_vs_prev: { count: number; avg_mql: number; hot_pct: number };
  // Sparkline points — avg MQL per day over the trailing 14 days
  sparkline: number[];
};

export type PaymentRow = {
  paid_at: string;
  amount_inr: number;
  status: string;
  program: string | null;
  payment_type: string | null;
};

// ---------------------------------------------------------------- periods

export function buildPeriod(id: Period["id"], opts?: { customStart?: string; customEnd?: string }): Period {
  const now = Date.now();
  const dayMs = 86400_000;
  let start: number, end = now;
  let label = "";
  if (id === "today") {
    const d = new Date(); d.setHours(0,0,0,0);
    start = d.getTime();
    label = "Today";
  } else if (id === "7d") {
    start = now - 7 * dayMs;
    label = "Last 7 days";
  } else if (id === "30d") {
    start = now - 30 * dayMs;
    label = "Last 30 days";
  } else if (id === "mtd") {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
    start = d.getTime();
    label = "Month to date";
  } else {
    start = opts?.customStart ? new Date(opts.customStart).getTime() : (now - 7 * dayMs);
    end = opts?.customEnd ? new Date(opts.customEnd).getTime() : now;
    label = `${new Date(start).toLocaleDateString("en-IN")} → ${new Date(end).toLocaleDateString("en-IN")}`;
  }
  const len = end - start;
  return {
    id, label,
    startMs: start, endMs: end,
    prevStartMs: start - len, prevEndMs: start,
  };
}

// ---------------------------------------------------------------- signal extraction

const JOB_KEYS = ["entrepreneur","freelance","corporate","exploring","working_other","working","break","student","other_professional","other"];
const AGE_KEYS = ["under_18","18_24","24_28","28_32","32_45","45_60","60plus"];
const WHY_KEYS = ["empty","under_30","31_100","101_250","251_500","501_1000","1000plus"];
const GRANT_KEYS = ["without_grant","with_grant"];

function bucketJob(bd: Record<string, number>): string {
  for (const k of Object.keys(bd)) {
    if (k.startsWith("job_")) return k.replace("job_", "");
  }
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

// ---------------------------------------------------------------- per-product agg

export function aggregateByProduct(leads: LeadRow[], productCode: string, period: Period): ProductAgg {
  const inPeriod = (l: LeadRow) => {
    if (l.program !== productCode) return false;
    if (!l.first_seen) return false;
    const t = new Date(l.first_seen).getTime();
    return t >= period.startMs && t < period.endMs;
  };
  const inPrev = (l: LeadRow) => {
    if (!period.prevStartMs || !period.prevEndMs) return false;
    if (l.program !== productCode) return false;
    if (!l.first_seen) return false;
    const t = new Date(l.first_seen).getTime();
    return t >= period.prevStartMs && t < period.prevEndMs;
  };

  const cur = leads.filter(inPeriod);
  const prev = leads.filter(inPrev);

  const sumScore = cur.reduce((s, l) => s + (l.score || 0), 0);
  const avg_mql = cur.length ? Math.round(sumScore / cur.length) : 0;
  const sortedScores = cur.map(l => l.score || 0).sort((a, b) => a - b);
  const median_mql = sortedScores.length ? sortedScores[Math.floor(sortedScores.length / 2)] : 0;
  const hot_count = cur.filter(l => l.score >= 50).length;
  const super_hot_count = cur.filter(l => l.score >= 70).length;
  const hot_pct = cur.length ? Math.round(1000 * hot_count / cur.length) / 10 : 0;

  // Signal distributions
  const signals = { job: {} as Record<string, number>, age: {} as Record<string, number>, why: {} as Record<string, number>, grant: {} as Record<string, number> };
  for (const l of cur) {
    const bd = l.score_breakdown || {};
    const j = bucketJob(bd);   signals.job[j]   = (signals.job[j]   || 0) + 1;
    const a = bucketAge(bd);   signals.age[a]   = (signals.age[a]   || 0) + 1;
    const w = bucketWhy(bd);   signals.why[w]   = (signals.why[w]   || 0) + 1;
    const g = bucketGrant(bd); signals.grant[g] = (signals.grant[g] || 0) + 1;
  }

  // Deltas vs previous period
  const prevSum = prev.reduce((s, l) => s + (l.score || 0), 0);
  const prevAvg = prev.length ? Math.round(prevSum / prev.length) : 0;
  const prevHotPct = prev.length ? Math.round(1000 * prev.filter(l => l.score >= 50).length / prev.length) / 10 : 0;
  const delta_vs_prev = {
    count: cur.length - prev.length,
    avg_mql: avg_mql - prevAvg,
    hot_pct: Math.round(10 * (hot_pct - prevHotPct)) / 10,
  };

  // Sparkline: avg MQL per day over trailing 14 days within period (or 14d ending now)
  const dayMs = 86400_000;
  const sparkPoints = 14;
  const sparkEnd = period.endMs;
  const sparkStart = sparkEnd - sparkPoints * dayMs;
  const buckets: { sum: number; n: number }[] = Array.from({length: sparkPoints}, () => ({sum: 0, n: 0}));
  for (const l of leads) {
    if (l.program !== productCode || !l.first_seen) continue;
    const t = new Date(l.first_seen).getTime();
    if (t < sparkStart || t >= sparkEnd) continue;
    const idx = Math.floor((t - sparkStart) / dayMs);
    if (idx >= 0 && idx < sparkPoints) {
      buckets[idx].sum += (l.score || 0);
      buckets[idx].n += 1;
    }
  }
  const sparkline = buckets.map(b => b.n ? Math.round(b.sum / b.n) : 0);

  return {
    code: productCode,
    count: cur.length, avg_mql, median_mql,
    hot_count, super_hot_count, hot_pct,
    signals, delta_vs_prev, sparkline,
  };
}

// ---------------------------------------------------------------- trend per product per day

export function buildDailyTrend(leads: LeadRow[], productCodes: string[], period: Period): { date: string; [code: string]: number | string }[] {
  const dayMs = 86400_000;
  const startDay = new Date(period.startMs); startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(period.endMs); endDay.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / dayMs));

  const series: { date: string; [code: string]: number | string }[] = [];
  for (let d = 0; d < days; d++) {
    const dStart = startDay.getTime() + d * dayMs;
    const dEnd = dStart + dayMs;
    const row: any = { date: new Date(dStart).toLocaleDateString("en-IN", { month: "short", day: "2-digit" }) };
    for (const code of productCodes) {
      const inDay = leads.filter(l => l.program === code && l.first_seen && new Date(l.first_seen).getTime() >= dStart && new Date(l.first_seen).getTime() < dEnd);
      const sum = inDay.reduce((s, l) => s + (l.score || 0), 0);
      row[code] = inDay.length ? Math.round(sum / inDay.length) : 0;
      row[`${code}_count`] = inDay.length;
    }
    series.push(row);
  }
  return series;
}

// ---------------------------------------------------------------- payments / cash flow

export function buildCashflowDaily(payments: PaymentRow[], productCodes: string[], period: Period) {
  const dayMs = 86400_000;
  const startDay = new Date(period.startMs); startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(period.endMs); endDay.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / dayMs));

  const series: any[] = [];
  for (let d = 0; d < days; d++) {
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
    series.push(row);
  }
  return series;
}

// ---------------------------------------------------------------- rep performance

export type RepActivity = {
  rep_name: string;
  lead_id: string;
  action: string;
  created_at: string;
};

export function aggregateRepPerformance(activities: RepActivity[], period: Period) {
  const byRep: Record<string, {
    total_actions: number;
    by_action: Record<string, number>;
    distinct_leads: Set<string>;
    converted: number;
    lost: number;
  }> = {};
  for (const a of activities) {
    if (!a.rep_name) continue;
    const t = new Date(a.created_at).getTime();
    if (t < period.startMs || t >= period.endMs) continue;
    const r = byRep[a.rep_name] ||= { total_actions: 0, by_action: {}, distinct_leads: new Set(), converted: 0, lost: 0 };
    r.total_actions++;
    r.by_action[a.action] = (r.by_action[a.action] || 0) + 1;
    r.distinct_leads.add(a.lead_id);
    if (a.action === "confirmed" || a.action === "converted") r.converted++;
    if (a.action === "lost" || a.action === "called_not_interested") r.lost++;
  }
  return Object.entries(byRep).map(([rep, d]) => ({
    rep_name: rep,
    total_actions: d.total_actions,
    distinct_leads: d.distinct_leads.size,
    converted: d.converted,
    lost: d.lost,
    by_action: d.by_action,
    convert_rate: d.distinct_leads.size > 0 ? Math.round(1000 * d.converted / d.distinct_leads.size) / 10 : 0,
  })).sort((a, b) => b.distinct_leads - a.distinct_leads);
}
