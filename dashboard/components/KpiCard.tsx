import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { deltaPct } from "@/lib/format";

export default function KpiCard({
  label, value, prevValue, sublabel, invert = false, icon,
}: {
  label: string; value: string; prevValue?: number; sublabel?: string;
  invert?: boolean; icon?: React.ReactNode;
}) {
  let deltaEl = null;
  if (prevValue !== undefined) {
    const now = parseFloat(value.replace(/[^\d.\-]/g, "")) || 0;
    const d = deltaPct(now, prevValue);
    const positive = invert ? d < 0 : d > 0;
    deltaEl = (
      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        positive ? "text-emerald-600" : d === 0 ? "text-fg-muted" : "text-rose-600"
      }`}>
        {d > 0 ? <ArrowUpRight className="w-3 h-3" /> : d < 0 ? <ArrowDownRight className="w-3 h-3" /> : null}
        {Math.abs(d).toFixed(1)}%
      </span>
    );
  }

  return (
    <div className="surface-card surface-card-hover p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-3">
        <div className="text-[11px] font-medium text-fg-muted uppercase tracking-wider">{label}</div>
        {icon && <div className="text-fg-subtle">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-3xl font-bold tracking-tight text-fg-text tabular-nums">{value}</div>
        {deltaEl}
      </div>
      {sublabel && <div className="text-xs text-fg-muted mt-2">{sublabel}</div>}
    </div>
  );
}
