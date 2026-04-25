"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";

const REPS: { name: string; programs: string[]; color: string }[] = [
  { name: "Pranaush", programs: ["FFM","FW"],     color: "border-rose-500/50 text-rose-400" },
  { name: "Sashank",  programs: ["FC","BFP"],     color: "border-lime-500/50 text-lime-400" },
  { name: "Wilson",   programs: ["VE","L3C"],     color: "border-blue-500/50 text-blue-400" },
];

const STAGES: { id: string; label: string; color: string }[] = [
  { id: "accepted",      label: "🔥 Rescue zone",        color: "border-amber-500/60 text-amber-400 bg-amber-500/10" },
  { id: "form_submitted",label: "Form submitted",        color: "border-cyan-500/40 text-cyan-400" },
  { id: "form_partial",  label: "Form partial",          color: "border-fg-border text-fg-muted" },
  { id: "confirmed",     label: "Confirmed",             color: "border-emerald-500/40 text-emerald-400" },
  { id: "balance_paid",  label: "Balance paid",          color: "border-emerald-500/60 text-emerald-300" },
];

const PROGRAMS = ["FFM", "FW", "FC", "FAI"];

export default function LeadsFilters({ stats }: { stats: any }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const toggleParam = (key: string, value: string) => {
    const cur = (params.get(key) || "").split(",").filter(Boolean);
    const set = new Set(cur);
    if (set.has(value)) set.delete(value); else set.add(value);
    setParam(key, set.size ? Array.from(set).join(",") : null);
  };

  const has = (key: string, value: string) =>
    (params.get(key) || "").split(",").filter(Boolean).includes(value);

  const repFilter = params.get("rep");

  return (
    <div className="space-y-4 mb-6">
      {/* Rep filter — primary */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-fg-muted uppercase tracking-wider mr-2">Rep view</span>
        <button
          onClick={() => setParam("rep", null)}
          className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            !repFilter ? "bg-fg-card border-fg-text text-fg-text" : "border-fg-border text-fg-muted hover:text-fg-text"
          }`}
        >
          All
        </button>
        {REPS.map(r => (
          <button
            key={r.name}
            onClick={() => setParam("rep", repFilter === r.name ? null : r.name)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              repFilter === r.name ? `bg-fg-card ${r.color} border-current` : "border-fg-border text-fg-muted hover:text-fg-text"
            }`}
          >
            {r.name} <span className="text-[10px] opacity-60">{r.programs.join("·")}</span>
          </button>
        ))}
      </div>

      {/* Funnel stage chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-fg-muted uppercase tracking-wider mr-2">Stage</span>
        {STAGES.map(s => {
          const active = has("stage", s.id);
          return (
            <button
              key={s.id}
              onClick={() => toggleParam("stage", s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                active ? `${s.color} border-current` : "border-fg-border text-fg-muted hover:text-fg-text"
              }`}
            >
              {s.label}
              {stats?.by_stage?.[s.id] !== undefined && (
                <span className="ml-1.5 opacity-60 tabular-nums">{stats.by_stage[s.id]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Program chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-fg-muted uppercase tracking-wider mr-2">Program</span>
        {PROGRAMS.map(p => {
          const active = has("program", p);
          return (
            <button
              key={p}
              onClick={() => toggleParam("program", p)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors tabular-nums ${
                active ? "bg-fg-card border-fg-text text-fg-text" : "border-fg-border text-fg-muted hover:text-fg-text"
              }`}
            >
              {p}
              {stats?.by_program?.[p] !== undefined && (
                <span className="ml-1.5 opacity-60">{stats.by_program[p]}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Score min slider */}
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span className="uppercase tracking-wider">Min score:</span>
        {[0, 25, 50, 75].map(min => (
          <button
            key={min}
            onClick={() => setParam("minScore", min ? String(min) : null)}
            className={`px-3 py-1 rounded text-xs border transition-colors ${
              params.get("minScore") === String(min) || (!params.get("minScore") && min === 0)
                ? "bg-fg-card border-fg-text text-fg-text"
                : "border-fg-border hover:text-fg-text"
            }`}
          >
            {min}+
          </button>
        ))}
      </div>
    </div>
  );
}
