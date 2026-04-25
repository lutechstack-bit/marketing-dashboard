"use client";

import { Lock } from "lucide-react";

const TABS = [
  { id: "forge",       label: "Forge",       color: "border-amber-500 text-amber-700",  active: true,  count: 4 },
  { id: "live",        label: "Live",        color: "border-blue-500 text-blue-700",    active: false, count: 0 },
  { id: "masterclass", label: "Masterclass", color: "border-purple-500 text-purple-700",active: false, count: 0 },
  { id: "b2b",         label: "B2B",         color: "border-emerald-500 text-emerald-700",active: false, count: 0 },
];

export default function FamilyTabs({ active = "forge" }: { active?: string }) {
  return (
    <nav className="flex gap-1 mb-6 border-b border-fg-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 -mb-px ${
            t.id === active
              ? t.color
              : `border-transparent text-fg-muted ${!t.active ? "opacity-50 cursor-not-allowed" : "hover:text-fg-text"}`
          }`}
          disabled={!t.active}
          title={!t.active ? "Phase 2 will populate this tab" : undefined}
        >
          {t.label}
          {!t.active && <Lock className="w-3 h-3" />}
          {t.active && t.count > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-fg-surface text-fg-muted font-normal">{t.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
