"use client";

import { useState, useMemo, useEffect } from "react";
import { LeadRow } from "@/lib/supabase";
import { inr } from "@/lib/format";
import {
  Phone, Mail, Search, Flame, Sun, Moon, ArrowUpDown,
  ArrowUp, ArrowDown, Filter, X, ExternalLink, Sparkles,
  IndianRupee, FileText
} from "lucide-react";

const PROGRAMS = ["FFM", "FW", "FC", "FAI"];
const REPS = [
  { name: "Pranaush", programs: ["FFM","FW"]   },
  { name: "Sashank",  programs: ["FC","BFP"]   },
  { name: "Wilson",   programs: ["VE","L3C"]   },
];

const STAGE_LABEL: Record<string, { label: string; bg: string; text: string }> = {
  form_partial:   { label: "Form partial",   bg: "bg-zinc-200 dark:bg-zinc-800",       text: "text-zinc-700 dark:text-zinc-400" },
  form_submitted: { label: "Form submitted", bg: "bg-cyan-100 dark:bg-cyan-900/30",    text: "text-cyan-700 dark:text-cyan-400" },
  accepted:       { label: "🔥 Rescue",      bg: "bg-amber-100 dark:bg-amber-900/30",  text: "text-amber-800 dark:text-amber-400" },
  confirmed:      { label: "Confirmed",      bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" },
  balance_paid:   { label: "Paid in full",   bg: "bg-emerald-200 dark:bg-emerald-800/30", text: "text-emerald-800 dark:text-emerald-300" },
  lost:           { label: "Lost",           bg: "bg-rose-100 dark:bg-rose-900/30",    text: "text-rose-700 dark:text-rose-400" },
};

const PROGRAM_COLOR: Record<string, string> = {
  FFM: "text-rose-600 dark:text-rose-400",
  FW:  "text-cyan-600 dark:text-cyan-400",
  FC:  "text-lime-600 dark:text-lime-400",
  FAI: "text-amber-600 dark:text-amber-400",
};

type SortKey = "score" | "last_activity" | "name" | "program" | "stage";

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec/60)}m`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h`;
  if (sec < 7 * 86400) return `${Math.floor(sec/86400)}d`;
  if (sec < 30 * 86400) return `${Math.floor(sec/(7*86400))}w`;
  return `${Math.floor(sec/(30*86400))}mo`;
}

export default function LeadsClient({ initialLeads }: { initialLeads: LeadRow[] }) {
  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem("levelup-theme");
    if (saved === "light") setTheme("light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("levelup-theme", theme);
  }, [theme]);

  // Filters
  const [rep, setRep] = useState<string | null>(null);
  const [stages, setStages] = useState<Set<string>>(new Set());
  const [programs, setPrograms] = useState<Set<string>>(new Set());
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Filtered data — recomputed on every state change, all client-side, INSTANT
  const filtered = useMemo(() => {
    let xs = [...initialLeads];

    if (rep) {
      const repPrograms = REPS.find(r => r.name === rep)?.programs || [];
      xs = xs.filter(l => l.program && repPrograms.includes(l.program));
    }
    if (stages.size) xs = xs.filter(l => l.funnel_stage && stages.has(l.funnel_stage));
    if (programs.size) xs = xs.filter(l => l.program && programs.has(l.program));
    if (minScore > 0) xs = xs.filter(l => l.score >= minScore);
    if (search) {
      const q = search.toLowerCase();
      xs = xs.filter(l =>
        (l.name || "").toLowerCase().includes(q) ||
        (l.email || "").toLowerCase().includes(q) ||
        (l.phone || "").includes(q)
      );
    }

    // Sort
    xs.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") cmp = a.score - b.score;
      else if (sortKey === "last_activity") cmp = (a.last_activity || "").localeCompare(b.last_activity || "");
      else if (sortKey === "name") cmp = (a.name || "").localeCompare(b.name || "");
      else if (sortKey === "program") cmp = (a.program || "").localeCompare(b.program || "");
      else if (sortKey === "stage") cmp = (a.funnel_stage || "").localeCompare(b.funnel_stage || "");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return xs;
  }, [initialLeads, rep, stages, programs, minScore, search, sortKey, sortDir]);

  // Stage counts (derived from filtered set sans stage filter, so user sees what's available)
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

  const toggleStage = (s: string) => {
    const next = new Set(stages);
    next.has(s) ? next.delete(s) : next.add(s);
    setStages(next);
  };
  const toggleProgram = (p: string) => {
    const next = new Set(programs);
    next.has(p) ? next.delete(p) : next.add(p);
    setPrograms(next);
  };
  const sortBy = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };

  const isLight = theme === "light";

  return (
    <div className={isLight ? "bg-white text-zinc-900" : "bg-fg-bg text-fg-text"}>
      <style jsx global>{`
        html.light, html.light body { background: #fff; color: #18181B; }
      `}</style>

      {/* Top bar — search + theme toggle + result count */}
      <div className="flex items-center gap-3 mb-4 sticky top-[68px] z-10 py-3 -mx-6 px-6 backdrop-blur"
           style={{background: isLight ? "rgba(255,255,255,0.85)" : "rgba(10,10,11,0.85)"}}>
        <div className={`flex items-center gap-2 flex-1 px-3 py-2 rounded-lg border ${isLight ? "border-zinc-200 bg-zinc-50" : "border-fg-border bg-fg-card"}`}>
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {search && <button onClick={() => setSearch("")}><X className="w-4 h-4 text-zinc-400 hover:text-zinc-600" /></button>}
        </div>
        <div className={`text-xs px-3 py-2 rounded-lg ${isLight ? "bg-zinc-100 text-zinc-600" : "bg-fg-card text-fg-muted"}`}>
          {filtered.length.toLocaleString("en-IN")} of {initialLeads.length.toLocaleString("en-IN")} leads
        </div>
        <button
          onClick={() => setTheme(isLight ? "dark" : "light")}
          className={`p-2 rounded-lg border ${isLight ? "border-zinc-200 hover:bg-zinc-50" : "border-fg-border hover:bg-fg-card"}`}
          title={isLight ? "Switch to dark" : "Switch to light"}
        >
          {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </div>

      {/* Filter rows */}
      <div className="space-y-3 mb-4">
        {/* Rep filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] uppercase tracking-wider mr-2 ${isLight ? "text-zinc-500" : "text-fg-muted"}`}>Rep</span>
          <ChipBtn isLight={isLight} active={!rep} onClick={() => setRep(null)}>All</ChipBtn>
          {REPS.map(r => (
            <ChipBtn key={r.name} isLight={isLight} active={rep === r.name} onClick={() => setRep(rep === r.name ? null : r.name)}>
              {r.name}
              <span className="opacity-60 ml-1.5">{r.programs.join("·")}</span>
            </ChipBtn>
          ))}
        </div>
        {/* Stage filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] uppercase tracking-wider mr-2 ${isLight ? "text-zinc-500" : "text-fg-muted"}`}>Stage</span>
          {Object.entries(STAGE_LABEL).map(([s, meta]) => (
            <ChipBtn key={s} isLight={isLight} active={stages.has(s)} onClick={() => toggleStage(s)}>
              {meta.label}
              {stageCounts[s] !== undefined && <span className="opacity-60 ml-1.5 tabular-nums">{stageCounts[s]}</span>}
            </ChipBtn>
          ))}
        </div>
        {/* Program + min score */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-[11px] uppercase tracking-wider mr-2 ${isLight ? "text-zinc-500" : "text-fg-muted"}`}>Program</span>
          {PROGRAMS.map(p => (
            <ChipBtn key={p} isLight={isLight} active={programs.has(p)} onClick={() => toggleProgram(p)}>
              {p} <span className="opacity-60 ml-1 tabular-nums">{programCounts[p] || 0}</span>
            </ChipBtn>
          ))}
          <span className={`text-[11px] uppercase tracking-wider ml-3 mr-2 ${isLight ? "text-zinc-500" : "text-fg-muted"}`}>Min score</span>
          {[0, 25, 50, 75].map(s => (
            <ChipBtn key={s} isLight={isLight} active={minScore === s} onClick={() => setMinScore(s)}>{s}+</ChipBtn>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-xl border overflow-hidden ${isLight ? "border-zinc-200 bg-white" : "border-fg-border bg-fg-card/30"}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={`sticky top-0 ${isLight ? "bg-zinc-50 border-b border-zinc-200" : "bg-fg-card border-b border-fg-border"}`}>
              <tr className={`text-left text-[11px] uppercase tracking-wider ${isLight ? "text-zinc-600" : "text-fg-muted"}`}>
                <th className="py-3 pl-4 pr-2 font-medium w-16"><SortHead k="score" curK={sortKey} dir={sortDir} onClick={sortBy}>Score</SortHead></th>
                <th className="py-3 px-2 font-medium"><SortHead k="name" curK={sortKey} dir={sortDir} onClick={sortBy}>Name</SortHead></th>
                <th className="py-3 px-2 font-medium">Phone</th>
                <th className="py-3 px-2 font-medium">Email</th>
                <th className="py-3 px-2 font-medium"><SortHead k="program" curK={sortKey} dir={sortDir} onClick={sortBy}>Program</SortHead></th>
                <th className="py-3 px-2 font-medium"><SortHead k="stage" curK={sortKey} dir={sortDir} onClick={sortBy}>Stage</SortHead></th>
                <th className="py-3 px-2 font-medium">Pmts</th>
                <th className="py-3 px-2 font-medium">Last paid</th>
                <th className="py-3 px-2 font-medium"><SortHead k="last_activity" curK={sortKey} dir={sortDir} onClick={sortBy}>Activity</SortHead></th>
                <th className="py-3 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((l) => {
                const stage = STAGE_LABEL[l.funnel_stage || ""] || { label: l.funnel_stage || "—", bg: "bg-zinc-200", text: "text-zinc-700" };
                const isHot = l.score >= 75 || l.funnel_stage === "accepted";
                return (
                  <tr key={l.id}
                      className={`border-b ${isLight ? "border-zinc-100 hover:bg-amber-50/40" : "border-fg-border/40 hover:bg-fg-card/60"} ${isHot ? (isLight ? "bg-amber-50/30" : "bg-amber-500/[0.04]") : ""}`}>
                    <td className="py-3 pl-4 pr-2"><ScoreBadge score={l.score} isLight={isLight} /></td>
                    <td className="py-3 px-2">
                      <div className="font-medium truncate max-w-[180px]">{l.name || <span className={isLight ? "text-zinc-400 italic" : "text-fg-muted italic"}>—</span>}</div>
                    </td>
                    <td className="py-3 px-2 tabular-nums whitespace-nowrap">
                      {l.phone ? (
                        <a href={`tel:${l.phone}`} className={`hover:underline ${isLight ? "text-zinc-700" : "text-fg-text/90"}`}>+{l.phone}</a>
                      ) : <span className={isLight ? "text-zinc-400" : "text-fg-muted"}>—</span>}
                    </td>
                    <td className="py-3 px-2 max-w-[220px] truncate">
                      {l.email ? (
                        <a href={`mailto:${l.email}`} className={`hover:underline truncate inline-block max-w-full ${isLight ? "text-zinc-700" : "text-fg-text/90"}`}>{l.email}</a>
                      ) : <span className={isLight ? "text-zinc-400" : "text-fg-muted"}>—</span>}
                    </td>
                    <td className="py-3 px-2">
                      <span className={`text-xs font-semibold ${PROGRAM_COLOR[l.program || ""] || (isLight ? "text-zinc-500" : "text-fg-muted")}`}>{l.program || "—"}</span>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`text-[11px] font-medium px-2 py-1 rounded ${stage.bg} ${stage.text}`}>{stage.label}</span>
                    </td>
                    <td className={`py-3 px-2 text-center tabular-nums ${(l.captured_payment_count || 0) > 0 ? "" : isLight ? "text-zinc-400" : "text-fg-muted"}`}>
                      {l.captured_payment_count || 0}
                    </td>
                    <td className="py-3 px-2 tabular-nums whitespace-nowrap">
                      {l.last_payment_amount ? (
                        <span className={isLight ? "text-emerald-700" : "text-emerald-400"}>{inr(l.last_payment_amount, { compact: true })}</span>
                      ) : <span className={isLight ? "text-zinc-400" : "text-fg-muted"}>—</span>}
                    </td>
                    <td className={`py-3 px-2 tabular-nums whitespace-nowrap ${isLight ? "text-zinc-600" : "text-fg-muted"}`}>{timeAgo(l.last_activity)}</td>
                    <td className="py-3 px-2">
                      <div className="flex gap-1">
                        {l.phone && <a href={`tel:${l.phone}`} className={`p-1.5 rounded ${isLight ? "hover:bg-emerald-100 text-emerald-700" : "hover:bg-emerald-500/20 text-emerald-400"}`} title="Call"><Phone className="w-4 h-4" /></a>}
                        {l.phone && <a href={`https://wa.me/${l.phone}`} target="_blank" rel="noopener" className={`p-1.5 rounded ${isLight ? "hover:bg-green-100 text-green-700" : "hover:bg-green-500/20 text-green-400"}`} title="WhatsApp"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.464 3.488"/></svg></a>}
                        {l.email && <a href={`mailto:${l.email}`} className={`p-1.5 rounded ${isLight ? "hover:bg-cyan-100 text-cyan-700" : "hover:bg-cyan-500/20 text-cyan-400"}`} title="Email"><Mail className="w-4 h-4" /></a>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`px-4 py-2.5 text-xs ${isLight ? "bg-zinc-50 text-zinc-600 border-t border-zinc-200" : "bg-fg-card/50 text-fg-muted border-t border-fg-border"}`}>
          Showing {Math.min(filtered.length, 200)} of {filtered.length} matching leads. Filters apply instantly · all client-side.
          {filtered.length > 200 && " Apply more filters to narrow."}
        </div>
      </div>
    </div>
  );
}

function ChipBtn({ children, active, isLight, onClick }: any) {
  const activeClass = isLight
    ? "bg-zinc-900 text-white border-zinc-900"
    : "bg-fg-text text-fg-bg border-fg-text";
  const idleClass = isLight
    ? "bg-white text-zinc-700 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50"
    : "bg-fg-card text-fg-muted border-fg-border hover:text-fg-text hover:border-fg-muted";
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${active ? activeClass : idleClass}`}>
      {children}
    </button>
  );
}

function SortHead({ children, k, curK, dir, onClick }: any) {
  const active = k === curK;
  return (
    <button onClick={() => onClick(k)} className="flex items-center gap-1 hover:text-amber-500 transition-colors">
      {children}
      {active ? (dir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  );
}

function ScoreBadge({ score, isLight }: { score: number; isLight: boolean }) {
  let cls;
  if (score >= 75) cls = isLight ? "bg-amber-500 text-white shadow-sm shadow-amber-500/30" : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40";
  else if (score >= 50) cls = isLight ? "bg-emerald-500 text-white" : "bg-emerald-500/15 text-emerald-300";
  else if (score >= 25) cls = isLight ? "bg-cyan-100 text-cyan-700" : "bg-cyan-500/10 text-cyan-300";
  else cls = isLight ? "bg-zinc-100 text-zinc-500" : "bg-fg-border text-fg-muted";
  return (
    <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg font-bold text-base tabular-nums ${cls}`}>
      {score}
    </div>
  );
}
