// Comprehensive health check — reports which data sources are wired up
// in production and which sections of the dashboard will render with real
// data vs render empty.
//
// GET /api/debug/health

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadAll } from "@/lib/data";
import { fetchMonthlySpend } from "@/lib/meta-ads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function GET() {
  const t0 = Date.now();
  const report: any = {
    env: {
      sheet_id_set:                 !!process.env.SHEET_ID,
      gcp_service_account_set:      !!process.env.GCP_SERVICE_ACCOUNT_JSON,
      meta_access_token_set:        !!process.env.META_ACCESS_TOKEN,
      meta_ad_account_id_set:       !!process.env.META_AD_ACCOUNT_ID_API,
      supabase_url_set:             !!process.env.SUPABASE_URL,
      supabase_service_role_set:    !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      telecrm_sync_token_set:       !!process.env.TELECRM_SYNC_TOKEN,
      tally_signing_secret_set:     !!process.env.TALLY_SIGNING_SECRET,
      rzp_admin_secret_set:         !!process.env.RZP_ADMIN_WEBHOOK_SECRET,
      rzp_edtech_secret_set:        !!process.env.RZP_EDTECH_WEBHOOK_SECRET,
      calendly_token_set:           !!process.env.CALENDLY_API_TOKEN,
    },
  };

  // 1. Supabase health — count rows in each table
  try {
    const admin = adminClient();
    const tables = ["leads", "form_submissions", "payments", "lead_activities", "manual_marketing_spend", "incentive_earnings"];
    const counts: Record<string, number | string> = {};
    for (const t of tables) {
      const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
      counts[t] = error ? `err: ${error.message}` : (count ?? 0);
    }
    report.supabase = { ok: true, table_counts: counts };
  } catch (e: any) {
    report.supabase = { ok: false, error: e.message };
  }

  // 2. Sheets health — try loadAll() and report which tabs/structures parsed
  try {
    const data = await loadAll();
    report.sheets = {
      ok: true,
      latest_input_month: data.latestInputMonth?.label || null,
      tabs: {
        actuals_rows: data.actuals.length,
        actuals_first_5_metrics: data.actuals.slice(0, 5).map(r => r.metric),
        actuals_months: data.actuals[0]?.values.length || 0,
        spend_trend_months: data.spendTrend.length,
        spend_trend_programs: [...new Set(data.spendTrend.map(r => r.program))],
        campaigns_count: data.campaigns?.length ?? 0,
        top_ads_count: data.topAds?.length ?? 0,
        master_rows: data.master?.length ?? 0,
        program_scorecards: data.programScorecards?.map(s => ({
          code: s.code, applicants: s.applicants, app_fee_count: s.appFeeCount,
          revenue_inr: s.totalRevenueInr, ads_spend_inr: s.adsSpendInr,
        })) ?? [],
        marketing_monthly_rows: data.monthly?.length ?? 0,
        marketing_monthly_programs: data.monthly ? [...new Set(data.monthly.map((r: any) => r.program))] : [],
      },
    };
  } catch (e: any) {
    report.sheets = { ok: false, error: e.message };
  }

  // 3. Meta Ads API — try fetching this month's spend
  try {
    const now = new Date();
    const meta = await fetchMonthlySpend(now.getFullYear(), now.getMonth() + 1);
    report.meta_ads_api = {
      ok: !!meta,
      this_month_spend_inr: meta?.spend_incl_gst ?? null,
      fetched_at: meta?.fetched_at ?? null,
    };
  } catch (e: any) {
    report.meta_ads_api = { ok: false, error: e.message };
  }

  // 4. TeleCRM API — confirm reachable
  try {
    if (process.env.TELECRM_SYNC_TOKEN && process.env.TELECRM_ENTERPRISE_ID) {
      const res = await fetch(
        `https://next.telecrm.in/autoupdate/v2/enterprise/${process.env.TELECRM_ENTERPRISE_ID}/lead/search?limit=1`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.TELECRM_SYNC_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );
      const j = res.ok ? await res.json() : null;
      report.telecrm = {
        ok: res.ok,
        status: res.status,
        total_leads: j?.total_count ?? null,
      };
    } else {
      report.telecrm = { ok: false, error: "env not set" };
    }
  } catch (e: any) {
    report.telecrm = { ok: false, error: e.message };
  }

  report.duration_ms = Date.now() - t0;
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
