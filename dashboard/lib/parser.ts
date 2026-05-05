// Campaign name classifier.
//
// Two-level classification:
//   · Family: Forge | Live | Masterclass | Workshop | Other
//   · Program (when a Forge campaign): FFM | FW | FC | FAI
//
// Forge programs: FFM, FW, FC, FAI (the four cohort programs)
// Live programs:  BFP, VE, L3C (live-cohort offerings)
// Masterclass:    one-time paid masterclasses (KS / AG / etc.)
// Workshop:       free workshops (101, etc.)
// Other:          everything else (hiring, evolve, video editing ad funnels)

const PROGRAM_RULES: [string, RegExp[]][] = [
  ["FAI", [/\bforge\s*ai\b/i, /\bthe\s+forge\s+ai\b/i]],
  ["FW",  [/\bforge\s+writing\b/i, /\bforge\s+wr\b/i, /\bforge\s+writers?\b/i]],
  ["FC",  [/\bforge\s+creators?\b/i, /\bforge\s+content\b/i, /\bforge\s+fc\b/i]],
  ["FFM", [/\bforge\s+filmmaking\b/i, /\bforge\s+fm\b/i, /\bforge\s+film\b/i, /\bthe\s+forge\s+fm\b/i]],
];

// Live cohort markers — non-Forge but still our pipeline (BFP / VE / L3 etc.)
const LIVE_RULES: [string, RegExp[]][] = [
  ["BFP", [/\bbfp\b/i, /\bbusiness\s+foundations?\b/i]],
  ["VE",  [/\bve\s*\|/i, /\bventure\s+engine\b/i, /\bl3ve\b/i]],
  ["L3C", [/\bl3c\b/i, /\bl3\s+creators?\b/i, /\bl3\s*\|/i]],
];

// Masterclass markers (excluded from Forge spend, tracked separately)
const MASTERCLASS_RULES: RegExp[] = [
  /\bmasterclass\b/i,
  /\|\s*mc\s*$/i, /\|\s*mc\s+/i,
  /\bks\s+masterclass\b/i, /\bag\s+masterclass\b/i,
];

// Workshop markers (free workshops + 101 funnels)
const WORKSHOP_RULES: RegExp[] = [
  /\bworkshop\b/i, /\b101\b/,
  /\bsf\s*101\b/i, /\bd\s*101\b/i, /\bsw\s*101\b/i, /\bpg\s*101\b/i, /\bws\s*101\b/i,
  /\bcg\s*101\b/i, /\bfd101\b/i, /\bwpg\b/i,
];

export type Family = "Forge" | "Live" | "Masterclass" | "Workshop" | "Other";
export type Program = "FFM" | "FW" | "FC" | "FAI" | "BFP" | "VE" | "L3C" | "AMBIGUOUS_FFM" | "NON_FORGE";

/**
 * Classify a Meta campaign name into (family, program).
 *
 * The new richer classifier — keeps the legacy `classifyCampaign` shape so
 * the existing /api/sync route still works.
 */
export function classifyCampaignFull(name: string | null | undefined): {
  family: Family;
  program: Program | null;
  reason: string;
} {
  if (!name) return { family: "Other", program: null, reason: "empty" };
  const lc = name.toLowerCase().trim();

  // Workshop / Masterclass take precedence — a "Forge MC" campaign is masterclass, not Forge.
  for (const r of MASTERCLASS_RULES) if (r.test(lc)) return { family: "Masterclass", program: null, reason: `mc:${r.source}` };
  for (const r of WORKSHOP_RULES)    if (r.test(lc)) return { family: "Workshop",    program: null, reason: `ws:${r.source}` };

  // Forge cohort programs
  if (lc.includes("forge")) {
    for (const [code, patterns] of PROGRAM_RULES) {
      for (const p of patterns) {
        if (p.test(lc)) return { family: "Forge", program: code as Program, reason: `forge:${code}` };
      }
    }
    return { family: "Forge", program: "AMBIGUOUS_FFM", reason: "forge fallback FFM" };
  }

  // Live cohort programs
  for (const [code, patterns] of LIVE_RULES) {
    for (const p of patterns) {
      if (p.test(lc)) return { family: "Live", program: code as Program, reason: `live:${code}` };
    }
  }

  return { family: "Other", program: null, reason: "no match" };
}

// ---------------------------------------------------------------- legacy shape
// Kept so app/api/sync/route.ts (and anything else referencing it) doesn't break.
export function classifyCampaign(name: string | null | undefined): { program: Program; reason: string } {
  const r = classifyCampaignFull(name);
  if (r.family === "Forge" && r.program) return { program: r.program, reason: r.reason };
  return { program: "NON_FORGE", reason: r.reason };
}
