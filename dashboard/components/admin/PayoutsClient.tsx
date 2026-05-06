"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Lock, Unlock, CheckCheck, RotateCcw, ChevronRight, AlertCircle, Loader2, UserPlus, Search, X } from "lucide-react";
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

type RepAssignment = {
  rep_id: string;
  product_code: string;
  edition_match: string | null;
  edition_label: string | null;
  incentive_inr: number;
};

export default function PayoutsClient({ earnings, repsById, leadsById, reps = [], assignments = [] }: {
  earnings: Earning[];
  repsById: Record<string, Rep>;
  leadsById: Record<string, Lead>;
  reps?: Rep[];
  assignments?: RepAssignment[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unlocked" | "approved" | "locked" | "paid_out" | "reverted">("unlocked");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // earning id being acted on, or 'batch'
  const [attribOpen, setAttribOpen] = useState(false);

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
        <button onClick={() => setAttribOpen(true)} className="btn-forge">
          <UserPlus className="w-4 h-4" />
          Manually attribute earning
        </button>
      </div>

      {attribOpen && (
        <ManualAttributeModal
          reps={reps}
          assignments={assignments}
          onClose={() => setAttribOpen(false)}
          onCreated={() => { setAttribOpen(false); router.refresh(); }}
        />
      )}

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

// ---------------------------------------------------------------- Manual Attribute / Update Modal
const STAGES: { id: string; label: string; bucket: string }[] = [
  { id: "form_partial",   label: "Partial — started form, didn't finish",         bucket: "Partials"          },
  { id: "form_submitted", label: "Abandoned — filled form, didn't pay app fee",   bucket: "Abandoned"         },
  { id: "app_fee_paid",   label: "App fee paid — interview not done yet",         bucket: "Need to book"      },
  { id: "accepted",       label: "Interview done & accepted",                     bucket: "(past queue)"      },
  { id: "confirmed",      label: "Confirmed slot",                                bucket: "(past queue)"      },
  { id: "balance_paid",   label: "Balance paid — full convert",                   bucket: "(past queue)"      },
  { id: "lost",           label: "Lost — won't convert",                          bucket: "(past queue)"      },
];

function ManualAttributeModal({ reps, assignments, onClose, onCreated }: {
  reps: Rep[];
  assignments: RepAssignment[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const [setStage, setSetStage] = useState<string>("app_fee_paid");
  const [doStageUpdate, setDoStageUpdate] = useState(true);

  const [doIncentive, setDoIncentive] = useState(true);
  const [selectedRep, setSelectedRep] = useState<string>("");
  const [editionLabel, setEditionLabel] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-side lead search (debounced 250ms). Top 20 hits across the full
  // 41k+ leads table — not the client-loaded slice.
  useEffect(() => {
    if (!search.trim() || search.trim().length < 2 || selectedLead) {
      setSearchResults([]); return;
    }
    setSearching(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/admin/lead-search?q=${encodeURIComponent(search.trim())}`, { signal: ctl.signal })
        .then(r => r.json())
        .then(j => { setSearchResults(j.leads || []); })
        .catch(() => { /* aborted or error */ })
        .finally(() => setSearching(false));
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [search, selectedLead]);

  const eligibleReps = useMemo(() => {
    if (!selectedLead?.program) return reps;
    const repIds = new Set(assignments.filter(a => a.product_code === selectedLead.program).map(a => a.rep_id));
    const matched = reps.filter(r => repIds.has(r.id));
    return matched.length > 0 ? matched : reps;
  }, [reps, assignments, selectedLead]);

  const matchingAssignments = useMemo(() => {
    if (!selectedLead?.program || !selectedRep) return [];
    return assignments.filter(a => a.rep_id === selectedRep && a.product_code === selectedLead.program);
  }, [assignments, selectedRep, selectedLead]);

  useEffect(() => {
    if (matchingAssignments.length >= 1) {
      setAmount(String(matchingAssignments[0].incentive_inr));
      setEditionLabel(matchingAssignments[0].edition_label || "");
    } else {
      setAmount(""); setEditionLabel("");
    }
  }, [matchingAssignments]);

  // Pre-fill stage with current lead's stage when picking
  useEffect(() => {
    if (selectedLead?.funnel_stage && STAGES.some(s => s.id === selectedLead.funnel_stage)) {
      setSetStage(selectedLead.funnel_stage);
    }
  }, [selectedLead]);

  async function submit() {
    setError(null);
    if (!selectedLead) { setError("Pick a lead first."); return; }
    if (!doStageUpdate && !doIncentive) {
      setError("Pick at least one action: change stage and/or attribute incentive.");
      return;
    }
    const body: any = { action: "update_lead", lead_id: selectedLead.id, notes: notes.trim() || null };
    if (doStageUpdate) body.set_stage = setStage;
    if (doIncentive) {
      if (!selectedRep)  { setError("Pick a rep for the incentive."); return; }
      if (!selectedLead.program) { setError("Lead has no program — can't attribute incentive."); return; }
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a valid incentive amount."); return; }
      body.rep_id = selectedRep;
      body.product_code = selectedLead.program;
      body.edition_label = editionLabel || null;
      body.amount_inr = amt;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/earnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      onCreated();
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="surface-card max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl font-extrabold italic text-forge-black inline-flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-forge-orange-deep not-italic" />
            Manually attribute earning
          </h2>
          <button onClick={onClose} className="text-fg-muted hover:text-forge-black"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-fg-muted mb-4">
          Use this to back-fill old conversions or attribute organic conversions to a rep. Creates a{" "}
          <code className="text-[10px] px-1 py-0.5 bg-forge-yellow-soft text-forge-orange-deep rounded">locked</code>{" "}
          earning that follows the same lifecycle as auto-locks (unlocks on balance fee, approvable for payout).
        </p>

        {/* Step 1: lead — server-side search across the whole 41k+ leads table */}
        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-1.5 font-semibold">1. Pick any lead</label>
          {selectedLead ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-forge-yellow-soft bg-forge-yellow-pale">
              <div className="min-w-0">
                <div className="font-semibold text-forge-black truncate">{selectedLead.name || selectedLead.email || "—"}</div>
                <div className="text-xs text-fg-muted truncate">
                  {selectedLead.email || "no email"} · {selectedLead.phone || "no phone"} ·{" "}
                  <span className="font-semibold text-forge-orange-deep">{selectedLead.program || "no program"}</span>{" "}
                  · currently <span className="italic">{selectedLead.funnel_stage || "—"}</span>
                </div>
              </div>
              <button onClick={() => { setSelectedLead(null); setSelectedRep(""); setSearch(""); }} className="text-xs text-forge-orange-deep hover:text-forge-orange shrink-0">change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-muted" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, email, or phone (any lead in DB)…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-fg-border rounded-md bg-fg-card text-forge-black focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20"
                  autoFocus
                />
                {searching && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-muted animate-spin" />
                )}
              </div>
              {searchResults.length > 0 && (
                <div className="mt-1 border border-fg-border rounded-md bg-fg-card max-h-[260px] overflow-y-auto">
                  {searchResults.map(l => (
                    <button
                      key={l.id}
                      onClick={() => { setSelectedLead(l); setSearch(""); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-forge-yellow-pale border-b border-fg-border/60 last:border-b-0"
                    >
                      <div className="font-semibold text-forge-black truncate">{l.name || l.email || l.phone || "—"}</div>
                      <div className="text-[11px] text-fg-muted truncate">
                        {l.email || "no email"} · {l.phone || "no phone"} · {l.program || "no program"}
                        {l.funnel_stage && <span className="ml-1 text-fg-subtle">· {l.funnel_stage}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {search.trim().length >= 2 && !searching && searchResults.length === 0 && (
                <div className="mt-1 text-xs text-fg-muted px-2 py-1">No leads match.</div>
              )}
              {search.trim().length > 0 && search.trim().length < 2 && (
                <div className="mt-1 text-xs text-fg-subtle px-2 py-1">Type 2+ characters…</div>
              )}
            </>
          )}
        </div>

        {/* Step 2: change stage (optional) */}
        <div className="mb-4 surface-card p-3 bg-forge-yellow-pale/40">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={doStageUpdate}
              onChange={e => setDoStageUpdate(e.target.checked)}
              disabled={!selectedLead}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-forge-black">2. Change lead status</div>
              <div className="text-[11px] text-fg-muted mb-2">Move the lead to any funnel stage. Bypasses webhook auto-promotion.</div>
              <select
                value={setStage}
                onChange={e => setSetStage(e.target.value)}
                disabled={!selectedLead || !doStageUpdate}
                className="w-full text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black disabled:opacity-50"
              >
                {STAGES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label} — {s.bucket}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </div>

        {/* Step 3: attribute incentive (optional) */}
        <div className="mb-4 surface-card p-3 bg-forge-yellow-pale/40">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={doIncentive}
              onChange={e => setDoIncentive(e.target.checked)}
              disabled={!selectedLead}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-forge-black">3. Attribute incentive to a rep</div>
              <div className="text-[11px] text-fg-muted mb-2">Creates a locked earning the rep can unlock when balance is paid.</div>
              {doIncentive && (
                <div className="space-y-2">
                  <select
                    value={selectedRep}
                    onChange={e => setSelectedRep(e.target.value)}
                    disabled={!selectedLead}
                    className="w-full text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black disabled:opacity-50"
                  >
                    <option value="">{selectedLead ? "— pick a rep —" : "Pick a lead first"}</option>
                    {eligibleReps.map(r => {
                      const assignedToProgram = selectedLead?.program
                        ? assignments.some(a => a.rep_id === r.id && a.product_code === selectedLead.program)
                        : false;
                      return (
                        <option key={r.id} value={r.id}>
                          {r.full_name || r.email}{assignedToProgram ? " ✓" : " (not assigned to this program)"}
                        </option>
                      );
                    })}
                  </select>

                  {matchingAssignments.length > 1 && (
                    <select
                      value={editionLabel}
                      onChange={e => {
                        const m = matchingAssignments.find(a => (a.edition_label || "") === e.target.value);
                        setEditionLabel(e.target.value);
                        if (m) setAmount(String(m.incentive_inr));
                      }}
                      className="w-full text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black"
                    >
                      {matchingAssignments.map(a => (
                        <option key={a.edition_label || "default"} value={a.edition_label || ""}>
                          Edition: {a.edition_label || "Default"} — ₹{a.incentive_inr.toLocaleString("en-IN")}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Incentive ₹"
                    className="w-full text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black"
                  />
                  {matchingAssignments.length === 0 && selectedRep && selectedLead?.program && (
                    <p className="text-[11px] text-rose-700">
                      ⚠ This rep isn't assigned to {selectedLead.program} — no preset incentive, enter manually.
                    </p>
                  )}
                </div>
              )}
            </div>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-fg-muted mb-1.5 font-semibold">Notes (optional, audited)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. 'Sashank converted from abandoned. Razorpay webhook missed this payment.'"
            rows={2}
            className="w-full text-sm px-3 py-2 border border-fg-border rounded-md bg-fg-card text-forge-black resize-none"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-fg-border text-fg-muted hover:bg-fg-surface">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || !selectedLead || (!doStageUpdate && !doIncentive)}
            className="btn-forge disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Apply changes
          </button>
        </div>
      </div>
    </div>
  );
}
