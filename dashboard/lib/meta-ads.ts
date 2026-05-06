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
import { classifyCampaignFull, type Family } from "./parser";

const META_API = "https://graph.facebook.com/v21.0";
const GST = 0.18; // Indian GST on ad spend

export type MetaMonthlySpend = {
  spend_excl_gst: number;
  spend_incl_gst: number;
  impressions: number;
  clicks: number;
  by_family: Record<Family, { spend: number; impressions: number; clicks: number; campaigns: number }>;
  excluded_examples: { name: string; family: Family; spend: number }[]; // first few excluded campaigns for transparency
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

async function fetchMonthlySpendImpl(
  year: number,
  month: number,
  includeFamilies: Family[],
): Promise<MetaMonthlySpend | null> {
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

  // Campaign-level insights so we can classify each campaign by name and
  // include only Forge / Live (excluding Masterclass, Workshop, Other).
  // One paginated call per ad account; usually 1-3 pages.
  const fields = "spend,impressions,clicks,campaign_name,campaign_id";
  let nextUrl: string | null =
    `${META_API}/${account}/insights?access_token=${token}&time_range=${tr}&level=campaign&fields=${fields}&limit=200`;
  const rows: Array<{ spend?: string; impressions?: string; clicks?: string; campaign_name?: string }> = [];
  while (nextUrl) {
    const d: any = await metaGet(nextUrl);
    rows.push(...(d.data || []));
    nextUrl = d.paging?.next || null;
  }

  // Initialize per-family aggregator
  const families: Family[] = ["Forge", "Live", "Masterclass", "Workshop", "Other"];
  const by_family: MetaMonthlySpend["by_family"] = Object.fromEntries(
    families.map(f => [f, { spend: 0, impressions: 0, clicks: 0, campaigns: 0 }]),
  ) as any;

  let spend_incl = 0;
  let spend_excl = 0;
  let impressions_total = 0;
  let clicks_total = 0;
  const excluded_examples: { name: string; family: Family; spend: number }[] = [];

  const include = new Set(includeFamilies);

  for (const r of rows) {
    const name = r.campaign_name || "";
    const { family } = classifyCampaignFull(name);
    const spend  = parseFloat(r.spend || "0");
    const imp    = parseInt(r.impressions || "0");
    const clk    = parseInt(r.clicks || "0");

    by_family[family].spend       += spend;
    by_family[family].impressions += imp;
    by_family[family].clicks      += clk;
    by_family[family].campaigns   += 1;

    if (include.has(family)) {
      spend_excl += spend;
      impressions_total += imp;
      clicks_total += clk;
    } else if (excluded_examples.length < 6 && spend > 0) {
      excluded_examples.push({ name, family, spend });
    }
  }
  spend_incl = spend_excl * (1 + GST);

  // Add GST to per-family totals for display
  for (const f of families) {
    by_family[f].spend = by_family[f].spend * (1 + GST);
  }

  return {
    spend_excl_gst: spend_excl,
    spend_incl_gst: spend_incl,
    impressions: impressions_total,
    clicks: clicks_total,
    by_family,
    excluded_examples,
    account_id: account,
    since, until,
    fetched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- campaign perf

export type MetaCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  family: Family;
  program: string | null;       // FFM/FW/FC/FAI/BFP/VE/L3C or null
  spend: number;                // INR incl GST
  impressions: number;
  clicks: number;
  ctr: number;                  // %
  cpc: number;                  // INR
  cpm: number;                  // INR per 1000 impressions
  leads: number;                // from "lead" action
  purchases: number;            // from "purchase" or "complete_registration"
  active_days: number;          // 1 (we don't track active_days at campaign level — placeholder)
};

export type MetaAdRow = {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  family: Family;
  program: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
};

function actionsValue(actions: any[] | undefined, names: string[]): number {
  if (!actions) return 0;
  let total = 0;
  for (const a of actions) {
    if (names.includes(a.action_type)) total += parseFloat(a.value || "0");
  }
  return total;
}

/**
 * Last-N-days campaign performance from Meta. Each row is one campaign,
 * with spend (INR incl GST), impressions, clicks, CTR/CPC/CPM, leads, and
 * purchases. Campaigns are classified into family/program via parser.ts so
 * the dashboard can filter by Forge/Live cleanly.
 *
 * Excludes Masterclass / Workshop / Other by default.
 *
 * Cached 1h.
 */
export async function fetchCampaignPerformance(opts: {
  daysBack?: number;
  includeFamilies?: Family[];
} = {}): Promise<MetaCampaignRow[] | null> {
  const daysBack = opts.daysBack ?? 30;
  const includeFamilies = opts.includeFamilies ?? ["Forge", "Live"];
  const familiesKey = includeFamilies.slice().sort().join(",");
  const cached = unstable_cache(
    async () => {
      try { return await fetchCampaignPerformanceImpl(daysBack, includeFamilies); }
      catch (e: any) { console.error("[meta-ads] fetchCampaignPerformance failed:", e?.message); return null; }
    },
    ["meta-campaigns-v1", String(daysBack), familiesKey],
    { revalidate: 3600, tags: ["meta-ads"] },
  );
  return cached();
}

async function fetchCampaignPerformanceImpl(daysBack: number, includeFamilies: Family[]): Promise<MetaCampaignRow[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID_API;
  if (!token || !account) return [];

  const tr = encodeURIComponent(JSON.stringify({ since: dateNDaysAgo(daysBack), until: today() }));
  const fields = "spend,impressions,clicks,ctr,cpc,cpm,actions,campaign_id,campaign_name";
  let nextUrl: string | null =
    `${META_API}/${account}/insights?access_token=${token}&time_range=${tr}&level=campaign&fields=${fields}&limit=200`;
  const rows: any[] = [];
  while (nextUrl) {
    const d: any = await metaGet(nextUrl);
    rows.push(...(d.data || []));
    nextUrl = d.paging?.next || null;
  }

  const include = new Set(includeFamilies);
  const out: MetaCampaignRow[] = [];
  for (const r of rows) {
    const name = r.campaign_name || "";
    const { family, program } = classifyCampaignFull(name);
    if (!include.has(family)) continue;
    const spendExcl = parseFloat(r.spend || "0");
    out.push({
      campaign_id: r.campaign_id,
      campaign_name: name,
      family, program: program === "AMBIGUOUS_FFM" ? "FFM" : (program || null),
      spend: spendExcl * (1 + GST),
      impressions: parseInt(r.impressions || "0"),
      clicks: parseInt(r.clicks || "0"),
      ctr: parseFloat(r.ctr || "0"),
      cpc: parseFloat(r.cpc || "0"),
      cpm: parseFloat(r.cpm || "0"),
      leads: actionsValue(r.actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]),
      purchases: actionsValue(r.actions, ["purchase", "offsite_conversion.fb_pixel_purchase", "complete_registration"]),
      active_days: 0,
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

// ---------------------------------------------------------------- top ads

/**
 * Last-N-days top ads (by spend) — ad-level granularity. Used to power the
 * Top Ads tile on Overview. Cached 1h.
 */
export async function fetchTopAds(opts: {
  daysBack?: number;
  limit?: number;
  includeFamilies?: Family[];
} = {}): Promise<MetaAdRow[] | null> {
  const daysBack = opts.daysBack ?? 30;
  const limit = opts.limit ?? 10;
  const includeFamilies = opts.includeFamilies ?? ["Forge", "Live"];
  const familiesKey = includeFamilies.slice().sort().join(",");
  const cached = unstable_cache(
    async () => {
      try { return await fetchTopAdsImpl(daysBack, limit, includeFamilies); }
      catch (e: any) { console.error("[meta-ads] fetchTopAds failed:", e?.message); return null; }
    },
    ["meta-top-ads-v1", String(daysBack), String(limit), familiesKey],
    { revalidate: 3600, tags: ["meta-ads"] },
  );
  return cached();
}

async function fetchTopAdsImpl(daysBack: number, limit: number, includeFamilies: Family[]): Promise<MetaAdRow[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID_API;
  if (!token || !account) return [];

  const tr = encodeURIComponent(JSON.stringify({ since: dateNDaysAgo(daysBack), until: today() }));
  const fields = "spend,impressions,clicks,actions,ad_id,ad_name,campaign_id,campaign_name";
  let nextUrl: string | null =
    `${META_API}/${account}/insights?access_token=${token}&time_range=${tr}&level=ad&fields=${fields}&limit=200`;
  const rows: any[] = [];
  while (nextUrl) {
    const d: any = await metaGet(nextUrl);
    rows.push(...(d.data || []));
    nextUrl = d.paging?.next || null;
  }

  const include = new Set(includeFamilies);
  const out: MetaAdRow[] = [];
  for (const r of rows) {
    const cname = r.campaign_name || "";
    const { family, program } = classifyCampaignFull(cname);
    if (!include.has(family)) continue;
    const spendExcl = parseFloat(r.spend || "0");
    out.push({
      ad_id: r.ad_id,
      ad_name: r.ad_name || `(unnamed ${r.ad_id})`,
      campaign_id: r.campaign_id,
      campaign_name: cname,
      family, program: program === "AMBIGUOUS_FFM" ? "FFM" : (program || null),
      spend: spendExcl * (1 + GST),
      impressions: parseInt(r.impressions || "0"),
      clicks: parseInt(r.clicks || "0"),
      leads: actionsValue(r.actions, ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]),
      purchases: actionsValue(r.actions, ["purchase", "offsite_conversion.fb_pixel_purchase", "complete_registration"]),
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- helpers

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- legacy spend

/**
 * Live monthly Meta Ads spend for {year, month} **filtered to the given
 * families**. Cached 1h. Returns null if env vars are missing or the API
 * call fails — caller should fall back to the sheet-tracked spend.
 *
 * Default = Forge + Live (excludes Masterclass / Workshop / Other), per
 * founder spec: "those should not be included in the marketing spend".
 */
export async function fetchMonthlySpend(
  year: number,
  month: number,
  includeFamilies: Family[] = ["Forge", "Live"],
): Promise<MetaMonthlySpend | null> {
  // Cache key MUST include year/month/families. Putting them in keyParts
  // (not relying on unstable_cache's arg-hashing) ensures different months /
  // family filters get different cache entries — same fix pattern that
  // resolved the fetchLeads bucket-leak bug.
  const familiesKey = includeFamilies.slice().sort().join(",");
  const cached = unstable_cache(
    async () => {
      try { return await fetchMonthlySpendImpl(year, month, includeFamilies); }
      catch (e: any) {
        console.error("[meta-ads] fetchMonthlySpend failed:", e?.message);
        return null;
      }
    },
    ["meta-monthly-spend-v3", String(year), String(month), familiesKey],
    { revalidate: 3600, tags: ["meta-ads"] },
  );
  return cached();
}
