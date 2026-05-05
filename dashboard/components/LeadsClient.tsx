"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LeadRow } from "@/lib/supabase";
import { inr } from "@/lib/format";
import {
  Phone, Mail, Search, X, ArrowUpDown, ArrowUp, ArrowDown,
  Flame, ChevronRight,
} from "lucide-react";

const PROGRAMS = ["FFM", "FW", "FC", "FAI", "BFP", "VE", "L3C"];
type Rep = { name: string; programs: string[] };

// Date filter presets — written as "last N hours / days"
const DATE_PRESETS: { id: string; label: string; hours: number | null }[] = [
  { id: "all",  label: "All time", hours: null },
  { id: "24h", label: "Last 24h", hours: 24 },
  { id: "7d",  label: "Last 7d",  hours: 24 * 7 },
  { id: "30d", label: "Last 30d", hours: 24 * 30 },
];

// Saved-view chips: pre-baked filter combos a rep would actually want
type SavedView = { id: string; label: string; description: string; predicate: (l: LeadRow) => boolean };
const SAVED_VIEWS: SavedView[] = [
  {
    id: "abandoned", label: "Abandoned (form done, no app fee)",
    description: "Filled the application but didn't pay the app fee — bucket A on /queue",
    predicate: (l) => l.funnel_stage === "form_submitted",
  },
  {
    id: "need_to_book", label: "Need to book interview",
    description: "Paid app fee but didn't book Calendly — bucket B on /queue",
    predicate: (l) => l.funnel_stage === "accepted",
  },
  {
    id: "hot_today", label: "Hot · last 24h",
    description: "Score 75+, activity in the last 24h",
    predicate: (l) => l.score >= 75 && hoursSince(l.last_activity) <= 24,
  },
  {
    id: "stale", label: "Stale · 7d+",
    description: "Form submitted, no activity in 7 days — re-engage",
    predicate: (l) => l.funnel_stage === "form_submitted" && hoursSince(l.last_activity) >= 24 * 7,
  },
];

const STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  form_partial:   { label: "Form partial",   cls: "bg-fg-surface text-fg-muted ring-1 ring-fg-border" },
  form_submitted: { label: "Form submitted", cls: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200" },
  app_fee_paid:   { label: "App fee paid",   cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200" },
  accepted:       { label: "App fee paid",   cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-200" },
  confirmed:      { label: "Confirmed",      cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" },
  balance_paid:   { label: "Paid in full",   cls: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 font-semibold" },
  lost:           { label: "Lost",           cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200" },
};

const PROGRAM_COLOR: Record<string, string> = {
  FFM: "text-yellow-700",
  FW:  "text-sky-600",
  FC:  "text-red-600",
  FAI: "text-indigo-700",
};

type SortKey = "score" | "last_activity" | "name" | "program" | "stage";

function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec/60)}m`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h`;
  if (sec < 7 * 86400) return `${Math.floor(sec/86400)}d`;
  if (sec < 30 * 86400) return `${Math.floor(sec/(7*86400))}w`;
  return `${Math.floor(sec/(30*86400))}mo`;
}

export default function LeadsClient({ initialLeads, reps = [] }: { initialLeads: LeadRow[]; reps?: Rep[] }) {
  const REPS = reps;
  const params = useSearchParams();

  // Filters — seeded from URL params (so founder-dashboard drill-downs land pre-filtered)
  const [rep, setRep] = useState<string | null>(null);
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [programs, setPrograms] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState(0);
  const [dateRange, setDateRange] = useState<string>("all");
  const [savedView, setSavedView] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const p = params.get("program");
    if (p) setPrograms(new Set(p.split(",").filter(Boolean)));
    const s = params.get("stage");
    if (s) setStages(new Set(s.split(",").filter(Boolean)));
    const r = params.get("rep");
    if (r && REPS.find(x => x.name === r)) setRep(r);
    const v = params.get("view");
    if (v && SAVED_VIEWS.find(x => x.id === v)) setSavedView(v);
    const ms = params.get("minScore");
    if (ms) { const n = parseInt(ms); if (!isNaN(n)) setMinScore(n); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let xs = [...initialLeads];

    if (rep) {
      const repPrograms = REPS.find(r => r.name === rep)?.programs || [];
      xs = xs.filter(l => l.program && repPrograms.includes(l.program));
    }
    if (stages.size)   xs = xs.filter(l => l.funnel_stage && stages.has(l.funnel_stage));
    if (programs.size) xs = xs.filter(l => l.program && programs.has(l.program));
    if (minScore > 0)  xs = xs.filter(l => l.score >= minScore);

    const hours = DATE_PRESETS.find(d => d.id === dateRange)?.hours;
    if (hours !== null && hours !== undefined) {
      xs = xs.filter(l => hoursSince(l.last_activity) <= hours);
    }

    if (savedView) {
      const view = SAVED_VIEWS.find(v => v.id === savedView);
      if (view) xs = xs.filter(view.predicate);
    }

    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter(l =>
        (l.name || "").toLowerCase().includes(q) ||
        (l.email || "").toLowerCase().includes(q) ||
        (l.phone || "").includes(q)
      );
    }

    xs.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score")              cmp = a.score - b.score;
      else if (sortKey === "last_activity") cmp = (a.last_activity || "").localeCompare(b.last_activity || "");
      else if (sortKey === "name")          cmp = (a.name || "").localeCompare(b.name || "");
      else if (sortKey === "program")       cmp = (a.program || "").localeCompare(b.program || "");
      else if (sortKey === "stage")         cmp = (a.funnel_stage || "").localeCompare(b.funnel_stage || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return xs;
  }, [initialLeads, rep, stages, programs, minScore, dateRange, savedView, search, sortKey, sortDir]);

  const stageCounts = useMemo(() => {
    const base = initialLeads.filter(l =>
      (!rep || (l.program && (REPS.find(r => r.name === rep)?.programs || []).includes(l.program))) &&
      (!programs.size || (l.program && programs.has(l.program))) &&
      l.score >= minScore
    );
    const c: Record<string, number> = {};
    for (const l of base) if (l.funnel_stage) c[l.funnel_stage] = (c[l.funnel_stage] || 0) + 1;
    return c;
  }, [initialLeads, rep, programs, minScore]);

  const programCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of initialLeads) if (l.program) c[l.program] = (c[l.program] || 0) + 1;
    return c;
  }, [initialLeads]);

  const toggleStage   = (s: string) => { const n = new Set(stages);   n.has(s) ? n.delete(s) : n.add(s); setStages(n); };
  const toggleProgram = (p: string) => { const n = new Set(programs); n.has(p) ? n.delete(p) : n.add(p); setPrograms(n); };
  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const clearAll = () => {
    setRep(null); setStages(new Set()); setPrograms(new Set());
    setMinScore(0); setDateRange("all"); setSavedView(null); setSearch("");
  };
  const anyFilterActive = !!(rep || stages.size || programs.size || minScore || dateRange !== "all" || savedView || search);

  return (
    <div>
      {/* Top bar — search, count, clear-all */}
      <div className="flex items-center gap-3 mb-4 sticky top-[60px] z-20 py-3 -mx-6 px-6 bg-white/85 backdrop-blur border-b border-fg-border">
        <div className="flex items-center gap-2 flex-1 max-w-md px-3 py-2 rounded-lg border border-fg-border bg-fg-surface focus-within:border-forge-yellow focus-within:bg-white transition-colors">
          <Search className="w-4 h-4 text-fg-subtle" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-fg-subtle"
          />
          {search && <button onClick={() => setSearch("")}><X className="w-4 h-4 text-fg-subtle hover:text-fg-text" /></button>}
        </div>
        <div className="text-xs px-3 py-2 rounded-lg bg-fg-surface text-fg-muted tabular-nums">
          <span className="text-fg-text font-semibold">{filtered.length.toLocaleString("en-IN")}</span>
          <span className="text-fg-subtle"> of </span>
          {initialLeads.length.toLocaleString("en-IN")}
        </div>
        {anyFilterActive && (
          <button onClick={clearAll} className="text-xs px-3 py-2 rounded-lg border border-fg-border text-fg-muted hover:text-fg-text hover:border-forge-yellow transition-colors">
            Clear all
          </button>
        )}
      </div>

      {/* Saved views — most useful for sales reps */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1">Quick views</span>
        {SAVED_VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setSavedView(savedView === v.id ? null : v.id)}
            title={v.description}
            className={`chip ${savedView === v.id ? "chip-active" : ""}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Filter rows */}
      <div className="space-y-2.5 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1 w-16">Rep</span>
          <button className={`chip ${!rep ? "chip-active" : ""}`} onClick={() => setRep(null)}>All</button>
          {REPS.map(r => (
            <button key={r.name} className={`chip ${rep === r.name ? "chip-active" : ""}`} onClick={() => setRep(rep === r.name ? null : r.name)}>
              {r.name}<span className="opacity-60 ml-1.5">{r.programs.join("·")}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1 w-16">Stage</span>
          {Object.entries(STAGE_LABEL).map(([s, meta]) => (
            <button key={s} className={`chip ${stages.has(s) ? "chip-active" : ""}`} onClick={() => toggleStage(s)}>
              {meta.label}
              {stageCounts[s] !== undefined && <span className="opacity-60 ml-1.5 tabular-nums">{stageCounts[s]}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-fg-muted mr-1 w-16">Program</span>
          {PROGRAMS.map(p => (
            <button key={p} className={`chip ${programs.has(p) ? "chip-active" : ""}`} onClick={() => toggleProgram(p)}>
              {p}<span className="opacity-60 ml-1 tabular-nums">{programCounts[p] || 0}</span>
            </button>
          ))}
          <span className="text-[11px] uppercase tracking-wider text-fg-muted ml-3 mr-1">Score</span>
          {[0, 25, 50, 75].map(s => (
            <button key={s} className={`chip ${minScore === s ? "chip-active" : ""}`} onClick={() => setMinScore(s)}>{s}+</button>
          ))}
          <span className="text-[11px] uppercase tracking-wider text-fg-muted ml-3 mr-1">Activity</span>
          {DATE_PRESETS.map(d => (
            <button key={d.id} className={`chip ${dateRange === d.id ? "chip-active" : ""}`} onClick={() => setDateRange(d.id)}>{d.label}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-fg-surface border-b border-fg-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="py-3 pl-4 pr-2 font-medium w-16"><SortHead k="score" curK={sortKey} dir={sortDir} onClick={sortBy}>Score</SortHead></th>
                <th className="py-3 px-2 font-medium"><SortHead k="name" curK={sortKey} dir={sortDir} onClick={sortBy}>Name</SortHead></th>
                <th className="py-3 px-2 font-medium">Phone</th>
                <th className="py-3 px-2 font-medium">Email</th>
                <th className="py-3 px-2 font-medium"><SortHead k="program" curK={sortKey} dir={sortDir} onClick={sortBy}>Program</SortHead></th>
                <th className="py-3 px-2 font-medium"><SortHead k="stage" curK={sortKey} dir={sortDir} onClick={sortBy}>Stage</SortHead></th>
                <th className="py-3 px-2 font-medium text-center">Pmts</th>
                <th className="py-3 px-2 font-medium">Last paid</th>
                <th className="py-3 px-2 font-medium"><SortHead k="last_activity" curK={sortKey} dir={sortDir} onClick={sortBy}>Activity</SortHead></th>
                <th className="py-3 px-2 font-medium">Actions</th>
                <th className="py-3 pr-4 pl-2 font-medium w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((l) => {
                const stage = STAGE_LABEL[l.funnel_stage || ""] || { label: l.funnel_stage || "—", cls: "bg-fg-surface text-fg-muted ring-1 ring-fg-border" };
                const isHot = l.score >= 75 || l.funnel_stage === "accepted";
                return (
                  <tr key={l.id} className={`border-b border-fg-border/70 row-hover ${isHot ? "bg-amber-50/40" : ""}`}>
                    <td className="py-3 pl-4 pr-2"><ScoreBadge score={l.score} /></td>
                    <td className="py-3 px-2">
                      <Link href={`/leads/${l.id}`} className="font-medium truncate max-w-[180px] inline-block text-fg-text hover:text-amber-700 hover:underline">
                        {l.name || <span className="text-fg-subtle italic">—</span>}
                      </Link>
                    </td>
                    <td className="py-3 px-2 tabular-nums whitespace-nowrap">
                      {l.phone ? (
                        <a href={`tel:${l.phone}`} className="hover:underline text-fg-text/85">+{l.phone}</a>
                      ) : <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="py-3 px-2 max-w-[220px] truncate">
                      {l.email ? (
                        <a href={`mailto:${l.email}`} className="hover:underline truncate inline-block max-w-full text-fg-text/85">{l.email}</a>
                      ) : <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="py-3 px-2">
                      <span className={`text-xs font-semibold ${PROGRAM_COLOR[l.program || ""] || "text-fg-subtle"}`}>{l.program || "—"}</span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`text-[11px] px-2 py-1 rounded ${stage.cls}`}>{stage.label}</span>
                    </td>
                    <td className={`py-3 px-2 text-center tabular-nums ${(l.captured_payment_count || 0) > 0 ? "text-fg-text" : "text-fg-subtle"}`}>
                      {l.captured_payment_count || 0}
                    </td>
                    <td className="py-3 px-2 tabular-nums whitespace-nowrap">
                      {l.last_payment_amount ? (
                        <span className="text-emerald-700 font-medium">{inr(l.last_payment_amount, { compact: true })}</span>
                      ) : <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="py-3 px-2 tabular-nums whitespace-nowrap text-fg-muted">{timeAgo(l.last_activity)}</td>
                    <td className="py-3 px-2">
                      <div className="flex gap-1">
                        {l.phone && <a href={`tel:${l.phone}`} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700" title="Call"><Phone className="w-4 h-4" /></a>}
                        {l.phone && <a href={`https://wa.me/${l.phone}`} target="_blank" rel="noopener" className="p-1.5 rounded hover:bg-green-100 text-green-700" title="WhatsApp"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488"/></svg></a>}
                        {l.email && <a href={`mailto:${l.email}`} className="p-1.5 rounded hover:bg-cyan-100 text-cyan-700" title="Email"><Mail className="w-4 h-4" /></a>}
                      </div>
                    </td>
                    <td className="py-3 pr-4 pl-2">
                      <Link href={`/leads/${l.id}`} className="text-fg-subtle hover:text-fg-text" title="Open lead detail">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-xs bg-fg-surface text-fg-muted border-t border-fg-border">
          Showing {Math.min(filtered.length, 200).toLocaleString("en-IN")} of {filtered.length.toLocaleString("en-IN")} matching leads · client-side filtering, instant.
          {filtered.length > 200 && " Apply more filters to narrow."}
        </div>
      </div>
    </div>
  );
}

function SortHead({ children, k, curK, dir, onClick }: any) {
  const active = k === curK;
  return (
    <button onClick={() => onClick(k)} className="flex items-center gap-1 hover:text-fg-text transition-colors">
      {children}
      {active ? (dir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let cls;
  if (score >= 75)      cls = "bg-amber-500 text-white shadow-sm shadow-amber-500/30";
  else if (score >= 50) cls = "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300";
  else if (score >= 25) cls = "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200";
  else                  cls = "bg-fg-surface text-fg-subtle ring-1 ring-fg-border";
  return (
    <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg font-bold text-base tabular-nums ${cls}`}>
      {score}
    </div>
  );
}
