"use client";

// In-dashboard CSV importer for the leads table.
// Steps:
//   1. Pick a file (drag-drop or click)
//   2. Parse client-side with papaparse, show row + column counts + preview
//   3. Map CSV columns → lead fields (auto-suggested from common header names,
//      manual override for everything)
//   4. (Optional) set defaults for program / status / source
//   5. Run: POST 250-row batches to /api/maintenance/import-telecrm with live
//      progress bar, ETA, and rolling tallies
//   6. Show final summary with errors

import { useMemo, useRef, useState } from "react";
import Papa, { type ParseResult } from "papaparse";
import {
  Upload, FileSpreadsheet, Sparkles, ArrowRight, Check, Loader2,
  AlertCircle, RefreshCw, Trash2, Pause, Play,
} from "lucide-react";

// --------------------------------------------------------------- types

type Mapping = {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  program?: string;
  status?: string;
  lost_reason?: string;
  reason?: string;
  scholarship?: string;
  age?: string;
  job_role?: string;
  designation?: string;
  city?: string;
  form_source?: string;
  interview?: string;
  interview_date?: string;
  interviewer?: string;
  grant?: string;
  grant_amount?: string;
  created_at?: string;
  last_activity?: string;
  passthrough?: string[];
};

type Defaults = { program?: string; status?: string; source?: string };

type FieldDef = {
  key: keyof Mapping;
  label: string;
  hints: string[];
  required?: boolean;
  group: "core" | "stage" | "scoring" | "context" | "dates";
};

const FIELDS: FieldDef[] = [
  // Core identity (need program + at least one of email/phone)
  { key: "email", label: "Email", hints: ["email", "e-mail", "mail"], required: true, group: "core" },
  { key: "phone", label: "Phone", hints: ["phone", "mobile", "whatsapp", "contact"], required: true, group: "core" },
  { key: "first_name", label: "First name", hints: ["first name", "firstname", "given"], group: "core" },
  { key: "last_name",  label: "Last name",  hints: ["last name", "lastname", "surname", "family"], group: "core" },
  { key: "full_name",  label: "Full name (single col)", hints: ["full name", "name"], group: "core" },
  { key: "program",    label: "Program / Product", hints: ["program", "product", "course"], required: true, group: "core" },

  // Stage
  { key: "status", label: "Status", hints: ["status", "stage", "funnel"], group: "stage" },
  { key: "lost_reason", label: "Lost reason", hints: ["lost reason", "lost"], group: "stage" },

  // MQL scoring inputs
  { key: "reason", label: "Why-essay (Reason)", hints: ["reason", "why", "essay", "story", "tell us"], group: "scoring" },
  { key: "scholarship", label: "Scholarship / financial fit", hints: ["scholarship", "grant", "financial", "fwif", "select one"], group: "scoring" },
  { key: "age", label: "Age", hints: ["age"], group: "scoring" },
  { key: "job_role", label: "Job role", hints: ["job role", "job", "occupation", "profession"], group: "scoring" },
  { key: "designation", label: "Designation", hints: ["designation", "title"], group: "scoring" },

  // Context
  { key: "city", label: "City", hints: ["city", "location", "town"], group: "context" },
  { key: "form_source", label: "Form / lead source", hints: ["form source", "source", "form"], group: "context" },
  { key: "interview", label: "Interview status", hints: ["interview"], group: "context" },
  { key: "interview_date", label: "Interview date", hints: ["interview date"], group: "context" },
  { key: "interviewer", label: "Interviewer", hints: ["interviewer"], group: "context" },
  { key: "grant", label: "Grant", hints: ["grant"], group: "context" },
  { key: "grant_amount", label: "Grant amount", hints: ["grant amount"], group: "context" },

  // Dates (preserve historical timing if columns exist)
  { key: "created_at", label: "Created / first-seen date", hints: ["created", "first seen", "date created", "added"], group: "dates" },
  { key: "last_activity", label: "Last-activity date", hints: ["last activity", "updated", "modified", "last contacted"], group: "dates" },
];

const PROGRAMS = ["FFM", "FW", "FC", "FAI", "BFP", "VE", "L3C"];

// --------------------------------------------------------------- helpers

function autoMap(columns: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  const cols = columns.map(c => ({ raw: c, lc: c.toLowerCase().trim() }));
  for (const f of FIELDS) {
    for (const hint of f.hints) {
      const exact = cols.find(c => !used.has(c.raw) && c.lc === hint);
      if (exact) { (m as any)[f.key] = exact.raw; used.add(exact.raw); break; }
    }
    if ((m as any)[f.key]) continue;
    for (const hint of f.hints) {
      const partial = cols.find(c => !used.has(c.raw) && c.lc.includes(hint));
      if (partial) { (m as any)[f.key] = partial.raw; used.add(partial.raw); break; }
    }
  }
  // Passthrough = unused columns, so nothing's lost
  m.passthrough = cols.filter(c => !used.has(c.raw)).map(c => c.raw);
  return m;
}

// --------------------------------------------------------------- component

export default function ImportClient() {
  const [step, setStep] = useState<"pick" | "map" | "running" | "done">("pick");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [defaults, setDefaults] = useState<Defaults>({ source: "CSV import" });
  const [parsing, setParsing] = useState(false);

  // Run state
  const runRef = useRef<{ paused: boolean; aborted: boolean }>({ paused: false, aborted: false });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, inserted: 0, updated: 0, merged: 0, skipped: 0, errors: 0, elapsedMs: 0 });
  const [recentErrors, setRecentErrors] = useState<{ idx: number; reason: string }[]>([]);

  function reset() {
    runRef.current = { paused: false, aborted: false };
    setStep("pick"); setFileName(""); setRows([]); setColumns([]); setMapping({});
    setDefaults({ source: "CSV import" }); setRunning(false); setPaused(false);
    setProgress({ done: 0, total: 0, inserted: 0, updated: 0, merged: 0, skipped: 0, errors: 0, elapsedMs: 0 });
    setRecentErrors([]);
  }

  function handleFile(file: File) {
    setParsing(true);
    setFileName(file.name);
    Papa.parse<any>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
      complete: (res: ParseResult<any>) => {
        const data = (res.data || []).filter(r => r && Object.values(r).some(v => v != null && String(v).trim() !== ""));
        const cols = res.meta.fields || [];
        setRows(data); setColumns(cols);
        setMapping(autoMap(cols));
        setStep("map");
        setParsing(false);
      },
      error: (err: any) => {
        alert("CSV parse failed: " + (err?.message || String(err)));
        setParsing(false);
      },
    });
  }

  async function runImport() {
    runRef.current = { paused: false, aborted: false };
    setRunning(true); setPaused(false);
    setStep("running");
    const total = rows.length;
    setProgress({ done: 0, total, inserted: 0, updated: 0, merged: 0, skipped: 0, errors: 0, elapsedMs: 0 });
    setRecentErrors([]);

    const BATCH = 250;
    const t0 = Date.now();
    let cum = { inserted: 0, updated: 0, merged: 0, skipped: 0, errors: 0 };

    for (let i = 0; i < total; i += BATCH) {
      while (runRef.current.paused && !runRef.current.aborted) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (runRef.current.aborted) break;
      const chunk = rows.slice(i, i + BATCH);
      try {
        const r = await fetch("/api/maintenance/import-telecrm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: chunk, mapping, defaults }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        cum.inserted += j.inserted || 0;
        cum.updated  += j.updated  || 0;
        cum.merged   += j.merged   || 0;
        cum.skipped  += j.skipped  || 0;
        cum.errors   += (j.errors?.length || 0);
        if (j.errors?.length) {
          setRecentErrors(prev => [...prev, ...j.errors.map((e: any) => ({ idx: e.idx + i, reason: e.reason }))].slice(-25));
        }
      } catch (e: any) {
        cum.errors += chunk.length;
        setRecentErrors(prev => [...prev, { idx: i, reason: `batch failed: ${e?.message || "unknown"}` }].slice(-25));
      }
      setProgress({
        done: Math.min(i + BATCH, total),
        total,
        inserted: cum.inserted,
        updated: cum.updated,
        merged: cum.merged,
        skipped: cum.skipped,
        errors: cum.errors,
        elapsedMs: Date.now() - t0,
      });
    }

    setRunning(false);
    setStep("done");
  }

  function abortImport() {
    runRef.current.aborted = true;
    runRef.current.paused = false;
  }
  function togglePause() {
    runRef.current.paused = !runRef.current.paused;
    setPaused(runRef.current.paused);
  }

  // ------------------------------------------------------------ render

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-4xl font-extrabold italic tracking-tight text-forge-black inline-flex items-center gap-3">
          <FileSpreadsheet className="w-8 h-8 text-forge-orange-deep not-italic" />
          <span>Import <span className="brand-underline">leads</span></span>
        </h1>
        <p className="text-sm text-fg-muted mt-2">
          Upload a CSV from any CRM (TeleCRM, Zoho, HubSpot, custom). Columns are auto-mapped, MQL is scored, and rows are upserted into{" "}
          <code className="text-xs px-1 py-0.5 bg-forge-cream rounded">leads</code> +{" "}
          <code className="text-xs px-1 py-0.5 bg-forge-cream rounded">form_submissions</code>.
        </p>
      </div>

      {step === "pick" && <PickFile onFile={handleFile} parsing={parsing} />}

      {step === "map" && (
        <MapStep
          fileName={fileName}
          rows={rows}
          columns={columns}
          mapping={mapping}
          setMapping={setMapping}
          defaults={defaults}
          setDefaults={setDefaults}
          onRun={runImport}
          onReset={reset}
        />
      )}

      {step === "running" && (
        <RunProgress
          progress={progress}
          paused={paused}
          onPauseToggle={togglePause}
          onAbort={abortImport}
          recentErrors={recentErrors}
        />
      )}

      {step === "done" && (
        <DoneSummary progress={progress} recentErrors={recentErrors} onReset={reset} />
      )}
    </div>
  );
}

// --------------------------------------------------------------- step 1: pick

function PickFile({ onFile, parsing }: { onFile: (f: File) => void; parsing: boolean }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`surface-card p-12 text-center border-2 border-dashed transition-colors ${drag ? "border-forge-orange-deep bg-forge-yellow-pale" : "border-forge-yellow-soft"}`}
    >
      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-forge-gradient flex items-center justify-center shadow-soft">
        <Upload className="w-6 h-6 text-forge-black" />
      </div>
      <h2 className="font-display text-2xl font-extrabold italic text-forge-black">Drop a CSV here</h2>
      <p className="text-sm text-fg-muted mt-1">or click below to pick a file</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={parsing}
        className="btn-forge mt-5"
      >
        {parsing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4"/>}
        Choose CSV file
      </button>
      <p className="text-[11px] text-fg-subtle mt-6 max-w-md mx-auto">
        Files are parsed in your browser — nothing leaves your machine until you click Run.
        Junk leads (Direct Junk, Wrong Number) are imported and tagged as Lost so nothing is dropped.
      </p>
    </div>
  );
}

// --------------------------------------------------------------- step 2: map

function MapStep({
  fileName, rows, columns, mapping, setMapping, defaults, setDefaults, onRun, onReset,
}: {
  fileName: string; rows: any[]; columns: string[];
  mapping: Mapping; setMapping: (m: Mapping) => void;
  defaults: Defaults; setDefaults: (d: Defaults) => void;
  onRun: () => void; onReset: () => void;
}) {
  const updateMap = (key: keyof Mapping, val: string) => {
    setMapping({ ...mapping, [key]: val || undefined });
  };

  // Validation: need program (column or default) + at least one of email/phone
  const hasProgram = !!(mapping.program || defaults.program);
  const hasContact = !!(mapping.email || mapping.phone);
  const ready = hasProgram && hasContact;

  const groups: { id: FieldDef["group"]; label: string }[] = [
    { id: "core",    label: "Core identity" },
    { id: "stage",   label: "Funnel stage" },
    { id: "scoring", label: "MQL scoring inputs" },
    { id: "context", label: "Extra context" },
    { id: "dates",   label: "Historical dates" },
  ];

  return (
    <div className="space-y-5">
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <FileSpreadsheet className="w-5 h-5 text-forge-orange-deep" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-forge-black truncate">{fileName}</div>
          <div className="text-xs text-fg-muted">{rows.length.toLocaleString()} rows · {columns.length} columns</div>
        </div>
        <button onClick={onReset} className="text-xs text-fg-muted hover:text-forge-black inline-flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" />Clear
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="surface-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-forge-orange-deep" />
            <h2 className="font-semibold text-forge-black">Column mapping</h2>
            <span className="text-xs text-fg-muted ml-auto">auto-suggested · override anywhere</span>
          </div>
          {groups.map(g => (
            <div key={g.id} className="mb-4 last:mb-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold mb-2">{g.label}</div>
              <div className="space-y-2">
                {FIELDS.filter(f => f.group === g.id).map(f => (
                  <div key={f.key} className="grid grid-cols-[1fr_auto_2fr] items-center gap-2 text-sm">
                    <label className="text-forge-black/85 truncate">
                      {f.label}
                      {f.required && <span className="text-rose-600 ml-0.5">*</span>}
                    </label>
                    <ArrowRight className="w-3 h-3 text-fg-subtle" />
                    <select
                      value={(mapping as any)[f.key] || ""}
                      onChange={e => updateMap(f.key, e.target.value)}
                      className="text-xs px-2 py-1.5 border border-fg-border rounded-md bg-fg-card"
                    >
                      <option value="">— skip —</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-5">
          <div className="surface-card p-5">
            <h2 className="font-semibold text-forge-black mb-3">Defaults <span className="text-xs text-fg-muted font-normal">— used when a row's column is empty</span></h2>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <label className="text-forge-black/85">Program</label>
                <select
                  value={defaults.program || ""}
                  onChange={e => setDefaults({ ...defaults, program: e.target.value || undefined })}
                  className="text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card"
                >
                  <option value="">— per-row from CSV —</option>
                  {PROGRAMS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <label className="text-forge-black/85">Status</label>
                <input
                  value={defaults.status || ""}
                  onChange={e => setDefaults({ ...defaults, status: e.target.value || undefined })}
                  placeholder="NEW"
                  className="text-sm px-2 py-1.5 border border-fg-border rounded-md"
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2 items-center">
                <label className="text-forge-black/85">Source label</label>
                <input
                  value={defaults.source || ""}
                  onChange={e => setDefaults({ ...defaults, source: e.target.value || undefined })}
                  placeholder="CSV import"
                  className="text-sm px-2 py-1.5 border border-fg-border rounded-md"
                />
              </div>
            </div>
          </div>

          <div className="surface-card p-5">
            <h2 className="font-semibold text-forge-black mb-2">Preview <span className="text-xs text-fg-muted font-normal">— first row, mapped</span></h2>
            <div className="space-y-1 text-xs max-h-[260px] overflow-y-auto">
              {rows[0] ? (
                FIELDS.map(f => {
                  const col = (mapping as any)[f.key];
                  const val = col ? String(rows[0][col] ?? "") : "";
                  return (
                    <div key={f.key} className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="text-fg-muted">{f.label}</span>
                      <span className="text-forge-black truncate">{val || <span className="text-fg-subtle italic">—</span>}</span>
                    </div>
                  );
                })
              ) : <div className="text-fg-muted italic">No rows.</div>}
            </div>
          </div>

          <div className="surface-card p-5 bg-forge-radial relative overflow-hidden">
            <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
            <div className="relative">
              <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold mb-1">Ready to run</div>
              <div className="font-display text-3xl font-extrabold italic text-forge-black">
                {rows.length.toLocaleString()} rows
              </div>
              <p className="text-xs text-fg-muted mt-2">
                {ready ? "Click Run to bulk-upsert in 250-row batches. You can pause or abort anytime." : (
                  <span className="text-rose-700">
                    {!hasProgram && "Need program (column or default). "}
                    {!hasContact && "Need email or phone column."}
                  </span>
                )}
              </p>
              <div className="flex gap-2 mt-4">
                <button onClick={onRun} disabled={!ready} className="btn-forge disabled:opacity-50">
                  <Play className="w-4 h-4" />Run import
                </button>
                <button onClick={onReset} className="px-4 py-2 text-sm rounded-md border border-fg-border text-fg-muted hover:bg-fg-surface">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- step 3: running

function RunProgress({
  progress, paused, onPauseToggle, onAbort, recentErrors,
}: {
  progress: { done: number; total: number; inserted: number; updated: number; merged: number; skipped: number; errors: number; elapsedMs: number };
  paused: boolean;
  onPauseToggle: () => void;
  onAbort: () => void;
  recentErrors: { idx: number; reason: string }[];
}) {
  const pct = progress.total > 0 ? (100 * progress.done) / progress.total : 0;
  const rate = progress.elapsedMs > 0 ? (progress.done / (progress.elapsedMs / 1000)) : 0;
  const etaSec = rate > 0 ? (progress.total - progress.done) / rate : 0;
  return (
    <div className="space-y-4">
      <div className="surface-card p-5 bg-forge-radial relative overflow-hidden">
        <div className="absolute inset-0 bg-forge-stripes opacity-[0.04] pointer-events-none" />
        <div className="relative">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-fg-muted font-semibold">Importing</div>
              <div className="font-display text-4xl font-extrabold italic text-forge-black">
                {progress.done.toLocaleString()} <span className="text-fg-muted">/ {progress.total.toLocaleString()}</span>
              </div>
            </div>
            <div className="text-sm text-forge-black/85 tabular-nums">
              {pct.toFixed(0)}% · {rate > 0 ? `${rate.toFixed(0)} rows/s` : "…"}{etaSec > 0 ? ` · ETA ${formatTime(etaSec)}` : ""}
            </div>
          </div>
          <div className="h-2 w-full bg-forge-cream rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-forge-gradient transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            <Stat label="Inserted" value={progress.inserted} tone="emerald" />
            <Stat label="Updated"  value={progress.updated}  tone="amber" />
            <Stat label="Skipped"  value={progress.skipped}  tone="muted" />
            <Stat label="Errors"   value={progress.errors}   tone="rose" />
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={onPauseToggle} className="px-3 py-1.5 text-xs font-medium rounded-md border border-fg-border bg-fg-card hover:bg-fg-surface inline-flex items-center gap-1">
              {paused ? <><Play className="w-3.5 h-3.5"/>Resume</> : <><Pause className="w-3.5 h-3.5"/>Pause</>}
            </button>
            <button onClick={onAbort} className="px-3 py-1.5 text-xs font-medium rounded-md border border-rose-200 text-rose-700 bg-fg-card hover:bg-rose-50 inline-flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5"/>Abort
            </button>
          </div>
        </div>
      </div>
      {recentErrors.length > 0 && <ErrorsBox errors={recentErrors} />}
    </div>
  );
}

// --------------------------------------------------------------- step 4: done

function DoneSummary({
  progress, recentErrors, onReset,
}: {
  progress: { done: number; total: number; inserted: number; updated: number; merged: number; skipped: number; errors: number; elapsedMs: number };
  recentErrors: { idx: number; reason: string }[];
  onReset: () => void;
}) {
  const aborted = progress.done < progress.total;
  return (
    <div className="space-y-4">
      <div className="surface-card p-5 border-l-4 border-l-emerald-500">
        <div className="flex items-start gap-3">
          <Check className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-display text-2xl font-extrabold italic text-forge-black">
              {aborted ? "Aborted" : "Done"}
            </h2>
            <p className="text-sm text-fg-muted mt-0.5">
              Processed {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows in {formatTime(progress.elapsedMs / 1000)}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-4">
          <Stat label="Inserted" value={progress.inserted} tone="emerald" big />
          <Stat label="Updated"  value={progress.updated}  tone="amber" big />
          <Stat label="Skipped"  value={progress.skipped}  tone="muted" big />
          <Stat label="Errors"   value={progress.errors}   tone="rose" big />
        </div>
        <div className="flex gap-2 mt-4">
          <a href="/queue" className="btn-forge">View queue →</a>
          <button onClick={onReset} className="px-4 py-2 text-sm rounded-md border border-fg-border text-fg-muted hover:bg-fg-surface inline-flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />Import another
          </button>
        </div>
      </div>
      {recentErrors.length > 0 && <ErrorsBox errors={recentErrors} />}
    </div>
  );
}

// --------------------------------------------------------------- presentation helpers

function Stat({ label, value, tone, big }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "muted"; big?: boolean }) {
  const colorMap = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber:   "bg-forge-yellow-soft text-forge-orange-deep ring-forge-yellow",
    rose:    "bg-rose-50 text-rose-700 ring-rose-200",
    muted:   "bg-forge-cream text-forge-black/70 ring-fg-border",
  };
  return (
    <div className={`${colorMap[tone]} ring-1 rounded-lg px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold opacity-80">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-bold tabular-nums`}>{value.toLocaleString()}</div>
    </div>
  );
}

function ErrorsBox({ errors }: { errors: { idx: number; reason: string }[] }) {
  return (
    <div className="surface-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="w-4 h-4 text-rose-600" />
        <h3 className="font-semibold text-forge-black text-sm">Recent errors <span className="text-fg-muted font-normal">({errors.length})</span></h3>
      </div>
      <div className="space-y-1 max-h-[200px] overflow-y-auto text-xs">
        {errors.slice(-25).reverse().map((e, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-fg-subtle tabular-nums shrink-0">row {e.idx}:</span>
            <span className="text-rose-700 truncate">{e.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}
