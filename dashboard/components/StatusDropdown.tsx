"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { STATUSES, STATUS_BY_ID, STATUS_TONE_CLS, type StatusId, actionToStatus } from "@/lib/statuses";

type Props = {
  leadId: string;
  /** Current status — pulled from lead.last_action (or "new" if no activity yet) */
  initialStatus?: string | null;
  /** Default rep on submit. Persisted to localStorage by the dropdown after first use. */
  repName?: string;
  /** Compact mode: smaller chip for table rows. */
  compact?: boolean;
  /** Called after successful save with the new status id. */
  onSaved?: (newStatus: StatusId) => void;
};

export default function StatusDropdown({ leadId, initialStatus, repName, compact, onSaved }: Props) {
  const initial = actionToStatus(initialStatus);
  const [current, setCurrent] = useState<StatusId>(initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function pick(id: StatusId) {
    if (id === current) { setOpen(false); return; }
    setOpen(false);
    setSaving(true);
    setError(null);
    const prev = current;
    setCurrent(id); // optimistic
    try {
      const rep = repName || (typeof window !== "undefined" ? localStorage.getItem("levelup-current-rep") : null) || "Sales Team";
      const r = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, rep_name: rep, action: id }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error || "Save failed");
      onSaved?.(id);
    } catch (e: any) {
      setCurrent(prev); // revert
      setError(e?.message || "Save failed");
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  const def = STATUS_BY_ID[current] || STATUSES[0];
  const toneCls = STATUS_TONE_CLS[def.tone];
  const sizeCls = compact ? "text-[11px] py-1 px-2" : "text-xs py-1.5 px-2.5";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        disabled={saving}
        title={error || `Current status: ${def.label}`}
        className={`inline-flex items-center gap-1 rounded-md font-medium ${toneCls} ${sizeCls} ${saving ? "opacity-60" : "hover:brightness-95"} ${error ? "ring-2 ring-rose-400" : ""}`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        <span className="truncate max-w-[150px]">{def.label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-56 surface-card py-1 max-h-80 overflow-y-auto">
          {STATUSES.map(s => (
            <button
              key={s.id}
              onClick={() => pick(s.id)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-fg-surface ${current === s.id ? "bg-fg-surface" : ""}`}
            >
              <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded ${STATUS_TONE_CLS[s.tone]}`}>{s.label}</span>
              {current === s.id && <Check className="w-3 h-3 text-emerald-600 ml-2 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
