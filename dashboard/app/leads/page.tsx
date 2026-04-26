import { fetchLeadStats, fetchLeads } from "@/lib/supabase";
import Header from "@/components/Header";
import LeadsClient from "@/components/LeadsClient";
import { Flame, TrendingUp, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [stats, leads] = await Promise.all([
    fetchLeadStats(),
    fetchLeads({ limit: 2000 }),
  ]);

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-fg-text">Lead Intelligence</h1>
            <p className="text-sm text-fg-muted mt-1">
              {stats.total.toLocaleString("en-IN")} scored leads · click any name to open the full timeline
            </p>
          </div>
          <div className="flex gap-2.5">
            <KpiPill label="Need to book interview" value={stats.rescue_zone} icon={<Flame className="w-3.5 h-3.5" />} accent="amber" />
            <KpiPill label="Hot 75+" value={stats.hot_75plus} icon={<TrendingUp className="w-3.5 h-3.5" />} accent="emerald" />
            <KpiPill label="Total"   value={stats.total}      icon={<Users className="w-3.5 h-3.5" />} accent="slate" />
          </div>
        </div>

        <LeadsClient initialLeads={leads} />
      </main>
    </>
  );
}

function KpiPill({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: "amber" | "emerald" | "slate" }) {
  const colors = {
    amber:   "border-amber-300 text-amber-800 bg-amber-50",
    emerald: "border-emerald-300 text-emerald-800 bg-emerald-50",
    slate:   "border-slate-200 text-slate-700 bg-slate-50",
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colors[accent]}`}>
      {icon}
      <span className="text-[11px] uppercase tracking-wider opacity-80 font-medium">{label}</span>
      <span className="text-base font-bold tabular-nums">{value.toLocaleString("en-IN")}</span>
    </div>
  );
}
