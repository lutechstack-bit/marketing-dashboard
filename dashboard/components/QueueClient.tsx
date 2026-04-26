"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Phone, MessageCircle, Mail, Flame, Zap, Clock, AlertCircle, CheckCircle2,
  ChevronRight, ChevronDown, ChevronUp, X,
} from "lucide-react";
import type { LeadRow } from "@/lib/supabase";
import { whyHotReason, suggestTalkingPoints } from "@/lib/insights";

type Bucket = "no_app_fee" | "no_interview" | "partials";

const PRODUCTS = [
  { code: "FFM", name: "Filmmaking", color: "rose"   },
  { code: "FW",  name: "Writing",    color: "cyan"   },
  { code: "FC",  name: "Creators",   color: "lime"   },
  { code: "FAI", name: "AI",         color: "amber"  },
] as const;

const REPS = [
  { name: "Pranaush", programs: ["FFM","FW"]   },
  { name: "Sashank",  programs: ["FC","BFP"]   },
  { name: "Wilson",   programs: ["VE","L3C"]   },
];

// Bucket meta — colors, labels, descriptions, what stage they correspond to
const BUCKET_META: Record<Bucket, {
  label: string;
  icon: React.ReactNode;
  cls: string;
  borderL: string;
  description: string;
  stage: string;
  priorityNote: string;
}> = {
  no_app_fee: {
    label: "Completed form · didn't pay app fee",
    icon: <Flame className="w-4 h-4" />,
    cls: "border-amber-300 text-amber-900 bg-amber-50",
    borderL: "border-l-amber-500",
    description: "Filled the application fully but didn't pay the application fee. This is your highest-leverage call — they're qualified and just need a nudge.",
    stage: "form_submitted",
    priorityNote: "HIGHEST PRIORITY",
  },
  no_interview: {
    label: "Paid app fee · didn't book interview",
    icon: <Zap className="w-4 h-4" />,
    cls: "border-cyan-300 text-cyan-900 bg-cyan-50",
    borderL: "border-l-cyan-500",
    description: "Paid the application fee but hasn't booked a Calendly interview. Push them to pick a slot — biggest drop-off point in the funnel.",
    stage: "accepted",
    priorityNote: "HIGH PRIORITY",
  },
  partials: {
    label: "Partials · started form, didn't finish",
    icon: <Clock className="w-4 h-4" />,
    cls: "border-slate-300 text-slate-700 bg-slate-50",
    borderL: "border-l-slate-400",
    description: "Began the application but didn't complete it. Soft re-engagement — a short message often recovers them.",
    stage: "form_partial",
    priorityNote: "Lower priority — collapse by default",
  },
};

function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function fmtAgo(iso?: string | null): string {
  const h = hoursSince(iso);
  if (!Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  if (h < 24 * 7) return `${Math.round(h / 24)}d ago`;
  return `${Math.round(h / (24 * 7))}w ago`;
}

function bucketFor(l: LeadRow): Bucket | null {
  switch (l.funnel_stage) {
    case "form_submitted": return "no_app_fee";
    case "accepted":       return "no_interview";
    case "app_fee_paid":   return "no_interview";  // edge case — old stage value
    case "form_partial":   return "partials";
    default: return null;
  }
}

type QueueClientProps = {
  initialLeads: LeadRow[];
  bookedEmails: string[];      // emails (lowercased) with an ACTIVE Calendly booking
  calendlyConnected: boolean;  // false if Calendly fetch failed or token missing
};

export default function QueueClient({ initialLeads, bookedEmails, calendlyConnected }: QueueClientProps) {
  const [product, setProduct] = useState<string>("FFM");
  const [rep, setRep] = useState<string | null>(null);
  const [partialsOpen, setPartialsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Set of booked emails for O(1) lookup
  const bookedSet = useMemo(() => new Set(bookedEmails), [bookedEmails]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedProd = localStorage.getItem("levelup-current-product");
    const savedRep = localStorage.getItem("levelup-current-rep");
    if (savedProd && PRODUCTS.find(p => p.code === savedProd)) setProduct(savedProd);
    if (savedRep && REPS.find(r => r.name === savedRep)) setRep(savedRep);
    setMounted(true);
  }, []);

  const setProductAndPersist = (p: string) => {
    setProduct(p);
    localStorage.setItem("levelup-current-product", p);
    setPartialsOpen(false); // reset on product switch
  };
  const setRepAndPersist = (r: string | null) => {
    setRep(r);
    if (r) localStorage.setItem("levelup-current-rep", r);
  };

  // Filter to current product, then optionally to rep's assigned programs
  const productLeads = useMemo(() => {
    let xs = initialLeads.filter(l => l.program === product);
    if (rep) {
      const allowed = REPS.find(r => r.name === rep)?.programs || [];
      xs = xs.filter(l => l.program && allowed.includes(l.program));
    }
    return xs;
  }, [initialLeads, product, rep]);

  // Bucket each lead — using Calendly bookings to refine bucket B
  // (paid app fee but didn't book interview = NOT in bookedSet)
  const buckets = useMemo(() => {
    const out: Record<Bucket, LeadRow[]> = { no_app_fee: [], no_interview: [], partials: [] };
    for (const l of productLeads) {
      const b = bucketFor(l);
      if (!b) continue;
      // Skip bucket B leads who already booked a Calendly interview
      if (b === "no_interview" && calendlyConnected) {
        const email = (l.email || "").toLowerCase();
        if (email && bookedSet.has(email)) continue;
      }
      out[b].push(l);
    }
    for (const k of Object.keys(out) as Bucket[]) {
      out[k].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return hoursSince(a.last_activity) - hoursSince(b.last_activity);
      });
    }
    return out;
  }, [productLeads, bookedSet, calendlyConnected]);

  // Counts across ALL products for the product tab badges
  const productCounts = useMemo(() => {
    const c: Record<string, { hot: number; warm: number; partials: number }> = {};
    for (const p of PRODUCTS) c[p.code] = { hot: 0, warm: 0, partials: 0 };
    for (const l of initialLeads) {
      if (!l.program || !c[l.program]) continue;
      const b = bucketFor(l);
      if (b === "no_app_fee") c[l.program].hot++;
      else if (b === "no_interview") c[l.program].warm++;
      else if (b === "partials") c[l.program].partials++;
    }
    return c;
  }, [initialLeads]);

  const totalCalls = buckets.no_app_fee.length + buckets.no_interview.length;
  const productMeta = PRODUCTS.find(p => p.code === product)!;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg-text">Today&apos;s Call Queue</h1>
          <p className="text-sm text-fg-muted mt-1">
            {today} · {totalCalls.toLocaleString("en-IN")} priority calls in <span className="font-semibold text-fg-text">{productMeta.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Rep filter</span>
          <div className="flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5">
            <button
              onClick={() => setRepAndPersist(null)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${!rep ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}
            >All</button>
            {REPS.map(r => (
              <button
                key={r.name}
                onClick={() => setRepAndPersist(rep === r.name ? null : r.name)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${rep === r.name ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"}`}
              >{r.name}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Product tabs */}
      <ProductTabs current={product} counts={productCounts} onChange={setProductAndPersist} />

      {/* Funnel snapshot for this product */}
      <FunnelSnapshot
        productName={productMeta.name}
        hot={buckets.no_app_fee.length}
        warm={buckets.no_interview.length}
        partials={buckets.partials.length}
      />

      {/* Buckets */}
      <div className="space-y-7 mt-6">
        <BucketSection
          bucket="no_app_fee"
          leads={buckets.no_app_fee}
          rank="A"
        />
        <BucketSection
          bucket="no_interview"
          leads={buckets.no_interview}
          rank="B"
          calendlyNote={!calendlyConnected}
        />
        <PartialsSection
          leads={buckets.partials}
          open={partialsOpen}
          onToggle={() => setPartialsOpen(o => !o)}
        />
      </div>

      {totalCalls === 0 && buckets.partials.length === 0 && (
        <div className="surface-card p-12 text-center mt-6">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-fg-text">No calls in {productMeta.name} right now</h2>
          <p className="text-sm text-fg-muted mt-1">
            {rep ? `${rep} has no leads in this product.` : "All clear — nothing in the priority buckets."}
          </p>
          <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 mt-4">
            Browse all leads <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function ProductTabs({ current, counts, onChange }: {
  current: string;
  counts: Record<string, { hot: number; warm: number; partials: number }>;
  onChange: (p: string) => void;
}) {
  const accent: Record<string, { active: string; dot: string }> = {
    rose:  { active: "border-rose-500 text-rose-700",  dot: "bg-rose-500" },
    cyan:  { active: "border-cyan-500 text-cyan-700",  dot: "bg-cyan-500" },
    lime:  { active: "border-lime-500 text-lime-700",  dot: "bg-lime-500" },
    amber: { active: "border-amber-500 text-amber-700",dot: "bg-amber-500" },
  };
  return (
    <div className="border-b border-fg-border mb-5 -mx-2 px-2 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {PRODUCTS.map(p => {
          const c = counts[p.code] || { hot: 0, warm: 0, partials: 0 };
          const total = c.hot + c.warm;
          const isActive = current === p.code;
          const aux = accent[p.color];
          return (
            <button
              key={p.code}
              onClick={() => onChange(p.code)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2.5 -mb-px ${
                isActive ? aux.active : "border-transparent text-fg-muted hover:text-fg-text"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${aux.dot}`} />
              <span>{p.name}</span>
              <span className="flex items-center gap-1 text-[11px] tabular-nums">
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{c.hot}</span>
                <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800">{c.warm}</span>
                <span className={`px-1.5 py-0.5 rounded bg-slate-100 ${isActive ? "text-slate-700" : "text-slate-500"}`}>{c.partials}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FunnelSnapshot({ productName, hot, warm, partials }: { productName: string; hot: number; warm: number; partials: number }) {
  if (hot === 0 && warm === 0 && partials === 0) return null;
  return (
    <div className="surface-card p-4 border-l-4 border-l-amber-500 flex items-start gap-3">
      <Flame className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-semibold text-fg-text mb-1">Where {productName} stands right now</div>
        <ul className="text-fg-muted space-y-0.5">
          {hot > 0 &&     <li>🔥 <span className="font-semibold text-fg-text">{hot}</span> completed the form but didn&apos;t pay the app fee — call to push payment</li>}
          {warm > 0 &&    <li>⚡ <span className="font-semibold text-fg-text">{warm}</span> paid the app fee but haven&apos;t booked an interview — call to push booking</li>}
          {partials > 0 && <li>📋 <span className="font-semibold text-fg-text">{partials}</span> partials waiting (collapsed below)</li>}
        </ul>
      </div>
    </div>
  );
}

function BucketSection({ bucket, leads, rank, calendlyNote }: {
  bucket: Bucket;
  leads: LeadRow[];
  rank: "A" | "B";
  calendlyNote?: boolean;
}) {
  const meta = BUCKET_META[bucket];
  const visible = leads.slice(0, 12);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold border ${rank === "A" ? "border-amber-500 text-amber-700 bg-amber-50" : "border-cyan-500 text-cyan-700 bg-cyan-50"}`}>{rank}</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${meta.cls}`}>
            {meta.icon}{meta.label}
          </span>
          <span className="text-xs text-fg-muted tabular-nums">{leads.length}</span>
          {calendlyNote && (
            <span className="text-[10px] text-amber-700 italic">· Calendly disconnected — using time approximation</span>
          )}
        </div>
        {leads.length > visible.length && (
          <span className="text-xs text-fg-muted">Showing top {visible.length} of {leads.length}</span>
        )}
      </div>
      <p className="text-xs text-fg-muted mb-3">{meta.description}</p>
      {leads.length === 0 ? (
        <div className="surface-card p-6 text-center text-sm text-fg-muted">
          No leads in this bucket right now. Nice work — or maybe lead volume is low today.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((l, i) => <QueueCard key={l.id} lead={l} rank={i + 1} />)}
        </div>
      )}
    </section>
  );
}

function PartialsSection({ leads, open, onToggle }: { leads: LeadRow[]; open: boolean; onToggle: () => void }) {
  const meta = BUCKET_META.partials;
  const visible = leads.slice(0, 8);
  return (
    <section>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 surface-card surface-card-hover text-left"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold border border-slate-300 text-slate-600 bg-slate-50">C</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${meta.cls}`}>
            {meta.icon}{meta.label}
          </span>
          <span className="text-xs text-fg-muted tabular-nums">{leads.length}</span>
          <span className="text-xs text-fg-subtle">— click to {open ? "collapse" : "expand"}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-fg-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-fg-muted shrink-0" />}
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-xs text-fg-muted mb-3">{meta.description}</p>
          {leads.length === 0 ? (
            <div className="surface-card p-6 text-center text-sm text-fg-muted">No partials in this product.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {visible.map((l, i) => <QueueCard key={l.id} lead={l} rank={i + 1} compact />)}
            </div>
          )}
          {leads.length > visible.length && (
            <div className="text-xs text-fg-muted mt-3 text-center">
              Showing top {visible.length} of {leads.length}. <Link href={`/leads?stage=form_partial&program=${leads[0]?.program || ""}`} className="text-amber-700 hover:underline">View all in Leads →</Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QueueCard({ lead, rank, compact }: { lead: LeadRow; rank: number; compact?: boolean }) {
  const why = whyHotReason(lead);
  const tips = suggestTalkingPoints(lead);

  return (
    <div className={`surface-card surface-card-hover p-4 group`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-fg-surface border border-fg-border flex items-center justify-center text-xs font-bold text-fg-muted tabular-nums">
          #{rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <Link href={`/leads/${lead.id}`} className="font-semibold text-fg-text truncate hover:text-amber-700 hover:underline">
              {lead.name || <span className="italic text-fg-subtle">No name</span>}
            </Link>
            <div className="flex items-center gap-2 shrink-0">
              <ScoreBadge score={lead.score} />
              <span className="text-[11px] text-fg-muted tabular-nums">{fmtAgo(lead.last_activity)}</span>
            </div>
          </div>
          {!compact && <p className="text-xs text-fg-text/85 leading-snug mb-2">{why}</p>}
          {!compact && tips.length > 0 && (
            <div className="text-[11px] text-fg-muted bg-fg-surface rounded px-2.5 py-1.5 mb-3 border border-fg-border/70">
              <span className="font-semibold text-fg-text/80">💡 Open with:</span> {tips[0]}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50">
                  <Phone className="w-3.5 h-3.5" />Call
                </a>
              )}
              {lead.phone && (
                <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-green-200 text-green-700 bg-white hover:bg-green-50">
                  <MessageCircle className="w-3.5 h-3.5" />WA
                </a>
              )}
              {lead.email && !compact && (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-cyan-200 text-cyan-700 bg-white hover:bg-cyan-50">
                  <Mail className="w-3.5 h-3.5" />Email
                </a>
              )}
            </div>
            <Link
              href={`/leads/${lead.id}`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md text-fg-muted hover:text-fg-text hover:bg-fg-surface"
            >
              Open <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let cls;
  if (score >= 75)      cls = "bg-amber-500 text-white shadow-sm shadow-amber-500/30";
  else if (score >= 50) cls = "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300";
  else if (score >= 25) cls = "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200";
  else                  cls = "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
  return (
    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-xs tabular-nums ${cls}`}>
      {score}
    </div>
  );
}
