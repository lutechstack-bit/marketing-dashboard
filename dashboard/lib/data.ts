// Data layer — pulls from Google Sheet, normalizes for the dashboard.

import { readMultipleTabs, tableToObjects } from "./sheets";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export type MonthlyMetric = {
  year: number; month: number; month_name: string; program: string;
  spend_inr_excl_gst: number; spend_inr_incl_gst: number;
  impressions: number; reach: number; clicks: number;
  ctr_pct: number; cpc_inr: number; cpm_inr: number;
  leads: number; cost_per_lead: number;
  purchase_count: number; purchase_value: number;
};

export type ProgramRollup = {
  ymKey: string; year: number; month: number; label: string;
  FFM: number; FW: number; FC: number; FAI: number;
  total: number;
};

export type ActualsRow = {
  metric: string;
  values: { ym: string; year: number; month: number; value: number | null }[];
};

export type AcquisitionRow = {
  ym: string; year: number; month: number; label: string;
  FFM: number; FW: number; FC: number; FAI: number; total: number;
};

const num = (x: any) => {
  if (x === null || x === undefined || x === "") return 0;
  const n = typeof x === "number" ? x : parseFloat(String(x).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export type ProgramMonthMetrics = {
  total_rev: number;
  conversion_rev: number;
  appl_rev: number;
  applicants: number;
  app_fee_count: number;
  app_fee_cr: number;
  converts: number;
  conversion_rate: number;
  caq: number;
  ads_spend: number;
  influencer_spend: number;
};

export type ProgramScorecard = {
  program: "FFM" | "FW" | "FC" | "FAI";
  name: string;
  this_month: ProgramMonthMetrics;
  prev_month: ProgramMonthMetrics;
};

export type CampaignPerf = {
  campaign_id: string;
  campaign_name: string;
  program: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  purchases: number;
  active_days: number;
};

export type AdPerf = {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  program: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  leads: number;
  purchases: number;
};

const PROGRAM_NAMES: Record<string, string> = {
  FFM: "Forge Filmmaking", FW: "Forge Writing", FC: "Forge Creators", FAI: "Forge AI",
};

// Inputs tab row layout — each program block is at known offsets from its header row
const INPUT_BLOCKS: Record<"FFM" | "FW" | "FC" | "FAI", { header: number; ads: number; influencer: number }> = {
  FFM: { header: 14, ads: 3,  influencer: 4 },
  FW:  { header: 25, ads: 5,  influencer: 6 },
  FC:  { header: 36, ads: 7,  influencer: 8 },
  FAI: { header: 47, ads: 9,  influencer: 10 },
};

export async function loadAll() {
  const tabs = await readMultipleTabs([
    "Meta Ads Monthly Rollup",
    "Meta Ads Daily",
    "Inputs",
    "Actuals",
    "Master",
  ]);

  // 1. Monthly rollup → list of MonthlyMetric
  const rollupRaw = tableToObjects(tabs["Meta Ads Monthly Rollup"] || []);
  const monthly: MonthlyMetric[] = rollupRaw.map((r: any) => ({
    year: parseInt(r.year),
    month: parseInt(r.month),
    month_name: r.month_name,
    program: r.program,
    spend_inr_excl_gst: num(r.spend_inr_excl_gst),
    spend_inr_incl_gst: num(r.spend_inr_incl_gst),
    impressions: num(r.impressions),
    reach: num(r.reach),
    clicks: num(r.clicks),
    ctr_pct: num(r.ctr_pct),
    cpc_inr: num(r.cpc_inr),
    cpm_inr: num(r.cpm_inr),
    leads: num(r.leads),
    cost_per_lead: num(r.cost_per_lead),
    purchase_count: num(r.purchase_count),
    purchase_value: num(r.purchase_value),
  }));

  // 2. Spend trend pivoted (year/month → {FFM, FW, FC, FAI})
  const spendTrendMap = new Map<string, ProgramRollup>();
  for (const m of monthly) {
    const ymKey = `${m.year}-${String(m.month).padStart(2, "0")}`;
    const label = `${m.month_name.slice(0,3)} ${String(m.year).slice(-2)}`;
    if (!spendTrendMap.has(ymKey)) {
      spendTrendMap.set(ymKey, {
        ymKey, year: m.year, month: m.month, label,
        FFM: 0, FW: 0, FC: 0, FAI: 0, total: 0,
      });
    }
    const row = spendTrendMap.get(ymKey)!;
    if (m.program in row) {
      (row as any)[m.program] = m.spend_inr_incl_gst;
    }
    row.total += m.spend_inr_incl_gst;
  }
  const spendTrend = Array.from(spendTrendMap.values()).sort((a, b) => a.ymKey.localeCompare(b.ymKey));

  // 3. Actuals tab — month columns + metric rows
  const actualsRaw = tabs["Actuals"] || [];
  // Row 1: months (date strings or month-year), col 0 is "Month"
  const headerRow = actualsRaw[0] || [];
  const monthCols: { idx: number; ym: string; year: number; month: number }[] = [];
  for (let c = 1; c < headerRow.length; c++) {
    const v = headerRow[c];
    if (!v) continue;
    // Try parse as date
    let date: Date | null = null;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) date = new Date(trimmed);
      else if (/^\d+$/.test(trimmed)) {
        // Excel serial date: 1899-12-30 + days
        const serial = parseInt(trimmed);
        date = new Date((serial - 25569) * 86400 * 1000);
      }
    } else if (typeof v === "number") {
      date = new Date((v - 25569) * 86400 * 1000);
    }
    if (date && !isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth() + 1;
      monthCols.push({ idx: c, ym: `${y}-${String(m).padStart(2, "0")}`, year: y, month: m });
    }
  }

  const actuals: ActualsRow[] = [];
  for (let r = 1; r < actualsRaw.length; r++) {
    const row = actualsRaw[r];
    const metric = (row?.[0] || "").toString().trim();
    if (!metric) continue;
    const values = monthCols.map((mc) => ({
      ym: mc.ym, year: mc.year, month: mc.month,
      value: row[mc.idx] !== undefined && row[mc.idx] !== "" ? num(row[mc.idx]) : null,
    }));
    actuals.push({ metric, values });
  }

  // 4. Acquisition counts (Acquisition FW/FFM/FAI/FC rows in Actuals)
  const acqMap = new Map<string, AcquisitionRow>();
  const acqMetrics: Record<string, "FFM" | "FW" | "FC" | "FAI"> = {
    "Acquisition FFM": "FFM",
    "Acquisition FW": "FW",
    "Acquisition FC": "FC",
    "Acquisition FAI": "FAI",
  };
  for (const a of actuals) {
    const prog = acqMetrics[a.metric];
    if (!prog) continue;
    for (const v of a.values) {
      if (!acqMap.has(v.ym)) {
        acqMap.set(v.ym, {
          ym: v.ym, year: v.year, month: v.month,
          label: `${MONTHS[v.month-1]?.slice(0,3)} ${String(v.year).slice(-2)}`,
          FFM: 0, FW: 0, FC: 0, FAI: 0, total: 0,
        });
      }
      const row = acqMap.get(v.ym)!;
      const val = v.value ?? 0;
      (row as any)[prog] = val;
      row.total = row.FFM + row.FW + row.FC + row.FAI;
    }
  }
  const acquisition = Array.from(acqMap.values()).sort((a,b) => a.ym.localeCompare(b.ym));

  // 5. Master tab → recent paid students
  const masterObjs = tableToObjects(tabs["Master"] || []).filter((r:any) => r.Type === "Slot Confirmation");

  // 6. Per-program scorecards from Inputs tab
  const inputsRaw = tabs["Inputs"] || [];
  // Find latest month with any Applicants data
  const inputYearRow = inputsRaw[0] || [];
  const inputMonthRow = inputsRaw[1] || [];
  const monthColIdx: { idx: number; ym: string; year: number; month: number; label: string }[] = [];
  for (let c = 1; c < inputYearRow.length; c++) {
    const yr = parseInt(String(inputYearRow[c]).trim());
    const mo = String(inputMonthRow[c]).trim();
    const monthIdx = MONTHS.indexOf(mo) + 1;
    if (yr && monthIdx) {
      monthColIdx.push({ idx: c, ym: `${yr}-${String(monthIdx).padStart(2,"0")}`, year: yr, month: monthIdx, label: `${mo.slice(0,3)} ${String(yr).slice(-2)}` });
    }
  }

  // Find latest month where ANY program has applicants/converts data
  let latestInputCol = monthColIdx[monthColIdx.length - 1];
  let prevInputCol = monthColIdx[monthColIdx.length - 2];

  const readProgramBlock = (program: keyof typeof INPUT_BLOCKS, col: number): ProgramMonthMetrics => {
    const headerRow = INPUT_BLOCKS[program].header; // 1-based: e.g. row 14
    const get = (offset: number) => num(inputsRaw[headerRow - 1 + offset]?.[col]);
    return {
      total_rev:      get(1),
      conversion_rev: get(2),
      appl_rev:       get(3),
      applicants:     get(4),
      app_fee_count:  get(5),
      app_fee_cr:     get(6),
      converts:       get(7),
      conversion_rate: get(8),
      caq:            get(9),
      ads_spend:      num(inputsRaw[INPUT_BLOCKS[program].ads - 1]?.[col]),
      influencer_spend: num(inputsRaw[INPUT_BLOCKS[program].influencer - 1]?.[col]),
    };
  };

  const programScorecards: ProgramScorecard[] = (["FFM","FW","FC","FAI"] as const).map((p) => ({
    program: p,
    name: PROGRAM_NAMES[p],
    this_month: latestInputCol ? readProgramBlock(p, latestInputCol.idx) : {} as ProgramMonthMetrics,
    prev_month: prevInputCol ? readProgramBlock(p, prevInputCol.idx) : {} as ProgramMonthMetrics,
  }));

  // 7. Campaign performance from Meta Ads Daily — last 30 days
  const dailyRaw = tableToObjects(tabs["Meta Ads Daily"] || []);
  const today = new Date();
  const cutoff = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0,10);
  const recentDaily = dailyRaw.filter((r: any) => r.date && r.date >= cutoff);

  // Group by campaign
  const campaignMap = new Map<string, CampaignPerf>();
  for (const r of recentDaily) {
    const key = r.campaign_id;
    if (!key) continue;
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaign_id: key, campaign_name: r.campaign_name || "—",
        program: r.program || "—",
        spend: 0, impressions: 0, clicks: 0,
        ctr: 0, cpc: 0, cpm: 0, leads: 0, purchases: 0, active_days: 0,
      });
    }
    const c = campaignMap.get(key)!;
    c.spend += num(r.spend);
    c.impressions += num(r.impressions);
    c.clicks += num(r.clicks);
    c.leads += num(r.lead) + num(r.lead_pixel);
    c.purchases += num(r.purchase_pixel);
    c.active_days += 1;
  }
  const campaigns = Array.from(campaignMap.values()).map((c) => ({
    ...c,
    ctr: c.impressions ? +(100 * c.clicks / c.impressions).toFixed(2) : 0,
    cpc: c.clicks ? +(c.spend / c.clicks).toFixed(2) : 0,
    cpm: c.impressions ? +(c.spend / c.impressions * 1000).toFixed(2) : 0,
  })).filter(c => c.spend > 0).sort((a,b) => b.spend - a.spend);

  // 8. Top ads (by lead count, last 30 days)
  const adMap = new Map<string, AdPerf>();
  for (const r of recentDaily) {
    const key = r.ad_id;
    if (!key) continue;
    if (!adMap.has(key)) {
      adMap.set(key, {
        ad_id: key, ad_name: r.ad_name || "—",
        campaign_name: r.campaign_name || "—",
        program: r.program || "—",
        spend: 0, impressions: 0, clicks: 0, ctr: 0,
        leads: 0, purchases: 0,
      });
    }
    const a = adMap.get(key)!;
    a.spend += num(r.spend);
    a.impressions += num(r.impressions);
    a.clicks += num(r.clicks);
    a.leads += num(r.lead) + num(r.lead_pixel);
    a.purchases += num(r.purchase_pixel);
  }
  const topAds = Array.from(adMap.values()).map((a) => ({
    ...a,
    ctr: a.impressions ? +(100 * a.clicks / a.impressions).toFixed(2) : 0,
  })).filter(a => a.spend > 0)
     .sort((a,b) => (b.leads + b.purchases * 10) - (a.leads + a.purchases * 10))
     .slice(0, 10);

  return {
    monthly, spendTrend, actuals, acquisition, master: masterObjs, monthCols,
    programScorecards, campaigns, topAds,
    latestInputMonth: latestInputCol,
  };
}

export function findActualValue(actuals: ActualsRow[], metric: string, ym: string): number | null {
  const row = actuals.find(r => r.metric.toLowerCase() === metric.toLowerCase());
  if (!row) return null;
  const v = row.values.find(x => x.ym === ym);
  return v?.value ?? null;
}

export function latestMonthYM(actuals: ActualsRow[]): { ym: string; year: number; month: number } | null {
  // Use the rev row to find latest month with data
  const rev = actuals.find(r => r.metric === "Revenue from Operations (A)" || r.metric.startsWith("Revenue from"));
  if (!rev) return null;
  const filled = rev.values.filter(v => v.value !== null && v.value > 0);
  if (!filled.length) return null;
  return filled[filled.length - 1];
}

export function computeKpis(d: Awaited<ReturnType<typeof loadAll>>) {
  const latest = latestMonthYM(d.actuals);
  if (!latest) return null;

  const prevMonth = latest.month === 1
    ? { ym: `${latest.year-1}-12`, year: latest.year-1, month: 12 }
    : { ym: `${latest.year}-${String(latest.month-1).padStart(2,"0")}`, year: latest.year, month: latest.month-1 };

  const spendThis = findActualValue(d.actuals, "Marketing (incl GST)", latest.ym) ?? 0;
  const revThis = findActualValue(d.actuals, "Revenue from Operations (A)", latest.ym) ?? 0;
  const acqThis = d.acquisition.find(a => a.ym === latest.ym)?.total ?? 0;
  const cacThis = acqThis > 0 ? spendThis / acqThis : 0;

  const spendPrev = findActualValue(d.actuals, "Marketing (incl GST)", prevMonth.ym) ?? 0;
  const revPrev = findActualValue(d.actuals, "Revenue from Operations (A)", prevMonth.ym) ?? 0;
  const acqPrev = d.acquisition.find(a => a.ym === prevMonth.ym)?.total ?? 0;
  const cacPrev = acqPrev > 0 ? spendPrev / acqPrev : 0;

  const grossPL = (findActualValue(d.actuals, "Gross P/L", latest.ym) ?? 0);
  const grossPLPrev = (findActualValue(d.actuals, "Gross P/L", prevMonth.ym) ?? 0);

  return {
    latest, prevMonth,
    spend: { now: spendThis, prev: spendPrev },
    revenue: { now: revThis, prev: revPrev },
    acquisitions: { now: acqThis, prev: acqPrev },
    cac: { now: cacThis, prev: cacPrev },
    grossPL: { now: grossPL, prev: grossPLPrev },
  };
}
