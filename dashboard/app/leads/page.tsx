import { fetchLeads, fetchLeadStats } from "@/lib/supabase";
import Header from "@/components/Header";
import LeadsFilters from "@/components/LeadsFilters";
import LeadsTable from "@/components/LeadsTable";
import { Flame, Users, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

const REP_PROGRAMS: Record<string, string[]> = {
  Pranaush: ["FFM", "FW"],
  Sashank:  ["FC", "BFP"],
  Wilson:   ["VE", "L3C"],
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const rep = sp.rep;
  const explicitPrograms = (sp.program || "").split(",").filter(Boolean);
  const stages           = (sp.stage || "").split(",").filter(Boolean);
  const minScore         = sp.minScore ? parseInt(sp.minScore) : undefined;

  // Rep filter narrows program list
  const repPrograms = rep ? REP_PROGRAMS[rep] || [] : [];
  const programs = explicitPrograms.length ? explicitPrograms : repPrograms;

  const [stats, leads] = await Promise.all([
    fetchLeadStats(),
    fetchLeads({
      programs: programs.length ? programs : undefined,
      stages: stages.length ? stages : undefined,
      minScore,
      limit: 500,
    }),
  ]);

  const rescueZone = stats.by_stage["accepted"] || 0;

  return (
    <>
      <Header />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Lead Intelligence</h1>
          <p className="text-sm text-fg-muted mt-1">
            {stats.total.toLocaleString("en-IN")} leads scored from {stats.total ? Object.keys(stats.by_program).length : 0} programs
            · {rescueZone} in rescue zone (paid app fee, awaiting confirmation)
          </p>
        </div>

        {/* Top KPI strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="glow-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-fg-muted">Rescue zone</span>
              <Flame className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-3xl font-bold">{rescueZone}</div>
            <div className="text-xs text-fg-muted mt-1">Paid app fee, no confirmation yet — call FIRST</div>
          </div>
          <div className="glow-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-fg-muted">Hot (score 75+)</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-bold">{stats.hot_75plus}</div>
            <div className="text-xs text-fg-muted mt-1">Top tier across all programs</div>
          </div>
          <div className="glow-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-fg-muted">Total leads</span>
              <Users className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-3xl font-bold">{stats.total.toLocaleString("en-IN")}</div>
            <div className="text-xs text-fg-muted mt-1">Across {Object.keys(stats.by_program).length} active programs</div>
          </div>
        </div>

        <LeadsFilters stats={stats} />
        <LeadsTable leads={leads} />

        <div className="text-xs text-fg-muted text-center mt-8 mb-4">
          Lead data from Tally form submissions + Razorpay payments. Updates daily via cron.
          AI-generated lead summaries coming next.
        </div>
      </main>
    </>
  );
}
