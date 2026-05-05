"use client";

// Reusable date range picker with rich preset list + custom date entry.
// Used on /queue and /leads. Displays as a chip that, when clicked, opens
// a popover with preset options + custom calendar inputs.

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { buildPresets, formatRange, type DateRange, ALL_TIME } from "@/lib/date-presets";

export default function DateRangePicker({
  value,
  onChange,
  align = "left",
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Pre-fill custom inputs from current value
  useEffect(() => {
    if (value.start) setCustomStart(toIsoDate(value.start));
    if (value.end)   setCustomEnd(toIsoDate(value.end));
  }, [value.start, value.end]);

  const presets = buildPresets();

  function pick(p: DateRange) {
    onChange(p);
    setOpen(false);
  }

  function applyCustom() {
    const start = customStart ? new Date(customStart + "T00:00:00") : null;
    const end   = customEnd   ? new Date(customEnd   + "T23:59:59") : null;
    if (!start && !end) { onChange(ALL_TIME); setOpen(false); return; }
    onChange({
      id: "custom",
      label: "Custom",
      start, end,
    });
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-fg-border bg-fg-card text-forge-black hover:bg-forge-yellow-pale hover:border-forge-yellow transition-colors"
      >
        <Calendar className="w-3.5 h-3.5 text-fg-muted" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Date</span>
        <span className="font-semibold">{formatRange(value)}</span>
        {value.id !== "all" && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onChange(ALL_TIME); }}
            className="ml-1 -mr-1 p-0.5 rounded hover:bg-fg-surface text-fg-muted hover:text-rose-600"
            title="Clear"
          >
            <X className="w-3 h-3" />
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`absolute top-full mt-1 z-30 surface-card p-3 w-[280px] ${align === "right" ? "right-0" : "left-0"}`}
        >
          <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold mb-1.5 px-1">Quick picks</div>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {presets.map(p => (
              <button
                key={p.id}
                onClick={() => pick(p)}
                className={`text-xs text-left px-2 py-1.5 rounded-md hover:bg-forge-yellow-pale transition-colors ${
                  value.id === p.id ? "bg-forge-yellow-soft text-forge-orange-deep font-semibold" : "text-forge-black"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="border-t border-fg-border/60 pt-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold mb-1.5 px-1">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                placeholder="Start"
                className="text-xs px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black"
              />
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                placeholder="End"
                className="text-xs px-2 py-1.5 border border-fg-border rounded-md bg-fg-card text-forge-black"
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setOpen(false)} className="text-xs text-fg-muted hover:text-forge-black px-2 py-1">Cancel</button>
              <button
                onClick={applyCustom}
                disabled={!customStart && !customEnd}
                className="btn-forge text-xs disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
