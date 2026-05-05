// Meta Ads API client — pulls spend directly for unified KPIs.
//
// Existing /api/sync route does a daily 6am IST sync to Sheets (full ad-
// level granularity). This module is a leaner wrapper that fetches just
// the monthly spend totals on demand, so the Overview KPIs reflect live
// Meta numbers instead of waiting on the cron + manual sheet entry.
//
// Strategy:
//   · Account-level insights call → total spend for a month (1 API hit)
//   · Cached 1h (spend doesn't move minute-to-minute, and Meta has rate limits)
//   · Falls back gracefully if env vars missing — caller can use Sheets path
//
// Required env vars: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID_API

import { unstable_cache } from "next/cache";

const META_API = "https://graph.facebook.com/v21.0";
const GST = 0.18; // Indian GST on ad spend

export type MetaMonthlySpend = {
  spend_excl_gst: number;
  spend_incl_gst: number;
  impressions: number;
  clicks: number;
  account_id: string;
  since: string;
  until: string;
  fetched_at: string;
};

async function metaGet(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) return r.json();
    if ([429, 500, 502, 503, 504].includes(r.status)) {
      await new Promise(res => setTimeout(res, 1000 * (2 ** i)));
      continue;
    }
    throw new Error(`Meta API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Error("Meta API failed after retries");
}

async function fetchMonthlySpendImpl(year: number, month: number): Promise<MetaMonthlySpend | null> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID_API;
  if (!token || !account) {
    console.warn("[meta-ads] META_ACCESS_TOKEN / META_AD_ACCOUNT_ID_API not set — falling back to sheet spend");
    return null;
  }

  // Month boundaries in YYYY-MM-DD (Meta wants local date strings).
  const since = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const until = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const tr = encodeURIComponent(JSON.stringify({ since, until }));

  // Account-level insights = single row covering the whole period for the
  // entire ad account. Way faster than iterating campaigns when we only
  // need totals (the existing sync still does per-ad detail for the daily
  // sheet — that's a different use case).
  const url = `${META_API}/${account}/insights?access_token=${token}&time_range=${tr}&fields=spend,impressions,clicks&limit=10`;
  const data = await metaGet(url);
  const rows = (data.data || []) as Array<{ spend?: string; impressions?: string; clicks?: string }>;

  const spend_excl_gst = rows.reduce((s, r) => s + parseFloat(r.spend || "0"), 0);
  const impressions    = rows.reduce((s, r) => s + parseInt(r.impressions || "0"), 0);
  const clicks         = rows.reduce((s, r) => s + parseInt(r.clicks || "0"), 0);

  return {
    spend_excl_gst,
    spend_incl_gst: spend_excl_gst * (1 + GST),
    impressions,
    clicks,
    account_id: account,
    since, until,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Live monthly Meta Ads spend for {year, month}. Cached 1h, tagged "meta-ads".
 * Returns null if env vars are missing or the API call fails — caller should
 * fall back to the sheet-tracked spend.
 */
export const fetchMonthlySpend = unstable_cache(
  async (year: number, month: number) => {
    try { return await fetchMonthlySpendImpl(year, month); }
    catch (e: any) {
      console.error("[meta-ads] fetchMonthlySpend failed:", e?.message);
      return null;
    }
  },
  ["meta-monthly-spend-v1"],
  { revalidate: 3600, tags: ["meta-ads"] },
);
