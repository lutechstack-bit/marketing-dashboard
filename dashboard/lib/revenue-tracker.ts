// Revenue Tracker sheet integration.
//
// This is a separate Google Sheet from the marketing rollup (different
// spreadsheet ID). It's the finance team's source of truth for:
//   - Per-student transaction log (cash inflows + refunds)
//   - Booked revenue, cash received, outstanding balances
//   - EMI tracking
//   - Drop-offs / re-engagement queue
//
// Setup: the GCP service account
//   forge-marketing-sync@levelup-marketing-sync.iam.gserviceaccount.com
// must be shared (Viewer access) on the Revenue Tracker sheet.
//
// Tabs we read (per the Revenue Tracker schema):
//   - "Metrics That Matter" — headline numbers (Booked Revenue, Cash Received,
//     Collection %, Outstanding, App→Enrollment %, Failed Transactions, etc.).
//     Comes pre-aggregated by Vertical/Product/Month.
//   - "Transaction Log" — individual transactions for cash flow charts.
//   - "Student Master" — per-student records, optional enrichment.
//
// Cached 1h since the sheet is updated manually a few times per day.

import { unstable_cache } from "next/cache";
import { readMultipleTabs, REVENUE_SHEET_ID } from "./sheets";

export type RevenueMetrics = {
  // Headline (filtered to All / All / latest month by default)
  booked_revenue_inr: number;
  cash_received_inr: number;
  outstanding_balance_inr: number;
  lost_written_off_inr: number;
  refunds_inr: number;
  collection_pct: number;       // 0–100
  net_cash_in_inr: number;
  applications: number;
  new_enrollments: number;
  conversions: number;
  conversion_rate_pct: number;
  app_to_enrollment_pct: number;
  failed_transactions: number;
  avg_revenue_per_student_inr: number;
  avg_collected_per_student_inr: number;
  // Time series — booked vs collected by cohort month
  by_cohort_month: { month: string; booked_inr: number; collected_inr: number }[];
  // Cash flow per month
  cash_flow_monthly: { month: string; cash_in_inr: number; refunds_inr: number; net_inr: number }[];
  // Provenance
  fetched_at: string;
  ok: boolean;
  error: string | null;
};

const num = (x: any): number => {
  if (x == null || x === "") return 0;
  if (typeof x === "number") return x;
  // Handle "₹387,500" / "19.7%" / "1,23,456" etc.
  const s = String(x).replace(/[₹,]/g, "").replace(/%$/, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Pull headline metrics + light time-series from the Revenue Tracker sheet.
 * Returns ok:false with error reason if the sheet isn't shared with the
 * service account (graceful degradation).
 */
async function fetchRevenueMetricsImpl(): Promise<RevenueMetrics> {
  const empty: RevenueMetrics = {
    booked_revenue_inr: 0, cash_received_inr: 0, outstanding_balance_inr: 0,
    lost_written_off_inr: 0, refunds_inr: 0, collection_pct: 0, net_cash_in_inr: 0,
    applications: 0, new_enrollments: 0, conversions: 0, conversion_rate_pct: 0,
    app_to_enrollment_pct: 0, failed_transactions: 0,
    avg_revenue_per_student_inr: 0, avg_collected_per_student_inr: 0,
    by_cohort_month: [], cash_flow_monthly: [],
    fetched_at: new Date().toISOString(), ok: false, error: null,
  };

  let tabs: Record<string, string[][]>;
  try {
    tabs = await readMultipleTabs(
      ["Metrics That Matter", "Transaction Log"],
      REVENUE_SHEET_ID,
    );
  } catch (e: any) {
    return { ...empty, error: e?.message || "fetch failed" };
  }

  // ---- Parse "Metrics That Matter" ----
  // Layout (per the screenshot):
  //   Row 1 → "METRICS THAT MATTER"
  //   Row 3 → Vertical / Product / Month dropdowns
  //   Row 5–6 → Booked Revenue · Cash Received · Collection % · Outstanding · Lost
  //   Row 8–9 → Net Cash In · Applications · New Enrollments · Conversions · Conv Rate
  //   Row 11–12 → Refunds · Avg Rev / Student · Avg Collected / Student · App→Enrollment % · Failed Tx
  // We grab these by labeled lookup so a row reorder doesn't break us.
  const m = tabs["Metrics That Matter"] || [];
  const findValueByLabel = (label: string): number => {
    const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < (m[r] || []).length; c++) {
        const cell = String(m[r][c] || "").trim();
        if (re.test(cell)) {
          // Value is typically directly below (next non-empty row, same column)
          for (let d = r + 1; d < Math.min(r + 4, m.length); d++) {
            const v = m[d]?.[c];
            if (v != null && String(v).trim() !== "") return num(v);
          }
        }
      }
    }
    return 0;
  };

  const bookedRevenue       = findValueByLabel("Booked Revenue");
  const cashReceived        = findValueByLabel("Cash Received");
  const collectionPct       = findValueByLabel("Collection %");
  const outstandingBalance  = findValueByLabel("Outstanding Balance");
  const lostWrittenOff      = findValueByLabel("Lost / Written-Off");
  const netCashIn           = findValueByLabel("Net Cash In");
  const applications        = findValueByLabel("Applications");
  const newEnrollments      = findValueByLabel("New Enrollments");
  const conversions         = findValueByLabel("Conversions");
  const conversionRate      = findValueByLabel("Conversion Rate");
  const refunds             = findValueByLabel("Refunds \\(Money Out\\)");
  const avgRevPerStudent    = findValueByLabel("Avg Revenue / Student");
  const avgCollectedStudent = findValueByLabel("Avg Collected / Student");
  const appToEnrollmentPct  = findValueByLabel("App → Enrollment %") || findValueByLabel("App ?? Enrollment %");
  const failedTx            = findValueByLabel("Failed Transactions");

  // ---- Parse "Transaction Log" — group by month for charts ----
  // Expected columns (will be confirmed once sheet is shared):
  //   date, student_id/email, program, type (booking/payment/refund), amount_inr, ...
  const tl = tabs["Transaction Log"] || [];
  const monthlyBooked = new Map<string, number>();
  const monthlyCollected = new Map<string, number>();
  const monthlyRefunds = new Map<string, number>();
  if (tl.length > 1) {
    const header = (tl[0] || []).map(h => String(h).toLowerCase().trim());
    const colDate    = header.findIndex(h => /date|paid|recorded/i.test(h));
    const colType    = header.findIndex(h => /type|status|category/i.test(h));
    const colAmount  = header.findIndex(h => /amount|inr|value/i.test(h));
    if (colDate >= 0 && colAmount >= 0) {
      for (let i = 1; i < tl.length; i++) {
        const row = tl[i] || [];
        const dRaw = row[colDate];
        if (!dRaw) continue;
        const d = new Date(String(dRaw));
        if (isNaN(d.getTime())) continue;
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const amt = num(row[colAmount]);
        const type = String(row[colType] || "").toLowerCase();
        if (/refund/i.test(type)) {
          monthlyRefunds.set(ym, (monthlyRefunds.get(ym) || 0) + amt);
        } else if (/booking|booked|application/i.test(type)) {
          monthlyBooked.set(ym, (monthlyBooked.get(ym) || 0) + amt);
        } else {
          // Default: treat as cash collection
          monthlyCollected.set(ym, (monthlyCollected.get(ym) || 0) + amt);
        }
      }
    }
  }

  // Merge to one set of months
  const months = Array.from(new Set([
    ...monthlyBooked.keys(), ...monthlyCollected.keys(), ...monthlyRefunds.keys(),
  ])).sort();
  const by_cohort_month = months.map(month => ({
    month,
    booked_inr:   monthlyBooked.get(month)   || 0,
    collected_inr: monthlyCollected.get(month) || 0,
  }));
  const cash_flow_monthly = months.map(month => {
    const cashIn = monthlyCollected.get(month) || 0;
    const refundsM = monthlyRefunds.get(month) || 0;
    return { month, cash_in_inr: cashIn, refunds_inr: refundsM, net_inr: cashIn - refundsM };
  });

  return {
    booked_revenue_inr:    bookedRevenue,
    cash_received_inr:     cashReceived,
    outstanding_balance_inr: outstandingBalance,
    lost_written_off_inr:  lostWrittenOff,
    refunds_inr:           refunds,
    collection_pct:        collectionPct,
    net_cash_in_inr:       netCashIn,
    applications:          applications,
    new_enrollments:       newEnrollments,
    conversions:           conversions,
    conversion_rate_pct:   conversionRate,
    app_to_enrollment_pct: appToEnrollmentPct,
    failed_transactions:   failedTx,
    avg_revenue_per_student_inr:   avgRevPerStudent,
    avg_collected_per_student_inr: avgCollectedStudent,
    by_cohort_month,
    cash_flow_monthly,
    fetched_at: new Date().toISOString(),
    ok: true,
    error: null,
  };
}

/** Cached entry point — 1h TTL, tag "revenue-tracker" so it can be invalidated separately. */
export const fetchRevenueMetrics = unstable_cache(
  fetchRevenueMetricsImpl,
  ["revenue-tracker-v1"],
  { revalidate: 3600, tags: ["revenue-tracker"] },
);
