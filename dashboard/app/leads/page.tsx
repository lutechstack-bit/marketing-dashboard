import { fetchLeadStats, fetchLeads, supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import LeadsClient from "@/components/LeadsClient";
import { Flame, TrendingUp, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  // Only enrich what /leads actually displays: payment count + last_action.
  // form_submissions enrichment was wasteful here — leads.first_seen is fine.
  // reps + their assignments power the per-rep filter chip in LeadsClient
  // (was previously hardcoded for Pranaush/Sashank/Wilson).
  const [stats, leads, repsRes, assignmentsRes] = await Promise.all([
    fetchLeadStats(),
    fetchLeads({ limit: 2000, enrichments: ["payments", "activities"] }),
    supabase.from("sales_reps").select("id,full_name,email").eq("active", true).eq("role", "sales"),
    supabase.from("rep_assignments").select("rep_id,product_code").eq("active", true),
  ]);

  const reps = (repsRes.data || []).map((r: any) => {
    const programs = (assignmentsRes.data || [])
      .filter((a: any) => a.rep_id === r.id)
      .map((a: any) => a.product_code);
    return {
      name: r.full_name || r.email.split("@")[0],
      programs: Array.from(new Set(programs)),
    };
  });

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

        <LeadsClient initialLeads={leads} reps={reps} />
      </main>
    </>
  );
}

function KpiPill({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: "amber" | "emerald" | "slate" }) {
  const colors = {
    amber:   "border-amber-300 text-amber-800 bg-amber-50",
    emerald: "border-emerald-300 text-emerald-800 bg-emerald-50",
    slate:   "border-fg-border text-fg-text bg-fg-surface",
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${colors[accent]}`}>
      {icon}
      <span className="text-[11px] uppercase tracking-wider opacity-80 font-medium">{label}</span>
      <span className="text-base font-bold tabular-nums">{value.toLocaleString("en-IN")}</span>
    </div>
  );
}
