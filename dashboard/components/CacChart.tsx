"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ProgramRollup, AcquisitionRow } from "@/lib/data";
import { inr } from "@/lib/format";

const COLORS = { FFM: "#EF4444", FW: "#06B6D4", FC: "#84CC16", FAI: "#F59E0B" };

export default function CacChart({
  spendTrend, acquisitions,
}: { spendTrend: ProgramRollup[]; acquisitions: AcquisitionRow[] }) {
  const acqMap = new Map(acquisitions.map(a => [a.ym, a]));
  const data = spendTrend.slice(-12).map(s => {
    const acq = acqMap.get(s.ymKey);
    const out: any = { label: s.label, ym: s.ymKey };
    for (const p of ["FFM", "FW", "FC", "FAI"] as const) {
      const spend = (s as any)[p] as number;
      const count = acq ? (acq as any)[p] as number : 0;
      out[p] = count > 0 ? Math.round(spend / count) : null;
    }
    return out;
  });

  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-fg-text">CAC per paid student</h2>
          <p className="text-xs text-fg-muted mt-0.5">Spend ÷ paid students per month · last 12 months</p>
        </div>
        <div className="flex gap-3 text-xs">
          {Object.entries(COLORS).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
              <span className="text-fg-muted">{k}</span>
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
          <YAxis
            tick={{ fill: "#64748B", fontSize: 11 }}
            stroke="#E5E7EB"
            tickFormatter={(v) => inr(v, { compact: true })}
          />
          <Tooltip
            contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }}
            labelStyle={{ color: "#0F172A", fontWeight: 600 }}
            formatter={(v: number, name) => [v ? inr(v) : "—", name]}
          />
          {(["FFM", "FW", "FC", "FAI"] as const).map((k) => (
            <Bar key={k} dataKey={k} fill={COLORS[k]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
