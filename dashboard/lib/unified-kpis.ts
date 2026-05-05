// Single source of truth for marketing economics.
//
// Problem this solves: /, /insights, /leads each had their own way of
// computing acquisitions and CAC. Sheets-only on Overview, hybrid on
// Insights, none on /leads. Numbers diverged because:
//   · Sheets "acquisitions" was manually entered by the team (often = total
//     leads, which deflates CAC by 30-100×)
//   · Supabase has the real funnel state but wasn't being used for KPIs
//   · No single helper computed "true CAC" using paid customers
//
// THE TRUTH (per founder):
//   · Marketing spend comes from sheets (manual P&L) + manual_marketing_spend
//     table (influencers/agencies). Sheets is the maintained source.
//   · Funnel state comes from Supabase — leads table is the truth.
//   · We expose THREE cost-per-conversion numbers so reps see real economics:
//       CPL — Cost Per Lead         = spend / total leads (cheapest per number)
//       CPA — Cost Per App-Fee Paid = spend / leads who paid app fee (most useful — first $ commitment)
//       CAC — Cost Per Confirmed     = spend / leads who paid balance (real customer acquisition cost)
//
// Imports both data sources and stitches them together. Cached 60s.

import { unstable_cache } from "next/cache";
import { supabase } from "./supabase";
import { loadAll } from "./data";

export type UnifiedKpis = {
  period: { ym: string; year: number; month: number; label: string };
  prev:   { ym: string; year: number; month: number };

  // Marketing economics
  spend:        { now: number; prev: number };
  spend_sheet:  number;     // sheets-tracked (Meta Ads, manual P&L)
  spend_manual: number;     // manual_marketing_spend table (influencers etc)

  // Funnel — from Supabase, the truth
  total_leads:        { now: number; prev: number };  // leads created in this period
  app_fee_paid_count: { now: number; prev: number };  // leads at app_fee_paid+ this period
  confirmed_count:    { now: number; prev: number };  // leads at balance_paid this period
  attended_count:     { now: number; prev: number };

  // Three honest cost-per-X
  cpl: { now: number; prev: number };  // Cost per Lead
  cpa: { now: number; prev: number };  // Cost per App-fee-paid (the "real CAC" most marketers care about)
  cac: { now: number; prev: number };  // Cost per Confirmed (true CAC)

  // P&L (still from sheets — manually maintained)
  revenue:  { now: number; prev: number };
  gross_pl: { now: number; prev: number };
};

const ymRange = (year: number, month: number) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end   = new Date(Date.UTC(year, month, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
};

/**
 * Computes unified KPIs for the latest sheet-tracked month + the prior month.
 * Cached 60s, tag "leads" so webhooks invalidate it.
 */
export const fetchUnifiedKpis = unstable_cache(
  async (): Promise<UnifiedKpis | null> => {
    // 1. Marketing spend + period — from sheets (the maintained source)
    let sheetData: Awaited<ReturnType<typeof loadAll>> | null = null;
    try { sheetData = await loadAll(); } catch (e: any) {
      console.error("[unified-kpis] sheets load failed:", e?.message);
    }
    if (!sheetData) return null;

    const latest = latestMonthFromActuals(sheetData.actuals);
    if (!latest) return null;
    const prev = prevMonth(latest);

    const spendSheetNow  = findActualValue(sheetData.actuals, "Marketing (incl GST)", latest.ym) ?? 0;
    const spendSheetPrev = findActualValue(sheetData.actuals, "Marketing (incl GST)", prev.ym) ?? 0;
    const revNow         = findActualValue(sheetData.actuals, "Revenue from Operations (A)", latest.ym) ?? 0;
    const revPrev        = findActualValue(sheetData.actuals, "Revenue from Operations (A)", prev.ym) ?? 0;
    const grossNow       = findActualValue(sheetData.actuals, "Gross P/L", latest.ym) ?? 0;
    const grossPrev      = findActualValue(sheetData.actuals, "Gross P/L", prev.ym) ?? 0;

    // 2. Manual spend (influencers, agencies, etc.) — from Supabase
    let spendManualNow = 0, spendManualPrev = 0;
    try {
      const nowR = ymRange(latest.year, latest.month);
      const prR  = ymRange(prev.year,   prev.month);
      const [n, p] = await Promise.all([
        supabase.from("manual_marketing_spend")
          .select("amount_inr").gte("date", nowR.startIso.slice(0, 10)).lt("date", nowR.endIso.slice(0, 10)),
        supabase.from("manual_marketing_spend")
          .select("amount_inr").gte("date", prR.startIso.slice(0, 10)).lt("date", prR.endIso.slice(0, 10)),
      ]);
      spendManualNow  = (n.data || []).reduce((s, r: any) => s + Number(r.amount_inr || 0), 0);
      spendManualPrev = (p.data || []).reduce((s, r: any) => s + Number(r.amount_inr || 0), 0);
    } catch { /* table may not exist — non-fatal */ }

    const spendNow  = spendSheetNow  + spendManualNow;
    const spendPrev = spendSheetPrev + spendManualPrev;

    // 3. Funnel counts from Supabase — by lead created_at within the period.
    //
    // Key insight: leads created THIS month who eventually reach a paid stage
    // = the cohort whose CAC we should compute against THIS month's spend.
    // We could attribute on payment date instead; pick what matches the
    // founder's mental model. Going with created_at since that's how Meta
    // attribution works — spend → leads → conversions over time.
    const nowR = ymRange(latest.year, latest.month);
    const prR  = ymRange(prev.year,   prev.month);

    const stagesPaidApp = ["app_fee_paid", "accepted", "confirmed", "balance_paid"];
    const stagesConfirmed = ["balance_paid"]; // strictest definition

    const [
      totalNow, totalPrev,
      paidAppNow, paidAppPrev,
      confirmedNow, confirmedPrev,
    ] = await Promise.all([
      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", nowR.startIso).lt("created_at", nowR.endIso),
      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", prR.startIso).lt("created_at", prR.endIso),

      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", nowR.startIso).lt("created_at", nowR.endIso)
        .in("funnel_stage", stagesPaidApp),
      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", prR.startIso).lt("created_at", prR.endIso)
        .in("funnel_stage", stagesPaidApp),

      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", nowR.startIso).lt("created_at", nowR.endIso)
        .in("funnel_stage", stagesConfirmed),
      supabase.from("leads").select("*", { count: "exact", head: true })
        .gte("created_at", prR.startIso).lt("created_at", prR.endIso)
        .in("funnel_stage", stagesConfirmed),
    ]);

    const total_leads     = { now: totalNow.count || 0,    prev: totalPrev.count || 0 };
    const app_fee_paid    = { now: paidAppNow.count || 0,  prev: paidAppPrev.count || 0 };
    const confirmed       = { now: confirmedNow.count || 0, prev: confirmedPrev.count || 0 };

    const cpl = {
      now:  total_leads.now  > 0 ? Math.round(spendNow  / total_leads.now)  : 0,
      prev: total_leads.prev > 0 ? Math.round(spendPrev / total_leads.prev) : 0,
    };
    const cpa = {
      now:  app_fee_paid.now  > 0 ? Math.round(spendNow  / app_fee_paid.now)  : 0,
      prev: app_fee_paid.prev > 0 ? Math.round(spendPrev / app_fee_paid.prev) : 0,
    };
    const cac = {
      now:  confirmed.now  > 0 ? Math.round(spendNow  / confirmed.now)  : 0,
      prev: confirmed.prev > 0 ? Math.round(spendPrev / confirmed.prev) : 0,
    };

    return {
      period: latest,
      prev,
      spend:        { now: spendNow,  prev: spendPrev  },
      spend_sheet:  spendSheetNow,
      spend_manual: spendManualNow,
      total_leads,
      app_fee_paid_count: app_fee_paid,
      confirmed_count:    confirmed,
      attended_count:     { now: 0, prev: 0 }, // placeholder — wire to attended stage when used
      cpl, cpa, cac,
      revenue:  { now: revNow,   prev: revPrev   },
      gross_pl: { now: grossNow, prev: grossPrev },
    };
  },
  ["fetch-unified-kpis-v1"],
  { revalidate: 60, tags: ["leads"] },
);

// ---------------------------------------------------------------- helpers

function latestMonthFromActuals(actuals: { metric: string; values: { ym: string; year: number; month: number; value: number | null }[] }[]) {
  const rev = actuals.find(r => r.metric === "Revenue from Operations (A)" || r.metric.startsWith("Revenue from"));
  if (!rev) return null;
  const filled = rev.values.filter(v => v.value !== null && v.value > 0);
  if (!filled.length) return null;
  const last = filled[filled.length - 1];
  const monthLabel = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][last.month - 1];
  return { ym: last.ym, year: last.year, month: last.month, label: `${monthLabel} ${last.year}` };
}

function prevMonth(p: { year: number; month: number }) {
  return p.month === 1
    ? { ym: `${p.year - 1}-12`, year: p.year - 1, month: 12 }
    : { ym: `${p.year}-${String(p.month - 1).padStart(2, "0")}`, year: p.year, month: p.month - 1 };
}

function findActualValue(actuals: any[], metric: string, ym: string): number | null {
  const r = actuals.find((x: any) => x.metric === metric);
  if (!r) return null;
  const v = r.values.find((x: any) => x.ym === ym);
  return v?.value ?? null;
}
