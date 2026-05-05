import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { getEarningsTotals, type EarningTotals } from "@/lib/earnings";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { Trophy, Lock, Unlock, CheckCheck, Wallet } from "lucide-react";
import { inr, fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const period = params.period || "month"; // month | quarter | all

  // Compute period boundaries
  const now = new Date();
  let from: Date | undefined;
  let label = "";
  if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    label = now.toLocaleString("en-IN", { month: "long", year: "numeric" });
  } else if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), q * 3, 1);
    label = `Q${q + 1} ${now.getFullYear()}`;
  } else {
    label = "All time";
  }

  // Fetch totals + reps
  const [totals, repsRes, currentRep] = await Promise.all([
    getEarningsTotals({ from }),
    supabase.from("sales_reps").select("id,full_name,email,role,active").eq("active", true),
    getCurrentRep(),
  ]);

  const reps = (repsRes.data || []) as { id: string; full_name: string | null; email: string; role: string; active: boolean }[];
  const repsById: Record<string, typeof reps[number]> = Object.fromEntries(reps.map(r => [r.id, r]));

  // Combine: every rep gets a row, even with zero earnings
  type Row = EarningTotals & { name: string; email: string; role: string; total: number };
  const rows: Row[] = [];
  for (const r of reps) {
    const t = totals.find(x => x.rep_id === r.id) || {
      rep_id: r.id,
      locked_count: 0, locked_amount: 0,
      unlocked_count: 0, unlocked_amount: 0,
      approved_count: 0, approved_amount: 0,
      paid_out_count: 0, paid_out_amount: 0,
      reverted_count: 0, reverted_amount: 0,
    };
    rows.push({
      ...t,
      name: r.full_name || r.email.split("@")[0],
      email: r.email,
      role: r.role,
      total: t.locked_amount + t.unlocked_amount + t.approved_amount + t.paid_out_amount,
    });
  }
  rows.sort((a, b) => b.total - a.total);

  const teamTotal = rows.reduce((s, r) => s + r.total, 0);
  const teamLocked = rows.reduce((s, r) => s + r.locked_amount, 0);
  const teamUnlocked = rows.reduce((s, r) => s + r.unlocked_amount, 0);
  const teamPaidOut = rows.reduce((s, r) => s + r.paid_out_amount, 0);

  return (
    <>
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-fg-text inline-flex items-center gap-2">
              <Trophy className="w-7 h-7 text-amber-500" />
              Leaderboard
            </h1>
            <p className="text-sm text-fg-muted mt-1">{label} · all incentive earnings (locked + unlocked + paid out)</p>
          </div>
          <div className="inline-flex bg-fg-surface border border-fg-border rounded-lg p-0.5 text-xs">
            {["month", "quarter", "all"].map(p => (
              <a key={p} href={`?period=${p}`} className={`px-3 py-1.5 rounded-md font-medium ${period === p ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}>
                {p === "month" ? "This month" : p === "quarter" ? "This quarter" : "All time"}
              </a>
            ))}
          </div>
        </div>

        {/* Team summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <SummaryTile icon={<Lock className="w-4 h-4" />} label="Team locked" amount={teamLocked} accent="amber" />
          <SummaryTile icon={<Unlock className="w-4 h-4" />} label="Team unlocked" amount={teamUnlocked} accent="emerald" />
          <SummaryTile icon={<CheckCheck className="w-4 h-4" />} label="Team paid out" amount={teamPaidOut} accent="cyan" />
          <SummaryTile icon={<Wallet className="w-4 h-4" />} label="Team total earned" amount={teamTotal} accent="indigo" big />
        </div>

        {/* Table */}
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-fg-surface border-b border-fg-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="py-3 pl-4 pr-2 font-medium w-12">Rank</th>
                <th className="py-3 px-2 font-medium">Rep</th>
                <th className="py-3 px-2 font-medium text-right">🔒 Locked</th>
                <th className="py-3 px-2 font-medium text-right">✅ Unlocked</th>
                <th className="py-3 px-2 font-medium text-right">💵 Paid out</th>
                <th className="py-3 px-2 font-medium text-right">Conversions</th>
                <th className="py-3 pr-4 pl-2 font-medium text-right">Total earned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isMe = currentRep?.id === r.rep_id;
                const totalConv = r.locked_count + r.unlocked_count + r.approved_count + r.paid_out_count;
                return (
                  <tr key={r.rep_id} className={`border-b border-fg-border/70 row-hover ${isMe ? "bg-amber-50/40" : ""}`}>
                    <td className="py-3 pl-4 pr-2">
                      <div className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${
                        i === 0 ? "bg-amber-500 text-white" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-900" : "bg-fg-surface text-fg-muted"
                      }`}>
                        {i + 1}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-semibold text-fg-text">{r.name}{isMe && <span className="ml-2 text-[10px] font-bold text-amber-700">YOU</span>}</div>
                      <div className="text-xs text-fg-muted">{r.role}</div>
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      <div className="font-semibold text-amber-700">{inr(r.locked_amount, { compact: true })}</div>
                      <div className="text-[10px] text-fg-subtle">{r.locked_count} pending balance</div>
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      <div className="font-semibold text-emerald-700">{inr(r.unlocked_amount, { compact: true })}</div>
                      <div className="text-[10px] text-fg-subtle">{r.unlocked_count} ready</div>
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums">
                      <div className="font-semibold text-fg-text">{inr(r.paid_out_amount, { compact: true })}</div>
                      <div className="text-[10px] text-fg-subtle">{r.paid_out_count} cleared</div>
                    </td>
                    <td className="py-3 px-2 text-right tabular-nums text-fg-text/85">{fmtInt(totalConv)}</td>
                    <td className="py-3 pr-4 pl-2 text-right">
                      <div className="font-bold text-base text-fg-text tabular-nums">{inr(r.total, { compact: true })}</div>
                      <ProgressBar value={r.total} max={Math.max(...rows.map(x => x.total), 1)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="p-12 text-center text-sm text-fg-muted">
              No active reps yet. Add one in <a href="/admin/team" className="text-amber-700 underline">Admin → Team</a>.
            </div>
          )}
        </div>

        <p className="text-xs text-fg-subtle mt-4 text-center">
          Earnings auto-update from Razorpay events. Locked = slot confirmation paid · Unlocked = balance paid · Paid out = admin-approved cash transferred.
        </p>
      </main>
    </>
  );
}

function SummaryTile({ icon, label, amount, accent, big }: { icon: React.ReactNode; label: string; amount: number; accent: "amber" | "emerald" | "cyan" | "indigo"; big?: boolean }) {
  const accentMap: Record<string, string> = {
    amber: "from-amber-50 to-white border-amber-200",
    emerald: "from-emerald-50 to-white border-emerald-200",
    cyan: "from-cyan-50 to-white border-cyan-200",
    indigo: "from-indigo-50 to-white border-indigo-200",
  };
  const iconColor: Record<string, string> = {
    amber: "text-amber-600", emerald: "text-emerald-600", cyan: "text-cyan-600", indigo: "text-indigo-600",
  };
  return (
    <div className={`relative rounded-xl border bg-gradient-to-br ${accentMap[accent]} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">{label}</span>
        <span className={iconColor[accent]}>{icon}</span>
      </div>
      <div className={`${big ? "text-3xl" : "text-2xl"} font-bold tabular-nums text-fg-text`}>{inr(amount, { compact: true })}</div>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round(100 * value / max)) : 0;
  return (
    <div className="h-1 w-full bg-fg-surface rounded-full mt-1.5 overflow-hidden">
      <div style={{ width: `${pct}%` }} className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full" />
    </div>
  );
}
