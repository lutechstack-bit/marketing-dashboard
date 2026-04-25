"""
Phase 1 backfill orchestrator.

Runs the Meta Ads sync in chunked time windows (to avoid Meta API + bash timeouts),
collects all rows, builds the final 3 output tables, and writes them to the live
Forge finance Google Sheet via gspread.

Usage:
    # Run a single chunk (writes to local cache):
    python3 run_full_backfill.py --since 2024-04-01 --until 2024-09-30 --chunk Q1

    # Or run all chunks + write to sheet in one go (long-running):
    python3 run_full_backfill.py --all --write

    # Just consolidate cached chunks → write:
    python3 run_full_backfill.py --consolidate --write
"""
import os, sys, json, pickle, argparse
from datetime import date, datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forge_meta_sync import (
    load_env, list_forge_campaigns, fetch_ad_insights, build_daily_table,
    build_monthly_rollup, build_inputs_shaped_table, CREDS_FILE, SHEET_ID
)

CACHE_DIR = "/sessions/beautiful-friendly-wozniak/mnt/outputs/forge_phase1/chunks"
SA_PATH = "/sessions/beautiful-friendly-wozniak/mnt/Marketing Lead Dashboard/forge-service-account.json"

# 4 chunks of ~6 months each — covers Apr 2024 → today
DEFAULT_CHUNKS = [
    ("2024-04-01", "2024-09-30", "2024H2"),
    ("2024-10-01", "2025-03-31", "2024H1"),
    ("2025-04-01", "2025-09-30", "2025H2"),
    ("2025-10-01", "2026-04-25", "2026H1"),
]


def run_chunk(token, account, since, until, chunk_name):
    print(f"\n=== CHUNK {chunk_name}: {since} → {until} ===")
    forge = list_forge_campaigns(token, account)
    print(f"  {len(forge)} Forge campaigns")
    insights = fetch_ad_insights(token, forge, since, until)
    forge_map = {c["id"]: c for c in forge}
    daily = build_daily_table(insights, forge_map)
    print(f"  {len(daily)} daily rows")
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(os.path.join(CACHE_DIR, f"{chunk_name}.pkl"), "wb") as f:
        pickle.dump(daily, f)
    return daily


def consolidate():
    """Load all cached chunks, deduplicate, return combined daily rows."""
    rows = []
    seen = set()  # dedupe on (date, ad_id)
    for f in sorted(os.listdir(CACHE_DIR)):
        if not f.endswith(".pkl"): continue
        with open(os.path.join(CACHE_DIR, f), "rb") as fh:
            chunk = pickle.load(fh)
        before = len(rows)
        for r in chunk:
            k = (r["date"], r["ad_id"])
            if k in seen: continue
            seen.add(k)
            rows.append(r)
        print(f"  loaded {f}: +{len(rows)-before} rows (total {len(rows)})")
    rows.sort(key=lambda r: (r["date"], r["program"], r["campaign_name"], r["ad_name"]))
    return rows


def write_to_sheet(daily, monthly, inputs_shaped):
    import gspread
    gc = gspread.service_account(filename=SA_PATH)
    sh = gc.open_by_key(SHEET_ID)

    def write_tab(title, header_and_rows):
        try:
            ws = sh.worksheet(title)
            ws.clear()
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=title, rows=max(len(header_and_rows)+50, 100), cols=max(len(header_and_rows[0]), 20))
        ws.update(values=header_and_rows, range_name="A1", value_input_option="USER_ENTERED")
        print(f"  ✅ {title}: {len(header_and_rows)} rows written")

    # Daily
    if daily:
        h = list(daily[0].keys())
        write_tab("Meta Ads Daily", [h] + [[r.get(k, "") for k in h] for r in daily])
    # Monthly
    if monthly:
        h = list(monthly[0].keys())
        write_tab("Meta Ads Monthly Rollup", [h] + [[r.get(k, "") for k in h] for r in monthly])
    # Inputs-shaped
    if inputs_shaped:
        write_tab("Meta Ads Inputs Format", inputs_shaped)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="ISO date YYYY-MM-DD (single chunk mode)")
    ap.add_argument("--until", help="ISO date YYYY-MM-DD")
    ap.add_argument("--chunk", help="Chunk name (single chunk mode)")
    ap.add_argument("--all", action="store_true", help="Run all 4 default chunks sequentially")
    ap.add_argument("--consolidate", action="store_true", help="Skip fetch, just merge cached chunks")
    ap.add_argument("--write", action="store_true", help="Write to live Google Sheet")
    args = ap.parse_args()

    env = load_env(CREDS_FILE)
    token = env["META_ACCESS_TOKEN"]
    account = env["META_AD_ACCOUNT_ID_API"]

    if args.all:
        for since, until, chunk_name in DEFAULT_CHUNKS:
            run_chunk(token, account, since, until, chunk_name)
    elif args.since and args.until and args.chunk:
        run_chunk(token, account, args.since, args.until, args.chunk)
    elif not args.consolidate:
        ap.print_help()
        sys.exit(1)

    if args.consolidate or args.all:
        print("\n=== CONSOLIDATING ===")
        daily = consolidate()
        monthly = build_monthly_rollup(daily)
        inputs_shaped = build_inputs_shaped_table(monthly)
        print(f"\n  Daily:   {len(daily)} rows")
        print(f"  Monthly: {len(monthly)} rows")
        print(f"  Shaped:  {len(inputs_shaped)} rows")

        if args.write:
            print("\n=== WRITING TO LIVE SHEET ===")
            write_to_sheet(daily, monthly, inputs_shaped)
            print("\n✅ Done.")


if __name__ == "__main__":
    main()
