"""
forge_meta_sync.py — Phase 1 Meta Ads → Google Sheet sync for Forge campaigns.

What it does:
1. Pulls last N days of ad-level insights from Meta Marketing API
   for the Forge ad account (act_798786164101616).
2. Filters to Forge campaigns only (FFM/FW/FC/FAI), classifying via parser.
3. Aggregates to two output tables:
   - Daily: one row per (ad × day) with spend, impressions, clicks, CTR, etc.
   - Monthly Rollup: one row per program × month, in the shape that fits
     the user's existing `Inputs` tab.
4. Either writes to local CSVs (dry-run) or to the live Google Sheet
   (when --write flag is passed and a Google service account JSON is configured).

Usage:
    # Dry run — writes CSVs to ./out/ for inspection
    python3 forge_meta_sync.py --days 90

    # Live — writes to the Google Sheet
    python3 forge_meta_sync.py --days 90 --write

Cron-friendly: idempotent (re-running for same date overwrites cleanly).
"""

import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from urllib import parse as urlparse, request as urlreq, error as urlerr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forge_campaign_parser import classify_campaign

# ──────────────────────────────────────────────────────────────────────────
# Config — credentials loaded from .env-style file
# ──────────────────────────────────────────────────────────────────────────
CREDS_FILE = "/sessions/beautiful-friendly-wozniak/mnt/uploads/LevelUp_API_Credentials_Master.md"
SHEET_ID   = "1b811ldC82v2GSOYGTzt7UokXDC8yy9RFv3Ffi0aXhK8"
GST_RATE   = 0.18  # India GST on Meta ad spend — Inputs tab tracks GST-inclusive
OUT_DIR    = os.environ.get("FORGE_OUT_DIR", "/sessions/beautiful-friendly-wozniak/mnt/outputs/forge_phase1")
WORKSPACE_DIR = "/sessions/beautiful-friendly-wozniak/mnt/Marketing Lead Dashboard"

API_VERSION = "v21.0"
META_API_BASE = f"https://graph.facebook.com/{API_VERSION}"


def load_env(path: str) -> dict:
    env = {}
    with open(path) as f:
        for line in f:
            if line and line[0].isupper() and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"')
    return env


# ──────────────────────────────────────────────────────────────────────────
# Meta API helpers
# ──────────────────────────────────────────────────────────────────────────
def meta_get(path_or_url: str, params: dict | None = None) -> dict:
    """GET against Meta Graph API with retries on 429/5xx."""
    if path_or_url.startswith("http"):
        url = path_or_url
        if params:
            sep = "&" if "?" in url else "?"
            url = url + sep + urlparse.urlencode(params)
    else:
        url = META_API_BASE + path_or_url
        if params:
            url = url + "?" + urlparse.urlencode(params)

    for attempt in range(5):
        try:
            with urlreq.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except urlerr.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                wait = 2 ** attempt
                print(f"  [retry {attempt+1}] HTTP {e.code} — sleeping {wait}s")
                time.sleep(wait)
                continue
            raise
        except Exception as e:
            if attempt < 4:
                wait = 2 ** attempt
                print(f"  [retry {attempt+1}] {type(e).__name__}: {e} — sleeping {wait}s")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Failed after 5 attempts: {url}")


def list_forge_campaigns(token: str, ad_account_id: str) -> list[dict]:
    """Pull all campaigns and classify via parser. Returns Forge-only with program tag."""
    out = []
    next_url = None
    params = {
        "access_token": token,
        "fields": "id,name,effective_status,objective,created_time",
        "limit": 100,
    }
    path = f"/{ad_account_id}/campaigns"
    next_url = META_API_BASE + path + "?" + urlparse.urlencode(params)
    while next_url:
        d = meta_get(next_url)
        for c in d.get("data", []):
            program, reason = classify_campaign(c.get("name") or "")
            if program in ("FFM", "FW", "FC", "FAI", "AMBIGUOUS_FFM"):
                # AMBIGUOUS_FFM rolls up under FFM (per user confirmation)
                norm_program = "FFM" if program == "AMBIGUOUS_FFM" else program
                out.append({
                    "id": c["id"],
                    "name": c.get("name") or "",
                    "program": norm_program,
                    "raw_program": program,
                    "effective_status": c.get("effective_status"),
                    "objective": c.get("objective"),
                })
        next_url = d.get("paging", {}).get("next")
    return out


def fetch_ad_insights(token: str, forge_campaigns: list[dict], since: str, until: str) -> list[dict]:
    """Pull ad-level daily insights for all 21 Forge campaigns IN PARALLEL.
    Most campaigns return 0 rows (paused/inactive), so threading collapses total
    time to roughly the slowest campaign's fetch."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    fields = ",".join([
        "date_start", "date_stop",
        "ad_id", "ad_name",
        "adset_id", "adset_name",
        "campaign_id", "campaign_name",
        "spend", "impressions", "reach", "frequency",
        "clicks", "ctr", "cpc", "cpm",
        "actions", "action_values",
    ])

    def fetch_one(c):
        cid = c["id"]
        params = {
            "access_token": token,
            "level": "ad",
            "time_increment": "1",
            "time_range": json.dumps({"since": since, "until": until}),
            "fields": fields,
            "limit": 500,
        }
        next_url = META_API_BASE + f"/{cid}/insights?" + urlparse.urlencode(params)
        rows = []
        page = 0
        while next_url:
            page += 1
            d = meta_get(next_url)
            rows.extend(d.get("data", []))
            next_url = d.get("paging", {}).get("next")
            if page > 20:  # safety
                break
        return c, rows

    all_rows = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(fetch_one, c): c for c in forge_campaigns}
        for fut in as_completed(futures):
            c, rows = fut.result()
            all_rows.extend(rows)
            print(f"  {c['program']:<4} {c['name'][:55]:<55} → {len(rows)} rows")
    return all_rows


# ──────────────────────────────────────────────────────────────────────────
# Action / conversion extraction
# ──────────────────────────────────────────────────────────────────────────
TRACKED_ACTIONS = {
    "lead":                                 "lead",
    "offsite_conversion.fb_pixel_lead":     "lead_pixel",
    "offsite_conversion.fb_pixel_purchase": "purchase_pixel",
    "purchase":                             "purchase",
    "complete_registration":                "complete_registration",
    "view_content":                         "view_content",
    "landing_page_view":                    "landing_page_view",
}


def extract_actions(actions, action_values):
    """Pull standard action counts/values from Meta's nested actions array."""
    out = {col: 0 for col in TRACKED_ACTIONS.values()}
    out_val = {f"{col}_value": 0.0 for col in TRACKED_ACTIONS.values()}
    if actions:
        for a in actions:
            t = a.get("action_type")
            if t in TRACKED_ACTIONS:
                try: out[TRACKED_ACTIONS[t]] += int(a.get("value", 0))
                except: pass
    if action_values:
        for a in action_values:
            t = a.get("action_type")
            if t in TRACKED_ACTIONS:
                try: out_val[f"{TRACKED_ACTIONS[t]}_value"] += float(a.get("value", 0))
                except: pass
    out.update(out_val)
    return out


# ──────────────────────────────────────────────────────────────────────────
# Build Daily + Monthly Rollup tables
# ──────────────────────────────────────────────────────────────────────────
def build_daily_table(insights: list[dict], forge_campaign_map: dict) -> list[dict]:
    rows = []
    for r in insights:
        cid = r.get("campaign_id")
        if cid not in forge_campaign_map:
            continue  # not a Forge campaign
        program = forge_campaign_map[cid]["program"]
        actions = extract_actions(r.get("actions"), r.get("action_values"))
        row = {
            "date": r.get("date_start"),
            "program": program,
            "campaign_id": cid,
            "campaign_name": r.get("campaign_name"),
            "adset_name": r.get("adset_name"),
            "ad_id": r.get("ad_id"),
            "ad_name": r.get("ad_name"),
            "spend": float(r.get("spend") or 0),
            "impressions": int(r.get("impressions") or 0),
            "reach": int(r.get("reach") or 0),
            "frequency": float(r.get("frequency") or 0),
            "clicks": int(r.get("clicks") or 0),
            "ctr": float(r.get("ctr") or 0),
            "cpc": float(r.get("cpc") or 0),
            "cpm": float(r.get("cpm") or 0),
        }
        row.update(actions)
        rows.append(row)
    rows.sort(key=lambda x: (x["date"], x["program"], x["campaign_name"], x["ad_name"]))
    return rows


def build_monthly_rollup(daily_rows: list[dict]) -> list[dict]:
    """Aggregate daily → (program, year-month). Output mirrors Inputs tab shape."""
    agg = defaultdict(lambda: defaultdict(float))
    for r in daily_rows:
        d = datetime.strptime(r["date"], "%Y-%m-%d").date()
        key = (r["program"], d.year, d.month)
        agg[key]["spend"]       += r["spend"]
        agg[key]["impressions"] += r["impressions"]
        agg[key]["reach"]       += r["reach"]
        agg[key]["clicks"]      += r["clicks"]
        agg[key]["lead"]        += r.get("lead", 0)
        agg[key]["lead_pixel"]  += r.get("lead_pixel", 0)
        agg[key]["purchase_pixel"] += r.get("purchase_pixel", 0)
        agg[key]["purchase_pixel_value"] += r.get("purchase_pixel_value", 0)

    rows = []
    for (program, y, m), v in sorted(agg.items()):
        impressions = v["impressions"]
        clicks      = v["clicks"]
        spend       = v["spend"]
        spend_gst   = spend * (1 + GST_RATE)
        leads_total = v["lead"] + v["lead_pixel"]
        rows.append({
            "year":              y,
            "month":             m,
            "month_name":        date(y, m, 1).strftime("%B"),
            "program":           program,
            "spend_inr_excl_gst": round(spend, 2),
            "spend_inr_incl_gst": round(spend_gst, 2),
            "impressions":       int(impressions),
            "reach":             int(v["reach"]),
            "clicks":            int(clicks),
            "ctr_pct":           round(100 * clicks / impressions, 2) if impressions else 0,
            "cpc_inr":           round(spend / clicks, 2) if clicks else 0,
            "cpm_inr":           round(spend / impressions * 1000, 2) if impressions else 0,
            "leads":             int(leads_total),
            "cost_per_lead":     round(spend / leads_total, 2) if leads_total else 0,
            "purchase_count":    int(v["purchase_pixel"]),
            "purchase_value":    round(v["purchase_pixel_value"], 2),
        })
    return rows


def build_inputs_shaped_table(monthly_rows: list[dict]) -> list[list]:
    """
    Shape = same as user's Inputs tab.
    Header row 1: 'Year' then years (e.g., 2025, 2025, ..., 2026)
    Header row 2: 'Month' then month names (January, February, ...)
    Then rows: 'FFM Ads', 'FW Ads', 'FC Ads', 'FAI Ads' with monthly spend across.
    """
    months = sorted({(r["year"], r["month"]) for r in monthly_rows})
    if not months:
        return []
    by_pm = {(r["program"], r["year"], r["month"]): r for r in monthly_rows}

    out = []
    out.append(["Year"] + [y for (y, m) in months])
    out.append(["Month"] + [date(y, m, 1).strftime("%B") for (y, m) in months])
    for prog in ("FFM", "FW", "FC", "FAI"):
        row = [f"{prog} Ads"]  # GST-inclusive to match user's existing Inputs tab
        for (y, m) in months:
            r = by_pm.get((prog, y, m))
            row.append(round(r["spend_inr_incl_gst"], 2) if r else 0)
        out.append(row)
    return out


# ──────────────────────────────────────────────────────────────────────────
# Output: write CSVs (dry-run) or Google Sheet (live)
# ──────────────────────────────────────────────────────────────────────────
def write_csv(path: str, rows: list[dict], fields=None):
    if not rows:
        with open(path, "w") as f: f.write("")
        return
    fields = fields or list(rows[0].keys())
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def write_2d_csv(path: str, rows_2d: list[list]):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerows(rows_2d)


def write_to_gsheet(sheet_id: str, daily_rows, monthly_rows, inputs_shaped):
    """Write to Google Sheets. Requires gspread + service account JSON at GOOGLE_APPLICATION_CREDENTIALS."""
    try:
        import gspread
    except ImportError:
        print("  ERROR: gspread not installed. Run: pip3 install gspread")
        return False
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if not sa_path or not os.path.isfile(sa_path):
        print(f"  ERROR: service account JSON not found at {sa_path}")
        print("         Set GOOGLE_APPLICATION_CREDENTIALS env var to the JSON path.")
        return False
    gc = gspread.service_account(filename=sa_path)
    sh = gc.open_by_key(sheet_id)
    for tab, header_and_rows in [
        ("Meta Ads Daily",          [list(daily_rows[0].keys())] + [list(r.values()) for r in daily_rows] if daily_rows else [[]]),
        ("Meta Ads Monthly Rollup", [list(monthly_rows[0].keys())] + [list(r.values()) for r in monthly_rows] if monthly_rows else [[]]),
        ("Meta Ads Inputs Format",  inputs_shaped),
    ]:
        try:
            ws = sh.worksheet(tab)
            ws.clear()
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=tab, rows=max(len(header_and_rows)+10, 100), cols=30)
        ws.update("A1", header_and_rows, value_input_option="USER_ENTERED")
        print(f"  ✅ wrote tab: {tab}")
    return True


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90, help="How many days back to pull")
    ap.add_argument("--since", help="ISO date YYYY-MM-DD (overrides --days)")
    ap.add_argument("--until", help="ISO date YYYY-MM-DD")
    ap.add_argument("--write", action="store_true", help="Write to Google Sheet (else dry-run CSVs)")
    ap.add_argument("--out-suffix", default="", help="Suffix appended to output filenames")
    args = ap.parse_args()

    env = load_env(CREDS_FILE)
    token = env["META_ACCESS_TOKEN"]
    account = env["META_AD_ACCOUNT_ID_API"]

    if args.since:
        since = datetime.strptime(args.since, "%Y-%m-%d").date()
    else:
        since = date.today() - timedelta(days=args.days)
    if args.until:
        until = datetime.strptime(args.until, "%Y-%m-%d").date()
    else:
        until = date.today()
    print(f"Fetching insights {since} → {until} for {account}")

    print("\n[1/4] Listing Forge campaigns…")
    forge = list_forge_campaigns(token, account)
    forge_map = {c["id"]: c for c in forge}
    print(f"  ✅ {len(forge)} Forge campaigns")
    by_prog = defaultdict(int)
    for c in forge: by_prog[c["program"]] += 1
    for k, v in sorted(by_prog.items()): print(f"     {k}: {v}")

    print("\n[2/4] Fetching ad-level daily insights (per-campaign)…")
    insights = fetch_ad_insights(token, forge, since.isoformat(), until.isoformat())
    print(f"  ✅ {len(insights)} ad×day rows from Meta")

    print("\n[3/4] Building Daily + Monthly Rollup + Inputs-shaped tables…")
    daily_rows = build_daily_table(insights, forge_map)
    monthly_rows = build_monthly_rollup(daily_rows)
    inputs_shaped = build_inputs_shaped_table(monthly_rows)
    print(f"  ✅ Daily: {len(daily_rows)} rows | Monthly: {len(monthly_rows)} rows | Inputs-shaped: {len(inputs_shaped)} rows")

    os.makedirs(OUT_DIR, exist_ok=True)
    suf = ("_" + args.out_suffix) if args.out_suffix else ""
    daily_csv  = os.path.join(OUT_DIR, f"Meta_Ads_Daily{suf}.csv")
    monthly_csv = os.path.join(OUT_DIR, f"Meta_Ads_Monthly_Rollup{suf}.csv")
    inputs_csv = os.path.join(OUT_DIR, f"Meta_Ads_Inputs_Shaped{suf}.csv")
    write_csv(daily_csv, daily_rows)
    write_csv(monthly_csv, monthly_rows)
    write_2d_csv(inputs_csv, inputs_shaped)

    # also copy to user's workspace
    try:
        os.makedirs(WORKSPACE_DIR + "/Phase1_DryRun", exist_ok=True)
        import shutil
        for src, dst in [
            (daily_csv,   WORKSPACE_DIR + "/Phase1_DryRun/Meta_Ads_Daily.csv"),
            (monthly_csv, WORKSPACE_DIR + "/Phase1_DryRun/Meta_Ads_Monthly_Rollup.csv"),
            (inputs_csv,  WORKSPACE_DIR + "/Phase1_DryRun/Meta_Ads_Inputs_Shaped.csv"),
        ]:
            shutil.copy(src, dst)
    except Exception as e:
        print(f"  (workspace copy skipped: {e})")

    print(f"\n[4/4] Output:")
    print(f"  Daily CSV:    {daily_csv}")
    print(f"  Monthly CSV:  {monthly_csv}")
    print(f"  Inputs-shape: {inputs_csv}")

    if args.write:
        print("\n→ Writing to Google Sheet…")
        ok = write_to_gsheet(SHEET_ID, daily_rows, monthly_rows, inputs_shaped)
        print("  ✅ done" if ok else "  ❌ failed")
    else:
        print("\n(dry-run — pass --write to push to Google Sheet)")


if __name__ == "__main__":
    main()
