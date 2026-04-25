"use client";

import { Lock } from "lucide-react";

const TABS = [
  { id: "forge", label: "Forge", color: "text-forge", active: true, count: 4 },
  { id: "live", label: "Live", color: "text-live", active: false, count: 0 },
  { id: "masterclass", label: "Masterclass", color: "text-masterclass", active: false, count: 0 },
  { id: "b2b", label: "B2B", color: "text-b2b", active: false, count: 0 },
];

export default function FamilyTabs({ active = "forge" }: { active?: string }) {
  return (
    <nav className="flex gap-1 mb-6 border-b border-fg-border">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            t.id === active
              ? `border-forge ${t.color}`
              : `border-transparent text-fg-muted ${!t.active ? "opacity-50 cursor-not-allowed" : "hover:text-fg-text"}`
          }`}
          disabled={!t.active}
          title={!t.active ? "Phase 2 will populate this tab" : undefined}
        >
          {t.label}
          {!t.active && <Lock className="w-3 h-3" />}
          {t.active && t.count > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-fg-card text-fg-muted">{t.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
