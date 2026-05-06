// Per-program × per-month scorecards — replaces the manually-maintained
// "Inputs" tab in the marketing sheet with live computed metrics.
//
// For each (program, month) cell we compute, from canonical sources:
//   - applications        : leads created in that month for that program
//                           (Supabase leads.first_seen / created_at)
//   - app_fees_paid       : leads who reached app_fee_paid+ (cumulative,
//                           anchored to the lead's first_seen month)
//   - converts            : leads at balance_paid (cumulative)
//   - app_fee_revenue_inr : sum of payments where payment_type='app_fee'
//                           AND program tagged AND paid_at in that month
//   - balance_revenue_inr : sum of payments where payment_type='full' AND
//                           program tagged AND paid_at in that month
//   - marketing_spend_inr : Meta API per-program-per-month
//   - cpa_inr             : marketing_spend / app_fees_paid
//   - cac_inr             : marketing_spend / converts
//   - app_fee_conv_pct    : app_fees_paid / applications × 100
//   - convert_rate_pct    : converts / applications × 100
//
// Cached 30 min, tag "leads" so webhook updates invalidate alongside the
// other lead-derived caches.

import { unstable_cache } from "next/cache";
import { supabase } from "./supabase";
import { fetchMonthlySpendByProgram } from "./meta-ads";
import { PRODUCTS } from "./products";

export type ProgramMonthScorecard = {
  program: string;
  family: "forge" | "live";
  ym: string;             // "YYYY-MM"
  year: number;
  month: number;
  applications: number;
  app_fees_paid: number;
  converts: number;
  app_fee_revenue_inr: number;
  balance_revenue_inr: number;
  total_revenue_inr: number;       // app_fee + balance
  marketing_spend_inr: number;     // Meta API, incl GST
  cpa_inr: number;                 // spend ÷ app_fees_paid
  cac_inr: number;                 // spend ÷ converts
  app_fee_conv_pct: number;        // app_fees_paid ÷ applications × 100
  convert_rate_pct: number;        // converts ÷ applications × 100
};

const PROGRESSED_STAGES = new Set(["app_fee_paid", "accepted", "confirmed", "balance_paid"]);
const CONVERTED_STAGES  = new Set(["balance_paid"]);

/** Helper: compute YYYY-MM from a JS Date or null. */
function ymOf(ts: any): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchProgramScorecardsImpl(opts: {
  monthsBack: number;
}): Promise<ProgramMonthScorecard[]> {
  const { monthsBack } = opts;
  const productMap = Object.fromEntries(PRODUCTS.map(p => [p.code, p.family]));
  const codes = PRODUCTS.map(p => p.code);

  // Build the months we care about
  const now = new Date();
  const months: { ym: string; year: number; month: number; startMs: number; endMs: number }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
    const startMs = Date.UTC(year, month - 1, 1);
    const endMs   = Date.UTC(year, month, 1);
    months.push({ ym: `${year}-${String(month).padStart(2, "0")}`, year, month, startMs, endMs });
  }
  const minStartMs = months[0].startMs;
  const maxEndMs   = months[months.length - 1].endMs;
  const sinceIso   = new Date(minStartMs).toISOString();
  const untilIso   = new Date(maxEndMs).toISOString();

  // Init cells
  const cells = new Map<string, ProgramMonthScorecard>();
  for (const code of codes) {
    for (const m of months) {
      const k = `${code}|${m.ym}`;
      cells.set(k, {
        program: code, family: productMap[code] as any, ym: m.ym, year: m.year, month: m.month,
        applications: 0, app_fees_paid: 0, converts: 0,
        app_fee_revenue_inr: 0, balance_revenue_inr: 0, total_revenue_inr: 0,
        marketing_spend_inr: 0, cpa_inr: 0, cac_inr: 0,
        app_fee_conv_pct: 0, convert_rate_pct: 0,
      });
    }
  }
  const bump = (code: string, ym: string, field: keyof ProgramMonthScorecard, by: number) => {
    const k = `${code}|${ym}`;
    const c = cells.get(k);
    if (!c) return;
    (c[field] as any) = ((c[field] as any) || 0) + by;
  };

  // ---- Leads — paginate parallel ----
  // Pull only leads in the time window. Use first_seen if set, else created_at
  // — same fallback as the rest of the dashboard.
  const PAGE = 1000;
  const countRes = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .in("program", codes)
    .gte("created_at", sinceIso)
    .lt("created_at", untilIso);
  const totalLeads = countRes.count || 0;
  const leadPages = Math.max(1, Math.ceil(totalLeads / PAGE));
  const leadResults = await Promise.all(
    Array.from({ length: leadPages }, (_, i) =>
      supabase
        .from("leads")
        .select("id,program,funnel_stage,first_seen,created_at")
        .in("program", codes)
        .gte("created_at", sinceIso)
        .lt("created_at", untilIso)
        .order("created_at", { ascending: false })
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );
  const allLeads = leadResults.flatMap(r => r.data || []);

  for (const l of allLeads as any[]) {
    const ym = ymOf(l.first_seen) || ymOf(l.created_at);
    if (!ym) continue;
    if (!cells.has(`${l.program}|${ym}`)) continue;
    bump(l.program, ym, "applications", 1);
    if (PROGRESSED_STAGES.has(l.funnel_stage)) bump(l.program, ym, "app_fees_paid", 1);
    if (CONVERTED_STAGES.has(l.funnel_stage))  bump(l.program, ym, "converts",      1);
  }

  // ---- Payments revenue — captured payments tagged with program ----
  const { data: pays } = await supabase
    .from("payments")
    .select("amount_inr,program,payment_type,paid_at,status")
    .eq("status", "captured")
    .gte("paid_at", sinceIso)
    .lt("paid_at", untilIso);
  for (const p of (pays || []) as any[]) {
    if (!p.program || !codes.includes(p.program)) continue;
    const ym = ymOf(p.paid_at);
    if (!ym) continue;
    if (!cells.has(`${p.program}|${ym}`)) continue;
    const amt = Number(p.amount_inr) || 0;
    if (p.payment_type === "app_fee") {
      bump(p.program, ym, "app_fee_revenue_inr", amt);
    } else if (p.payment_type === "full") {
      bump(p.program, ym, "balance_revenue_inr", amt);
    }
  }

  // ---- Marketing spend from Meta API (per-program × per-month) ----
  const meta = await fetchMonthlySpendByProgram({ monthsBack });
  if (meta) {
    for (const r of meta) {
      if (!cells.has(`${r.program}|${r.ym}`)) continue;
      bump(r.program, r.ym, "marketing_spend_inr", r.spend_inr);
    }
  }

  // ---- Final derived numbers ----
  const out: ProgramMonthScorecard[] = [];
  for (const c of cells.values()) {
    c.total_revenue_inr  = c.app_fee_revenue_inr + c.balance_revenue_inr;
    c.cpa_inr            = c.app_fees_paid > 0 ? Math.round(c.marketing_spend_inr / c.app_fees_paid) : 0;
    c.cac_inr            = c.converts      > 0 ? Math.round(c.marketing_spend_inr / c.converts)      : 0;
    c.app_fee_conv_pct   = c.applications  > 0 ? Math.round(1000 * c.app_fees_paid / c.applications) / 10 : 0;
    c.convert_rate_pct   = c.applications  > 0 ? Math.round(1000 * c.converts      / c.applications) / 10 : 0;
    out.push(c);
  }

  // Sort: program in PRODUCTS order, then month ASC
  const orderIdx = Object.fromEntries(codes.map((c, i) => [c, i]));
  out.sort((a, b) => (orderIdx[a.program] - orderIdx[b.program]) || a.ym.localeCompare(b.ym));
  return out;
}

export const fetchProgramScorecards = unstable_cache(
  async (monthsBack: number = 6) => fetchProgramScorecardsImpl({ monthsBack }),
  ["program-scorecards-v1"],
  { revalidate: 1800, tags: ["leads", "meta-ads"] },
);
