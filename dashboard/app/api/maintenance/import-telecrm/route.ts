// Generic CSV bulk-import endpoint.
//
// Used by /admin/import (and originally by the one-off TeleCRM bootstrap).
// Accepts a batch of arbitrary rows + a column-mapping config so the same
// endpoint handles any vendor's export, not just TeleCRM.
//
// Performance: bulk-upserts in 3 queries per batch (pre-fetch existing → bulk
// upsert leads by id → bulk upsert form_submissions by id). 10-20× faster
// than the per-row sequential pattern.
//
// Auth: ADMIN_BOOTSTRAP_TOKEN (also passes through if caller is an
// authenticated admin/founder, so the in-dashboard import doesn't need a
// separate token).
//
// POST /api/maintenance/import-telecrm[?token=...]
// Body: {
//   rows: Array<Record<string, any>>,
//   mapping?: ColumnMapping,
//   defaults?: { program?, status?, source? },
// }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { scoreLead } from "@/lib/scoring";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// --------------------------------------------------------------- types

type ColumnMapping = {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  program?: string;
  status?: string;
  lost_reason?: string;
  reason?: string;        // essay
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
  // free-form: keep these arbitrary CSV columns in form_submissions.responses
  passthrough?: string[];
  // optional date columns (so historical timestamps survive)
  created_at?: string;
  last_activity?: string;
};

type Defaults = { program?: string; status?: string; source?: string };

// --------------------------------------------------------------- helpers

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const PROGRAM_MAP: Record<string, string> = {
  "FFM": "FFM", "FORGE FILMMAKING": "FFM",
  "FW": "FW",   "FORGE WRITING": "FW",
  "FC": "FC",   "FORGE CREATORS": "FC",
  "FAI": "FAI", "FORGE AI": "FAI",
  "BFP": "BFP", "BUSINESS FOUNDATIONS": "BFP",
  "VE": "VE",   "VENTURE ENGINE": "VE", "LIVE VE": "VE",
  "L3C": "L3C",
};

function normalizeProgram(p?: string | null): string | null {
  if (p == null) return null;
  const k = String(p).trim().toUpperCase();
  if (!k || k === "-" || k === "—") return null;
  return PROGRAM_MAP[k] || null;
}

function normalizePhone(raw?: string | null): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function normalizeEmail(raw?: string | null): string | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v || v === "-" || !v.includes("@")) return null;
  return v;
}

function buildName(row: any, m: ColumnMapping): string | null {
  if (m.full_name && row[m.full_name]) {
    const v = String(row[m.full_name]).trim();
    if (v && v !== "-") return v;
  }
  const first = m.first_name ? String(row[m.first_name] || "").trim() : "";
  const last  = m.last_name  ? String(row[m.last_name]  || "").trim() : "";
  const lastClean = last && last !== "_" && last !== "-" ? last : "";
  const full = [first, lastClean].filter(Boolean).join(" ").trim();
  return full || null;
}

// All status strings → funnel_stage. Anything we don't recognize defaults to
// form_submitted. Keys are upper-case for case-insensitive matching.
const STAGE_MAP: Record<string, string> = {
  "NEW": "form_submitted",
  "HOT": "form_submitted",
  "FOLLOW-UP": "form_submitted", "FOLLOWUP": "form_submitted",
  "CALL BACK": "form_submitted", "CALLBACK": "form_submitted",
  "DNP REMINDER": "form_submitted",
  "DNP 1": "form_submitted", "DNP 2": "form_submitted", "DNP 3": "form_submitted",
  "LANGUAGE ISSUE": "form_submitted",
  "FEE LINK SENT": "form_submitted",
  "APPLICATION FEE PAID": "app_fee_paid", "APP FEE PAID": "app_fee_paid",
  "INTERVIEW SCHEDULED": "app_fee_paid",
  "NEED TO RESCHEDULE INTERVIEW": "app_fee_paid", "RESCHEDULE INTERVIEW": "app_fee_paid",
  "NO SHOW": "app_fee_paid",
  "INTERVIEW COMPLETED": "accepted", "INTERVIEW DONE": "accepted",
  "ACCEPTANCE SENT": "accepted",
  "DEFFERED": "accepted", "DEFERRED": "accepted",
  "CONVERTED": "balance_paid", "PAID IN FULL": "balance_paid",
  "LOST": "lost",
  "DIRECT JUNK": "lost", "JUNK": "lost",
  "WRONG NUMBER": "lost",
};

function mapStage(status?: string): { stage: string; isJunk: boolean } {
  if (!status) return { stage: "form_submitted", isJunk: false };
  const k = String(status).trim().toUpperCase();
  const stage = STAGE_MAP[k] ?? "form_submitted";
  const isJunk = ["DIRECT JUNK", "JUNK", "WRONG NUMBER"].includes(k);
  return { stage, isJunk };
}

// Parse miscellaneous date strings (DD/MM/YYYY, ISO, Unix). Returns ISO or null.
function parseDate(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-") return null;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const yr = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const dt = new Date(Date.UTC(yr, parseInt(mo) - 1, parseInt(d)));
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return null;
}

// Build the synthetic responses object so MQL scoring + AI brief see it.
function buildResponses(row: any, m: ColumnMapping): Record<string, any> {
  const r: Record<string, any> = {};
  const keep = (label: string, key?: string) => {
    if (!key) return;
    const v = row[key];
    if (v == null) return;
    const s = String(v).trim();
    if (!s || s === "-") return;
    r[label] = s;
  };
  keep("Tell us why you really want to be on this program", m.reason);
  keep("Select one (financial fit)", m.scholarship);
  keep("Age", m.age);
  keep("Job role", m.job_role);
  keep("Designation", m.designation);
  keep("City", m.city);
  keep("Form source", m.form_source);
  keep("Interview", m.interview);
  keep("Interview date", m.interview_date);
  keep("Interviewer", m.interviewer);
  keep("Grant", m.grant);
  keep("Grant amount", m.grant_amount);
  keep("Lost reason", m.lost_reason);
  // Passthrough columns: keep them verbatim so nothing's lost
  for (const col of m.passthrough || []) {
    const v = row[col];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s || s === "-") continue;
    if (!r[col]) r[col] = s;
  }
  return r;
}

// Stable id for form_submissions so re-imports are idempotent
function syntheticSubmissionId(opts: { email: string | null; phone: string | null; program: string }): string {
  const seed = `${opts.program}|${opts.email || ""}|${opts.phone || ""}`;
  const hash = crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16);
  return `csv_${opts.program}_${hash}`;
}

// --------------------------------------------------------------- handler

export async function POST(req: Request) {
  // Auth: bootstrap token OR authenticated admin/founder
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const tokenOk = process.env.ADMIN_BOOTSTRAP_TOKEN && token === process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!tokenOk) {
    const rep = await getCurrentRep();
    if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (rep.role !== "admin" && rep.role !== "founder") {
      return NextResponse.json({ error: "admin or founder role required" }, { status: 403 });
    }
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as {
    rows?: any[];
    mapping?: ColumnMapping;
    defaults?: Defaults;
  } | null;

  if (!body || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Body must be { rows: [...] }" }, { status: 400 });
  }

  const m: ColumnMapping = body.mapping || {};
  const d: Defaults = body.defaults || {};
  const admin = adminClient();

  // ----- Pass 1: normalize each input row into a {lead, sub} pair, or skip
  type Prepared = {
    rowIdx: number;
    email: string | null;
    phone: string | null;
    program: string;
    name: string | null;
    funnel_stage: string;
    is_junk: boolean;
    score: number;
    breakdown: Record<string, number>;
    formSource: string;
    responses: Record<string, any>;
    firstSeen: string;
    lastActivity: string;
  };

  const prepared: Prepared[] = [];
  let skipped = 0;
  const errors: { idx: number; reason: string }[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i] || {};
    try {
      const email = m.email ? normalizeEmail(row[m.email]) : null;
      const phone = m.phone ? normalizePhone(row[m.phone]) : null;
      const program =
        (m.program ? normalizeProgram(row[m.program]) : null) ??
        (d.program ? normalizeProgram(d.program) : null);

      if (!program) { skipped++; continue; }
      if (!email && !phone) { skipped++; continue; }

      const status = (m.status ? row[m.status] : null) || d.status || null;
      const { stage, isJunk } = mapStage(status);
      const name = buildName(row, m);
      const responses = buildResponses(row, m);
      const { score, breakdown } = scoreLead({ responses, programCode: program });

      const formSource =
        (m.form_source && row[m.form_source] && String(row[m.form_source]).trim() !== "-"
          ? `CSV · ${row[m.form_source]}`
          : null) ||
        d.source ||
        "CSV import";

      const now = new Date().toISOString();
      const firstSeen = (m.created_at && parseDate(row[m.created_at])) || now;
      const lastActivity = (m.last_activity && parseDate(row[m.last_activity])) || firstSeen;

      prepared.push({
        rowIdx: i, email, phone, program, name,
        funnel_stage: stage, is_junk: isJunk,
        score, breakdown, formSource, responses,
        firstSeen, lastActivity,
      });
    } catch (e: any) {
      errors.push({ idx: i, reason: e?.message || "prep error" });
      skipped++;
    }
  }

  if (prepared.length === 0) {
    return NextResponse.json({ ok: true, processed: body.rows.length, inserted: 0, updated: 0, skipped, errors });
  }

  // ----- Pass 2: pre-fetch any leads already in the DB matching these
  // (email, program) or (phone, program) pairs. Single round trip.
  const emailKeys = Array.from(new Set(prepared.filter(p => p.email).map(p => `${p.email}|${p.program}`)));
  const phoneKeys = Array.from(new Set(prepared.filter(p => p.phone).map(p => `${p.phone}|${p.program}`)));

  const allEmails = Array.from(new Set(prepared.filter(p => p.email).map(p => p.email!)));
  const allPhones = Array.from(new Set(prepared.filter(p => p.phone).map(p => p.phone!)));
  const allPrograms = Array.from(new Set(prepared.map(p => p.program)));

  // Pull every lead matching any of (email IN allEmails) OR (phone IN allPhones), program IN allPrograms.
  // Then in-memory filter by exact (email|program) or (phone|program) pair to avoid cross-program collisions.
  let existingRows: any[] = [];
  if (allEmails.length > 0 || allPhones.length > 0) {
    const orParts: string[] = [];
    if (allEmails.length > 0) orParts.push(`email.in.(${allEmails.map(e => `"${e}"`).join(",")})`);
    if (allPhones.length > 0) orParts.push(`phone.in.(${allPhones.map(p => `"${p}"`).join(",")})`);
    const { data, error } = await admin
      .from("leads")
      .select("id,email,phone,program,name,score,source_campaign_name")
      .in("program", allPrograms)
      .or(orParts.join(","));
    if (error) {
      return NextResponse.json({ error: `prefetch failed: ${error.message}` }, { status: 500 });
    }
    existingRows = data || [];
  }

  // claimed[`${key}|${program}`] = id  — tracks every (email, program) and
  // (phone, program) pair that's been claimed by either an existing row or an
  // earlier in-batch row, so subsequent rows know to merge instead of duplicate.
  const claimedByEmail = new Map<string, string>(); // email|program → id
  const claimedByPhone = new Map<string, string>(); // phone|program → id
  // Track the existing row data for known ids so we know when not to clobber
  const existingById = new Map<string, any>();
  for (const r of existingRows) {
    existingById.set(r.id, r);
    if (r.email && r.program) claimedByEmail.set(`${r.email}|${r.program}`, r.id);
    if (r.phone && r.program) claimedByPhone.set(`${r.phone}|${r.program}`, r.id);
  }

  // ----- Pass 3: build leadRows + subRows for bulk upsert
  type LeadUpsert = {
    id: string;
    email: string | null; phone: string | null; name: string | null;
    program: string; funnel_stage: string;
    source_campaign_name: string;
    score: number; score_breakdown: Record<string, number>;
    first_seen: string; last_activity: string;
  };

  // Use a Map keyed by id so multiple input rows that resolve to the same id
  // (in-batch duplicates) collapse into one upsert payload — last write wins.
  const leadRowsById = new Map<string, LeadUpsert>();
  const subRowsById = new Map<string, any>();
  let insertedCount = 0;
  let updatedCount = 0;
  let mergedCount = 0;

  for (const p of prepared) {
    const emailKey = p.email ? `${p.email}|${p.program}` : null;
    const phoneKey = p.phone ? `${p.phone}|${p.program}` : null;

    const idByEmail = emailKey ? claimedByEmail.get(emailKey) : undefined;
    const idByPhone = phoneKey ? claimedByPhone.get(phoneKey) : undefined;

    let id: string;

    if (idByEmail && idByPhone && idByEmail !== idByPhone) {
      // Merge case: row's email matches record A, phone matches different
      // record B. Pick the email-matched id (more identifying); we'll
      // intentionally NOT write the conflicting phone.
      id = idByEmail;
      mergedCount++;
    } else if (idByEmail) {
      id = idByEmail;
    } else if (idByPhone) {
      id = idByPhone;
    } else {
      id = crypto.randomUUID();
    }

    // The existing DB row backing this id (undefined for fresh inserts or
    // rows claimed in-batch by an earlier new row).
    const existing = existingById.get(id);

    // Pick email/phone we'll write. Rules:
    //  · If existing has a value, keep it (never overwrite).
    //  · In an email/phone merge case, drop the conflicting field.
    //  · If a candidate value is claimed by a different id, drop it.
    let finalEmail: string | null = existing?.email || p.email;
    let finalPhone: string | null = existing?.phone || p.phone;

    if (idByEmail && idByPhone && idByEmail !== idByPhone) {
      finalPhone = existing?.phone || null;
    }
    if (finalEmail) {
      const claimedBy = claimedByEmail.get(`${finalEmail}|${p.program}`);
      if (claimedBy && claimedBy !== id) finalEmail = existing?.email || null;
    }
    if (finalPhone) {
      const claimedBy = claimedByPhone.get(`${finalPhone}|${p.program}`);
      if (claimedBy && claimedBy !== id) finalPhone = existing?.phone || null;
    }

    // Register/update the claim maps so the next prepared row sees this row's
    // bindings (in-batch chained merges).
    if (finalEmail) claimedByEmail.set(`${finalEmail}|${p.program}`, id);
    if (finalPhone) claimedByPhone.set(`${finalPhone}|${p.program}`, id);

    const finalName  = existing?.name || p.name;
    const finalScore = Math.max(p.score, existing?.score || 0);
    const finalSource = existing?.source_campaign_name || p.formSource;

    leadRowsById.set(id, {
      id,
      email: finalEmail,
      phone: finalPhone,
      name: finalName,
      program: p.program,
      funnel_stage: p.funnel_stage,
      source_campaign_name: finalSource,
      score: finalScore,
      score_breakdown: p.breakdown,
      first_seen: existing?.first_seen || p.firstSeen,
      last_activity: p.lastActivity,
    });

    const subId = syntheticSubmissionId({ email: p.email, phone: p.phone, program: p.program });
    subRowsById.set(subId, {
      id: subId,
      lead_id: id,
      form_id: "csv_import",
      form_name: "CSV legacy import",
      program: p.program,
      is_completed: true,
      submitted_at: p.firstSeen,
      email: p.email, phone: p.phone, name: p.name,
      responses: p.responses,
    });
  }

  // Recount: distinct ids that match an existing row = updates
  updatedCount = 0;
  for (const id of leadRowsById.keys()) {
    if (existingById.has(id)) updatedCount++;
  }
  // Inserted = total distinct - updated
  insertedCount = leadRowsById.size - updatedCount;

  const leadRows = Array.from(leadRowsById.values());
  const subRows = Array.from(subRowsById.values());

  // ----- Pass 4: bulk upsert. If the bulk fails on a constraint violation we
  // didn't manage to dedupe in-memory (rare edge case), fall back to per-row
  // upserts so one bad row doesn't poison the whole batch.
  async function bulkOrFallback<T extends { id: string }>(
    table: string,
    rows: T[],
    onConflict: string,
  ): Promise<{ ok: number; failures: { id: string; reason: string }[] }> {
    if (rows.length === 0) return { ok: 0, failures: [] };
    const { error } = await admin.from(table).upsert(rows, { onConflict });
    if (!error) return { ok: rows.length, failures: [] };

    // Bulk failed — retry per-row to isolate the bad ones
    let ok = 0;
    const failures: { id: string; reason: string }[] = [];
    for (const r of rows) {
      const { error: e2 } = await admin.from(table).upsert([r], { onConflict });
      if (e2) failures.push({ id: r.id, reason: e2.message });
      else ok++;
    }
    return { ok, failures };
  }

  const leadResult = await bulkOrFallback("leads", leadRows, "id");
  if (leadResult.failures.length) {
    leadResult.failures.slice(0, 10).forEach(f =>
      errors.push({ idx: -1, reason: `lead ${f.id.slice(0, 8)}: ${f.reason}` })
    );
  }

  // form_submissions only for leads that actually got upserted, to avoid FK errors
  const okLeadIds = new Set(
    leadRows.filter(r => !leadResult.failures.find(f => f.id === r.id)).map(r => r.id),
  );
  const validSubs = subRows.filter(s => okLeadIds.has(s.lead_id));
  const subResult = await bulkOrFallback("form_submissions", validSubs, "id");
  if (subResult.failures.length) {
    errors.push({ idx: -1, reason: `${subResult.failures.length} sub-row failures (1st: ${subResult.failures[0].reason})` });
  }

  // Adjust counts: rows that genuinely failed shouldn't be counted as inserted
  const failedCount = leadResult.failures.length;
  if (failedCount > 0) {
    skipped += failedCount;
    insertedCount = Math.max(0, insertedCount - failedCount);
  }

  return NextResponse.json({
    ok: true,
    processed: body.rows.length,
    inserted: insertedCount,
    updated: updatedCount,
    merged: mergedCount,
    skipped,
    errors: errors.slice(0, 10),
  });
}
