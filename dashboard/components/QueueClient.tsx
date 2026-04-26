"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Phone, MessageCircle, Mail, ChevronRight, CheckCircle2, Radio, Flame, Zap, Clock,
  IndianRupee, Sparkles,
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
function fmtSubmitted(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
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

// Stub for incentive math — config-driven so user can edit one place.
// TODO: when user sends real incentive ladder, populate this from a config file.
function incentiveFor(score: number, bucketId: BucketId): { amount: number; label: string } | null {
  // Simple inverse-linear stub: lower score → higher payout (harder to convert).
  // base 1500, +20 per (100-score) point, capped 100% above for partials/abandoned.
  if (bucketId === "partials") return null; // partials not yet incentivized
  const base = bucketId === "abandoned" ? 1500 : 800; // app fee push pays more than booking push
  const variable = Math.max(0, (100 - score)) * 18;
  const amount = Math.round(base + variable);
  const label = bucketId === "abandoned" ? "if app fee paid" : "if interview booked";
  return { amount, label };
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

  // Auto-refresh every 30s while tab visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        router.refresh();
        setLastRefresh(new Date());
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [router]);

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

  useEffect(() => {
    const cur = PRODUCT_BY_CODE[product];
    if (!cur || cur.family !== family) {
      const first = PRODUCTS_BY_FAMILY[family][0]?.code;
      if (first) setProduct(first);
    }
  }, [family, product]);

  const setFamilyP  = (f: Family)   => { setFamily(f);  localStorage.setItem("levelup-family", f); };
  const setProductP = (p: string)   => { setProduct(p); localStorage.setItem("levelup-current-product", p); };
  const setBucketP  = (b: BucketId) => { setBucket(b);  localStorage.setItem("levelup-current-bucket", b); };

  const bookedSet = useMemo(() => new Set(bookedEmails), [bookedEmails]);

  // Leads filtered to current product
  const productLeads = useMemo(
    () => initialLeads.filter(l => l.program === product),
    [initialLeads, product]
  );

  // Bucket filtered (with Calendly de-dup for B)
  const bucketed = useMemo(() => {
    const out: Record<BucketId, LeadRow[]> = { abandoned: [], need_to_book: [], partials: [] };
    for (const l of productLeads) {
      const b = bucketFor(l);
      if (!b) continue;
      if (b === "need_to_book" && calendlyConnected) {
        const email = (l.email || "").toLowerCase();
        if (email && bookedSet.has(email)) continue;
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

  // Counts across ALL products (drives the product-tab badges)
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

  // Today's Focus stats — across the CURRENT product
  const focus = useMemo(() => {
    const newLastHour = productLeads.filter(l => hoursSince(l.first_seen) <= 1).length;
    const new24h      = productLeads.filter(l => hoursSince(l.first_seen) <= 24).length;
    const oldestHotInQueue = bucketed.abandoned.concat(bucketed.need_to_book)
      .map(l => hoursSince(l.first_seen))
      .filter(h => Number.isFinite(h))
      .sort((a, b) => b - a)[0] || 0;
    return { newLastHour, new24h, oldestHotInQueue };
  }, [productLeads, bucketed]);

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
              <span className="ml-2 text-amber-700 italic">· Calendly disconnected</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Radio className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
          <span>Auto-refresh · 30s</span>
          <span className="text-fg-subtle hidden md:inline">· {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div>
      </div>

      {/* Family tabs */}
      <FamilyTabs current={family} onChange={setFamilyP} />

      {/* Product tabs */}
      <ProductTabs family={family} current={product} counts={productCounts} onChange={setProductP} />

      {/* Today's Focus banner */}
      {mounted && (
        <FocusBanner
          productName={productMeta?.longName || product}
          newLastHour={focus.newLastHour}
          new24h={focus.new24h}
          oldestHotHours={focus.oldestHotInQueue}
          totalAbandoned={bucketed.abandoned.length}
          totalNeedBook={bucketed.need_to_book.length}
        />
      )}

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
              <span className={`w-2.5 h-2.5 rounded-full ${aux.dot}`} />
              <span className="font-semibold">{p.name}</span>
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
// Today's Focus banner — what changed in the last hour
// ----------------------------------------------------------------
function FocusBanner({ productName, newLastHour, new24h, oldestHotHours, totalAbandoned, totalNeedBook }: {
  productName: string; newLastHour: number; new24h: number; oldestHotHours: number; totalAbandoned: number; totalNeedBook: number;
}) {
  if (newLastHour === 0 && new24h === 0 && totalAbandoned === 0 && totalNeedBook === 0) return null;
  const oldestLabel = oldestHotHours < 1 ? `${Math.round(oldestHotHours * 60)}m`
                    : oldestHotHours < 24 ? `${Math.round(oldestHotHours)}h`
                    : `${Math.round(oldestHotHours / 24)}d`;
  return (
    <div className="surface-card mt-3 mb-4 p-4 bg-gradient-to-br from-amber-50/60 via-white to-yellow-50/40 border-l-4 border-l-yellow-500">
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-fg-text mb-1.5">Today&apos;s focus · {productName}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FocusStat icon={<Zap className="w-3.5 h-3.5"/>} value={newLastHour} label="new in last hour" tone={newLastHour > 0 ? "hot" : "neutral"} />
            <FocusStat icon={<Clock className="w-3.5 h-3.5"/>} value={new24h} label="new in 24h" tone="neutral" />
            <FocusStat icon={<Flame className="w-3.5 h-3.5"/>} value={totalAbandoned} label="awaiting app fee" tone={totalAbandoned > 0 ? "warm" : "neutral"} />
            <FocusStat icon={<Clock className="w-3.5 h-3.5"/>} valueText={oldestLabel} label="oldest in queue" tone={oldestHotHours > 24 ? "hot" : "warm"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FocusStat({ icon, value, valueText, label, tone }: { icon: React.ReactNode; value?: number; valueText?: string; label: string; tone: "hot" | "warm" | "neutral" }) {
  const toneCls = tone === "hot" ? "text-amber-700" : tone === "warm" ? "text-cyan-700" : "text-fg-text";
  return (
    <div className="flex items-baseline gap-2">
      <span className={`${toneCls}`}>{icon}</span>
      <span className={`text-xl font-bold tabular-nums ${toneCls}`}>{valueText ?? value}</span>
      <span className="text-xs text-fg-muted leading-tight">{label}</span>
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
            ? "Live program ingestion (VE / BFP / L3C Tally forms) hasn't been wired yet."
            : "Either the queue is empty, or all leads in this bucket have been moved on."}
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
              <th className="py-3 px-2 font-medium">Submitted</th>
              <th className="py-3 px-2 font-medium">Why hot</th>
              <th className="py-3 px-2 font-medium w-32">Incentive</th>
              <th className="py-3 px-2 font-medium w-44">Status</th>
              <th className="py-3 pr-4 pl-2 font-medium w-44">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.slice(0, 200).map((l, i) => (
              <LeadRowView key={l.id} lead={l} rank={i + 1} bucketId={bucketId} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 text-xs bg-fg-surface text-fg-muted border-t border-fg-border">
        Showing {Math.min(leads.length, 200).toLocaleString("en-IN")} of {leads.length.toLocaleString("en-IN")} in <span className="font-semibold text-fg-text">{BUCKETS[bucketId].label}</span>
      </div>
    </div>
  );
}

function LeadRowView({ lead, rank, bucketId }: { lead: LeadRow; rank: number; bucketId: BucketId }) {
  const why = whyHotReason(lead);
  const submittedRecent = hoursSince(lead.first_seen) <= 1;
  const incentive = incentiveFor(lead.score, bucketId);
  return (
    <tr className={`border-b border-fg-border/70 row-hover align-top ${submittedRecent ? "bg-yellow-50/40" : ""}`}>
      <td className="py-3 pl-4 pr-2 text-xs text-fg-subtle tabular-nums">{rank}</td>
      <td className="py-3 px-2"><ScoreBadge score={lead.score} breakdown={lead.score_breakdown} /></td>
      <td className="py-3 px-2 max-w-[220px]">
        <div className="flex items-center gap-1.5">
          <Link href={`/leads/${lead.id}`} className="font-medium text-fg-text hover:text-amber-700 hover:underline truncate inline-block max-w-full">
            {lead.name || <span className="italic text-fg-subtle">No name</span>}
          </Link>
          {submittedRecent && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-500 text-white shrink-0">NEW</span>}
        </div>
        {lead.email && (
          <div className="text-xs text-fg-muted truncate" title={lead.email}>{lead.email}</div>
        )}
      </td>
      <td className="py-3 px-2 tabular-nums whitespace-nowrap">
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className="text-fg-text hover:text-emerald-700 hover:underline">+{lead.phone}</a>
        ) : <span className="text-fg-subtle italic">missing</span>}
      </td>
      <td className="py-3 px-2 whitespace-nowrap text-xs text-fg-muted">
        <div className={submittedRecent ? "text-yellow-700 font-semibold" : ""}>{fmtSubmitted(lead.first_seen)}</div>
        <div className="text-fg-subtle text-[10px]">{fmtAgo(lead.first_seen)} ago</div>
      </td>
      <td className="py-3 px-2 max-w-[280px]">
        <p className="text-xs text-fg-text/85 leading-snug line-clamp-2">{why}</p>
      </td>
      <td className="py-3 px-2 whitespace-nowrap">
        {incentive ? (
          <div className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
            <IndianRupee className="w-3 h-3" />
            <span className="text-xs font-bold tabular-nums">{incentive.amount.toLocaleString("en-IN")}</span>
          </div>
        ) : <span className="text-fg-subtle text-xs">—</span>}
      </td>
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

function ScoreBadge({ score, breakdown }: { score: number; breakdown?: Record<string, number> }) {
  // Recalibrated thresholds (founder feedback): scores feel low because most leads
  // sit at form_submitted, capping funnel pts at 12/35. Lowering Hot to 50 below.
  let cls;
  if (score >= 75)      cls = "bg-amber-500 text-white shadow-sm shadow-amber-500/30";  // super hot
  else if (score >= 50) cls = "bg-emerald-500 text-white shadow-sm";                     // hot
  else if (score >= 25) cls = "bg-cyan-100 text-cyan-800 ring-1 ring-cyan-200";          // warm
  else                  cls = "bg-slate-100 text-slate-500 ring-1 ring-slate-200";       // cold

  const tooltip = breakdown && Object.keys(breakdown).length > 0
    ? Object.entries(breakdown).filter(([_, v]) => Number(v) > 0).map(([k, v]) => `${k.replace(/_/g, " ")}: +${v}`).join(" · ")
    : `Score ${score}/100`;

  return (
    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-md font-bold text-xs tabular-nums ${cls} cursor-help`} title={tooltip}>
      {score}
    </div>
  );
}
