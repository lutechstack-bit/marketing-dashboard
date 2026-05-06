// Debug: verify Meta Ads API returns live campaign + ad data.
//
// GET /api/debug/meta-test

import { NextResponse } from "next/server";
import { fetchCampaignPerformance, fetchTopAds } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const t0 = Date.now();
  const [campaigns, ads] = await Promise.all([
    fetchCampaignPerformance({ daysBack: 30 }),
    fetchTopAds({ daysBack: 30, limit: 10 }),
  ]);
  return NextResponse.json({
    campaigns_count: campaigns?.length ?? null,
    campaigns_sample: (campaigns || []).slice(0, 8).map(c => ({
      family: c.family,
      program: c.program,
      campaign_name: c.campaign_name,
      spend_inr: Math.round(c.spend),
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      leads: c.leads,
      purchases: c.purchases,
    })),
    by_family: campaigns ? campaigns.reduce<Record<string, { count: number; spend: number; leads: number }>>((acc, c) => {
      acc[c.family] = acc[c.family] || { count: 0, spend: 0, leads: 0 };
      acc[c.family].count++;
      acc[c.family].spend += c.spend;
      acc[c.family].leads += c.leads;
      return acc;
    }, {}) : null,
    top_ads_count: ads?.length ?? null,
    top_ads_sample: (ads || []).slice(0, 5).map(a => ({
      family: a.family, program: a.program,
      ad_name: a.ad_name, campaign_name: a.campaign_name,
      spend_inr: Math.round(a.spend), leads: a.leads, purchases: a.purchases,
    })),
    duration_ms: Date.now() - t0,
  }, { headers: { "Cache-Control": "no-store" } });
}
