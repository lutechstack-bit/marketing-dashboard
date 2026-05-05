"use client";

// Schedule a follow-up callback. Used on the lead detail page next to the
// outcome buttons. One-click presets (in 1h / tomorrow 10am / next week) +
// custom date-time picker.

import { useState } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";

const PRESETS = [
  { id: "1h",   label: "in 1 hour",       offset: () => { const t = new Date(); t.setHours(t.getHours() + 1, 0, 0, 0); return t; } },
  { id: "4h",   label: "in 4 hours",      offset: () => { const t = new Date(); t.setHours(t.getHours() + 4, 0, 0, 0); return t; } },
  { id: "tom",  label: "tomorrow 10am",   offset: () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0); return t; } },
  { id: "tom6", label: "tomorrow 6pm",    offset: () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(18, 0, 0, 0); return t; } },
  { id: "wk",   label: "next week",       offset: () => { const t = new Date(); t.setDate(t.getDate() + 7); t.setHours(10, 0, 0, 0); return t; } },
];

export default function ScheduleCallback({ leadId, onScheduled }: { leadId: string; onScheduled?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("10:00");
  const [notes, setNotes] = useState("");

  async function schedule(at: Date) {
    setBusy(true);
    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          due_at: at.toISOString(),
          type: "callback",
          notes: notes.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error || "Failed to schedule");
        return;
      }
      setOpen(false);
      setNotes("");
      onScheduled?.();
    } finally { setBusy(false); }
  }

  function scheduleCustom() {
    if (!customDate) { alert("pick a date"); return; }
    const at = new Date(`${customDate}T${customTime || "10:00"}:00`);
    if (isNaN(at.getTime())) { alert("invalid date/time"); return; }
    schedule(at);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-forge-yellow-soft text-forge-orange-deep bg-forge-yellow-pale hover:bg-forge-yellow-soft transition-colors"
      >
        <CalendarClock className="w-4 h-4" />Schedule callback
      </button>
    );
  }

  return (
    <div className="surface-card p-4 mt-2 w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-forge-black inline-flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-forge-orange-deep" />Schedule a callback
        </h3>
        <button onClick={() => setOpen(false)} className="text-fg-muted hover:text-forge-black">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => schedule(p.offset())}
            disabled={busy}
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-fg-border text-forge-black bg-fg-card hover:bg-forge-yellow-pale hover:border-forge-yellow disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
          className="text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-fg-text" />
        <input type="time" value={customTime} onChange={e => setCustomTime(e.target.value)}
          className="text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-fg-text" />
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Optional note — what's the follow-up about?"
        className="w-full text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-fg-text resize-none min-h-[48px]"
      />
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs text-fg-muted hover:text-forge-black">Cancel</button>
        <button
          onClick={scheduleCustom}
          disabled={busy || !customDate}
          className="btn-forge text-xs"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <CalendarClock className="w-3.5 h-3.5"/>}
          Schedule at custom time
        </button>
      </div>
    </div>
  );
}
