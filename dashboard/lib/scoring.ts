// Data-driven MQL scoring derived from 24,500+ real leads across FFM/FW/FC.
//
// Framework: predicts probability of paying the application fee from a
// completed Tally form. Stage component intentionally dropped — MQL is meant
// for the "abandoned" bucket (form_submitted, no app fee yet).
//
// Weights below are tuned to actual conversion rates, not gut feel.
// See conversation history for the per-bucket rate tables that grounded each cut-off.
//
// Used by /api/maintenance/rescore to refresh scores in bulk.

export type Responses = Record<string, any>;

export type ScoreBreakdown = Record<string, number>;

export type ScoredLead = {
  score: number;
  breakdown: ScoreBreakdown;
};

// Pull-helpers — Tally response keys vary slightly across programs, so we
// match by case-insensitive substring rather than exact key.
function findValue(responses: Responses, ...needles: string[]): string | null {
  if (!responses) return null;
  for (const k of Object.keys(responses)) {
    const kl = k.toLowerCase();
    if (needles.some(n => kl.includes(n.toLowerCase()))) {
      const v = responses[k];
      if (Array.isArray(v)) return v.join(", ");
      if (v == null)        return null;
      return String(v);
    }
  }
  return null;
}

// 1. WHY-FORGE LENGTH (40 max) — biggest signal in the data
function scoreWhyForge(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  const text = findValue(responses,
    "tell us why",            // FFM/FW/FC main "why" question prefix
    "why do you really",
    "why forge", "why this program", "why are you applying",
  ) || "";
  const len = text.trim().length;
  if (len === 0)         return { pts: 0,  bd: { why_empty: 0 } };
  if (len <= 30)         return { pts: 0,  bd: { why_under_30_chars: 0 } };
  if (len <= 100)        return { pts: 8,  bd: { why_31_100_chars: 8 } };
  if (len <= 250)        return { pts: 18, bd: { why_101_250_chars: 18 } };
  if (len <= 500)        return { pts: 28, bd: { why_251_500_chars: 28 } };
  if (len <= 1000)       return { pts: 32, bd: { why_501_1000_chars: 32 } };
  return                          { pts: 40, bd: { why_1000plus_chars: 40 } };
}

// 2. AGE (20 max) — peak in 28-45 band
function scoreAge(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  const raw = findValue(responses, "age");
  if (!raw) return { pts: 0, bd: {} };
  const r = raw.trim();
  // Tally usually returns either a band string ("32-45") or a number
  if (/^<\s*18/.test(r) || /under 18/i.test(r)) return { pts: 0,  bd: { age_under_18: 0 } };
  if (/^>\s*60/.test(r) || /over 60/i.test(r))  return { pts: 12, bd: { age_60plus: 12 } };
  if (/45[-\s]+60/.test(r))                      return { pts: 18, bd: { age_45_60: 18 } };
  if (/32[-\s]+45/.test(r))                      return { pts: 20, bd: { age_32_45: 20 } };
  if (/28[-\s]+32/.test(r))                      return { pts: 16, bd: { age_28_32: 16 } };
  if (/24[-\s]+28/.test(r) || /22[-\s]+27/.test(r) || /24[-\s]+27/.test(r)) return { pts: 10, bd: { age_24_28: 10 } };
  if (/18[-\s]+24/.test(r) || /18[-\s]+21/.test(r)) return { pts: 4, bd: { age_18_24: 4 } };
  // Numeric fallback
  const n = parseInt(r);
  if (Number.isFinite(n) && n > 0) {
    if (n < 18)        return { pts: 0,  bd: { age_under_18: 0 } };
    if (n <= 24)       return { pts: 4,  bd: { age_18_24: 4 } };
    if (n <= 28)       return { pts: 10, bd: { age_24_28: 10 } };
    if (n <= 32)       return { pts: 16, bd: { age_28_32: 16 } };
    if (n <= 45)       return { pts: 20, bd: { age_32_45: 20 } };
    if (n <= 60)       return { pts: 18, bd: { age_45_60: 18 } };
    return                      { pts: 12, bd: { age_60plus: 12 } };
  }
  return { pts: 0, bd: { age_unparsed: 0 } };
}

// 3. JOB ROLE (20 max) — entrepreneur gets its own top tier
function scoreJobRole(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  const raw = findValue(responses, "job role", "what do you do", "currently doing", "occupation", "profession");
  if (!raw) return { pts: 0, bd: {} };
  const r = raw.toLowerCase();
  if (/student/.test(r))                                     return { pts: 2,  bd: { job_student: 2 } };
  if (/entrepreneur|founder|ceo|cto|business\s*owner/.test(r)) return { pts: 20, bd: { job_entrepreneur: 20 } };
  if (/freelanc/.test(r))                                    return { pts: 14, bd: { job_freelancer: 14 } };
  if (/corporate/.test(r) && /work/.test(r))                 return { pts: 12, bd: { job_corporate: 12 } };
  if (/exploring/.test(r))                                   return { pts: 10, bd: { job_exploring: 10 } };
  if (/working/.test(r) && /not.+corporate/.test(r))         return { pts: 10, bd: { job_working_other: 10 } };
  if (/working/.test(r))                                     return { pts: 12, bd: { job_working: 12 } };
  if (/taking\s*a\s*break/.test(r))                          return { pts: 8,  bd: { job_break: 8 } };
  // Other professional indicators (designer, writer, etc) — middle tier
  if (/designer|writer|developer|engineer|director|manager|lead|consultant|teacher|professor|doctor|lawyer/.test(r))
    return { pts: 12, bd: { job_other_professional: 12 } };
  return { pts: 0, bd: { job_other: 0 } };
}

// 4. GRANT CHOICE (10 max) — willingness to pay = commitment
function scoreGrant(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  // The "Select one" question varies but answers are predictable
  const raw = findValue(responses, "select one", "would like to apply", "grant for the forge", "would like to apply for");
  if (!raw) return { pts: 0, bd: {} };
  const r = raw.toLowerCase();
  if (/without\s*(a\s*)?(grant|scholarship)/.test(r) || /individual.+without/.test(r))
    return { pts: 10, bd: { without_grant: 10 } };
  if (/grant|scholarship|fwif/.test(r))
    return { pts: 4, bd: { with_grant: 4 } };
  return { pts: 0, bd: {} };
}

// 5. RECENCY (10 max)
function scoreRecency(submittedAt: string | null | undefined): { pts: number; bd: ScoreBreakdown } {
  if (!submittedAt) return { pts: 0, bd: {} };
  const t = new Date(submittedAt).getTime();
  if (!Number.isFinite(t)) return { pts: 0, bd: {} };
  const hours = (Date.now() - t) / 3600_000;
  if (hours < 1)        return { pts: 10, bd: { recency_under_1h: 10 } };
  if (hours < 24)       return { pts: 8,  bd: { recency_under_24h: 8 } };
  if (hours < 24 * 3)   return { pts: 5,  bd: { recency_under_3d: 5 } };
  if (hours < 24 * 7)   return { pts: 3,  bd: { recency_under_7d: 3 } };
  return { pts: 0, bd: {} };
}

/**
 * Compute MQL score (0–100) from form responses + earliest submission time.
 * Stage-agnostic: this score predicts "will pay the app fee" based on form quality alone.
 * Caller decides whether to use this score (e.g. for the abandoned bucket only).
 */
export function scoreLead(opts: {
  responses: Responses;
  submittedAt: string | null | undefined;
}): ScoredLead {
  const breakdown: ScoreBreakdown = {};
  let total = 0;
  for (const fn of [
    () => scoreWhyForge(opts.responses),
    () => scoreAge(opts.responses),
    () => scoreJobRole(opts.responses),
    () => scoreGrant(opts.responses),
    () => scoreRecency(opts.submittedAt),
  ]) {
    const { pts, bd } = fn();
    total += pts;
    Object.assign(breakdown, bd);
  }
  return { score: Math.min(100, Math.max(0, total)), breakdown };
}

// Threshold tier — used by UI to color-badge the score
export function tier(score: number): "super_hot" | "hot" | "warm" | "cold" {
  if (score >= 70) return "super_hot";
  if (score >= 50) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}
