// Forge campaign name parser — TS port of forge_campaign_parser.py

const PROGRAM_RULES: [string, RegExp[]][] = [
  ["FAI", [/\bforge\s*ai\b/i, /\bthe\s+forge\s+ai\b/i]],
  ["FW",  [/\bforge\s+writing\b/i, /\bforge\s+wr\b/i, /\bforge\s+writers?\b/i]],
  ["FC",  [/\bforge\s+creators?\b/i, /\bforge\s+content\b/i, /\bforge\s+fc\b/i]],
  ["FFM", [/\bforge\s+filmmaking\b/i, /\bforge\s+fm\b/i, /\bforge\s+film\b/i, /\bthe\s+forge\s+fm\b/i]],
];

const NON_FORGE: RegExp[] = [
  /\blive\s+cohort\b/i, /\bbfp\b/i, /\bl3\b/i, /\bl3ve\b/i, /\bve\s+\|/i, /\bsmp\b/i, /\b101\b/,
  /\bmasterclass\b/i, /\|\s*mc\s*$/i, /\|\s*mc\s+/i, /\bworkshop\b/i, /\bhiring\b/i, /\bcareer/i,
  /\bstarda\b/i, /\bavinash\s+exp\b/i, /\brahul\s+exp\b/i, /\bnelson\b/i, /\bgvr\b/i,
  /\bks\s+masterclass\b/i, /\bag\s+masterclass\b/i, /\bks\s+\|/i, /\bks\s+pre/i, /\bag\s*\|/i,
  /\bsf\s*101\b/i, /\bd\s*101\b/i, /\bsw\s*101\b/i, /\bpg\s*101\b/i, /\bws\s*101\b/i, /\bwpg\b/i,
  /\bvv\b/i, /\bcg\s*101\b/i, /\bvideo\s+editing\b/i, /\bvideoviews\b/i, /\btraffic\s+campaign\b/i,
  /\binstagram\s+post/i, /\bsubscr\b/i, /\bevolve\b/i, /\bart\s+direction\b/i, /\bcatalogue\s+campaign\b/i,
  /\bfd101\b/i, /\bcrew\s+/i, /\bsushant\b/i, /\bnirmal\b/i, /\bravi\s+basrur\b/i, /\blokesh\b/i, /\btheWav\b/i,
];

export type Program = "FFM" | "FW" | "FC" | "FAI" | "AMBIGUOUS_FFM" | "NON_FORGE";

export function classifyCampaign(name: string | null | undefined): { program: Program; reason: string } {
  if (!name) return { program: "NON_FORGE", reason: "empty" };
  const lc = name.toLowerCase().trim();
  if (!lc.includes("forge")) return { program: "NON_FORGE", reason: "no 'forge'" };
  for (const r of NON_FORGE) {
    if (r.test(lc)) return { program: "NON_FORGE", reason: `excluded by ${r.source}` };
  }
  for (const [code, patterns] of PROGRAM_RULES) {
    for (const p of patterns) {
      if (p.test(lc)) return { program: code as Program, reason: `match ${p.source}` };
    }
  }
  return { program: "AMBIGUOUS_FFM", reason: "default to FFM" };
}
