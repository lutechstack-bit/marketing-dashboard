"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Phone, MessageCircle, Mail, ChevronRight, CheckCircle2, AlertCircle, Radio,
} from "lucide-react";
import type { LeadRow } from "@/lib/supabase";
import { whyHotReason } from "@/lib/insights";
import {
  PRODUCTS, FAMILIES, PRODUCTS_BY_FAMILY, PRODUCT_BY_CODE,
  BUCKETS, BUCKET_ORDER, productAccents, familyLabel,
  type Family, type BucketId,
} from "@/lib/products";
import StatusDropdown from "./StatusDropdown";

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function hoursSince(iso?: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}
function fmtAgo(iso?: string | null): string {
  const h = hoursSince(iso);
  if (!Number.isFinite(h)) return "—";
  if (h < 1)        return `${Math.round(h * 60)}m`;
  if (h < 24)       return `${Math.round(h)}h`;
  if (h < 24 * 7)   return `${Math.round(h / 24)}d`;
  return `${Math.round(h / (24 * 7))}w`;
}
function bucketFor(l: LeadRow): BucketId | null {
  switch (l.funnel_stage) {
    case "form_submitted": return "abandoned";
    case "accepted":       return "need_to_book";
    case "app_fee_paid":   return "need_to_book";
    case "form_partial":   return "partials";
    default: return null;
  }
}

// ----------------------------------------------------------------
// Component
// ----------------------------------------------------------------
type QueueClientProps = {
  initialLeads: LeadRow[];
  bookedEmails: string[];
  calendlyConnected: boolean;
};

export default function QueueClient({ initialLeads, bookedEmails, calendlyConnected }: QueueClientProps) {
  const router = useRouter();
  const [family, setFamily] = useState<Family>("forge");
  const [product, setProduct] = useState<string>("FFM");
  const [bucket, setBucket] = useState<BucketId>("abandoned");
  const [mounted, setMounted] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Auto-refresh every 30s while the tab is visible — picks up new webhook
  // ingestions without the rep having to manually reload.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        router.refresh();
        setLastRefresh(new Date());
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [router]);

  // Restore + persist user choices
  useEffect(() => {
    if (typeof window === "undefined") return;
    const f = localStorage.getItem("levelup-family") as Family | null;
    const p = localStorage.getItem("levelup-current-product");
    const b = localStorage.getItem("levelup-current-bucket") as BucketId | null;
    if (f === "forge" || f === "live") setFamily(f);
    if (p && PRODUCT_BY_CODE[p]) setProduct(p);
    if (b && BUCKETS[b]) setBucket(b);
    setMounted(true);
  }, []);

  // When family changes, snap product to the first product of that family
  // unless the current product already belongs to it.
  useEffect(() => {
    const cur = PRODUCT_BY_CODE[product];
    if (!cur || cur.family !== family) {
      const first = PRODUCTS_BY_FAMILY[family][0]?.code;
      if (first) setProduct(first);
    }
  }, [family, product]);

  const setFamilyP = (f: Family) => { setFamily(f); localStorage.setItem("levelup-family", f); };
  const setProductP = (p: string) => { setProduct(p); localStorage.setItem("levelup-current-product", p); };
  const setBucketP  = (b: BucketId) => { setBucket(b); localStorage.setItem("levelup-current-bucket", b); };

  // Booked-email Set for O(1) lookup
  const bookedSet = useMemo(() => new Set(bookedEmails), [bookedEmails]);

  // All leads for the selected product
  const productLeads = useMemo(
    () => initialLeads.filter(l => l.program === product),
    [initialLeads, product]
  );

  // Bucket the leads — bucket B uses Calendly to drop already-booked ones
  const bucketed = useMemo(() => {
    const out: Record<BucketId, LeadRow[]> = { abandoned: [], need_to_book: [], partials: [] };
    for (const l of productLeads) {
      const b = bucketFor(l);
      if (!b) continue;
      if (b === "need_to_book" && calendlyConnected) {
        const email = (l.email || "").toLowerCase();
        if (email && bookedSet.has(email)) continue; // they already booked
      }
      out[b].push(l);
    }
    for (const k of Object.keys(out) as BucketId[]) {
      out[k].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return hoursSince(a.last_activity) - hoursSince(b.last_activity);
      });
    }
    return out;
  }, [productLeads, bookedSet, calendlyConnected]);

  // Per-product counts across ALL three buckets, used in the product-tab badges
  const productCounts = useMemo(() => {
    const c: Record<string, { abandoned: number; need_to_book: number; partials: number }> = {};
    for (const p of PRODUCTS) c[p.code] = { abandoned: 0, need_to_book: 0, partials: 0 };
    for (const l of initialLeads) {
      if (!l.program || !c[l.program]) continue;
      const b = bucketFor(l);
      if (!b) continue;
      if (b === "need_to_book" && calendlyConnected) {
        const email = (l.email || "").toLowerCase();
        if (email && bookedSet.has(email)) continue;
      }
      c[l.program][b]++;
    }
    return c;
  }, [initialLeads, bookedSet, calendlyConnected]);

  const productMeta = PRODUCT_BY_CODE[product];
  const visible = bucketed[bucket];
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg-text">Today&apos;s Call Queue</h1>
          <p className="text-sm text-fg-muted mt-1">
            {today} · viewing <span className="font-semibold text-fg-text">{productMeta?.longName || product}</span>
            {!calendlyConnected && (
              <span className="ml-2 text-amber-700 italic">· Calendly disconnected — bucket B uses time approximation</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          <span>Auto-refreshing every 30s</span>
          <span className="text-fg-subtle hidden md:inline">· last sync {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
      </div>

      {/* Family tabs (Forge | Live) — primary axis */}
      <FamilyTabs current={family} onChange={setFamilyP} />

      {/* Product tabs — for the active family */}
      <ProductTabs family={family} current={product} counts={productCounts} onChange={setProductP} />

      {/* Bucket toggles */}
      <BucketTabs current={bucket} counts={{
        abandoned:    bucketed.abandoned.length,
        need_to_book: bucketed.need_to_book.length,
        partials:     bucketed.partials.length,
      }} onChange={setBucketP} />

      {/* Active bucket description */}
      <p className="text-xs text-fg-muted mt-3 mb-4">{BUCKETS[bucket].description}</p>

      {/* List */}
      <LeadsList leads={visible} bucketId={bucket} family={family} />
    </div>
  );
}

// ----------------------------------------------------------------
// Family tabs
// ----------------------------------------------------------------
function FamilyTabs({ current, onChange }: { current: Family; onChange: (f: Family) => void }) {
  return (
    <div className="inline-flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5 mb-4">
      {FAMILIES.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-all ${
            current === f ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"
          }`}
        >
          {familyLabel(f)}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// Product tabs (depend on selected family)
// ----------------------------------------------------------------
function ProductTabs({ family, current, counts, onChange }: {
  family: Family;
  current: string;
  counts: Record<string, { abandoned: number; need_to_book: number; partials: number }>;
  onChange: (p: string) => void;
}) {
  const items = PRODUCTS_BY_FAMILY[family];
  return (
    <div className="border-b border-fg-border mb-2 -mx-2 px-2 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {items.map(p => {
          const c = counts[p.code] || { abandoned: 0, need_to_book: 0, partials: 0 };
          const isActive = current === p.code;
          const aux = productAccents(p.color);
          return (
            <button
              key={p.code}
              onClick={() => onChange(p.code)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2.5 -mb-px ${
                isActive ? aux.tabActive : "border-transparent text-fg-muted hover:text-fg-text"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${aux.dot}`} />
              <span>{p.name}</span>
              <span className="flex items-center gap-1 text-[11px] tabular-nums">
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Abandoned (form complete, no app fee)">{c.abandoned}</span>
                <span className="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800" title="Need to book interview">{c.need_to_book}</span>
                <span className={`px-1.5 py-0.5 rounded bg-slate-100 ${isActive ? "text-slate-700" : "text-slate-500"}`} title="Partials">{c.partials}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Bucket toggles
// ----------------------------------------------------------------
function BucketTabs({ current, counts, onChange }: {
  current: BucketId;
  counts: Record<BucketId, number>;
  onChange: (b: BucketId) => void;
}) {
  return (
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      {BUCKET_ORDER.map(id => {
        const def = BUCKETS[id];
        const isActive = current === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              isActive ? def.cls + " ring-2 ring-offset-1 ring-current/20" : "border-fg-border text-fg-muted bg-white hover:bg-fg-surface hover:text-fg-text"
            }`}
          >
            <span>{def.label}</span>
            <span className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded ${isActive ? def.badgeCls : "bg-fg-surface text-fg-muted"}`}>
              {counts[id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------
// Leads list (table format)
// ----------------------------------------------------------------
function LeadsList({ leads, bucketId, family }: { leads: LeadRow[]; bucketId: BucketId; family: Family }) {
  if (leads.length === 0) {
    const isLiveEmpty = family === "live";
    return (
      <div className="surface-card p-12 text-center mt-2">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-fg-text">No leads in this bucket</h2>
        <p className="text-sm text-fg-muted mt-1 max-w-md mx-auto">
          {isLiveEmpty
            ? "Live program ingestion (VE / BFP / L3C Tally forms) hasn't been wired yet — these tabs will populate once the forms are connected."
            : "Either the queue is genuinely empty, or all leads in this bucket have been moved on. Try another bucket."}
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden mt-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-fg-surface border-b border-fg-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="py-3 pl-4 pr-2 font-medium w-12">#</th>
              <th className="py-3 px-2 font-medium w-14">Score</th>
              <th className="py-3 px-2 font-medium">Name</th>
              <th className="py-3 px-2 font-medium">Phone</th>
              <th className="py-3 px-2 font-medium">Why hot</th>
              <th className="py-3 px-2 font-medium w-20">Last</th>
              <th className="py-3 px-2 font-medium w-44">Status</th>
              <th className="py-3 pr-4 pl-2 font-medium w-44">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.slice(0, 200).map((l, i) => (
              <LeadRowView key={l.id} lead={l} rank={i + 1} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 text-xs bg-fg-surface text-fg-muted border-t border-fg-border">
        Showing {Math.min(leads.length, 200).toLocaleString("en-IN")} of {leads.length.toLocaleString("en-IN")} in <span className="font-semibold text-fg-text">{BUCKETS[bucketId].label}</span>
        {leads.length > 200 && " — apply filters in /leads to narrow further."}
      </div>
    </div>
  );
}

function LeadRowView({ lead, rank }: { lead: LeadRow; rank: number }) {
  const why = whyHotReason(lead);
  return (
    <tr className="border-b border-fg-border/70 row-hover align-top">
      <td className="py-3 pl-4 pr-2 text-xs text-fg-subtle tabular-nums">{rank}</td>
      <td className="py-3 px-2"><ScoreBadge score={lead.score} /></td>
      <td className="py-3 px-2 max-w-[200px]">
        <Link href={`/leads/${lead.id}`} className="font-medium text-fg-text hover:text-amber-700 hover:underline truncate block">
          {lead.name || <span className="italic text-fg-subtle">No name</span>}
        </Link>
        {lead.email && (
          <div className="text-xs text-fg-muted truncate" title={lead.email}>{lead.email}</div>
        )}
      </td>
      <td className="py-3 px-2 tabular-nums whitespace-nowrap">
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className="text-fg-text hover:text-emerald-700 hover:underline">+{lead.phone}</a>
        ) : <span className="text-fg-subtle">—</span>}
      </td>
      <td className="py-3 px-2 max-w-[280px]">
        <p className="text-xs text-fg-text/85 leading-snug line-clamp-2">{why}</p>
      </td>
      <td className="py-3 px-2 tabular-nums text-xs text-fg-muted whitespace-nowrap">{fmtAgo(lead.last_activity)}</td>
      <td className="py-3 px-2">
        <StatusDropdown leadId={lead.id} initialStatus={lead.last_action} compact />
      </td>
      <td className="py-3 pr-4 pl-2 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="p-1.5 rounded hover:bg-emerald-100 text-emerald-700" title="Call">
              <Phone className="w-4 h-4" />
            </a>
          )}
          {lead.phone && (
            <a href={`https://wa.me/${lead.phone}`} target="_blank" rel="noopener" className="p-1.5 rounded hover:bg-green-100 text-green-700" title="WhatsApp">
              <MessageCircle className="w-4 h-4" />
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="p-1.5 rounded hover:bg-cyan-100 text-cyan-700" title="Email">
              <Mail className="w-4 h-4" />
            </a>
          )}
          <Link href={`/leads/${lead.id}`} className="p-1.5 rounded hover:bg-fg-surface text-fg-muted hover:text-fg-text" title="Open detail">
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </td>
    </tr>
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
