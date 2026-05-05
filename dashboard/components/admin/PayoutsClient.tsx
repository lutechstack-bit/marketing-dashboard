"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Lock, Unlock, CheckCheck, RotateCcw, ChevronRight, AlertCircle, Loader2 } from "lucide-react";
import { inr, fmtDate } from "@/lib/format";

type Earning = {
  id: string;
  lead_id: string | null;
  rep_id: string | null;
  product_code: string | null;
  edition_label: string | null;
  amount_inr: number;
  status: "locked" | "unlocked" | "approved" | "paid_out" | "reverted";
  locked_at: string | null;
  unlocked_at: string | null;
  approved_at: string | null;
  paid_out_at: string | null;
  reverted_at: string | null;
  reverted_reason: string | null;
};

type Lead = { id: string; name: string | null; email: string | null; phone: string | null; program: string | null; funnel_stage: string | null };
type Rep = { id: string; full_name: string | null; email: string; role: string };

const STATUS_META: Record<Earning["status"], { label: string; cls: string; icon: React.ReactNode }> = {
  locked:    { label: "🔒 Locked",      cls: "bg-forge-yellow-soft text-forge-orange-deep ring-forge-yellow",  icon: <Lock className="w-3.5 h-3.5" /> },
  unlocked:  { label: "✅ Unlocked",    cls: "bg-emerald-50 text-emerald-800 ring-emerald-200",                icon: <Unlock className="w-3.5 h-3.5" /> },
  approved:  { label: "✓ Approved",     cls: "bg-cyan-50 text-cyan-800 ring-cyan-200",                          icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  paid_out:  { label: "💵 Paid out",    cls: "bg-forge-cream text-forge-black/70 ring-fg-border",               icon: <CheckCheck className="w-3.5 h-3.5" /> },
  reverted:  { label: "❌ Reverted",    cls: "bg-rose-50 text-rose-700 ring-rose-200",                          icon: <RotateCcw className="w-3.5 h-3.5" /> },
};

export default function PayoutsClient({ earnings, repsById, leadsById }: {
  earnings: Earning[];
  repsById: Record<string, Rep>;
  leadsById: Record<string, Lead>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unlocked" | "approved" | "locked" | "paid_out" | "reverted">("unlocked");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // earning id being acted on, or 'batch'

  const filtered = useMemo(() => {
    if (filter === "all") return earnings;
    return earnings.filter(e => e.status === filter);
  }, [earnings, filter]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(filtered.filter(e => e.status === "unlocked" || e.status === "approved").map(e => e.id)));
  const clearSelection = () => setSelected(new Set());

  async function actOne(action: string, earning_id: string) {
    setBusy(earning_id);
    try {
      const r = await fetch("/api/admin/earnings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, earning_id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Action failed");
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally { setBusy(null); }
  }

  async function actBatch(action: string) {
    if (selected.size === 0) return;
    if (!confirm(`${action === "approve_batch" ? "Approve" : "Mark paid out"} ${selected.size} earnings?`)) return;
    setBusy("batch");
    try {
      const r = await fetch("/api/admin/earnings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, earning_ids: Array.from(selected) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Batch failed");
      setSelected(new Set());
      router.refresh();
    } catch (e: any) {
      alert(e.message);
    } finally { setBusy(null); }
  }

  // Counts for filter chips
  const counts = {
    all: earnings.length,
    locked: earnings.filter(e => e.status === "locked").length,
    unlocked: earnings.filter(e => e.status === "unlocked").length,
    approved: earnings.filter(e => e.status === "approved").length,
    paid_out: earnings.filter(e => e.status === "paid_out").length,
    reverted: earnings.filter(e => e.status === "reverted").length,
  };

  // Selectable totals
  const selectedAmount = filtered.filter(e => selected.has(e.id)).reduce((s, e) => s + Number(e.amount_inr || 0), 0);
  const selectedReps = new Set(filtered.filter(e => selected.has(e.id)).map(e => e.rep_id));

  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="font-display text-4xl font-extrabold italic tracking-tight text-forge-black inline-flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-forge-orange-deep not-italic" />
            <span>Payout <span className="brand-underline">approvals</span></span>
          </h1>
          <p className="text-sm text-fg-muted mt-2">Per-lead approval. Batch buttons enabled when rows are selected.</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterChip label="Unlocked"  count={counts.unlocked} active={filter === "unlocked"} onClick={() => { setFilter("unlocked"); clearSelection(); }} />
        <FilterChip label="Approved"  count={counts.approved} active={filter === "approved"} onClick={() => { setFilter("approved"); clearSelection(); }} />
        <FilterChip label="Locked"    count={counts.locked}   active={filter === "locked"}   onClick={() => { setFilter("locked");   clearSelection(); }} />
        <FilterChip label="Paid out (90d)"  count={counts.paid_out} active={filter === "paid_out"} onClick={() => { setFilter("paid_out"); clearSelection(); }} />
        <FilterChip label="Reverted (90d)"  count={counts.reverted} active={filter === "reverted"} onClick={() => { setFilter("reverted"); clearSelection(); }} />
        <FilterChip label="All"       count={counts.all}      active={filter === "all"}      onClick={() => { setFilter("all");      clearSelection(); }} />
      </div>

      {/* Batch toolbar — appears when rows selected */}
      {selected.size > 0 && (
        <div className="surface-card p-3 mb-3 bg-forge-radial border-l-4 border-l-forge-yellow flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-forge-black">
            <span className="font-semibold">{selected.size}</span> selected · <span className="font-display italic font-bold tabular-nums text-forge-orange-deep">{inr(selectedAmount, { compact: true })}</span> across {selectedReps.size} {selectedReps.size === 1 ? "rep" : "reps"}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={clearSelection} className="text-xs text-fg-muted hover:text-forge-black px-2 py-1">Clear</button>
            <button
              onClick={() => actBatch("approve_batch")}
              disabled={busy === "batch"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {busy === "batch" ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <ShieldCheck className="w-3.5 h-3.5"/>}
              Approve all
            </button>
            <button
              onClick={() => actBatch("mark_paid_out_batch")}
              disabled={busy === "batch"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-forge-yellow text-forge-black hover:bg-forge-orange shadow-soft disabled:opacity-50"
            >
              {busy === "batch" ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <CheckCheck className="w-3.5 h-3.5"/>}
              Mark all paid out
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-fg-surface border-b border-fg-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="py-3 pl-4 pr-2 w-10">
                {(filter === "unlocked" || filter === "approved") && (
                  <input type="checkbox" onChange={e => e.target.checked ? selectAll() : clearSelection()} className="rounded" />
                )}
              </th>
              <th className="py-3 px-2 font-medium">Status</th>
              <th className="py-3 px-2 font-medium">Lead</th>
              <th className="py-3 px-2 font-medium">Rep</th>
              <th className="py-3 px-2 font-medium">Product</th>
              <th className="py-3 px-2 font-medium text-right">Amount</th>
              <th className="py-3 px-2 font-medium">Locked at</th>
              <th className="py-3 px-2 font-medium">Unlocked at</th>
              <th className="py-3 pr-4 pl-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-sm text-fg-muted">No earnings in this filter.</td></tr>
            ) : filtered.map(e => {
              const lead = e.lead_id ? leadsById[e.lead_id] : null;
              const rep = e.rep_id ? repsById[e.rep_id] : null;
              const meta = STATUS_META[e.status];
              const selectable = e.status === "unlocked" || e.status === "approved";
              return (
                <tr key={e.id} className="border-b border-fg-border/70 row-hover">
                  <td className="py-3 pl-4 pr-2">
                    {selectable && (
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} className="rounded" />
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded ring-1 ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="py-3 px-2 max-w-[200px]">
                    {lead ? (
                      <Link href={`/leads/${lead.id}`} className="text-forge-black hover:text-forge-orange-deep hover:underline truncate block font-medium">{lead.name || lead.email || "—"}</Link>
                    ) : <span className="text-fg-subtle italic">lead not found</span>}
                  </td>
                  <td className="py-3 px-2 text-fg-text/85">{rep?.full_name || rep?.email || <span className="text-fg-subtle italic">unknown rep</span>}</td>
                  <td className="py-3 px-2">
                    <span className="text-xs font-semibold">{e.product_code}</span>
                    {e.edition_label && <span className="text-[10px] text-fg-muted ml-1">· {e.edition_label}</span>}
                  </td>
                  <td className="py-3 px-2 text-right font-bold tabular-nums text-forge-orange-deep">{inr(e.amount_inr)}</td>
                  <td className="py-3 px-2 text-xs text-fg-muted whitespace-nowrap">{e.locked_at ? fmtDate(e.locked_at) : "—"}</td>
                  <td className="py-3 px-2 text-xs text-fg-muted whitespace-nowrap">{e.unlocked_at ? fmtDate(e.unlocked_at) : "—"}</td>
                  <td className="py-3 pr-4 pl-2">
                    {e.status === "unlocked" && (
                      <button
                        onClick={() => actOne("approve", e.id)}
                        disabled={busy === e.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        {busy === e.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <ShieldCheck className="w-3 h-3"/>}
                        Approve
                      </button>
                    )}
                    {e.status === "approved" && (
                      <button
                        onClick={() => actOne("mark_paid_out", e.id)}
                        disabled={busy === e.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy === e.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <CheckCheck className="w-3 h-3"/>}
                        Mark paid
                      </button>
                    )}
                    {e.status === "reverted" && e.reverted_reason && (
                      <span className="text-[10px] text-rose-700" title={e.reverted_reason}>{e.reverted_reason.slice(0, 30)}…</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`chip ${active ? "chip-active" : ""}`}>
      {label}<span className="ml-1.5 opacity-70 tabular-nums">{count}</span>
    </button>
  );
}
