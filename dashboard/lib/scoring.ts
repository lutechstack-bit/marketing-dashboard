// MQL Scoring Framework v3 — supplied by founder
// MQL = Essay (0-35) + Financial (0-25) + ICP (0-20, per-product) + Age (0-10)
// MAX = 90 (NOT 100)
//
// Source: LevelUp_CRM_MQL_Scored_v3.csv + forgeai_mql_scoring methodology.
// ICP weights vary per product. Recency component dropped from previous version.

export type Responses = Record<string, any>;
export type ScoreBreakdown = Record<string, number>;
export type ScoredLead = { score: number; breakdown: ScoreBreakdown };

export const MAX_SCORE = 90;

// --------------------------------------------------------------- helpers

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

// --------------------------------------------------------------- 1. Essay (0-35)

function scoreEssay(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  // Total character count across BOTH essay fields if present
  // (per methodology: most paid applicants only fill the 'why' essay; that's fine)
  let totalLen = 0;
  let foundAny = false;
  for (const k of Object.keys(responses || {})) {
    const kl = k.toLowerCase();
    const isEssay =
      (kl.includes("tell us why") || kl.includes("why do you really") ||
       kl.includes("why forge") || kl.includes("why this program") ||
       kl.includes("why are you applying")) ||
      (kl.includes("biggest difficulty") || kl.includes("roadblock") || kl.includes("stopping you"));
    if (!isEssay) continue;
    const v = responses[k];
    if (typeof v === "string") { totalLen += v.trim().length; foundAny = true; }
    else if (Array.isArray(v)) { totalLen += v.join(" ").length; foundAny = true; }
  }
  if (!foundAny || totalLen === 0)            return { pts: 0,  bd: { essay_empty: 0 } };
  if (totalLen <= 10)                          return { pts: 0,  bd: { essay_0_10: 0 } };
  if (totalLen <= 50)                          return { pts: 3,  bd: { essay_11_50: 3 } };
  if (totalLen <= 100)                         return { pts: 7,  bd: { essay_51_100: 7 } };
  if (totalLen <= 200)                         return { pts: 14, bd: { essay_101_200: 14 } };
  if (totalLen <= 500)                         return { pts: 22, bd: { essay_201_500: 22 } };
  if (totalLen <= 1000)                        return { pts: 30, bd: { essay_501_1000: 30 } };
  return                                              { pts: 35, bd: { essay_1000plus: 35 } };
}

// --------------------------------------------------------------- 2. Financial (0-25)

function scoreFinancial(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  const raw = findValue(responses, "select one", "would like to apply", "grant", "scholarship");
  if (!raw) return { pts: 10, bd: { financial_empty: 10 } };
  const r = raw.toLowerCase();
  if (/without\s*(a\s*)?(grant|scholarship)|individual.+without|self[\s-]?paying/.test(r))
    return { pts: 25, bd: { financial_self_paying: 25 } };
  if (/fwif/.test(r))
    return { pts: 15, bd: { financial_fwif: 15 } };
  if (/grant|scholarship/.test(r))
    return { pts: 10, bd: { financial_apply_grant: 10 } };
  return { pts: 10, bd: { financial_other: 10 } };
}

// --------------------------------------------------------------- 3. ICP (0-20, per-product)

const ICP_WEIGHTS: Record<string, Record<string, number>> = {
  // Job Role Bucket → per-product score (max 20 across all)
  entrepreneur:    { FFM: 20, FC: 20, FW: 20, FAI: 20, BFP: 18, VE: 20, L3C: 20 },
  corporate:       { FFM: 8,  FC: 4,  FW: 9,  FAI: 11, BFP: 20, VE: 17, L3C: 4  },
  working_other:   { FFM: 5,  FC: 5,  FW: 11, FAI: 7,  BFP: 20, VE: 17, L3C: 5  },
  freelancer:      { FFM: 8,  FC: 4,  FW: 5,  FAI: 7,  BFP: 8,  VE: 12, L3C: 4  },
  exploring:       { FFM: 8,  FC: 11, FW: 13, FAI: 11, BFP: 3,  VE: 16, L3C: 7  },
  break:           { FFM: 5,  FC: 7,  FW: 8,  FAI: 5,  BFP: 17, VE: 19, L3C: 4  },
  student:         { FFM: 0,  FC: 0,  FW: 0,  FAI: 0,  BFP: 0,  VE: 0,  L3C: 0  },
};

function bucketJobRole(responses: Responses): keyof typeof ICP_WEIGHTS | "unknown" {
  const raw = findValue(responses, "job role", "what do you do", "currently doing", "occupation", "profession", "who are you");
  if (!raw) return "unknown";
  const r = raw.toLowerCase();
  if (/student/.test(r)) return "student";
  if (/entrepreneur|founder|ceo|cto|business\s*owner|aspiring\s*founder|solopreneur/.test(r)) return "entrepreneur";
  if (/working/.test(r) && /at\s*a\s*corporate|corporate/.test(r)) return "corporate";
  if (/marketer|designer|writer|developer|engineer|director|manager|lead|consultant|teacher|professor|doctor|lawyer/.test(r)) return "corporate";
  if (/working/.test(r) && /not.+corporate/.test(r)) return "working_other";
  if (/working/.test(r)) return "corporate";
  if (/freelanc/.test(r)) return "freelancer";
  if (/exploring/.test(r)) return "exploring";
  if (/taking\s*a\s*break|break/.test(r)) return "break";
  return "unknown";
}

function scoreICP(responses: Responses, programCode: string): { pts: number; bd: ScoreBreakdown } {
  const bucket = bucketJobRole(responses);
  if (bucket === "unknown") return { pts: 0, bd: { job_unknown: 0 } };
  const weights = ICP_WEIGHTS[bucket];
  const pts = weights[programCode] ?? 0;
  return { pts, bd: { [`job_${bucket}`]: pts } };
}

// --------------------------------------------------------------- 4. Age (0-10)

function scoreAge(responses: Responses): { pts: number; bd: ScoreBreakdown } {
  const raw = findValue(responses, "age");
  if (!raw) return { pts: 0, bd: { age_empty: 0 } };
  const r = raw.trim();
  if (/^<\s*18|under 18/i.test(r))                                 return { pts: 1,  bd: { age_under_18: 1 } };
  if (/^>\s*60|over 60/i.test(r))                                  return { pts: 5,  bd: { age_60plus: 5 } };
  if (/45[-\s]+60/.test(r))                                         return { pts: 10, bd: { age_45_60: 10 } };
  if (/32[-\s]+45/.test(r))                                         return { pts: 10, bd: { age_32_45: 10 } };
  if (/28[-\s]+32/.test(r))                                         return { pts: 8,  bd: { age_28_32: 8 } };
  if (/24[-\s]+27/.test(r) || /22[-\s]+27/.test(r) || /24[-\s]+28/.test(r)) return { pts: 6, bd: { age_24_27: 6 } };
  if (/18[-\s]+24/.test(r) || /18[-\s]+21/.test(r))                return { pts: 3, bd: { age_18_24: 3 } };
  // Numeric fallback
  const n = parseInt(r);
  if (Number.isFinite(n) && n > 0) {
    if (n < 18)                                                    return { pts: 1,  bd: { age_under_18: 1 } };
    if (n <= 21)                                                   return { pts: 3,  bd: { age_18_24: 3 } };
    if (n <= 24)                                                   return { pts: 3,  bd: { age_18_24: 3 } };
    if (n <= 27)                                                   return { pts: 6,  bd: { age_24_27: 6 } };
    if (n <= 32)                                                   return { pts: 8,  bd: { age_28_32: 8 } };
    if (n <= 45)                                                   return { pts: 10, bd: { age_32_45: 10 } };
    if (n <= 60)                                                   return { pts: 10, bd: { age_45_60: 10 } };
    return                                                                { pts: 5,  bd: { age_60plus: 5 } };
  }
  return { pts: 0, bd: { age_unparsed: 0 } };
}

// --------------------------------------------------------------- main

/**
 * Compute MQL score per the v3 framework. Score is bounded 0-90.
 * @param programCode required for ICP weight lookup (FFM/FC/FW/FAI/BFP/VE/L3C)
 */
export function scoreLead(opts: {
  responses: Responses;
  programCode: string;
  // submittedAt kept for backward-compat but unused in v3 (recency dropped)
  submittedAt?: string | null;
}): ScoredLead {
  const breakdown: ScoreBreakdown = {};
  let total = 0;
  for (const fn of [
    () => scoreEssay(opts.responses),
    () => scoreFinancial(opts.responses),
    () => scoreICP(opts.responses, opts.programCode),
    () => scoreAge(opts.responses),
  ]) {
    const { pts, bd } = fn();
    total += pts;
    Object.assign(breakdown, bd);
  }
  return { score: Math.min(MAX_SCORE, Math.max(0, total)), breakdown };
}

// --------------------------------------------------------------- tiers (max 90)

export type TierId = "hot" | "warm" | "ok" | "cold" | "junk";

export type TierDef = { id: TierId; label: string; min: number; max: number; convRate: string; action: string; emoji: string };

export const TIERS: TierDef[] = [
  { id: "hot",  label: "HOT",  min: 75, max: 90, convRate: "21%",  action: "Call within 1 hour. Send fee link.",      emoji: "🔥" },
  { id: "warm", label: "WARM", min: 60, max: 74, convRate: "9.7%", action: "Call within 24 hours. Schedule interview.", emoji: "⚡" },
  { id: "ok",   label: "OK",   min: 45, max: 59, convRate: "3.2%", action: "Auto-nurture sequence. Email follow-up.",   emoji: "·"  },
  { id: "cold", label: "COLD", min: 30, max: 44, convRate: "0.8%", action: "Drip campaign only.",                       emoji: "·"  },
  { id: "junk", label: "JUNK", min: 0,  max: 29, convRate: "0.5%", action: "Skip — likely fake/student.",               emoji: "❄"  },
];

export function tier(score: number): TierId {
  for (const t of TIERS) if (score >= t.min) return t.id;
  return "junk";
}
