"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Sparkles, TrendingUp, TrendingDown, Users, IndianRupee, Target,
  Phone, Calendar, Zap, ChevronRight, BarChart3, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import type { LeadRow } from "@/lib/supabase";
import {
  PRODUCTS, FAMILIES, PRODUCTS_BY_FAMILY, PRODUCT_BY_CODE,
  productAccents, familyLabel, type Family,
} from "@/lib/products";
import {
  buildPeriod, aggregateByProduct, buildDailyTrend, buildCashflowDaily,
  aggregateRepPerformance, type Period, type ProductAgg, type PaymentRow, type RepActivity,
} from "@/lib/insights-agg";
import { inr, fmtInt, pct } from "@/lib/format";

// Per-program color hex (matches tailwind config / queue)
const PROD_HEX: Record<string, string> = {
  FFM: "#EAB308", FW: "#38BDF8", FC: "#EF4444", FAI: "#4338CA",
  VE: "#3B82F6", BFP: "#8B5CF6", L3C: "#D946EF",
};

// Pretty labels for signal buckets
const JOB_LABEL: Record<string, string> = {
  entrepreneur: "Entrepreneur", freelancer: "Freelancer", corporate: "Working pro",
  exploring: "Exploring options", working_other: "Working (other)", working: "Working",
  break: "Taking a break", student: "Student",
  other_professional: "Other professional", other: "Other", unknown: "Unknown",
};
const AGE_LABEL: Record<string, string> = {
  under_18: "<18", "18_24": "18-24", "24_28": "24-28", "28_32": "28-32",
  "32_45": "32-45", "45_60": "45-60", "60plus": "60+",
  unparsed: "Unparsed", unknown: "Unknown",
};
const WHY_LABEL: Record<string, string> = {
  empty: "No answer", under_30: "<30 chars", "31_100": "31-100", "101_250": "101-250",
  "251_500": "251-500", "501_1000": "501-1000", "1000plus": "1000+", unknown: "Unknown",
};
const GRANT_LABEL: Record<string, string> = {
  without_grant: "Without grant", with_grant: "With grant", unknown: "Not specified",
};

type Props = {
  initialLeads: LeadRow[];
  payments: PaymentRow[];
  activities: RepActivity[];
  marketingMonthly: any[];
  marketingDaily: any[];
};

// ----------------------------------------------------------------
export default function InsightsClient({ initialLeads, payments, activities, marketingMonthly, marketingDaily }: Props) {
  const [family, setFamily] = useState<Family>("forge");
  const [periodId, setPeriodId] = useState<Period["id"]>("30d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [drillProduct, setDrillProduct] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const period = useMemo(
    () => buildPeriod(periodId, { customStart, customEnd }),
    [periodId, customStart, customEnd]
  );
  const productCodes = PRODUCTS_BY_FAMILY[family].map(p => p.code);

  // Per-product aggregates
  const aggs = useMemo(
    () => productCodes.map(code => aggregateByProduct(initialLeads, code, period)),
    [initialLeads, productCodes, period]
  );

  // Hero totals (across selected family)
  const totals = useMemo(() => {
    const totalLeads = aggs.reduce((s, a) => s + a.count, 0);
    const totalScore = aggs.reduce((s, a) => s + a.avg_mql * a.count, 0);
    const avgMql = totalLeads ? Math.round(totalScore / totalLeads) : 0;
    const hotCount = aggs.reduce((s, a) => s + a.hot_count, 0);
    const hotPct = totalLeads ? Math.round(1000 * hotCount / totalLeads) / 10 : 0;
    const totalSuperHot = aggs.reduce((s, a) => s + a.super_hot_count, 0);
    const prevTotalLeads = aggs.reduce((s, a) => s + (a.count - a.delta_vs_prev.count), 0);
    const leadsDelta = prevTotalLeads ? Math.round(1000 * (totalLeads - prevTotalLeads) / prevTotalLeads) / 10 : 0;
    return { totalLeads, avgMql, hotCount, hotPct, totalSuperHot, leadsDelta };
  }, [aggs]);

  // Period revenue (captured payments in period)
  const periodRevenue = useMemo(() => {
    let total = 0;
    for (const p of payments) {
      if (p.status !== "captured") continue;
      if (!productCodes.includes(p.program || "")) continue;
      const t = new Date(p.paid_at).getTime();
      if (t >= period.startMs && t < period.endMs) total += Number(p.amount_inr) || 0;
    }
    return total;
  }, [payments, period, productCodes]);

  // Daily trend
  const trendData = useMemo(
    () => buildDailyTrend(initialLeads, productCodes, period),
    [initialLeads, productCodes, period]
  );

  // Cash flow daily
  const cashflowDaily = useMemo(
    () => buildCashflowDaily(payments, productCodes, period),
    [payments, productCodes, period]
  );

  // Rep performance
  const repPerf = useMemo(
    () => aggregateRepPerformance(activities, period),
    [activities, period]
  );

  // Marketing spend in period — pull from sheet monthly data
  // marketingMonthly has: { year, month, program, spend_inr_incl_gst, leads, ... }
  const marketingPeriod = useMemo(() => {
    let totalSpend = 0;
    let totalLeadsRecorded = 0;
    const start = new Date(period.startMs);
    const end = new Date(period.endMs);
    for (const m of marketingMonthly) {
      if (!productCodes.includes(m.program)) continue;
      // Treat each row as the WHOLE month — only count if month overlaps period
      const monthStart = new Date(m.year, m.month - 1, 1);
      const monthEnd = new Date(m.year, m.month, 1);
      const overlapStart = Math.max(monthStart.getTime(), start.getTime());
      const overlapEnd = Math.min(monthEnd.getTime(), end.getTime());
      if (overlapEnd <= overlapStart) continue;
      const monthLen = monthEnd.getTime() - monthStart.getTime();
      const overlapFrac = (overlapEnd - overlapStart) / monthLen;
      totalSpend += (m.spend_inr_incl_gst || 0) * overlapFrac;
      totalLeadsRecorded += (m.leads || 0) * overlapFrac;
    }
    return { spend: totalSpend, leads: totalLeadsRecorded, cpa: totalLeadsRecorded > 0 ? totalSpend / totalLeadsRecorded : 0 };
  }, [marketingMonthly, period, productCodes]);

  const drillAgg = drillProduct ? aggs.find(a => a.code === drillProduct) : null;

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-fg-text inline-flex items-center gap-2">
          <Sparkles className="w-7 h-7 text-amber-500" />
          Marketing &amp; Sales Intelligence
        </h1>
        <p className="text-sm text-fg-muted mt-1">{period.label} · {family === "forge" ? "Forge" : "Live"} · all products</p>
      </div>

      {/* Filter bar */}
      <FilterBar
        family={family} onFamily={setFamily}
        periodId={periodId} onPeriod={setPeriodId}
        customStart={customStart} customEnd={customEnd}
        onCustomStart={setCustomStart} onCustomEnd={setCustomEnd}
      />

      {/* Hero strip */}
      <HeroStrip
        period={period}
        totalLeads={totals.totalLeads}
        leadsDelta={totals.leadsDelta}
        avgMql={totals.avgMql}
        hotPct={totals.hotPct}
        superHot={totals.totalSuperHot}
        spend={marketingPeriod.spend}
        leadsRecorded={marketingPeriod.leads}
        cpa={marketingPeriod.cpa}
        revenue={periodRevenue}
      />

      {/* Per-product cards */}
      <h2 className="text-lg font-semibold text-fg-text mb-3">Per program — click any card to drill in</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {aggs.map(a => (
          <ProductCard
            key={a.code}
            agg={a}
            product={PRODUCT_BY_CODE[a.code]!}
            isOpen={drillProduct === a.code}
            onClick={() => setDrillProduct(drillProduct === a.code ? null : a.code)}
          />
        ))}
      </div>

      {/* Drill-down */}
      {drillAgg && <DrillDown agg={drillAgg} leads={initialLeads} period={period} />}

      {/* Trend chart */}
      <section className="mb-6">
        <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Average MQL over time" subtitle={`Daily average per program · ${period.label}`} />
        <div className="surface-card p-6">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trendData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
              <YAxis tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" domain={[0, 100]} />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }} />
              <Legend />
              {productCodes.map(c => (
                <Line key={c} type="monotone" dataKey={c} stroke={PROD_HEX[c] || "#94A3B8"} strokeWidth={2} dot={false} name={PRODUCT_BY_CODE[c]?.name || c} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Marketing efficiency */}
      <section className="mb-6">
        <SectionHeader icon={<Target className="w-4 h-4" />} title="Marketing efficiency" subtitle="Spend (incl GST) · leads · CPA — pulled from your finance sheet" />
        <MarketingEfficiency
          spend={marketingPeriod.spend}
          leads={marketingPeriod.leads}
          cpa={marketingPeriod.cpa}
          marketingMonthly={marketingMonthly}
          productCodes={productCodes}
          period={period}
        />
      </section>

      {/* Cash flow */}
      <section className="mb-6">
        <SectionHeader icon={<Wallet className="w-4 h-4" />} title="Cash flow — captured payments by day" subtitle="From Razorpay (both accounts) · stacked by program" />
        <div className="surface-card p-6">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cashflowDaily} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
              <YAxis tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" tickFormatter={(v) => inr(v, { compact: true })} />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }} formatter={(v: number) => inr(v)} />
              <Legend />
              {productCodes.map(c => (
                <Bar key={c} dataKey={c} stackId="cash" fill={PROD_HEX[c] || "#94A3B8"} name={PRODUCT_BY_CODE[c]?.name || c} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Sales rep performance */}
      <section className="mb-6">
        <SectionHeader icon={<Phone className="w-4 h-4" />} title="Sales rep performance" subtitle={`From dashboard activity · ${period.label} · EOD report integration coming next`} />
        <RepPerformance reps={repPerf} />
      </section>

      {/* Coming soon block */}
      <section className="mb-12">
        <SectionHeader icon={<Calendar className="w-4 h-4" />} title="Coming next" subtitle="Need data hooks before I can wire these" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ComingSoonCard title="YouTube collaboration ad spend" desc="Per-collab spend + lead attribution. Need: spreadsheet of YouTube collabs (creator, date range, cost, UTM tag) so I can split it from Meta in the spend chart." />
          <ComingSoonCard title="EOD report integration" desc="Productive minutes · interview calls · abandoned-leads dialed · daily HOTS list. Need: where reps submit EOD (Sheets / Slack / Tally?) so I can pull it auto-magically into the rep performance card." />
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function FilterBar({ family, onFamily, periodId, onPeriod, customStart, customEnd, onCustomStart, onCustomEnd }: any) {
  return (
    <div className="surface-card p-3 mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1">Family</span>
        <div className="inline-flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5">
          {FAMILIES.map((f: Family) => (
            <button key={f} onClick={() => onFamily(f)}
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
          { id: "7d",    label: "7d" },
          { id: "30d",   label: "30d" },
          { id: "mtd",   label: "MTD" },
          { id: "custom",label: "Custom" },
        ].map(p => (
          <button key={p.id} onClick={() => onPeriod(p.id)}
            className={`chip ${periodId === p.id ? "chip-active" : ""}`}>{p.label}</button>
        ))}
        {periodId === "custom" && (
          <div className="inline-flex items-center gap-1 ml-1">
            <input type="date" value={customStart} onChange={e => onCustomStart(e.target.value)} className="text-xs px-2 py-1.5 rounded border border-fg-border" />
            <span className="text-fg-subtle text-xs">→</span>
            <input type="date" value={customEnd} onChange={e => onCustomEnd(e.target.value)} className="text-xs px-2 py-1.5 rounded border border-fg-border" />
          </div>
        )}
      </div>
    </div>
  );
}

function HeroStrip({ period, totalLeads, leadsDelta, avgMql, hotPct, superHot, spend, leadsRecorded, cpa, revenue }: any) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <HeroTile label="New leads" value={fmtInt(totalLeads)} delta={leadsDelta} icon={<Users className="w-4 h-4" />} accent="amber" />
      <HeroTile label="Avg MQL" value={String(avgMql)} sub="out of 100" icon={<Sparkles className="w-4 h-4" />} accent="indigo" big />
      <HeroTile label="Hot 50+" value={`${hotPct}%`} sub={`${superHot} super hot`} icon={<Zap className="w-4 h-4" />} accent="emerald" />
      <HeroTile label="Marketing spend" value={inr(spend, { compact: true })} sub="incl. GST" icon={<Wallet className="w-4 h-4" />} accent="rose" invert />
      <HeroTile label="CPA" value={cpa > 0 ? inr(cpa) : "—"} sub="cost per Meta-lead" icon={<Target className="w-4 h-4" />} accent="cyan" invert />
      <HeroTile label="Revenue" value={inr(revenue, { compact: true })} sub="captured this period" icon={<IndianRupee className="w-4 h-4" />} accent="emerald" />
    </div>
  );
}

function HeroTile({ label, value, sub, delta, icon, accent, big, invert }: any) {
  const accentMap: Record<string, string> = {
    amber:   "from-amber-50 to-white border-amber-200",
    indigo:  "from-indigo-50 to-white border-indigo-200",
    emerald: "from-emerald-50 to-white border-emerald-200",
    rose:    "from-rose-50 to-white border-rose-200",
    cyan:    "from-cyan-50 to-white border-cyan-200",
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

function ProductCard({ agg, product, isOpen, onClick }: { agg: ProductAgg; product: any; isOpen: boolean; onClick: () => void }) {
  const aux = productAccents(product.color);
  const max = Math.max(...agg.sparkline, 1);
  const points = agg.sparkline.map((v, i) => `${(i / Math.max(agg.sparkline.length - 1, 1)) * 100},${100 - (v / max) * 100}`).join(" ");
  const deltaCount = agg.delta_vs_prev.count;
  const deltaMql = agg.delta_vs_prev.avg_mql;
  return (
    <button
      onClick={onClick}
      className={`surface-card surface-card-hover text-left p-5 transition-all ring-2 ${isOpen ? `${aux.tabActive.split(" ")[0]} shadow-card-hover` : "ring-transparent"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${aux.dot}`} />
          <span className="font-semibold text-fg-text">{product.longName}</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-fg-subtle transition-transform ${isOpen ? "rotate-90" : ""}`} />
      </div>
      <div className="flex items-baseline gap-3 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Leads</div>
          <div className="text-2xl font-bold tabular-nums text-fg-text leading-none">{agg.count}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">Avg MQL</div>
          <div className={`text-2xl font-bold tabular-nums leading-none ${agg.avg_mql >= 50 ? "text-emerald-600" : agg.avg_mql >= 30 ? "text-cyan-700" : "text-fg-text"}`}>{agg.avg_mql}</div>
        </div>
      </div>
      <div className="text-xs text-fg-muted mb-3 flex items-center gap-2">
        <span><span className="text-emerald-600 font-semibold">{agg.hot_pct}%</span> hot 50+</span>
        <span>·</span>
        <span><span className="text-amber-600 font-semibold">{agg.super_hot_count}</span> super hot</span>
      </div>
      {/* Sparkline */}
      <div className="h-10 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <polyline points={points} fill="none" stroke={PROD_HEX[product.code] || "#94A3B8"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] text-fg-subtle">
        <span>14-day avg MQL trend</span>
        <span className={`font-semibold ${deltaCount > 0 ? "text-emerald-600" : deltaCount < 0 ? "text-rose-600" : ""}`}>
          {deltaCount > 0 ? "+" : ""}{deltaCount} vs prev period
        </span>
      </div>
    </button>
  );
}

function DrillDown({ agg, leads, period }: { agg: ProductAgg; leads: LeadRow[]; period: Period }) {
  const product = PRODUCT_BY_CODE[agg.code]!;
  const aux = productAccents(product.color);
  // Top 10 leads in period for this product
  const periodLeads = leads.filter(l => l.program === agg.code && l.first_seen
    && new Date(l.first_seen).getTime() >= period.startMs
    && new Date(l.first_seen).getTime() < period.endMs)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  const tierData = [
    { tier: "Cold <30",      count: agg.count - agg.hot_count - (agg.signals.why["unknown"] || 0) - countTier(leads, period, agg.code, 0, 30) === 0 ? countTier(leads, period, agg.code, 0, 30) : countTier(leads, period, agg.code, 0, 30), color: "#CBD5E1" },
    { tier: "Warm 30-49",    count: countTier(leads, period, agg.code, 30, 50),  color: "#06B6D4" },
    { tier: "Hot 50-69",     count: countTier(leads, period, agg.code, 50, 70),  color: "#10B981" },
    { tier: "Super hot 70+", count: agg.super_hot_count,                          color: "#F59E0B" },
  ];

  return (
    <div className="surface-card p-6 mb-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-fg-text inline-flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${aux.dot}`} />
            {product.longName} · drill-down
          </h2>
          <p className="text-sm text-fg-muted mt-0.5">{agg.count} leads in period · avg MQL {agg.avg_mql} · {agg.hot_pct}% hot</p>
        </div>
      </div>

      {/* MQL distribution bars */}
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">MQL distribution</div>
        <DistributionBars items={tierData.map(t => ({ label: t.tier, count: t.count, color: t.color }))} total={agg.count} />
      </div>

      {/* Signal breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SignalBreakdown title="Job role" data={agg.signals.job} labels={JOB_LABEL} total={agg.count} />
        <SignalBreakdown title="Age band" data={agg.signals.age} labels={AGE_LABEL} total={agg.count} />
        <SignalBreakdown title="Why-Forge length" data={agg.signals.why} labels={WHY_LABEL} total={agg.count} />
        <SignalBreakdown title="Grant choice" data={agg.signals.grant} labels={GRANT_LABEL} total={agg.count} />
      </div>

      {/* Top 10 leads */}
      <div className="mt-6 pt-6 border-t border-fg-border">
        <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">Top 10 leads in this period</div>
        {periodLeads.length === 0 ? (
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
                {periodLeads.map(l => (
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

function countTier(leads: LeadRow[], period: Period, code: string, min: number, max: number): number {
  return leads.filter(l => l.program === code
    && l.first_seen
    && new Date(l.first_seen).getTime() >= period.startMs
    && new Date(l.first_seen).getTime() < period.endMs
    && (l.score || 0) >= min && (l.score || 0) < max).length;
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
            <span className="w-20 text-right tabular-nums text-xs text-fg-muted shrink-0">{it.count} <span className="text-fg-subtle">({pct.toFixed(1)}%)</span></span>
          </div>
        );
      })}
    </div>
  );
}

function SignalBreakdown({ title, data, labels, total }: { title: string; data: Record<string, number>; labels: Record<string, string>; total: number }) {
  const items = Object.entries(data)
    .map(([k, v]) => ({ label: labels[k] || k, count: v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-2">{title}</div>
      <div className="space-y-1">
        {items.map(it => {
          const pct = total > 0 ? Math.round(1000 * it.count / total) / 10 : 0;
          return (
            <div key={it.label} className="flex items-center gap-2 text-sm">
              <span className="w-32 text-fg-text/80 truncate shrink-0">{it.label}</span>
              <div className="flex-1 h-4 bg-fg-surface rounded overflow-hidden">
                <div style={{ width: `${pct}%` }} className="h-full bg-gradient-to-r from-indigo-400 to-cyan-400 transition-all" />
              </div>
              <span className="w-16 text-right tabular-nums text-xs text-fg-muted shrink-0">{it.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-fg-text inline-flex items-center gap-2">{icon}{title}</h2>
      <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>
    </div>
  );
}

function MarketingEfficiency({ spend, leads, cpa, marketingMonthly, productCodes, period }: any) {
  // Build last-12-month spend + leads + CPA series across selected products
  const months: Record<string, { spend: number; leads: number; ymKey: string; label: string; year: number; month: number }> = {};
  for (const m of marketingMonthly) {
    if (!productCodes.includes(m.program)) continue;
    const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
    months[key] ||= { spend: 0, leads: 0, ymKey: key, label: `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m.month-1]} ${String(m.year).slice(-2)}`, year: m.year, month: m.month };
    months[key].spend += m.spend_inr_incl_gst || 0;
    months[key].leads += m.leads || 0;
  }
  const series = Object.values(months).sort((a, b) => a.ymKey.localeCompare(b.ymKey)).slice(-12).map(m => ({
    ...m,
    cpa: m.leads > 0 ? Math.round(m.spend / m.leads) : 0,
  }));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="surface-card p-5">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted">Spend (selected period)</div>
        <div className="text-2xl font-bold text-fg-text tabular-nums">{inr(spend, { compact: true })}</div>
        <div className="text-xs text-fg-muted mt-1">Meta Ads · GST-inclusive</div>
      </div>
      <div className="surface-card p-5">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted">Meta-attributed leads</div>
        <div className="text-2xl font-bold text-fg-text tabular-nums">{fmtInt(leads)}</div>
        <div className="text-xs text-fg-muted mt-1">From Meta API attribution</div>
      </div>
      <div className="surface-card p-5">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted">CPA</div>
        <div className="text-2xl font-bold text-fg-text tabular-nums">{cpa > 0 ? inr(cpa) : "—"}</div>
        <div className="text-xs text-fg-muted mt-1">Cost per attributed lead</div>
      </div>
      <div className="lg:col-span-3 surface-card p-6">
        <div className="text-sm font-semibold text-fg-text mb-3">12-month spend vs leads vs CPA</div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={series} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <YAxis yAxisId="L" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" tickFormatter={v => inr(v, { compact: true })} />
            <YAxis yAxisId="R" orientation="right" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }} formatter={(v: number, k: string) => k === "spend" ? inr(v) : k === "cpa" ? inr(v) : fmtInt(v)} />
            <Legend />
            <Area yAxisId="L" type="monotone" dataKey="spend" stroke="#EF4444" fill="#EF4444" fillOpacity={0.15} name="Spend (₹)" />
            <Area yAxisId="R" type="monotone" dataKey="leads" stroke="#10B981" fill="#10B981" fillOpacity={0.15} name="Leads" />
            <Line yAxisId="R" type="monotone" dataKey="cpa" stroke="#4338CA" strokeWidth={2} dot={false} name="CPA" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RepPerformance({ reps }: { reps: any[] }) {
  if (reps.length === 0) {
    return (
      <div className="surface-card p-8 text-center text-sm text-fg-muted">
        No rep activity logged in this period yet — once reps start using the status dropdown on /queue, this populates automatically.
      </div>
    );
  }
  return (
    <div className="surface-card overflow-hidden">
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
