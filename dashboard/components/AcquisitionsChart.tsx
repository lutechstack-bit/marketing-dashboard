"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { AcquisitionRow } from "@/lib/data";

const COLORS = { FFM: "#EF4444", FW: "#06B6D4", FC: "#84CC16", FAI: "#F59E0B" };

export default function AcquisitionsChart({ data }: { data: AcquisitionRow[] }) {
  const recent = data.slice(-12);
  return (
    <div className="glow-card rounded-xl p-6 animate-fade-in">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Paid students per program</h2>
          <p className="text-xs text-fg-muted mt-0.5">Slot-confirmation count by month · last 12 months</p>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#71717A", fontSize: 11 }} stroke="#27272A" />
          <YAxis tick={{ fill: "#71717A", fontSize: 11 }} stroke="#27272A" allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#141416", border: "1px solid #27272A", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#FAFAFA", fontWeight: 600 }}
          />
          {(["FFM", "FW", "FC", "FAI"] as const).map((k) => (
            <Bar key={k} dataKey={k} stackId="a" fill={COLORS[k]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
