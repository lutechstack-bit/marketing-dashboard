"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { AcquisitionRow } from "@/lib/data";

const COLORS = { FFM: "#EF4444", FW: "#06B6D4", FC: "#84CC16", FAI: "#F59E0B" };

export default function AcquisitionsChart({ data }: { data: AcquisitionRow[] }) {
  const recent = data.slice(-12);
  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-fg-text">Paid students per program</h2>
          <p className="text-xs text-fg-muted mt-0.5">Slot confirmations by month · last 12 months</p>
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
        <BarChart data={recent} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" />
          <YAxis tick={{ fill: "#64748B", fontSize: 11 }} stroke="#E5E7EB" allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px -4px rgb(15 23 42 / 0.15)" }}
            labelStyle={{ color: "#0F172A", fontWeight: 600 }}
          />
          {(["FFM", "FW", "FC", "FAI"] as const).map((k) => (
            <Bar key={k} dataKey={k} stackId="a" fill={COLORS[k]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
