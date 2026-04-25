import { loadAll, computeKpis } from "@/lib/data";
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
import { Wallet, IndianRupee, Users, TrendingUp, Target } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let data: Awaited<ReturnType<typeof loadAll>> | null = null;
  let error: string | null = null;
  try { data = await loadAll(); }
  catch (e: any) { error = e?.message || "Failed to load data"; }

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

  const kpis = computeKpis(data);
  const latestLabel = kpis ? `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][kpis.latest.month-1]} ${kpis.latest.year}` : "";

  return (
    <>
      <Header lastSync={new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} />
      <main className="max-w-[1500px] mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-fg-text">Founders Overview</h1>
          <p className="text-sm text-fg-muted mt-1">{latestLabel ? `Showing ${latestLabel}` : "All-time view"} · click a tab below to drill into a program family</p>
        </div>

        {/* Family tabs */}
        <FamilyTabs active="forge" />

        {/* Top KPIs */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            <KpiCard label="Marketing Spend" value={inr(kpis.spend.now, { compact: true })} prevValue={kpis.spend.prev} sublabel="incl. GST · vs prev month" invert icon={<Wallet className="w-4 h-4" />} />
            <KpiCard label="Revenue" value={inr(kpis.revenue.now, { compact: true })} prevValue={kpis.revenue.prev} sublabel="from operations · vs prev month" icon={<IndianRupee className="w-4 h-4" />} />
            <KpiCard label="Paid Students" value={fmtInt(kpis.acquisitions.now)} prevValue={kpis.acquisitions.prev} sublabel="slot confirmations · vs prev month" icon={<Users className="w-4 h-4" />} />
            <KpiCard label="Blended CAC" value={kpis.cac.now > 0 ? inr(kpis.cac.now) : "—"} prevValue={kpis.cac.prev > 0 ? kpis.cac.prev : undefined} sublabel="cost per paid student" invert icon={<Target className="w-4 h-4" />} />
            <KpiCard label="Gross P/L" value={inr(kpis.grossPL.now, { compact: true })} prevValue={kpis.grossPL.prev} sublabel="vs prev month" icon={<TrendingUp className="w-4 h-4" />} />
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
