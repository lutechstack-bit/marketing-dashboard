// Today's Progress widget — for sales reps on /queue.
// Shows calls / conversions / earnings TODAY with progress bars vs a
// daily target. Plus pipeline value (locked earnings = "money in motion").
//
// Server component (reads fetchTodaysActivity which is cached 30s).

import { Phone, Trophy, Wallet, Lock } from "lucide-react";
import { fetchTodaysActivity } from "@/lib/sales-stats";
import { inr } from "@/lib/format";

// Daily targets — defaults; later wire to a per-rep settings table.
const DEFAULT_TARGETS = { calls: 30, conversions: 2 };

export default async function TodaysProgress({ repId, repName }: { repId: string; repName: string | null }) {
  const a = await fetchTodaysActivity(repId, repName);

  const callPct = Math.min(100, (a.calls_today / DEFAULT_TARGETS.calls) * 100);
  const convPct = Math.min(100, (a.conversions_today / DEFAULT_TARGETS.conversions) * 100);

  return (
    <div className="surface-card mb-5 overflow-hidden">
      <div className="px-5 py-3 bg-forge-radial relative border-b border-fg-border/60">
        <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
        <div className="flex items-baseline justify-between gap-3 relative">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold">Today's progress</div>
            <div className="font-display text-xl font-extrabold italic text-forge-black">
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold">Locked today</div>
            <div className="font-display text-2xl font-extrabold italic text-forge-orange-deep tabular-nums">
              {inr(a.earnings_today_locked, { compact: true })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 divide-y md:divide-y-0 md:divide-x divide-fg-border/60">
        <Stat
          icon={<Phone className="w-3.5 h-3.5" />}
          label="Calls today"
          value={a.calls_today}
          target={DEFAULT_TARGETS.calls}
          pct={callPct}
          tone="amber"
        />
        <Stat
          icon={<Trophy className="w-3.5 h-3.5" />}
          label="Conversions today"
          value={a.conversions_today}
          target={DEFAULT_TARGETS.conversions}
          pct={convPct}
          tone="emerald"
        />
        <PipelineStat
          icon={<Lock className="w-3.5 h-3.5" />}
          label="Pipeline (waiting on balance)"
          amount={a.pipeline_locked}
          count={a.pipeline_count}
        />
      </div>
    </div>
  );
}

function Stat({ icon, label, value, target, pct, tone }: {
  icon: React.ReactNode; label: string; value: number; target: number; pct: number;
  tone: "amber" | "emerald";
}) {
  const barColor = tone === "amber" ? "bg-forge-yellow" : "bg-emerald-500";
  const hit = value >= target;
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-fg-muted font-semibold mb-1">
        {icon}{label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-display text-3xl font-extrabold italic tabular-nums ${hit ? "text-emerald-700" : "text-forge-black"}`}>
          {value}
        </span>
        <span className="text-sm text-fg-muted">/ {target}</span>
        {hit && <span className="ml-1 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">target hit</span>}
      </div>
      <div className="h-1.5 w-full bg-forge-cream rounded-full mt-2 overflow-hidden">
        <div style={{ width: `${pct}%` }} className={`h-full ${barColor} transition-all duration-300`} />
      </div>
    </div>
  );
}

function PipelineStat({ icon, label, amount, count }: { icon: React.ReactNode; label: string; amount: number; count: number }) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-fg-muted font-semibold mb-1">
        {icon}{label}
      </div>
      <div className="font-display text-3xl font-extrabold italic tabular-nums text-forge-orange-deep">
        {inr(amount, { compact: true })}
      </div>
      <div className="text-xs text-fg-muted mt-1">
        {count} {count === 1 ? "lead" : "leads"} could pay balance any day
      </div>
    </div>
  );
}
