import { loadAll } from "@/lib/data";
import { fetchUnifiedKpis } from "@/lib/unified-kpis";
import { fetchCampaignPerformance, fetchTopAds } from "@/lib/meta-ads";
import { fetchRevenueMetrics } from "@/lib/revenue-tracker";
import { fetchProgramScorecards } from "@/lib/program-scorecards";
import RevenueTrackerStrip from "@/components/RevenueTrackerStrip";
import LiveProgramScorecards from "@/components/LiveProgramScorecards";
import RefreshButton from "@/components/RefreshButton";
import DashboardViewToggle from "@/components/DashboardViewToggle";
import { inr, fmtInt } from "@/lib/format";
import Header from "@/components/Header";
import KpiCard from "@/components/KpiCard";
import SpendTrendChart from "@/components/SpendTrendChart";
import CacChart from "@/components/CacChart";
import AcquisitionsChart from "@/components/AcquisitionsChart";
import PnlTable from "@/components/PnlTable";
import RecentStudents from "@/components/RecentStudents";
import CampaignPerformance from "@/components/CampaignPerformance";
import TopAds from "@/components/TopAds";
import { Wallet, IndianRupee, Users, TrendingUp, Target, Filter, Banknote, Receipt, Wallet as WalletIcon } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type SearchParams = Promise<{ [k: string]: string | string[] | undefined }>;

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const view  = (sp.view  as string) === "revenue" ? "revenue" : "marketing";
  const slice = (sp.slice as string) === "timelines" ? "timelines" : "products";

  // Pull everything in parallel — same data backs every view, the toggles
  // just change WHICH parts get emphasized at the top.
  let data: Awaited<ReturnType<typeof loadAll>> | null = null;
  let unifiedKpis: Awaited<ReturnType<typeof fetchUnifiedKpis>> = null;
  let metaCampaigns: Awaited<ReturnType<typeof fetchCampaignPerformance>> = null;
  let metaTopAds: Awaited<ReturnType<typeof fetchTopAds>> = null;
  let revenue: Awaited<ReturnType<typeof fetchRevenueMetrics>> | null = null;
  let liveScorecards: Awaited<ReturnType<typeof fetchProgramScorecards>> = [];
  let error: string | null = null;
  try {
    [data, unifiedKpis, metaCampaigns, metaTopAds, revenue, liveScorecards] = await Promise.all([
      loadAll(),
      fetchUnifiedKpis(),
      fetchCampaignPerformance({ daysBack: 30 }).catch(() => null),
      fetchTopAds({ daysBack: 30, limit: 12 }).catch(() => null),
      fetchRevenueMetrics().catch(() => null),
      fetchProgramScorecards(6).catch(() => []),
    ]);
  } catch (e: any) { error = e?.message || "Failed to load data"; }

  if (error || !data) {
    return (
      <>
        <Header />
        <main className="max-w-[1500px] mx-auto px-6 py-12">
          <div className="surface-card p-8 text-center">
            <h1 className="text-xl font-semibold mb-2 text-fg-text">Couldn&apos;t load data from the sheet</h1>
            <p className="text-sm text-fg-muted">{error}</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header lastSync={new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} />
      <main className="max-w-[1500px] mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-4xl font-extrabold italic tracking-tight text-forge-black">
              <span className="brand-underline">Dashboard</span>
            </h1>
            <p className="text-sm text-fg-muted mt-2">
              {view === "marketing" ? "Marketing perspective" : "Revenue perspective"} · {slice === "products" ? "products view" : "timelines view"}
            </p>
          </div>
          <RefreshButton />
        </div>

        {/* Period / family / view toggles — URL-driven, persist across navigation */}
        <DashboardViewToggle />

        {/* ---------- Headline KPIs (perspective-dependent) ---------- */}
        {view === "marketing" && unifiedKpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
            <KpiCard
              label="Marketing Spend"
              value={inr(unifiedKpis.spend.now, { compact: true })}
              prevValue={unifiedKpis.spend.prev}
              sublabel={
                unifiedKpis.spend_source === "meta_api"
                  ? `🟢 Meta ${inr(unifiedKpis.spend_meta_api, { compact: true })} + manual ${inr(unifiedKpis.spend_manual, { compact: true })}`
                  : unifiedKpis.spend_source === "sheet"
                  ? `📋 Sheet · ${inr(unifiedKpis.spend_sheet, { compact: true })}`
                  : "⚠ no spend data this month"
              }
              invert icon={<Wallet className="w-4 h-4" />} />
            <KpiCard label="Total Leads" value={fmtInt(unifiedKpis.total_leads.now)} prevValue={unifiedKpis.total_leads.prev}
              sublabel="created this month" icon={<Users className="w-4 h-4" />} />
            <KpiCard label="App-Fee Paid" value={fmtInt(unifiedKpis.app_fee_paid_count.now)} prevValue={unifiedKpis.app_fee_paid_count.prev}
              sublabel="cohort created this month" icon={<Filter className="w-4 h-4" />} />
            <KpiCard label="Confirmed" value={fmtInt(unifiedKpis.confirmed_count.now)} prevValue={unifiedKpis.confirmed_count.prev}
              sublabel="balance paid" icon={<Receipt className="w-4 h-4" />} />
            <KpiCard label="CPL" value={unifiedKpis.cpl.now > 0 ? inr(unifiedKpis.cpl.now) : "—"} prevValue={unifiedKpis.cpl.prev > 0 ? unifiedKpis.cpl.prev : undefined}
              sublabel="cost per lead" invert icon={<Target className="w-4 h-4" />} />
            <KpiCard label="CPA" value={unifiedKpis.cpa.now > 0 ? inr(unifiedKpis.cpa.now) : "—"} prevValue={unifiedKpis.cpa.prev > 0 ? unifiedKpis.cpa.prev : undefined}
              sublabel="paid app fee" invert icon={<Target className="w-4 h-4" />} />
            <KpiCard label="CAC" value={unifiedKpis.cac.now > 0 ? inr(unifiedKpis.cac.now) : "—"} prevValue={unifiedKpis.cac.prev > 0 ? unifiedKpis.cac.prev : undefined}
              sublabel="confirmed" invert icon={<TrendingUp className="w-4 h-4" />} />
          </div>
        )}

        {view === "revenue" && (
          <RevenueTrackerStrip metrics={revenue} />
        )}

        {/* ---------- Slice content ---------- */}
        {slice === "products" && (
          <>
            <LiveProgramScorecards cells={liveScorecards} />
          </>
        )}

        {slice === "timelines" && view === "marketing" && (
          <>
            <div className="mb-6">
              <SpendTrendChart data={data.spendTrend} />
            </div>
            <div className="mb-6">
              <CampaignPerformance campaigns={(metaCampaigns && metaCampaigns.length > 0
                ? metaCampaigns.map(c => ({ ...c, program: c.program || "" }))
                : data.campaigns) as any} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <TopAds ads={(metaTopAds && metaTopAds.length > 0
                ? metaTopAds.map(a => ({
                    ad_id: a.ad_id, ad_name: a.ad_name,
                    campaign_name: a.campaign_name,
                    program: a.program || "",
                    spend: a.spend, impressions: a.impressions, clicks: a.clicks,
                    ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0,
                    leads: a.leads, purchases: a.purchases,
                  }))
                : data.topAds) as any} />
              <CacChart spendTrend={data.spendTrend} acquisitions={data.acquisition} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <AcquisitionsChart data={data.acquisition} />
              <RecentStudents master={data.master} />
            </div>
          </>
        )}

        {slice === "timelines" && view === "revenue" && (
          <>
            <div className="mb-6">
              <PnlTable actuals={data.actuals} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <AcquisitionsChart data={data.acquisition} />
              <RecentStudents master={data.master} />
            </div>
          </>
        )}

        <div className="text-xs text-fg-subtle text-center mt-12 mb-4">
          Live data · Meta Ads API + Revenue Tracker sheet + TeleCRM sync · cache TTL 60s
        </div>
      </main>
    </>
  );
}
