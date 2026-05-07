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
 * Sheets returns percentage cells as fractions (0.197 for "19.7%"). Detect
 * fractional values and multiply by 100. If the value is already > 1 we
 * assume it's already in percentage form.
 */
const pct = (x: any): number => {
  const n = num(x);
  if (n === 0) return 0;
  // If it looks like a fraction (0 < x < 1), it came from a Sheets % cell
  // and needs to be scaled. Anything ≥ 1 is treated as already-percent.
  return Math.abs(n) < 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
};

/**
 * Convert a value that may be a Google Sheets date serial (days since
 * 1899-12-30) or an ISO date string into a YYYY-MM cohort month string.
 * Returns null if unparseable.
 */
function parseCohortMonth(raw: any): string | null {
  if (raw == null || raw === "") return null;
  // Sheets date serial number → days since 1899-12-30
  if (typeof raw === "number" || /^\d+(\.\d+)?$/.test(String(raw))) {
    const serial = Number(raw);
    if (serial > 25569 && serial < 80000) { // 1970-01-01 to ~2119
      const ms = (serial - 25569) * 86400_000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      }
    }
    return null;
  }
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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

  // Helper: lookup raw cell value (not coerced through num())
  const findRawByLabel = (label: string): any => {
    const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < (m[r] || []).length; c++) {
        const cell = String(m[r][c] || "").trim();
        if (re.test(cell)) {
          for (let d = r + 1; d < Math.min(r + 4, m.length); d++) {
            const v = m[d]?.[c];
            if (v != null && String(v).trim() !== "") return v;
          }
        }
      }
    }
    return null;
  };

  const bookedRevenue       = findValueByLabel("Booked Revenue");
  const cashReceived        = findValueByLabel("Cash Received");
  const collectionPct       = pct(findRawByLabel("Collection %"));
  const outstandingBalance  = findValueByLabel("Outstanding Balance");
  const lostWrittenOff      = findValueByLabel("Lost / Written-Off");
  const netCashIn           = findValueByLabel("Net Cash In");
  const applications        = findValueByLabel("Applications");
  const newEnrollments      = findValueByLabel("New Enrollments");
  const conversions         = findValueByLabel("Conversions");
  const conversionRate      = pct(findRawByLabel("Conversion Rate"));
  const refunds             = findValueByLabel("Refunds \\(Money Out\\)");
  const avgRevPerStudent    = findValueByLabel("Avg Revenue / Student");
  const avgCollectedStudent = findValueByLabel("Avg Collected / Student");
  const appToEnrollmentPct  = pct(findRawByLabel("App → Enrollment %") || findRawByLabel("App ?? Enrollment %"));
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
        const ym = parseCohortMonth(row[colDate]);
        if (!ym) continue;
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

/** Cached entry point — 60s TTL for near-real-time refresh, tag
 * "revenue-tracker" so the dashboard reflects manual sheet edits within
 * a minute. Google Sheets API allows ~60 reads/min per service account
 * which is more than enough at this cache window. */
export const fetchRevenueMetrics = unstable_cache(
  fetchRevenueMetricsImpl,
  ["revenue-tracker-v2"],
  { revalidate: 60, tags: ["revenue-tracker"] },
);

// ============================================================================
// Per-program × per-month revenue from the Transaction Log
// ============================================================================
// The Transaction Log has columns: TXN ID, Date, Month, Student ID, Student Name,
// Product, Payment Type, Payment Mode, Amount (₹), Razorpay ID, EMI #, Txn Status,
// Remarks, TeleCRM Lead ID, Notes. We aggregate by (Product, Month, Payment Type)
// for successful transactions only.

export type ProgramMonthRevenue = {
  program: string;          // FFM/FW/FC/FAI/BFP/VE/L3C
  ym: string;               // "YYYY-MM"
  year: number;
  month: number;
  app_fee_revenue_inr: number;     // Payment Type = "Application Fee"
  confirmation_revenue_inr: number; // "Confirmation Fee"
  balance_revenue_inr: number;     // "Balance" / "Full" / EMI installments
  total_revenue_inr: number;
  // Counts of distinct STUDENTS per payment type in the month — used to
  // populate "app fees paid" / "converts" with payment-date semantics.
  app_fee_student_count: number;
  confirmation_student_count: number;
  balance_student_count: number;
  // Total transaction rows in month (for diagnostics)
  txn_count: number;
};

const MONTH_TOKEN_TO_NUM: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** Parse "Mar-26" → { year: 2026, month: 3 } */
function parseMonthToken(raw: any): { year: number; month: number; ym: string } | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^([A-Za-z]{3})[-/\s]?(\d{2,4})$/);
  if (!m) return null;
  const monthNum = MONTH_TOKEN_TO_NUM[m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()];
  if (!monthNum) return null;
  let year = parseInt(m[2]);
  if (year < 100) year += 2000;
  return { year, month: monthNum, ym: `${year}-${String(monthNum).padStart(2, "0")}` };
}

async function fetchRevenueByProgramMonthImpl(): Promise<ProgramMonthRevenue[]> {
  let tabs: Record<string, string[][]>;
  try {
    tabs = await readMultipleTabs(["Transaction Log"], REVENUE_SHEET_ID);
  } catch (e: any) {
    return [];
  }
  const tl = tabs["Transaction Log"] || [];
  if (tl.length < 2) return [];

  const header = (tl[0] || []).map(h => String(h).toLowerCase().trim());
  const colMonth     = header.findIndex(h => /^month$/.test(h));
  const colStudentId = header.findIndex(h => /^student\s*id$/.test(h));
  const colProduct   = header.findIndex(h => /^\s*product\s*$/.test(h));
  const colPayType   = header.findIndex(h => /payment\s*type/.test(h));
  const colAmount    = header.findIndex(h => /amount/.test(h));
  const colStatus    = header.findIndex(h => /txn\s*status|status/.test(h));

  if (colMonth < 0 || colProduct < 0 || colPayType < 0 || colAmount < 0 || colStatus < 0) {
    return [];
  }

  // Aggregate by (program, ym). Track distinct students per payment-type
  // bucket so "9 app fees paid in May" really counts 9 unique students who
  // paid an app fee that month (not 9 transactions for the same student).
  type Cell = ProgramMonthRevenue & {
    _app_fee_students: Set<string>;
    _confirmation_students: Set<string>;
    _balance_students: Set<string>;
  };
  const cells = new Map<string, Cell>();
  const VALID_PROGS = new Set(["FFM", "FW", "FC", "FAI", "BFP", "VE", "L3C"]);
  for (let i = 1; i < tl.length; i++) {
    const row = tl[i] || [];
    const status = String(row[colStatus] || "").toLowerCase();
    if (!/success/i.test(status)) continue;       // skip failed / pending
    const product = String(row[colProduct] || "").trim().toUpperCase();
    if (!VALID_PROGS.has(product)) continue;
    const monthInfo = parseMonthToken(row[colMonth]);
    if (!monthInfo) continue;
    const amt = num(row[colAmount]);
    if (!amt) continue;
    const ptype = String(row[colPayType] || "").toLowerCase();
    const studentId = colStudentId >= 0 ? String(row[colStudentId] || "").trim() : "";
    // Fall back to txn id if student id is empty so each row counts as 1 unique
    const studentKey = studentId || `__txn_${i}`;
    const key = `${product}|${monthInfo.ym}`;
    if (!cells.has(key)) {
      cells.set(key, {
        program: product, ym: monthInfo.ym, year: monthInfo.year, month: monthInfo.month,
        app_fee_revenue_inr: 0, confirmation_revenue_inr: 0, balance_revenue_inr: 0,
        total_revenue_inr: 0,
        app_fee_student_count: 0, confirmation_student_count: 0, balance_student_count: 0,
        txn_count: 0,
        _app_fee_students: new Set(), _confirmation_students: new Set(), _balance_students: new Set(),
      });
    }
    const c = cells.get(key)!;
    c.txn_count++;
    if (/application\s*fee|app\s*fee/i.test(ptype)) {
      c.app_fee_revenue_inr += amt;
      c._app_fee_students.add(studentKey);
    } else if (/confirmation/i.test(ptype)) {
      c.confirmation_revenue_inr += amt;
      c._confirmation_students.add(studentKey);
    } else {
      c.balance_revenue_inr += amt;
      c._balance_students.add(studentKey);
    }
    c.total_revenue_inr += amt;
  }
  // Materialize counts and strip working sets
  return Array.from(cells.values())
    .map(c => ({
      program: c.program, ym: c.ym, year: c.year, month: c.month,
      app_fee_revenue_inr: c.app_fee_revenue_inr,
      confirmation_revenue_inr: c.confirmation_revenue_inr,
      balance_revenue_inr: c.balance_revenue_inr,
      total_revenue_inr: c.total_revenue_inr,
      app_fee_student_count: c._app_fee_students.size,
      confirmation_student_count: c._confirmation_students.size,
      balance_student_count: c._balance_students.size,
      txn_count: c.txn_count,
    }))
    .sort((a, b) => a.program.localeCompare(b.program) || a.ym.localeCompare(b.ym));
}

/** Cached 60s — same near-real-time policy as fetchRevenueMetrics. */
export const fetchRevenueByProgramMonth = unstable_cache(
  fetchRevenueByProgramMonthImpl,
  ["revenue-by-program-month-v1"],
  { revalidate: 60, tags: ["revenue-tracker"] },
);

// ============================================================================
// Dashboard tab — all-time headline numbers
// ============================================================================

export type RevenueDashboard = {
  total_students: number;
  active_students: number;
  drop_offs: number;
  total_booked_inr: number;
  cash_collected_inr: number;
  collection_pct: number;
  ok: boolean;
  fetched_at: string;
};

async function fetchRevenueDashboardImpl(): Promise<RevenueDashboard> {
  const empty: RevenueDashboard = {
    total_students: 0, active_students: 0, drop_offs: 0,
    total_booked_inr: 0, cash_collected_inr: 0, collection_pct: 0,
    ok: false, fetched_at: new Date().toISOString(),
  };
  let tabs: Record<string, string[][]>;
  try {
    tabs = await readMultipleTabs(["Dashboard"], REVENUE_SHEET_ID);
  } catch (e) { return empty; }
  const rows = tabs["Dashboard"] || [];
  if (rows.length < 3) return empty;

  // Layout (per probe): row 1 has labels, row 2 has values
  // Total Students | Active Students | Drop-Offs | Total Booked | Cash Collected | Collection %
  const labels = (rows[1] || []).map(c => String(c || "").trim());
  const values = rows[2] || [];

  const findIdx = (re: RegExp) => labels.findIndex(l => re.test(l));
  return {
    total_students:    num(values[findIdx(/total\s*students/i)]),
    active_students:   num(values[findIdx(/active\s*students/i)]),
    drop_offs:         num(values[findIdx(/drop[\s-]?offs?/i)]),
    total_booked_inr:  num(values[findIdx(/total\s*booked/i)]),
    cash_collected_inr: num(values[findIdx(/cash\s*collected/i)]),
    collection_pct:    pct(values[findIdx(/collection\s*%/i)]),
    ok: true,
    fetched_at: new Date().toISOString(),
  };
}

export const fetchRevenueDashboard = unstable_cache(
  fetchRevenueDashboardImpl,
  ["revenue-dashboard-v1"],
  { revalidate: 60, tags: ["revenue-tracker"] },
);
