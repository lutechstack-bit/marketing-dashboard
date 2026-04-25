"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { ProgramRollup } from "@/lib/data";
import { inr } from "@/lib/format";

const COLORS = { FFM: "#EF4444", FW: "#06B6D4", FC: "#84CC16", FAI: "#F59E0B" };

export default function SpendTrendChart({ data }: { data: ProgramRollup[] }) {
  // Show last 18 months for readability
  const recent = data.slice(-18);

  return (
    <div className="glow-card rounded-xl p-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Marketing spend by program</h2>
          <p className="text-xs text-fg-muted mt-0.5">Monthly Meta Ads spend, GST-inclusive · last 18 months</p>
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
                <stop offset="5%" stopColor={c} stopOpacity={0.5} />
                <stop offset="95%" stopColor={c} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#71717A", fontSize: 11 }} stroke="#27272A" />
          <YAxis
            tick={{ fill: "#71717A", fontSize: 11 }}
            stroke="#27272A"
            tickFormatter={(v) => inr(v, { compact: true })}
          />
          <Tooltip
            contentStyle={{ background: "#141416", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#FAFAFA", fontWeight: 600 }}
            formatter={(v: number, name) => [inr(v), name]}
          />
          {Object.entries(COLORS).map(([k, c]) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId="1"
              stroke={c}
              fill={`url(#g-${k})`}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
