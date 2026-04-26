// Single source of truth for products, families, and bucket definitions.
// Used by Queue, Lead Detail, and any new pages that need consistent labels.

export type Family = "forge" | "live";

export type Product = {
  code: string;        // matches leads.program in Supabase
  name: string;        // short display name
  longName: string;    // full display name
  family: Family;
  appFeeInr: number;   // for personalized talking points
  color: string;       // tailwind color stem (rose, cyan, lime, amber, blue, etc.)
};

// Per-product color scheme (locked in by founder):
//   FFM  = yellow         (Forge Filmmaking)
//   FW   = sky / light blue (Forge Writing)
//   FC   = red            (Forge Creators)
//   FAI  = indigo / dark blue (Forge AI)
export const PRODUCTS: Product[] = [
  // Forge
  { code: "FFM", name: "Filmmaking", longName: "Forge Filmmaking", family: "forge", appFeeInr: 800, color: "yellow" },
  { code: "FW",  name: "Writing",    longName: "Forge Writing",    family: "forge", appFeeInr: 600, color: "sky"    },
  { code: "FC",  name: "Creators",   longName: "Forge Creators",   family: "forge", appFeeInr: 700, color: "red"    },
  { code: "FAI", name: "AI",         longName: "Forge AI",         family: "forge", appFeeInr: 900, color: "indigo" },
  // Live
  { code: "VE",  name: "Video Editing", longName: "Video Editing Academy",            family: "live", appFeeInr: 400, color: "blue"    },
  { code: "BFP", name: "BFP",           longName: "Breakthrough Filmmakers' Program", family: "live", appFeeInr: 400, color: "violet"  },
  { code: "L3C", name: "L3 Creators",   longName: "LevelUp Creator Academy",          family: "live", appFeeInr: 400, color: "fuchsia" },
];

export const FAMILIES: Family[] = ["forge", "live"];

export const PRODUCTS_BY_FAMILY: Record<Family, Product[]> = {
  forge: PRODUCTS.filter(p => p.family === "forge"),
  live:  PRODUCTS.filter(p => p.family === "live"),
};

export const PRODUCT_BY_CODE: Record<string, Product> = Object.fromEntries(
  PRODUCTS.map(p => [p.code, p])
);

// ----------------------------------------------------------------
// Bucket definitions — used by /queue and any other "what to call next" UI
// ----------------------------------------------------------------

export type BucketId = "abandoned" | "need_to_book" | "partials";

export type BucketDef = {
  id: BucketId;
  label: string;          // user-facing — matches user's exact naming
  shortLabel: string;     // for tab buttons
  description: string;
  funnelStage: string;    // Supabase leads.funnel_stage value
  // Visual treatment
  cls: string;
  badgeCls: string;
  rank: "A" | "B" | "C";
};

export const BUCKETS: Record<BucketId, BucketDef> = {
  abandoned: {
    id: "abandoned",
    label: "Abandoned Leads",
    shortLabel: "Abandoned",
    description: "Filled the application fully but didn't pay the application fee. Highest-leverage call — they're qualified, just need a nudge to pay.",
    funnelStage: "form_submitted",
    cls: "border-amber-300 text-amber-900 bg-amber-50",
    badgeCls: "bg-amber-100 text-amber-900",
    rank: "A",
  },
  need_to_book: {
    id: "need_to_book",
    label: "Need To Book Interview",
    shortLabel: "Need to book interview",
    description: "Paid the application fee but hasn't booked a Calendly interview yet. Push them to pick a slot — biggest drop-off in the funnel.",
    funnelStage: "accepted",
    cls: "border-cyan-300 text-cyan-900 bg-cyan-50",
    badgeCls: "bg-cyan-100 text-cyan-900",
    rank: "B",
  },
  partials: {
    id: "partials",
    label: "Partial Form Submissions",
    shortLabel: "Partial forms",
    description: "Started the application but didn't finish. Soft re-engagement — a short message often recovers them.",
    funnelStage: "form_partial",
    cls: "border-slate-300 text-slate-700 bg-slate-50",
    badgeCls: "bg-slate-100 text-slate-700",
    rank: "C",
  },
};

export const BUCKET_ORDER: BucketId[] = ["abandoned", "need_to_book", "partials"];

// Tailwind needs literal class names to be detected — so we can't fully dynamic
// the color helpers. These return safe sets per product color.
export function productAccents(color: string) {
  // Tailwind needs literal class names — keep this map in sync with PRODUCTS' color values.
  const map: Record<string, { dot: string; tabActive: string; chip: string; soft: string }> = {
    yellow:  { dot: "bg-yellow-500",  tabActive: "border-yellow-500 text-yellow-700",   chip: "text-yellow-800 bg-yellow-50 ring-1 ring-yellow-200",  soft: "bg-yellow-50/60" },
    sky:     { dot: "bg-sky-400",     tabActive: "border-sky-500 text-sky-700",         chip: "text-sky-700 bg-sky-50 ring-1 ring-sky-200",            soft: "bg-sky-50/60" },
    red:     { dot: "bg-red-500",     tabActive: "border-red-500 text-red-700",         chip: "text-red-700 bg-red-50 ring-1 ring-red-200",            soft: "bg-red-50/60" },
    indigo:  { dot: "bg-indigo-700",  tabActive: "border-indigo-700 text-indigo-700",   chip: "text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200",   soft: "bg-indigo-50/60" },
    rose:    { dot: "bg-rose-500",    tabActive: "border-rose-500 text-rose-700",       chip: "text-rose-700 bg-rose-50 ring-1 ring-rose-200",          soft: "bg-rose-50/60" },
    cyan:    { dot: "bg-cyan-500",    tabActive: "border-cyan-500 text-cyan-700",       chip: "text-cyan-700 bg-cyan-50 ring-1 ring-cyan-200",          soft: "bg-cyan-50/60" },
    lime:    { dot: "bg-lime-500",    tabActive: "border-lime-500 text-lime-700",       chip: "text-lime-700 bg-lime-50 ring-1 ring-lime-200",          soft: "bg-lime-50/60" },
    amber:   { dot: "bg-amber-500",   tabActive: "border-amber-500 text-amber-700",     chip: "text-amber-700 bg-amber-50 ring-1 ring-amber-200",       soft: "bg-amber-50/60" },
    blue:    { dot: "bg-blue-500",    tabActive: "border-blue-500 text-blue-700",       chip: "text-blue-700 bg-blue-50 ring-1 ring-blue-200",          soft: "bg-blue-50/60" },
    violet:  { dot: "bg-violet-500",  tabActive: "border-violet-500 text-violet-700",   chip: "text-violet-700 bg-violet-50 ring-1 ring-violet-200",    soft: "bg-violet-50/60" },
    fuchsia: { dot: "bg-fuchsia-500", tabActive: "border-fuchsia-500 text-fuchsia-700", chip: "text-fuchsia-700 bg-fuchsia-50 ring-1 ring-fuchsia-200", soft: "bg-fuchsia-50/60" },
  };
  return map[color] || { dot: "bg-slate-400", tabActive: "border-slate-500 text-slate-700", chip: "text-slate-700 bg-slate-50 ring-1 ring-slate-200", soft: "bg-slate-50/60" };
}

export function familyLabel(f: Family): string {
  return f === "forge" ? "Forge" : "Live";
}
