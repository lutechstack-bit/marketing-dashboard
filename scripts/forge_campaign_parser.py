"""
Forge campaign name parser.
Given a Meta Ads campaign name, classify it as:
  - One of: FFM (Filmmaking), FW (Writing), FC (Creators), FAI (AI)
  - Or NON_FORGE (to exclude)

Logic is keyword-based, in priority order.

Usage:
    from forge_campaign_parser import classify_campaign
    classify_campaign("Forge AI | CBO | 8/4/26")
    # → ("FAI", "matched 'forge ai'")
"""

import re
from typing import Tuple

# Programs to detect, in priority order. Most-specific first.
PROGRAM_RULES = [
    # (program_code, list of patterns to match — case-insensitive substring)
    ("FAI", [r"\bforge\s*ai\b", r"\bforge\s+ai\b", r"\bthe\s+forge\s+ai\b", r"\bf\s*ai\b"]),
    ("FW",  [r"\bforge\s+writing\b", r"\bforge\s+wr\b", r"\bforge\s*wr\b", r"\bforge\s+writers?\b"]),
    ("FC",  [r"\bforge\s+creators?\b", r"\bforge\s+content\b", r"\bforge\s+fc\b"]),
    ("FFM", [r"\bforge\s+filmmaking\b", r"\bforge\s+fm\b", r"\bforge\s+film\b", r"\bthe\s+forge\s+fm\b"]),
]

# Hard-exclude patterns — anything matching these is NOT a Forge campaign.
# Order doesn't matter; any one match excludes.
NON_FORGE_PATTERNS = [
    r"\blive\s+cohort\b",         # LIVE COHORT campaigns
    r"\bbfp\b",                   # Breakthrough Filmmaker Program (LIVE)
    r"\bl3\b",                    # Live L3 *
    r"\bl3ve\b",
    r"\bve\s+\|",                 # VE | * = Video Editing (LIVE)
    r"\bsmp\b",                   # Sales / Masterclass program LIVE
    r"\b101\b",                   # *101 = LIVE workshop (D101, SW101, SF101 etc.)
    r"\bmasterclass\b",           # standalone masterclass campaigns
    r"\|\s*mc\s*$",               # ends with "| MC"
    r"\|\s*mc\s+",                # contains "| MC | "
    r"\bworkshop\b",
    r"\bhiring\b",
    r"\bcareer",
    r"\bstarda\b",
    r"\bavinash\s+exp\b",
    r"\brahul\s+exp\b",
    r"\bnelson\b",
    r"\bgvr\b",
    r"\bks\s+masterclass\b",
    r"\bag\s+masterclass\b",
    r"\bkr_traffic\b",
    r"\bks_\w+\b",
    r"\bks\s+\|",
    r"\bks\s+pre",
    r"\bgvr\s+",
    r"\bag\s*\|",
    r"\bsf\s*101\b",
    r"\bd\s*101\b",
    r"\bsw\s*101\b",
    r"\bpg\s*101\b",
    r"\bws\s*101\b",
    r"\bwpg\b",
    r"\bvv\b",
    r"\bcg\s*101\b",
    r"\bvideo\s+editing\b",
    r"\bvideoviews\b",
    r"\btraffic\s+campaign\b",
    r"\binstagram\s+post",
    r"\bsubscr\b",
    r"\bevolve\b",
    r"\bart\s+direction\b",
    r"\bcatalogue\s+campaign\b",
    r"\bfd101\b",
    r"\bsw\s*\b",
    r"\bcrew\s+\b",
    r"\bsushant\b",
    r"\bnirmal\b",
    r"\bravi\s+basrur\b",
    r"\blokesh\b",
    r"\btheWav\b",
]


def _match_any(name_lc: str, patterns) -> str:
    """Return the first matching pattern, or empty string."""
    for p in patterns:
        if re.search(p, name_lc, flags=re.IGNORECASE):
            return p
    return ""


def classify_campaign(name: str) -> Tuple[str, str]:
    """
    Classify a campaign name.
    Returns (program_code, reason).
    program_code ∈ {FFM, FW, FC, FAI, NON_FORGE, AMBIGUOUS}
    """
    if not name:
        return ("NON_FORGE", "empty name")

    name_lc = name.lower().strip()

    # Step 1: Must contain "forge" somewhere to be a Forge campaign
    if "forge" not in name_lc:
        return ("NON_FORGE", "no 'forge' in name")

    # Step 2: Hard-exclude non-Forge brand campaigns even if they contain "forge"
    excl = _match_any(name_lc, NON_FORGE_PATTERNS)
    if excl:
        return ("NON_FORGE", f"excluded by pattern: {excl}")

    # Step 3: Try to map to specific program by keyword priority
    for code, patterns in PROGRAM_RULES:
        hit = _match_any(name_lc, patterns)
        if hit:
            return (code, f"matched program rule: {hit}")

    # Step 4: Ambiguous — has "forge" but no specific program keyword
    # Best guess: original Forge brand = Filmmaking (FFM was the first program)
    # But flag it so user can review
    return ("AMBIGUOUS_FFM", "contains 'forge' but no specific program keyword — defaulting to FFM (review)")


if __name__ == "__main__":
    # Self-test
    cases = [
        ("the Forge AI | CBO | 8/4/26", "FAI"),
        ("Forge Creators Lead | CBO | 10/5/25", "FC"),
        ("Forge Writing New Lead Gen | CBO | 17/4/25", "FW"),
        ("Forge FM New Leads | CBO | 11/11/25", "FFM"),
        ("Forge Filmmaking ABO Lead Campaign 2/10/24", "FFM"),
        ("Forge Wr retargeting campaign | ABO 25/3", "FW"),
        ("the Forge | Testing | ABO | 10/6/25", "AMBIGUOUS_FFM"),
        ("the Forge FM Lead Campaign CBO", "FFM"),
        ("LIVE L3 CREATORS | CBO | 4 MARCH", "NON_FORGE"),
        ("BFP LEADS | LIVE COHORT | OCT 22 | CBO", "NON_FORGE"),
        ("Hiring | Lead | 10th April", "NON_FORGE"),
        ("Nelson Masterclass | Sales | Feb 24 | MC", "NON_FORGE"),
        ("Forge Creators RTG | CBO | 29/7/25", "FC"),
        ("Forge Insta Chat Ads | 21/3/25", "AMBIGUOUS_FFM"),
        ("AVINASH EXP BID CAP", "NON_FORGE"),
    ]
    print(f"{'EXPECTED':<15} {'GOT':<18} {'PASS':<5} {'NAME'}")
    print("-" * 100)
    for name, expected in cases:
        got, reason = classify_campaign(name)
        ok = "✓" if got == expected else "✗"
        print(f"{expected:<15} {got:<18} {ok:<5} {name[:60]}")
