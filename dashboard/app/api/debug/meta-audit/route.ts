// Comprehensive Meta Ads audit — raw API output + every derived number we
// show on the dashboard, side-by-side with the formula. Use this to spot
// where our processed numbers diverge from what Meta Ads Manager shows.
//
// GET /api/debug/meta-audit?period=this_month
//   period = this_month | last_30 | mtd | YYYY-MM (e.g. 2026-04)

import { NextResponse } from "next/server";
import { classifyCampaignFull } from "@/lib/parser";
import { fetchMonthlySpend, fetchCampaignPerformance, fetchTopAds, fetchMonthlySpendByProgram } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const META_API = "https://graph.facebook.com/v21.0";

function isoMonthBounds(year: number, month: number) {
  const since = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const until = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { since, until };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") || "this_month";

  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT_ID_API;
  if (!token || !account) {
    return NextResponse.json({ error: "META_ACCESS_TOKEN or META_AD_ACCOUNT_ID_API not set" }, { status: 500 });
  }

  // Resolve date window
  const now = new Date();
  let since: string, until: string, label: string;
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map(Number);
    const b = isoMonthBounds(y, m); since = b.since; until = b.until; label = period;
  } else if (period === "last_30") {
    until = now.toISOString().slice(0, 10);
    since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    label = "last 30 days";
  } else if (period === "mtd") {
    const m = now.getUTCMonth() + 1, y = now.getUTCFullYear();
    since = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    until = now.toISOString().slice(0, 10);
    label = `${y}-${String(m).padStart(2, "0")} (MTD)`;
  } else { // this_month
    const b = isoMonthBounds(now.getUTCFullYear(), now.getUTCMonth() + 1);
    since = b.since; until = b.until; label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")} (full month)`;
  }

  // 1) Account-level info — confirm currency, timezone, account ID, balance
  const acctRes = await fetch(
    `${META_API}/${account}?fields=id,name,currency,timezone_name,account_status,amount_spent,balance,age,disable_reason&access_token=${token}`,
    { cache: "no-store" }
  );
  const acct = acctRes.ok ? await acctRes.json() : { error: await acctRes.text() };

  // 2) Account-level insights for the window — single canonical "spend" number
  const acctInsightsRes = await fetch(
    `${META_API}/${account}/insights?access_token=${token}&time_range=${encodeURIComponent(JSON.stringify({since, until}))}&fields=spend,impressions,clicks,actions,reach`,
    { cache: "no-store" }
  );
  const acctInsightsRaw = acctInsightsRes.ok ? await acctInsightsRes.json() : { error: await acctInsightsRes.text() };
  const accountTotalRow = acctInsightsRaw.data?.[0] || null;

  // 3) Campaign-level rows for the window — every campaign + classification
  const campRes = await fetch(
    `${META_API}/${account}/insights?access_token=${token}&level=campaign&time_range=${encodeURIComponent(JSON.stringify({since, until}))}&fields=spend,impressions,clicks,actions,campaign_id,campaign_name&limit=200`,
    { cache: "no-store" }
  );
  const campRaw = campRes.ok ? await campRes.json() : { error: await campRes.text() };
  const campaigns = (campRaw.data || []) as any[];

  // Classification rollup
  const byFamily = { Forge: { spend: 0, n: 0 }, Live: { spend: 0, n: 0 }, Masterclass: { spend: 0, n: 0 }, Workshop: { spend: 0, n: 0 }, Other: { spend: 0, n: 0 } } as Record<string, { spend: number; n: number }>;
  const byProgram = {} as Record<string, { spend: number; n: number; campaigns: string[] }>;
  const unclassified: { name: string; spend: number; family: string }[] = [];
  let metaTotalSpendExcl = 0;
  for (const r of campaigns) {
    const name = r.campaign_name || "(unnamed)";
    const spend = parseFloat(r.spend || "0");
    metaTotalSpendExcl += spend;
    const { family, program } = classifyCampaignFull(name);
    byFamily[family] = byFamily[family] || { spend: 0, n: 0 };
    byFamily[family].spend += spend;
    byFamily[family].n++;
    if (program && program !== "AMBIGUOUS_FFM" && program !== "NON_FORGE") {
      if (!byProgram[program]) byProgram[program] = { spend: 0, n: 0, campaigns: [] };
      byProgram[program].spend += spend;
      byProgram[program].n++;
      if (byProgram[program].campaigns.length < 3) byProgram[program].campaigns.push(name);
    }
    if (family === "Other" && spend > 0) {
      unclassified.push({ name, spend, family });
    }
  }
  unclassified.sort((a, b) => b.spend - a.spend);

  // 4) What our processed lib helpers return for the same window
  const [helperMonthly, helperByProgram, helperCampaigns, helperTopAds] = await Promise.all([
    /^\d{4}-\d{2}$/.test(period)
      ? fetchMonthlySpend(parseInt(period.slice(0, 4)), parseInt(period.slice(5, 7)))
      : period === "this_month" || period === "mtd"
        ? fetchMonthlySpend(now.getUTCFullYear(), now.getUTCMonth() + 1)
        : null,
    fetchMonthlySpendByProgram({ monthsBack: 1 }).catch(() => null),
    fetchCampaignPerformance({ daysBack: 30 }).catch(() => null),
    fetchTopAds({ daysBack: 30, limit: 5 }).catch(() => null),
  ]);

  return NextResponse.json({
    window: { since, until, label, server_now: now.toISOString() },
    account_info: {
      id: acct.id, name: acct.name, currency: acct.currency,
      timezone_name: acct.timezone_name, account_status: acct.account_status,
      amount_spent_lifetime: acct.amount_spent, balance: acct.balance,
      account_id_used: account,
    },
    raw_account_total: accountTotalRow ? {
      spend_excl_gst: parseFloat(accountTotalRow.spend || "0"),
      spend_incl_gst: parseFloat(accountTotalRow.spend || "0") * 1.18,
      impressions: parseInt(accountTotalRow.impressions || "0"),
      clicks: parseInt(accountTotalRow.clicks || "0"),
      reach: parseInt(accountTotalRow.reach || "0"),
      actions: accountTotalRow.actions || [],
    } : null,
    raw_campaign_count: campaigns.length,
    raw_campaign_total_spend_excl_gst: metaTotalSpendExcl,
    raw_campaign_total_spend_incl_gst: metaTotalSpendExcl * 1.18,
    by_family_excl_gst: byFamily,
    by_program_excl_gst: byProgram,
    unclassified_campaigns_top_10: unclassified.slice(0, 10),
    helper_outputs: {
      fetchMonthlySpend: helperMonthly ? {
        spend_excl_gst: helperMonthly.spend_excl_gst,
        spend_incl_gst: helperMonthly.spend_incl_gst,
        by_family: helperMonthly.by_family,
      } : null,
      fetchMonthlySpendByProgram_count: helperByProgram?.length ?? null,
      fetchMonthlySpendByProgram_sample: (helperByProgram || []).slice(0, 8).map(r => ({
        program: r.program, ym: r.ym, spend_inr: r.spend_inr, campaigns: r.campaigns,
      })),
      fetchCampaignPerformance_count: helperCampaigns?.length ?? null,
      fetchCampaignPerformance_sample: (helperCampaigns || []).slice(0, 5).map(c => ({
        family: c.family, program: c.program, name: c.campaign_name, spend_inr: c.spend, leads: c.leads,
      })),
      fetchTopAds_count: helperTopAds?.length ?? null,
    },
    diagnostics: {
      gst_multiplier: 1.18,
      gst_explanation: "Meta returns spend EXCLUDING GST. We multiply by 1.18 to match the GST-included number on invoices.",
      timezone_note: "Meta uses the ad account's timezone for time_range. Indian ad accounts default to Asia/Kolkata (IST).",
      currency_note: "Spend is in the ad account's currency. For Indian accounts, that's INR. Verify account_info.currency above.",
      lead_action_types_we_count: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
      lead_action_types_we_might_miss: ["messaging_conversation_started_7d", "submit_application_total", "complete_registration"],
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
