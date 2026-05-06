// TeleCRM → Supabase mapping. Single place to define how a TeleCRM lead
// becomes a row in our `leads` + `form_submissions` tables.
//
// Source-of-truth principle: TeleCRM is canonical for identity, attribution,
// MQL, funnel stage, lost reason, and rep ownership. Our local DB is canonical
// for: form_partial state (Tally captures these, TeleCRM doesn't), payments
// (Razorpay-driven), and earnings (computed locally on payment events).

// --------------------------------------------------------------- stage map
//
// TeleCRM Active Stage labels → our funnel_stage enum. Anything missing
// defaults to form_submitted (still in funnel, not yet paid).
export const TELECRM_STATUS_TO_STAGE: Record<string, { stage: string; isJunk?: boolean; lostSubreason?: string }> = {
  // Initial / nurturing — still in funnel, no payment yet
  "NEW":                          { stage: "form_submitted" },
  "Fee Link Sent":                { stage: "form_submitted" },
  "DNP Reminder":                 { stage: "form_submitted" },
  "DNP 1":                        { stage: "form_submitted" },
  "DNP 2":                        { stage: "form_submitted" },
  "Follow-Up":                    { stage: "form_submitted" },
  "HOT":                          { stage: "form_submitted" },
  "WARM":                         { stage: "form_submitted" },
  "Cross - sell":                 { stage: "form_submitted" },
  "Cross-sell":                   { stage: "form_submitted" },
  // Junk / lost
  "Direct Junk":                  { stage: "lost", isJunk: true,  lostSubreason: "Direct Junk" },
  "Wrong Number":                 { stage: "lost", isJunk: true,  lostSubreason: "Wrong Number" },
  "Language Issue":               { stage: "lost", isJunk: false, lostSubreason: "Language Issue" },
  "Lost":                         { stage: "lost", isJunk: false }, // sub-reason comes from lostReasonid
  // Paid app fee — committed
  "Application Fee Paid":         { stage: "app_fee_paid" },
  "Interview Scheduled":          { stage: "app_fee_paid" },
  "Need to reschedule interview": { stage: "app_fee_paid" },
  "No show":                      { stage: "app_fee_paid" }, // they paid, didn't show — still in funnel
  // Past interview — admitted
  "Interview completed":          { stage: "accepted" },
  "Acceptance sent":              { stage: "accepted" },
  "Deffered":                     { stage: "accepted" },
  "Deferred":                     { stage: "accepted" },
  // Won
  "Converted":                    { stage: "balance_paid" },
};

// Same progression as the import-telecrm route's STAGE_RANK — used to never
// downgrade a lead. Razorpay-set app_fee_paid wins over TeleCRM "NEW".
export const STAGE_RANK: Record<string, number> = {
  form_partial:   0,
  form_submitted: 1,
  lost:           1,
  app_fee_paid:   2,
  accepted:       3,
  confirmed:      4,
  balance_paid:   5,
  attended:       6,
};

export function pickHigherStage(a: string | null | undefined, b: string | null | undefined): string {
  const ra = a ? (STAGE_RANK[a] ?? 0) : -1;
  const rb = b ? (STAGE_RANK[b] ?? 0) : -1;
  if (rb > ra) return b!;
  return a || b || "form_submitted";
}

// --------------------------------------------------------------- program map
//
// TeleCRM uses the same product codes we do. This is just a normalization
// pass for casing / whitespace / aliases.
const PROGRAM_ALIAS: Record<string, string> = {
  "FFM": "FFM", "FORGE FILMMAKING": "FFM",
  "FW":  "FW",  "FORGE WRITING":    "FW",
  "FC":  "FC",  "FORGE CREATORS":   "FC",
  "FAI": "FAI", "FORGE AI":         "FAI",
  "BFP": "BFP", "BREAKTHROUGH":     "BFP",
  "VE":  "VE",  "VIDEO EDITING":    "VE",
  "L3C": "L3C", "LEVELUP CREATORS": "L3C",
};

export function normalizeProgram(p: any): string | null {
  if (p == null) return null;
  const k = String(p).trim().toUpperCase();
  if (!k || k === "-" || k === "—") return null;
  return PROGRAM_ALIAS[k] || (PROGRAM_ALIAS[k] === undefined && /^[A-Z]{2,4}$/.test(k) ? k : null);
}

export function normalizePhone(raw: any): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function normalizeEmail(raw: any): string | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v || v === "-" || !v.includes("@")) return null;
  return v;
}

// --------------------------------------------------------------- main
//
// Convert one TeleCRM lead document into a normalized record we can upsert.
export type NormalizedTelecrmLead = {
  telecrm_id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  program: string | null;
  funnel_stage: string;
  is_junk: boolean;
  // Score
  score: number;
  score_breakdown: Record<string, number>;
  // Attribution
  source_utm_source: string | null;     // "Google Ads" / "MC" / "Meta"
  source_campaign_id: string | null;    // Meta campaign ID
  source_campaign_name: string | null;  // Meta ad name / form source
  // Timestamps (ISO)
  first_seen: string | null;
  last_activity: string | null;
  status_changed_at: string | null;
  // Rich extras (stored in form_submissions.responses)
  responses: Record<string, any>;
  // Native TeleCRM status for diagnostics
  telecrm_status: string | null;
  lost_reason: string | null;
  assigned_rep_email: string | null;
};

export function normalizeTelecrmLead(doc: any): NormalizedTelecrmLead | null {
  if (!doc || !doc.id) return null;
  const f = doc.fields || {};

  const email = normalizeEmail(f.email_1 || f.email);
  const phone = normalizePhone(f.phone);
  const program = normalizeProgram(f.product_1 || f.product);
  if (!program || (!email && !phone)) return null;

  const tcStatus: string = doc.status || "NEW";
  const stageInfo = TELECRM_STATUS_TO_STAGE[tcStatus] || { stage: "form_submitted" };

  // MQL: TeleCRM gives us the same components we use locally — trust them.
  const score = Number(f.mql ?? 0) || 0;
  const breakdown: Record<string, number> = {};
  if (f.essay != null)     breakdown.essay     = Number(f.essay);
  if (f.financial != null) breakdown.financial = Number(f.financial);
  if (f.icp != null)       breakdown.icp       = Number(f.icp);
  if (f.age_score != null) breakdown.age_score = Number(f.age_score);

  const msToIso = (ms: any): string | null => {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n).toISOString();
  };

  // Lost reason: explicit lostReasonid > junk-flag-derived > status-derived
  let lostReason: string | null = null;
  if (stageInfo.stage === "lost") {
    lostReason = doc.lostReasonid || stageInfo.lostSubreason || null;
  }

  // Build responses payload — everything we don't have a column for
  const responses: Record<string, any> = {
    name: f.name || null,
    age: f.age || null,
    city: f.city || null,
    gender: f.gender || null,
    job_role: f.job_role || null,
    designation: f.designation || null,
    scholarship: f.scholarship || null,
    reason: f.reason || null,
    availability: f.availability || null,
    form_source: f.form_source || null,
    ad_name: f.ad_name || null,
    campaign: f.campaign || null,
    source: f.source || null,
    application_status: f.application_status || null,
    mql_bucket: f.mql_bucket || null,
    telecrm_id: doc.id,
    telecrm_status: tcStatus,
    lost_reason: lostReason,
    assigned_rep_email: doc.employeeid || null,
  };
  // Strip nulls
  for (const k of Object.keys(responses)) if (responses[k] == null) delete responses[k];

  // Source attribution: prefer Meta ad metadata when present
  const source_utm_source   = f.source || null;
  const source_campaign_id  = f.campaign ? String(f.campaign) : null;
  // For ad_name we prefer the human-readable form_source if ad_name is just a numeric Meta ID
  const source_campaign_name = f.ad_name
    ? (/^\d{10,}$/.test(String(f.ad_name)) ? `${f.form_source || "Meta"} · ad ${f.ad_name}` : String(f.ad_name))
    : (f.form_source || null);

  return {
    telecrm_id: doc.id,
    email, phone, name: f.name || null, program,
    funnel_stage: stageInfo.stage,
    is_junk: !!stageInfo.isJunk,
    score,
    score_breakdown: breakdown,
    source_utm_source,
    source_campaign_id,
    source_campaign_name,
    first_seen:        msToIso(f.created_on),
    last_activity:     msToIso(f.modified_on) || msToIso(f.created_on),
    status_changed_at: msToIso(doc?.leadMetaData?.statusChangeTimestamp),
    responses,
    telecrm_status: tcStatus,
    lost_reason: lostReason,
    assigned_rep_email: doc.employeeid || null,
  };
}
