"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Youtube, AlertCircle, X } from "lucide-react";
import { inr, fmtDate } from "@/lib/format";
import { PRODUCTS } from "@/lib/products";

type SpendRow = {
  id: string;
  channel: string;
  source_name: string | null;
  date: string;
  amount_inr: number;
  program: string | null;
  utm_tag: string | null;
  notes: string | null;
  created_at: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  youtube_collab: "YouTube collab",
  influencer: "Influencer",
  agency: "Agency",
  newsletter: "Newsletter",
  event: "Event",
  other: "Other",
};

export default function ManualSpendForm() {
  const [rows, setRows] = useState<SpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [setupMissing, setSetupMissing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [channel, setChannel]       = useState("youtube_collab");
  const [sourceName, setSourceName] = useState("");
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount]         = useState("");
  const [program, setProgram]       = useState("");
  const [notes, setNotes]           = useState("");

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/spend");
      const j = await r.json();
      if (!r.ok) {
        if (j.setup) { setSetupMissing(true); setError(j.setup); }
        else throw new Error(j.error || "Failed to load");
      } else {
        setRows(j.spend || []);
      }
    } catch (e: any) {
      setError(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    if (!date || !amount) { setError("Date and amount required"); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel, source_name: sourceName || null, date,
          amount_inr: parseFloat(amount),
          program: program || null,
          notes: notes || null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Save failed");
      setSourceName(""); setAmount(""); setProgram(""); setNotes("");
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this spend entry?")) return;
    try {
      const r = await fetch(`/api/spend?id=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
      await load();
    } catch (e: any) { alert(e?.message); }
  }

  // Setup gate
  if (setupMissing) {
    return (
      <div className="surface-card p-5 border-l-4 border-l-amber-400 bg-amber-50/40">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-semibold text-fg-text">One-time setup needed</h3>
        </div>
        <p className="text-xs text-fg-muted mb-3">
          The <code>manual_marketing_spend</code> table doesn&apos;t exist in your Supabase yet. To enable YouTube / influencer / agency spend tracking:
        </p>
        <ol className="text-xs text-fg-text space-y-1.5 list-decimal pl-5 mb-3">
          <li>Open <a href="https://supabase.com/dashboard" target="_blank" rel="noopener" className="text-amber-700 underline">Supabase Dashboard</a></li>
          <li>Pick your project → SQL Editor → New query</li>
          <li>Paste the block below → Run</li>
          <li>Refresh this page</li>
        </ol>
        <pre className="text-[10px] bg-white border border-amber-200 rounded p-3 overflow-x-auto leading-relaxed">{`CREATE TABLE IF NOT EXISTS manual_marketing_spend (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       TEXT NOT NULL DEFAULT 'youtube_collab',
  source_name   TEXT,
  date          DATE NOT NULL,
  amount_inr    NUMERIC NOT NULL,
  program       TEXT,
  utm_tag       TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manual_spend_date ON manual_marketing_spend(date DESC);
CREATE INDEX IF NOT EXISTS idx_manual_spend_program ON manual_marketing_spend(program);`}</pre>
      </div>
    );
  }

  const total = rows.reduce((s, r) => s + Number(r.amount_inr || 0), 0);

  return (
    <div className="surface-card p-5">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg-text inline-flex items-center gap-2">
            <Youtube className="w-4 h-4 text-rose-600" />
            Manual marketing spend
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">{rows.length} entries · total {inr(total, { compact: true })}</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-fg-text text-white hover:bg-slate-700">
          {showForm ? <X className="w-3.5 h-3.5"/> : <Plus className="w-3.5 h-3.5"/>}
          {showForm ? "Cancel" : "Add spend"}
        </button>
      </div>

      {error && !setupMissing && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mb-3">{error}</div>
      )}

      {showForm && (
        <div className="border border-fg-border rounded-lg p-4 mb-4 bg-fg-surface">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <Field label="Channel">
              <select value={channel} onChange={e => setChannel(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white">
                {Object.entries(CHANNEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Date *">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white" />
            </Field>
            <Field label="Amount ₹ *">
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white" placeholder="25000" />
            </Field>
            <Field label="Source / creator name">
              <input type="text" value={sourceName} onChange={e => setSourceName(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white" placeholder="e.g. Tanmay Bhat" />
            </Field>
            <Field label="Program (optional)">
              <select value={program} onChange={e => setProgram(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white">
                <option value="">All / mixed</option>
                {PRODUCTS.map(p => <option key={p.code} value={p.code}>{p.longName}</option>)}
              </select>
            </Field>
            <Field label="Notes (optional)">
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className="w-full text-sm px-2 py-1.5 border border-fg-border rounded bg-white" placeholder="Video URL, contract notes..." />
            </Field>
          </div>
          <div className="flex justify-end">
            <button onClick={submit} disabled={submitting || !date || !amount}
              className="px-4 py-2 text-sm font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
              {submitting ? "Saving…" : "Save spend"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-fg-muted py-4 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-fg-subtle italic py-4 text-center">No spend entries yet — add your first YouTube collab above.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-fg-surface border-b border-fg-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="py-2 px-3 font-medium">Date</th>
                <th className="py-2 px-3 font-medium">Channel</th>
                <th className="py-2 px-3 font-medium">Source</th>
                <th className="py-2 px-3 font-medium">Program</th>
                <th className="py-2 px-3 font-medium text-right">Amount</th>
                <th className="py-2 px-3 font-medium">Notes</th>
                <th className="py-2 px-3 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-fg-border/70 row-hover">
                  <td className="py-2 px-3 whitespace-nowrap text-fg-text">{fmtDate(r.date)}</td>
                  <td className="py-2 px-3 text-xs text-fg-muted">{CHANNEL_LABELS[r.channel] || r.channel}</td>
                  <td className="py-2 px-3 font-medium text-fg-text">{r.source_name || <span className="text-fg-subtle italic">—</span>}</td>
                  <td className="py-2 px-3 text-xs text-fg-muted">{r.program || "all"}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-emerald-700">{inr(r.amount_inr)}</td>
                  <td className="py-2 px-3 text-xs text-fg-muted truncate max-w-[200px]">{r.notes || ""}</td>
                  <td className="py-2 px-3">
                    <button onClick={() => remove(r.id)} className="p-1 rounded text-fg-subtle hover:text-rose-600 hover:bg-rose-50" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-fg-subtle mt-3">
        These entries roll into the marketing efficiency totals once integrated. Tip: set the program field if you can attribute the collab to a specific Forge product, otherwise leave as &quot;all&quot;.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-fg-muted uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}
