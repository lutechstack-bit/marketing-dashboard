// Earnings header — the centerpiece of the sales rep's queue.
// Shows the "money in escrow" treatment in Forge brand colors.

import Link from "next/link";
import { Lock, Unlock, CheckCheck, Sparkles, Trophy } from "lucide-react";
import { inr, fmtInt } from "@/lib/format";
import { getEarningsTotals, type EarningTotals } from "@/lib/earnings";

export default async function EarningsHeader({ repId, repName }: { repId: string; repName: string }) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const totals = await getEarningsTotals({ rep_id: repId, from });
  const t: EarningTotals = totals[0] || {
    rep_id: repId,
    locked_count: 0, locked_amount: 0,
    unlocked_count: 0, unlocked_amount: 0,
    approved_count: 0, approved_amount: 0,
    paid_out_count: 0, paid_out_amount: 0,
    reverted_count: 0, reverted_amount: 0,
  };

  const total = t.locked_amount + t.unlocked_amount + t.approved_amount + t.paid_out_amount;
  const periodLabel = now.toLocaleString("en-IN", { month: "long", year: "numeric" });

  if (total === 0) {
    return (
      <div className="surface-card p-5 mb-5 bg-forge-radial border-l-4 border-l-forge-yellow relative overflow-hidden">
        <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
        <div className="flex items-start gap-3 relative">
          <Sparkles className="w-5 h-5 text-forge-orange-deep shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-forge-black">Hi {repName} · {periodLabel}</div>
            <div className="text-xs text-fg-muted mt-0.5">No conversions yet this month — every lead in your queue has a potential payout. Get them to balance payment to unlock.</div>
            <Link href="/leaderboard" className="inline-flex items-center gap-1 text-xs text-forge-orange-deep hover:text-forge-orange font-medium mt-2">
              <Trophy className="w-3 h-3" />View leaderboard →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card mb-5 overflow-hidden relative">
      {/* Top stripe */}
      <div className="h-1 bg-forge-gradient" />

      <div className="p-5 bg-forge-radial relative">
        <div className="absolute right-6 top-4 opacity-[0.05] pointer-events-none">
          <span className="font-display font-extrabold italic text-forge-black text-7xl leading-none">{inr(total, { compact: true })}</span>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap relative">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold">{repName} · {periodLabel}</div>
            <div className="font-display text-4xl font-extrabold italic text-forge-black mt-1 leading-none">
              {inr(total, { compact: true })}
              <span className="text-sm font-sans font-medium text-fg-muted ml-2 not-italic">earned</span>
            </div>
            <div className="text-xs text-fg-muted mt-1">
              {t.locked_count + t.unlocked_count + t.approved_count + t.paid_out_count} conversions ·
              <Link href="/leaderboard" className="text-forge-orange-deep hover:text-forge-orange ml-1 font-medium">leaderboard →</Link>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Tile icon={<Lock className="w-3.5 h-3.5" />}      label="Locked"   amount={t.locked_amount}   count={t.locked_count}   tone="amber"  subtitle="push to balance" />
            <Tile icon={<Unlock className="w-3.5 h-3.5" />}    label="Unlocked" amount={t.unlocked_amount} count={t.unlocked_count} tone="emerald" subtitle="pending approval" />
            <Tile icon={<CheckCheck className="w-3.5 h-3.5" />} label="Paid out" amount={t.paid_out_amount} count={t.paid_out_count} tone="cleared" subtitle="cleared" />
          </div>
        </div>

        {t.locked_amount > 0 && (
          <div className="mt-4 pt-3 border-t border-forge-yellow-soft flex items-center gap-2 text-sm relative">
            <Lock className="w-4 h-4 text-forge-orange-deep" />
            <span className="text-forge-black">
              <span className="font-bold tabular-nums text-forge-orange-deep">{inr(t.locked_amount, { compact: true })}</span> waiting on balance from{" "}
              <span className="font-semibold">{t.locked_count} {t.locked_count === 1 ? "lead" : "leads"}</span>.
              Push them to claim.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, amount, count, tone, subtitle }: { icon: React.ReactNode; label: string; amount: number; count: number; tone: "amber" | "emerald" | "cleared"; subtitle: string }) {
  const colorMap: Record<string, { bg: string; text: string; ring: string }> = {
    amber:    { bg: "bg-forge-yellow-soft",   text: "text-forge-orange-deep", ring: "ring-forge-yellow" },
    emerald:  { bg: "bg-emerald-50",           text: "text-emerald-700",       ring: "ring-emerald-200" },
    cleared:  { bg: "bg-forge-cream",          text: "text-forge-black/70",    ring: "ring-fg-border" },
  };
  const c = colorMap[tone];
  return (
    <div className={`${c.bg} ring-1 ${c.ring} rounded-lg px-3 py-2.5 min-w-[130px]`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${c.text}`}>
        {icon}{label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${c.text}`}>{inr(amount, { compact: true })}</div>
      <div className="text-[10px] text-fg-muted">{fmtInt(count)} · {subtitle}</div>
    </div>
  );
}
