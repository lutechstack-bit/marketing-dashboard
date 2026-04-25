import { fetchLeadStats, fetchLeads } from "@/lib/supabase";
import Header from "@/components/Header";
import LeadsClient from "@/components/LeadsClient";
import { Flame, TrendingUp, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  // ONE round trip — fetch top 2000 leads once, all filtering is client-side.
  const [stats, leads] = await Promise.all([
    fetchLeadStats(),
    fetchLeads({ limit: 2000 }),
  ]);

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Lead Intelligence</h1>
            <p className="text-sm text-fg-muted mt-1">
              CRM-style lead manager · {stats.total.toLocaleString("en-IN")} scored leads · client-side filtering
            </p>
          </div>
          <div className="hidden md:flex gap-3">
            <KpiPill label="Rescue zone" value={stats.rescue_zone} icon={<Flame className="w-3.5 h-3.5" />} accent="amber" />
            <KpiPill label="Hot 75+"     value={stats.hot_75plus} icon={<TrendingUp className="w-3.5 h-3.5" />} accent="emerald" />
            <KpiPill label="Total"       value={stats.total}      icon={<Users className="w-3.5 h-3.5" />} accent="cyan" />
          </div>
        </div>

        <LeadsClient initialLeads={leads} />
      </main>
    </>
  );
}

function KpiPill({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: "amber" | "emerald" | "cyan" }) {
  const colors = {
    amber:   "border-amber-500/30 text-amber-500",
    emerald: "border-emerald-500/30 text-emerald-500",
    cyan:    "border-cyan-500/30 text-cyan-500",
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colors[accent]} bg-fg-card/30`}>
      {icon}
      <span className="text-xs uppercase tracking-wider opacity-80">{label}</span>
      <span className="text-base font-bold tabular-nums">{value.toLocaleString("en-IN")}</span>
    </div>
  );
}
