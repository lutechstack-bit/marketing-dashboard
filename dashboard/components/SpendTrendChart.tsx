"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { ProgramRollup } from "@/lib/data";
import { inr } from "@/lib/format";

const COLORS = { FFM: "#EAB308", FW: "#38BDF8", FC: "#EF4444", FAI: "#4338CA" };

export default function SpendTrendChart({ data }: { data: ProgramRollup[] }) {
  const recent = data.slice(-18);

  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-fg-text">Marketing spend by program</h2>
          <p className="text-xs text-fg-muted mt-0.5">Monthly Meta Ads spend (GST-incl) · last 18 months</p>
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
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={recent} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
          <defs>
            {Object.entries(COLORS).map(([k, c]) => (
              <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={c} stopOpacity={0.55} />
                <stop offset="95%" stopColor={c} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
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
            formatter={(v: number, name) => [inr(v), name]}
          />
          {Object.entries(COLORS).map(([k, c]) => (
            <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={c} fill={`url(#g-${k})`} strokeWidth={1.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
