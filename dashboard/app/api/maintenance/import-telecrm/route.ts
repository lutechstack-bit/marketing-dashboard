// Bulk import endpoint for the legacy TeleCRM CSV (`All+Data.csv`).
//
// Accepts a batch of rows, normalizes them, computes MQL score, and upserts
// to leads + creates a form_submission so the AI brief / scoring / queue see
// the historical context.
//
// Auth: ADMIN_BOOTSTRAP_TOKEN (same gate used by /api/admin/invite-users).
//
// POST /api/maintenance/import-telecrm?token=...
// Body: { rows: TelecrmRow[] }
// Returns: { ok, processed, inserted, updated, skipped, errors }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreLead } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TelecrmRow = {
  Status?: string;
  "Lost Reason"?: string;
  "First Name"?: string;
  Email?: string;
  "Last Name"?: string;
  Phone?: string;
  "Form Source"?: string;
  City?: string;
  Reason?: string;
  Scholarship?: string;
  Age?: string;
  Product?: string;
  "Job Role"?: string;
  Designation?: string;
  "Scholarship Status"?: string;
  Interview?: string;
  "Interview Date"?: string;
  Interviewer?: string;
  Grant?: string;
  "Grant Amount"?: string;
};

// ---------------------------------------------------------------- helpers

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const PROGRAM_MAP: Record<string, string> = {
  "FFM": "FFM",
  "FORGE FILMMAKING": "FFM",
  "FW": "FW",
  "FORGE WRITING": "FW",
  "FC": "FC",
  "FORGE CREATORS": "FC",
  "FAI": "FAI",
  "FORGE AI": "FAI",
  "BFP": "BFP",
  "VE": "VE",
  "LIVE VE": "VE",
  "L3C": "L3C",
};

function normalizeProgram(p?: string): string | null {
  if (!p) return null;
  const k = p.trim().toUpperCase();
  if (!k || k === "-") return null;
  return PROGRAM_MAP[k] || null;
}

function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v || v === "-" || !v.includes("@")) return null;
  return v;
}

function buildName(row: TelecrmRow): string | null {
  const first = (row["First Name"] || "").trim();
  const last  = (row["Last Name"] || "").trim();
  const lastClean = last && last !== "_" && last !== "-" ? last : "";
  const full = [first, lastClean].filter(Boolean).join(" ").trim();
  return full || null;
}

// Map TeleCRM Status string → funnel_stage in our schema
const STAGE_MAP: Record<string, string> = {
  "NEW": "form_submitted",
  "HOT": "form_submitted",
  "FOLLOW-UP": "form_submitted",
  "CALL BACK": "form_submitted",
  "DNP REMINDER": "form_submitted",
  "DNP 1": "form_submitted",
  "DNP 2": "form_submitted",
  "DNP 3": "form_submitted",
  "LANGUAGE ISSUE": "form_submitted",
  "FEE LINK SENT": "form_submitted",
  "APPLICATION FEE PAID": "app_fee_paid",
  "INTERVIEW SCHEDULED": "app_fee_paid",
  "NEED TO RESCHEDULE INTERVIEW": "app_fee_paid",
  "NO SHOW": "app_fee_paid",
  "INTERVIEW COMPLETED": "accepted",
  "ACCEPTANCE SENT": "accepted",
  "DEFERRED": "accepted",
  "DEFFERED": "accepted", // typo in source data
  "CONVERTED": "balance_paid",
  "LOST": "lost",
};

// Statuses we drop entirely
const SKIP_STATUSES = new Set(["DIRECT JUNK", "WRONG NUMBER", "JUNK"]);

function mapStage(status?: string): { stage: string; skip: boolean } {
  if (!status) return { stage: "form_submitted", skip: false };
  const k = status.trim().toUpperCase();
  if (SKIP_STATUSES.has(k)) return { stage: "lost", skip: true };
  return { stage: STAGE_MAP[k] || "form_submitted", skip: false };
}

// Build a synthetic Tally-style responses object so MQL scoring + AI brief can
// use the CSV's essay / scholarship / job-role data the same way they use real
// Tally form responses.
function buildResponses(row: TelecrmRow): Record<string, any> {
  const r: Record<string, any> = {};
  if (row.Reason && row.Reason !== "-")
    r["Tell us why you really want to be on this program"] = row.Reason;
  if (row.Scholarship && row.Scholarship !== "-")
    r["Select one (financial fit)"] = row.Scholarship;
  if (row.Age && row.Age !== "-") r["Age"] = row.Age;
  if (row["Job Role"] && row["Job Role"] !== "-") r["Job role"] = row["Job Role"];
  if (row.Designation && row.Designation !== "-") r["Designation"] = row.Designation;
  if (row.City && row.City !== "-") r["City"] = row.City;
  if (row["Form Source"] && row["Form Source"] !== "-") r["Form source"] = row["Form Source"];
  if (row.Interview && row.Interview !== "-") r["Interview"] = row.Interview;
  if (row.Interviewer && row.Interviewer !== "-") r["Interviewer"] = row.Interviewer;
  if (row["Lost Reason"] && row["Lost Reason"] !== "-") r["Lost reason"] = row["Lost Reason"];
  if (row.Grant && row.Grant !== "-") r["Grant"] = row.Grant;
  if (row["Grant Amount"] && row["Grant Amount"] !== "-") r["Grant amount"] = row["Grant Amount"];
  return r;
}

// Stable id for the form_submission so re-imports are idempotent
function syntheticSubmissionId(row: TelecrmRow): string {
  const email = normalizeEmail(row.Email) || "noemail";
  const phone = normalizePhone(row.Phone) || "nophone";
  const program = normalizeProgram(row.Product) || "noprog";
  return `telecrm_${program}_${email}_${phone}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 80);
}

// ---------------------------------------------------------------- handler

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }

  const body = await req.json().catch(() => null) as { rows?: TelecrmRow[] } | null;
  if (!body || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Body must be { rows: [...] }" }, { status: 400 });
  }

  const admin = adminClient();
  let inserted = 0, updated = 0, skipped = 0;
  const errors: { idx: number; reason: string; sample?: any }[] = [];

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i];
    try {
      // 1. Skip junk
      const stageInfo = mapStage(row.Status);
      if (stageInfo.skip) { skipped++; continue; }

      // 2. Normalize core fields
      const email = normalizeEmail(row.Email);
      const phone = normalizePhone(row.Phone);
      const program = normalizeProgram(row.Product);
      // Need at least program + (email OR phone) to upsert
      if (!program) { skipped++; continue; }
      if (!email && !phone) { skipped++; continue; }

      const name = buildName(row);
      const responses = buildResponses(row);
      const { score, breakdown } = scoreLead({ responses, programCode: program });

      // 3. Find existing lead by email or phone within this program (matches the
      // composite uniques on the leads table).
      const orParts: string[] = [];
      if (email) orParts.push(`email.eq.${email}`);
      if (phone) orParts.push(`phone.eq.${phone}`);
      const findQ = await admin
        .from("leads")
        .select("id,name,email,phone,program,funnel_stage,score,source_campaign_name")
        .eq("program", program)
        .or(orParts.join(","))
        .limit(1);
      const existing = (findQ.data || [])[0];

      const formSource = row["Form Source"] && row["Form Source"] !== "-"
        ? `TeleCRM · ${row["Form Source"]}`
        : "TeleCRM import";

      if (existing) {
        // Update only if we'd be improving the row. funnel_stage from CRM wins
        // because the CRM is the authoritative source of call outcomes.
        const updates: Record<string, any> = {
          last_activity: new Date().toISOString(),
        };
        if (!existing.name && name) updates.name = name;
        if (!existing.email && email) updates.email = email;
        if (!existing.phone && phone) updates.phone = phone;
        if (stageInfo.stage) updates.funnel_stage = stageInfo.stage;
        if (score > (existing.score || 0)) {
          updates.score = score;
          updates.score_breakdown = breakdown;
        }
        if (!existing.source_campaign_name) updates.source_campaign_name = formSource;
        await admin.from("leads").update(updates).eq("id", existing.id);
        updated++;

        // Upsert form_submission too
        await admin.from("form_submissions").upsert({
          id: syntheticSubmissionId(row),
          lead_id: existing.id,
          form_id: "telecrm_import",
          form_name: "TeleCRM legacy import",
          program,
          is_completed: true,
          submitted_at: new Date().toISOString(),
          email, phone, name,
          responses,
        }, { onConflict: "id" });
      } else {
        const { data: newLead, error: insErr } = await admin.from("leads").insert({
          email, phone, name,
          program,
          funnel_stage: stageInfo.stage,
          source_campaign_name: formSource,
          score,
          score_breakdown: breakdown,
          first_seen: new Date().toISOString(),
          last_activity: new Date().toISOString(),
        }).select("id").single();

        if (insErr) {
          // Likely a unique-constraint race — try one more lookup
          const retry = await admin
            .from("leads")
            .select("id")
            .eq("program", program)
            .or(orParts.join(","))
            .limit(1);
          const retryRow = (retry.data || [])[0];
          if (retryRow) { updated++; }
          else { errors.push({ idx: i, reason: insErr.message }); skipped++; continue; }
        } else {
          inserted++;
          await admin.from("form_submissions").upsert({
            id: syntheticSubmissionId(row),
            lead_id: newLead!.id,
            form_id: "telecrm_import",
            form_name: "TeleCRM legacy import",
            program,
            is_completed: true,
            submitted_at: new Date().toISOString(),
            email, phone, name,
            responses,
          }, { onConflict: "id" });
        }
      }
    } catch (e: any) {
      errors.push({ idx: i, reason: e?.message || "unknown", sample: row });
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: body.rows.length,
    inserted,
    updated,
    skipped,
    errors: errors.slice(0, 20),
  });
}
