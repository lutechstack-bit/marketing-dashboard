import { loadAll } from "@/lib/data";
import { fetchUnifiedKpis } from "@/lib/unified-kpis";
import { inr, fmtInt } from "@/lib/format";
import Header from "@/components/Header";
import KpiCard from "@/components/KpiCard";
import FamilyTabs from "@/components/FamilyTabs";
import SpendTrendChart from "@/components/SpendTrendChart";
import CacChart from "@/components/CacChart";
import AcquisitionsChart from "@/components/AcquisitionsChart";
import PnlTable from "@/components/PnlTable";
import RecentStudents from "@/components/RecentStudents";
import ProgramScorecards from "@/components/ProgramScorecards";
import CampaignPerformance from "@/components/CampaignPerformance";
import TopAds from "@/components/TopAds";
import { Wallet, IndianRupee, Users, TrendingUp, Target, Filter } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  // Pull both data sources in parallel. unifiedKpis = the new single-source-of-truth
  // numbers (Sheets spend × Supabase funnel). data = the rest of the page (charts,
  // P&L, campaign performance, etc.) which is still authored in Sheets.
  let data: Awaited<ReturnType<typeof loadAll>> | null = null;
  let unifiedKpis: Awaited<ReturnType<typeof fetchUnifiedKpis>> = null;
  let error: string | null = null;
  try {
    [data, unifiedKpis] = await Promise.all([loadAll(), fetchUnifiedKpis()]);
  } catch (e: any) { error = e?.message || "Failed to load data"; }

  if (error || !data) {
    return (
      <>
        <Header />
        <main className="max-w-[1500px] mx-auto px-6 py-12">
          <div className="surface-card p-8 text-center">
            <h1 className="text-xl font-semibold mb-2 text-fg-text">Couldn&apos;t load data from the sheet</h1>
            <p className="text-sm text-fg-muted">{error}</p>
            <p className="text-xs text-fg-subtle mt-4">Check that GCP_SERVICE_ACCOUNT_JSON env var is set on Vercel.</p>
          </div>
        </main>
      </>
    );
  }

  const latestLabel = unifiedKpis?.period.label || "—";

  return (
    <>
      <Header lastSync={new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} />
      <main className="max-w-[1500px] mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="font-display text-4xl font-extrabold italic tracking-tight text-forge-black">
            Founders <span className="brand-underline">overview</span>
          </h1>
          <p className="text-sm text-fg-muted mt-2">{latestLabel ? `Showing ${latestLabel}` : "All-time view"} · click a tab below to drill into a program family</p>
        </div>

        {/* Family tabs */}
        <FamilyTabs active="forge" />

        {/* Top KPIs — unified source: Sheets spend × Supabase funnel.
            Three cost-per-X numbers because a single "CAC" hides the truth:
              CPL = spend / total leads (every form-fill is a lead)
              CPA = spend / app-fee-paid (real $ commitment — the metric that matters)
              CAC = spend / confirmed (balance paid — true customer acquisition cost) */}
        {unifiedKpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
            <KpiCard label="Marketing Spend" value={inr(unifiedKpis.spend.now, { compact: true })} prevValue={unifiedKpis.spend.prev}
              sublabel={`Sheets ${inr(unifiedKpis.spend_sheet, { compact: true })} + manual ${inr(unifiedKpis.spend_manual, { compact: true })}`}
              invert icon={<Wallet className="w-4 h-4" />} />
            <KpiCard label="Revenue" value={inr(unifiedKpis.revenue.now, { compact: true })} prevValue={unifiedKpis.revenue.prev}
              sublabel="from operations · vs prev month" icon={<IndianRupee className="w-4 h-4" />} />
            <KpiCard label="Total Leads" value={fmtInt(unifiedKpis.total_leads.now)} prevValue={unifiedKpis.total_leads.prev}
              sublabel="created this month · DB truth" icon={<Users className="w-4 h-4" />} />
            <KpiCard label="App-Fee Paid" value={fmtInt(unifiedKpis.app_fee_paid_count.now)} prevValue={unifiedKpis.app_fee_paid_count.prev}
              sublabel="cohort created this month" icon={<Filter className="w-4 h-4" />} />
            <KpiCard label="CPL" value={unifiedKpis.cpl.now > 0 ? inr(unifiedKpis.cpl.now) : "—"} prevValue={unifiedKpis.cpl.prev > 0 ? unifiedKpis.cpl.prev : undefined}
              sublabel="cost per lead" invert icon={<Target className="w-4 h-4" />} />
            <KpiCard label="CPA · paid app fee" value={unifiedKpis.cpa.now > 0 ? inr(unifiedKpis.cpa.now) : "—"} prevValue={unifiedKpis.cpa.prev > 0 ? unifiedKpis.cpa.prev : undefined}
              sublabel="first $ commitment" invert icon={<Target className="w-4 h-4" />} />
            <KpiCard label="CAC · confirmed" value={unifiedKpis.cac.now > 0 ? inr(unifiedKpis.cac.now) : "—"} prevValue={unifiedKpis.cac.prev > 0 ? unifiedKpis.cac.prev : undefined}
              sublabel={`${unifiedKpis.confirmed_count.now} balance-paid`} invert icon={<TrendingUp className="w-4 h-4" />} />
          </div>
        )}

        {/* Per-program scorecards */}
        <ProgramScorecards
          scorecards={data.programScorecards}
          monthLabel={data.latestInputMonth ? `${data.latestInputMonth.label}` : "—"}
        />

        {/* Spend trend (full width) */}
        <div className="mb-6">
          <SpendTrendChart data={data.spendTrend} />
        </div>

        {/* Marketing efficiency: Campaigns, then Top ads + CAC side by side */}
        <div className="mb-6">
          <CampaignPerformance campaigns={data.campaigns} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <TopAds ads={data.topAds} />
          <CacChart spendTrend={data.spendTrend} acquisitions={data.acquisition} />
        </div>

        {/* Acquisitions + Recent students */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <AcquisitionsChart data={data.acquisition} />
          <RecentStudents master={data.master} />
        </div>

        {/* P&L (full width — needs the room for 6 month columns) */}
        <div className="mb-6">
          <PnlTable actuals={data.actuals} />
        </div>

        <div className="text-xs text-fg-subtle text-center mt-12 mb-4">
          v2 · Forge data live · Live, Masterclass, B2B coming once attribution pipeline ships
        </div>
      </main>
    </>
  );
}
