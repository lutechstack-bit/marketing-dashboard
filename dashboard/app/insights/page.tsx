import Header from "@/components/Header";
import { fetchLeadsLight, supabase } from "@/lib/supabase";
import { loadAll } from "@/lib/data";
import { buildInsights } from "@/lib/insights-server";
import { fetchRevenueMetrics } from "@/lib/revenue-tracker";
import { fetchProgramScorecards } from "@/lib/program-scorecards";
import InsightsClient from "@/components/InsightsClient";
import RevenueTrackerStrip from "@/components/RevenueTrackerStrip";
import LiveProgramScorecards from "@/components/LiveProgramScorecards";
import RefreshButton from "@/components/RefreshButton";
import type { Family } from "@/lib/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const family = (params.family === "live" ? "live" : "forge") as Family;
  // Default to "all time" so the founder sees the real DB totals on load.
  // Most leads (CSV-imported) have null first_seen and would be excluded
  // from any date-bounded filter — defaulting to 30d gave the wrong picture.
  const periodId = (params.period as string) || "all";
  const customStart = params.start as string | undefined;
  const customEnd = params.end as string | undefined;

  // Parallel fetch — leads (lightweight, no joins), payments, activities, sheet,
  // revenue tracker, per-program scorecards
  const [leads, sheetData, paymentsRes, activitiesRes, revenue, liveScorecards] = await Promise.all([
    fetchLeadsLight({ limit: 50000 }),
    loadAll().catch((e) => {
      console.error("[insights] sheet load failed:", e?.message);
      return null;
    }),
    supabase
      .from("payments")
      .select("paid_at,amount_inr,status,program,payment_type")
      .eq("status", "captured")
      .order("paid_at", { ascending: false })
      .limit(5000),
    supabase
      .from("lead_activities")
      .select("rep_name,lead_id,action,created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
    fetchRevenueMetrics().catch(() => null),
    fetchProgramScorecards(6).catch(() => []),
  ]);

  // Aggregate server-side — client receives small JSON
  const insights = buildInsights({
    leads,
    payments: (paymentsRes.data || []) as any[],
    activities: (activitiesRes.data || []) as any[],
    marketingMonthly: sheetData?.monthly || [],
    family, periodId, customStart, customEnd,
  });

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <div className="flex items-center justify-end mb-3">
          <RefreshButton />
        </div>
        <RevenueTrackerStrip metrics={revenue} />
        <LiveProgramScorecards cells={liveScorecards} />
        <InsightsClient insights={insights} />
      </main>
    </>
  );
}
