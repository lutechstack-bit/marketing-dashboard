// Earnings header shown at the top of /queue. Shows the logged-in rep their own
// "money in escrow" — the locked-but-can't-claim-yet psychological trigger.
//
// Server component (reads earnings server-side, instant render).

import { Lock, Unlock, CheckCheck, Sparkles } from "lucide-react";
import { inr, fmtInt } from "@/lib/format";
import { getEarningsTotals, type EarningTotals } from "@/lib/earnings";

export default async function EarningsHeader({ repId, repName }: { repId: string; repName: string }) {
  // Current month
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

  // No earnings yet — show a friendlier prompt
  if (total === 0) {
    return (
      <div className="surface-card p-4 border-l-4 border-l-amber-400 bg-gradient-to-br from-amber-50/40 via-white to-yellow-50/30 mb-5">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-fg-text">{repName} · {periodLabel}</div>
            <div className="text-xs text-fg-muted">No conversions yet this month — every lead in your queue has the potential payout shown on the right. Get them to balance payment to unlock.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-card p-5 mb-5 bg-gradient-to-br from-amber-50/30 via-white to-emerald-50/20 border-t-4 border-t-amber-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted font-semibold">{repName} · {periodLabel}</div>
          <div className="text-3xl font-bold tabular-nums text-fg-text mt-0.5">{inr(total, { compact: true })} earned</div>
          <div className="text-xs text-fg-muted mt-0.5">{t.locked_count + t.unlocked_count + t.approved_count + t.paid_out_count} conversions this month</div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Tile icon={<Lock className="w-4 h-4" />} label="Locked" amount={t.locked_amount} count={t.locked_count} accent="amber" subtitle="push to balance" />
          <Tile icon={<Unlock className="w-4 h-4" />} label="Unlocked" amount={t.unlocked_amount} count={t.unlocked_count} accent="emerald" subtitle="pending approval" />
          <Tile icon={<CheckCheck className="w-4 h-4" />} label="Paid out" amount={t.paid_out_amount} count={t.paid_out_count} accent="cyan" subtitle="cleared" />
        </div>
      </div>
      {t.locked_amount > 0 && (
        <div className="mt-4 pt-3 border-t border-amber-200/60 flex items-center gap-2 text-sm">
          <Lock className="w-4 h-4 text-amber-600" />
          <span className="text-fg-text">
            <span className="font-bold tabular-nums text-amber-700">{inr(t.locked_amount, { compact: true })}</span> waiting on balance payment from{" "}
            <span className="font-semibold">{t.locked_count} {t.locked_count === 1 ? "lead" : "leads"}</span>.
            Push them to claim.
          </span>
        </div>
      )}
    </div>
  );
}

function Tile({ icon, label, amount, count, accent, subtitle }: { icon: React.ReactNode; label: string; amount: number; count: number; accent: "amber" | "emerald" | "cyan"; subtitle: string }) {
  const colorMap: Record<string, { bg: string; text: string; ring: string }> = {
    amber:   { bg: "bg-amber-100/60",   text: "text-amber-800",   ring: "ring-amber-200" },
    emerald: { bg: "bg-emerald-100/60", text: "text-emerald-800", ring: "ring-emerald-200" },
    cyan:    { bg: "bg-cyan-100/60",    text: "text-cyan-800",    ring: "ring-cyan-200" },
  };
  const c = colorMap[accent];
  return (
    <div className={`${c.bg} ring-1 ${c.ring} rounded-lg px-3 py-2 min-w-[120px]`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${c.text}`}>
        {icon}{label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${c.text}`}>{inr(amount, { compact: true })}</div>
      <div className="text-[10px] text-fg-muted">{fmtInt(count)} · {subtitle}</div>
    </div>
  );
}
