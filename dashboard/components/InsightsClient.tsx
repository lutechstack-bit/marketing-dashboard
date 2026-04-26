"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sparkles, TrendingUp, TrendingDown, Users, IndianRupee, Target,
  Phone, ChevronRight, Wallet, Radio, Info, AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  PRODUCTS_BY_FAMILY, PRODUCT_BY_CODE, productAccents, familyLabel,
  type Family,
} from "@/lib/products";
import type { InsightsPayload, ProductInsight } from "@/lib/insights-server";
import { inr, fmtInt } from "@/lib/format";

const PROD_HEX: Record<string, string> = {
  FFM: "#EAB308", FW: "#38BDF8", FC: "#EF4444", FAI: "#4338CA",
  VE: "#3B82F6", BFP: "#8B5CF6", L3C: "#D946EF",
};

export default function InsightsClient({ insights }: { insights: InsightsPayload }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [drillCode, setDrillCode] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Auto-refresh every 60s when tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        router.refresh();
        setLastRefresh(new Date());
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [router]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };

  const family = insights.family;
  const periodId = insights.period.id;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg-text inline-flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-amber-500" />
            Marketing &amp; Sales Intelligence
          </h1>
          <p className="text-sm text-fg-muted mt-1">
            {insights.period.label} · {familyLabel(family)} · {fmtInt(insights.hero.total_leads)} leads in period
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
            Auto-refresh · 60s
            <span className="text-fg-subtle hidden md:inline">· {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="text-xs px-3 py-1.5 rounded-md border border-fg-border text-fg-muted hover:text-fg-text hover:border-slate-400 inline-flex items-center gap-1.5"
            title="Show how the numbers were computed"
          >
            <Info className="w-3.5 h-3.5" />
            How is this computed?
          </button>
        </div>
      </div>

      {/* Diagnostics block — toggleable */}
      {showDiagnostics && (
        <div className="surface-card p-4 mb-5 bg-amber-50/40 border-l-4 border-l-amber-400">
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-900 mb-2 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            Diagnostics — raw inputs &amp; formulas
          </div>
          <ul className="text-xs text-fg-text/85 space-y-1 leading-relaxed font-mono">
            {insights.diagnostics.explanation.map((line, i) => <li key={i}>· {line}</li>)}
          </ul>
        </div>
      )}

      {/* Filter bar */}
      <div className="surface-card p-3 mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1">Family</span>
          <div className="inline-flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5">
            {(["forge", "live"] as Family[]).map(f => (
              <button key={f} onClick={() => setParam("family", f)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${family === f ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}>
                {familyLabel(f)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1">Period</span>
          {[
            { id: "today", label: "Today" },
            { id: "7d", label: "7d" },
            { id: "30d", label: "30d" },
            { id: "mtd", label: "MTD" },
          ].map(p => (
            <button key={p.id} onClick={() => setParam("period", p.id)}
              className={`chip ${periodId === p.id ? "chip-active" : ""}`}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Hero strip */}
      <HeroStrip hero={insights.hero} />

      {/* Per-product cards */}
      <h2 className="text-lg font-semibold text-fg-text mb-3 mt-6">Per program — click any card to drill in</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {insights.products.map(p => (
          <ProductCard key={p.code} prod={p} isOpen={drillCode === p.code} onClick={() => setDrillCode(drillCode === p.code ? null : p.code)} />
        ))}
      </div>

      {/* Drill-down */}
      {drillCode && (() => {
        const drill = insights.products.find(p => p.code === drillCode);
        return drill ? <DrillDown prod={drill} /> : null;
      })()}

      {/* Trend */}
      <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Average MQL over time" subtitle={`Daily average per program · ${insights.period.label}`} />
      <div className="surface-card p-6 mb-6">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={insights.trend_daily} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <YAxis tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }} />
            <Legend />
            {PRODUCTS_BY_FAMILY[family].map(p => (
              <Line key={p.code} type="monotone" dataKey={p.code} stroke={PROD_HEX[p.code] || "#94A3B8"} strokeWidth={2} dot={false} name={p.name} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Marketing efficiency 12m */}
      <SectionHeader icon={<Target className="w-4 h-4" />} title="Marketing efficiency · 12 months" subtitle="Spend (incl GST) vs actual leads · CPA = spend / leads from DB" />
      <div className="surface-card p-6 mb-6">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={insights.marketing_12m} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <YAxis yAxisId="L" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" tickFormatter={v => inr(v, { compact: true })} />
            <YAxis yAxisId="R" orientation="right" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }}
              formatter={(v: number, k: string) => k === "spend" ? inr(v) : (k === "cpa_actual" ? inr(v) : fmtInt(v))} />
            <Legend />
            <Area yAxisId="L" type="monotone" dataKey="spend"        stroke="#EF4444" fill="#EF4444" fillOpacity={0.15} name="Spend (₹)" />
            <Area yAxisId="R" type="monotone" dataKey="leads_actual" stroke="#10B981" fill="#10B981" fillOpacity={0.15} name="Leads (DB)" />
            <Line yAxisId="R" type="monotone" dataKey="cpa_actual"   stroke="#4338CA" strokeWidth={2} dot={false} name="CPA (₹)" />
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-fg-subtle mt-2">
          Lead count is your real Tally form-submission count from the DB, not Meta's narrow attribution. CPA is the truthful number.
        </p>
      </div>

      {/* Cash flow */}
      <SectionHeader icon={<Wallet className="w-4 h-4" />} title="Cash flow — captured payments" subtitle="From Razorpay (both accounts) · stacked by program" />
      <div className="surface-card p-6 mb-6">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={insights.cashflow_daily} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <YAxis tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" tickFormatter={v => inr(v, { compact: true })} />
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }} formatter={(v: number) => inr(v)} />
            <Legend />
            {PRODUCTS_BY_FAMILY[family].map(p => (
              <Bar key={p.code} dataKey={p.code} stackId="cash" fill={PROD_HEX[p.code] || "#94A3B8"} name={p.name} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Sales rep performance */}
      <SectionHeader icon={<Phone className="w-4 h-4" />} title="Sales rep performance" subtitle={`From dashboard activity · ${insights.period.label}`} />
      <RepTable reps={insights.reps} />

      {/* Coming next */}
      <SectionHeader icon={<Wallet className="w-4 h-4" />} title="Coming next" subtitle="Need data hooks before I can wire these" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
        <ComingSoonCard title="YouTube collaboration ad spend" desc="UI to add collabs (creator, fee, date, program). Saves to a manual_marketing_spend table — needs a one-time SQL paste in Supabase to create the table. Tell me when to ship." />
        <ComingSoonCard title="EOD report integration" desc="Productive minutes · interview calls · abandoned-leads dialed · daily HOTS list. Need: where reps submit EOD (Sheets / Slack / Tally?)." />
      </div>
    </div>
  );
}

// ============================================================================

function HeroStrip({ hero }: { hero: InsightsPayload["hero"] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <HeroTile label="New leads" value={fmtInt(hero.total_leads)}
        sub={hero.scoreable_leads !== hero.total_leads ? `${hero.scoreable_leads} scoreable` : "all scoreable"}
        delta={hero.leads_delta_pct} icon={<Users className="w-4 h-4" />} accent="amber" />
      <HeroTile label="Avg MQL" value={String(hero.avg_mql)} sub={`median ${hero.median_mql}`} icon={<Sparkles className="w-4 h-4" />} accent="indigo" big />
      <HeroTile label="Hot 50+" value={`${hero.hot_pct}%`} sub={`${hero.super_hot_count} super hot`} icon={<TrendingUp className="w-4 h-4" />} accent="emerald" />
      <HeroTile label="Marketing spend" value={inr(hero.spend_inr, { compact: true })} sub="incl GST · period" icon={<Wallet className="w-4 h-4" />} accent="rose" invert />
      <HeroTile label="CPA" value={hero.cpa_inr > 0 ? inr(hero.cpa_inr) : "—"}
        sub={hero.cpa_inr > 0 ? `spend ÷ ${fmtInt(hero.total_leads)} leads` : "no leads in period"}
        icon={<Target className="w-4 h-4" />} accent="cyan" invert />
      <HeroTile label="Revenue" value={inr(hero.revenue_inr, { compact: true })} sub="captured · period" icon={<IndianRupee className="w-4 h-4" />} accent="emerald" />
    </div>
  );
}

function HeroTile({ label, value, sub, delta, icon, accent, big, invert }: any) {
  const accentMap: Record<string, string> = {
    amber: "from-amber-50 to-white border-amber-200",
    indigo: "from-indigo-50 to-white border-indigo-200",
    emerald: "from-emerald-50 to-white border-emerald-200",
    rose: "from-rose-50 to-white border-rose-200",
    cyan: "from-cyan-50 to-white border-cyan-200",
  };
  const iconColor: Record<string, string> = {
    amber: "text-amber-600", indigo: "text-indigo-600", emerald: "text-emerald-600", rose: "text-rose-600", cyan: "text-cyan-600",
  };
  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${accentMap[accent]} p-4 transition-shadow hover:shadow-card-hover`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">{label}</span>
        <span className={iconColor[accent]}>{icon}</span>
      </div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-bold tabular-nums text-fg-text leading-none`}>{value}</div>
      <div className="flex items-baseline justify-between mt-1.5 gap-2">
        <span className="text-[11px] text-fg-muted">{sub || ""}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[11px] font-semibold inline-flex items-center gap-0.5 ${(invert ? delta < 0 : delta > 0) ? "text-emerald-600" : "text-rose-600"}`}>
            {delta > 0 ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}

function ProductCard({ prod, isOpen, onClick }: { prod: ProductInsight; isOpen: boolean; onClick: () => void }) {
  const aux = productAccents(prod.color);
  const max = Math.max(...prod.sparkline, 1);
  const points = prod.sparkline.map((v, i) => `${(i / Math.max(prod.sparkline.length - 1, 1)) * 100},${100 - (v / max) * 100}`).join(" ");
  return (
    <button onClick={onClick}
      className={`surface-card surface-card-hover text-left p-5 transition-all ring-2 ${isOpen ? `${aux.tabActive.split(" ")[0]} shadow-card-hover` : "ring-transparent"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${aux.dot}`} />
          <span className="font-semibold text-fg-text">{prod.long_name}</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-fg-subtle transition-transform ${isOpen ? "rotate-90" : ""}`} />
      </div>
      <div className="flex items-baseline gap-3 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Leads</div>
          <div className="text-2xl font-bold tabular-nums text-fg-text leading-none">{prod.count}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Avg MQL</div>
          <div className={`text-2xl font-bold tabular-nums leading-none ${prod.avg_mql >= 50 ? "text-emerald-600" : prod.avg_mql >= 30 ? "text-cyan-700" : "text-fg-text"}`}>{prod.avg_mql}</div>
        </div>
      </div>
      <div className="text-xs text-fg-muted mb-3 flex items-center gap-2 flex-wrap">
        <span><span className="text-emerald-600 font-semibold">{prod.hot_pct}%</span> hot 50+</span>
        <span>·</span>
        <span><span className="text-amber-600 font-semibold">{prod.super_hot_count}</span> super hot</span>
        {prod.cpa_period_inr > 0 && <><span>·</span><span>CPA {inr(prod.cpa_period_inr, { compact: true })}</span></>}
      </div>
      <div className="h-10 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <polyline points={points} fill="none" stroke={PROD_HEX[prod.code] || "#94A3B8"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-fg-subtle">
        <span>14-day avg MQL trend</span>
        <span className={`font-semibold ${prod.delta_count > 0 ? "text-emerald-600" : prod.delta_count < 0 ? "text-rose-600" : ""}`}>
          {prod.delta_count > 0 ? "+" : ""}{prod.delta_count} vs prev
        </span>
      </div>
    </button>
  );
}

function DrillDown({ prod }: { prod: ProductInsight }) {
  const aux = productAccents(prod.color);
  return (
    <div className="surface-card p-6 mb-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-fg-text inline-flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${aux.dot}`} />
            {prod.long_name} · drill-down
          </h2>
          <p className="text-sm text-fg-muted mt-0.5">{prod.count} leads · {prod.scoreable} scoreable · avg {prod.avg_mql} · median {prod.median_mql} · {prod.hot_pct}% hot</p>
        </div>
      </div>

      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">MQL distribution (scoreable leads only)</div>
        <DistributionBars items={prod.tier_distribution.map(t => ({ label: t.tier, count: t.count, color: t.color }))} total={prod.scoreable} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SignalBreakdown title="Job role"           items={prod.signals.job} />
        <SignalBreakdown title="Age band"           items={prod.signals.age} />
        <SignalBreakdown title="Why-Forge length"   items={prod.signals.why} />
        <SignalBreakdown title="Grant choice"       items={prod.signals.grant} />
      </div>

      <div className="mt-6 pt-6 border-t border-fg-border">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">Top 10 leads in period</div>
        {prod.top10.length === 0 ? (
          <div className="text-sm text-fg-subtle italic">No leads in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-fg-border">
                <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                  <th className="py-2 pr-2 font-medium w-12">Score</th>
                  <th className="py-2 px-2 font-medium">Name</th>
                  <th className="py-2 px-2 font-medium">Email</th>
                  <th className="py-2 px-2 font-medium">Submitted</th>
                  <th className="py-2 px-2 font-medium">Stage</th>
                  <th className="py-2 pl-2 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {prod.top10.map(l => (
                  <tr key={l.id} className="border-b border-fg-border/70 row-hover">
                    <td className="py-2 pr-2"><MiniScore score={l.score} /></td>
                    <td className="py-2 px-2 font-medium text-fg-text truncate max-w-[180px]">{l.name || "—"}</td>
                    <td className="py-2 px-2 text-fg-muted truncate max-w-[200px]">{l.email || "—"}</td>
                    <td className="py-2 px-2 text-xs text-fg-muted whitespace-nowrap">{new Date(l.first_seen).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</td>
                    <td className="py-2 px-2 text-xs text-fg-muted">{(l.funnel_stage || "").replace(/_/g, " ")}</td>
                    <td className="py-2 pl-2">
                      <Link href={`/leads/${l.id}`} className="text-amber-700 hover:text-amber-800"><ChevronRight className="w-4 h-4"/></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniScore({ score }: { score: number }) {
  let cls;
  if (score >= 70)      cls = "bg-amber-500 text-white";
  else if (score >= 50) cls = "bg-emerald-500 text-white";
  else if (score >= 30) cls = "bg-cyan-100 text-cyan-800";
  else                  cls = "bg-slate-100 text-slate-500";
  return <div className={`inline-flex items-center justify-center w-7 h-7 rounded font-bold text-xs tabular-nums ${cls}`}>{score}</div>;
}

function DistributionBars({ items, total }: { items: { label: string; count: number; color: string }[]; total: number }) {
  return (
    <div className="space-y-1.5">
      {items.map(it => {
        const pct = total > 0 ? Math.round(1000 * it.count / total) / 10 : 0;
        return (
          <div key={it.label} className="flex items-center gap-3 text-sm">
            <span className="w-32 text-fg-muted shrink-0">{it.label}</span>
            <div className="flex-1 h-6 bg-fg-surface rounded overflow-hidden">
              <div style={{ width: `${pct}%`, background: it.color }} className="h-full transition-all" />
            </div>
            <span className="w-24 text-right tabular-nums text-xs text-fg-muted shrink-0">{it.count} <span className="text-fg-subtle">({pct.toFixed(1)}%)</span></span>
          </div>
        );
      })}
    </div>
  );
}

function SignalBreakdown({ title, items }: { title: string; items: { label: string; count: number; pct: number }[] }) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map(it => it.pct), 1);
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">{title}</div>
      <div className="space-y-1">
        {items.map(it => (
          <div key={it.label} className="flex items-center gap-2 text-sm">
            <span className="w-32 text-fg-text/80 truncate shrink-0">{it.label}</span>
            <div className="flex-1 h-4 bg-fg-surface rounded overflow-hidden">
              <div style={{ width: `${(it.pct / max) * 100}%` }} className="h-full bg-gradient-to-r from-indigo-400 to-cyan-400 transition-all" />
            </div>
            <span className="w-20 text-right tabular-nums text-xs text-fg-muted shrink-0">{it.count} <span className="text-fg-subtle">({it.pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-3 mt-2">
      <h2 className="text-lg font-semibold text-fg-text inline-flex items-center gap-2">{icon}{title}</h2>
      <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>
    </div>
  );
}

function RepTable({ reps }: { reps: InsightsPayload["reps"] }) {
  if (reps.length === 0) {
    return (
      <div className="surface-card p-8 text-center text-sm text-fg-muted mb-6">
        No rep activity logged in this period yet — once reps start using the status dropdown on /queue, this populates automatically.
      </div>
    );
  }
  return (
    <div className="surface-card overflow-hidden mb-6">
      <table className="w-full text-sm">
        <thead className="bg-fg-surface border-b border-fg-border">
          <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
            <th className="py-3 px-4 font-medium">Rep</th>
            <th className="py-3 px-4 font-medium text-right">Distinct leads touched</th>
            <th className="py-3 px-4 font-medium text-right">Total actions</th>
            <th className="py-3 px-4 font-medium text-right">Converted</th>
            <th className="py-3 px-4 font-medium text-right">Lost / not interested</th>
            <th className="py-3 px-4 font-medium text-right">Convert rate</th>
          </tr>
        </thead>
        <tbody>
          {reps.map(r => (
            <tr key={r.rep_name} className="border-b border-fg-border/70 row-hover">
              <td className="py-3 px-4 font-semibold text-fg-text">{r.rep_name}</td>
              <td className="py-3 px-4 text-right tabular-nums">{r.distinct_leads}</td>
              <td className="py-3 px-4 text-right tabular-nums text-fg-muted">{r.total_actions}</td>
              <td className="py-3 px-4 text-right tabular-nums text-emerald-600 font-semibold">{r.converted}</td>
              <td className="py-3 px-4 text-right tabular-nums text-rose-600">{r.lost}</td>
              <td className="py-3 px-4 text-right tabular-nums">
                <span className={`font-semibold ${r.convert_rate >= 10 ? "text-emerald-600" : r.convert_rate >= 5 ? "text-cyan-700" : "text-fg-text"}`}>{r.convert_rate}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComingSoonCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="surface-card p-5 border-l-4 border-l-amber-400 bg-amber-50/30">
      <div className="text-sm font-semibold text-fg-text mb-1.5">{title}</div>
      <div className="text-xs text-fg-muted leading-relaxed">{desc}</div>
    </div>
  );
}
