"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2, Check } from "lucide-react";

// Optional columns that the rep can toggle on/off. Always-on columns
// (#, Score, Name, Status, Actions) are NOT in this list.
export type ColumnId =
  | "phone"
  | "email"
  | "submitted"
  | "why_hot"
  | "source"
  | "last_activity"
  | "incentive";

export const COLUMN_DEFS: { id: ColumnId; label: string; defaultOn: boolean; help?: string }[] = [
  { id: "phone",         label: "Phone",         defaultOn: true,  help: "Click-to-call number" },
  { id: "email",         label: "Email",         defaultOn: false, help: "Lead's email address (off by default — too wide for queue scanning)" },
  { id: "submitted",     label: "Submitted",     defaultOn: true,  help: "When the form was submitted" },
  { id: "why_hot",       label: "Why hot",       defaultOn: true,  help: "Rule-based one-liner — full AI brief on the lead detail page" },
  { id: "source",        label: "Source",        defaultOn: false, help: "Campaign name and UTM source" },
  { id: "last_activity", label: "Last activity", defaultOn: false, help: "Most recent touchpoint timestamp" },
  { id: "incentive",     label: "Incentive ₹",   defaultOn: true,  help: "Conversion payout for this lead (placeholder amounts)" },
];

const STORAGE_KEY = "levelup-queue-columns";

export function defaultVisible(): Set<ColumnId> {
  return new Set(COLUMN_DEFS.filter(c => c.defaultOn).map(c => c.id));
}

export function loadVisible(): Set<ColumnId> {
  if (typeof window === "undefined") return defaultVisible();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultVisible();
    const arr = JSON.parse(raw) as ColumnId[];
    if (!Array.isArray(arr)) return defaultVisible();
    // Filter out any unknown keys (in case definitions changed)
    const valid = new Set(COLUMN_DEFS.map(c => c.id));
    return new Set(arr.filter(x => valid.has(x as ColumnId)));
  } catch { return defaultVisible(); }
}

export function persistVisible(set: Set<ColumnId>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
}

export default function ColumnSettings({ visible, onChange }: {
  visible: Set<ColumnId>;
  onChange: (next: Set<ColumnId>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggle = (id: ColumnId) => {
    const next = new Set(visible);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
    persistVisible(next);
  };

  const reset = () => {
    const d = defaultVisible();
    onChange(d);
    persistVisible(d);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        title="Choose which columns to show"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-muted hover:text-fg-text border border-fg-border rounded-md bg-white hover:bg-fg-surface transition-colors"
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span>Columns</span>
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-72 surface-card py-2">
          <div className="px-3 py-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-fg-muted">
            <span>Show columns</span>
            <button onClick={reset} className="text-amber-700 hover:text-amber-800 normal-case font-medium">Reset</button>
          </div>
          {COLUMN_DEFS.map(c => {
            const on = visible.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="w-full text-left px-3 py-2 text-sm flex items-start gap-2.5 hover:bg-fg-surface"
                title={c.help}
              >
                <span className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded border ${on ? "bg-emerald-500 border-emerald-500" : "border-fg-border bg-white"}`}>
                  {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className="flex-1 min-w-0">
                  <div className="text-fg-text font-medium">{c.label}</div>
                  {c.help && <div className="text-[11px] text-fg-muted leading-tight">{c.help}</div>}
                </span>
              </button>
            );
          })}
          <div className="px-3 pt-1 mt-1 border-t border-fg-border text-[10px] text-fg-subtle">
            Settings persist for this browser only · per device
          </div>
        </div>
      )}
    </div>
  );
}
