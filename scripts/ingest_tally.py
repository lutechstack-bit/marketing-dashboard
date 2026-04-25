"""
Tally form submissions ingestion → Supabase.

For each Forge form, fetches all submissions (paginated), extracts email/phone/name
+ responses keyed by question title, upserts a lead row, inserts a form_submission row.

Usage:
    python3 ingest_tally.py --form nPJydd            # Single form
    python3 ingest_tally.py --form nPJydd --max-pages 5
    python3 ingest_tally.py --all-current             # FFM/FW/FAI/FC current forms
    python3 ingest_tally.py --all-legacy              # Older forms (large volumes)
"""

import argparse
import json
import os
import re
import sys
import time
from typing import Optional
from urllib import request as urlreq
from supabase import create_client


CREDS_FILE = "/sessions/beautiful-friendly-wozniak/mnt/uploads/LevelUp_API_Credentials_Master.md"
SB_ENV = "/sessions/beautiful-friendly-wozniak/mnt/outputs/forge_phase1/secrets/.env.supabase"


def load_envs():
    env = {}
    with open(CREDS_FILE) as f:
        for line in f:
            if line and line[0].isupper() and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"')
    with open(SB_ENV) as f:
        for line in f:
            if line and line[0].isupper() and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env


# Map Tally form_id → (program code, friendly form_name, default-completed-only?)
FORGE_FORMS = {
    "nPJydd": ("FFM", "Forge Filmmaking | New Form (current)",        False),
    "316Mel": ("FFM", "Forge Filmmaking MAIN FORM (legacy)",          True),  # only completed for legacy
    "3NZXk0": ("FW",  "Forge Writing New Form (current)",             False),
    "3lY56o": ("FW",  "Forge Writing Appl Form (legacy)",             True),
    "kdWEXR": ("FAI", "Forge AI Residency Application Form",          False),
    "3EgP2L": ("FC",  "Forge Creators Application Form",              False),
}


def tally_get(url: str, key: str) -> dict:
    req = urlreq.Request(url, headers={
        "Authorization": f"Bearer {key}",
        "tally-version": "2025-02-01",
        "User-Agent": "LevelUp-Forge-Sync/1.0",
        "Accept": "application/json",
    })
    for attempt in range(4):
        try:
            with urlreq.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            if attempt < 3:
                time.sleep(2 ** attempt); continue
            raise


def extract_questions(submissions_response: dict) -> dict[str, str]:
    """Tally embeds 'questions' in submissions response. Returns {questionId: title}.
    For hidden fields with null question title, fall back to field-level title."""
    out = {}
    for q in submissions_response.get("questions", []) or []:
        qid = q.get("id")
        qtitle = (q.get("title") or "").strip()
        if not qtitle:
            # Hidden fields case — use first field's title
            fields = q.get("fields") or []
            if fields and fields[0].get("title"):
                qtitle = fields[0]["title"]
        if qid:
            out[qid] = qtitle or qid
    return out


def fetch_form_submissions(form_id: str, key: str, page: int = 1, limit: int = 200, completed_only: bool = False) -> dict:
    qfilter = "&filter=completed" if completed_only else ""
    return tally_get(
        f"https://api.tally.so/forms/{form_id}/submissions?page={page}&limit={limit}{qfilter}",
        key
    )


# Heuristics: extract email/phone/name from a Tally submission's responses.
EMAIL_RE = re.compile(r"^[\w.+\-]+@[\w\-]+\.[\w.\-]+$")
PHONE_RE = re.compile(r"^\+?\d[\d\s\-()]{7,}$")


def extract_lead_fields(responses_normalized: dict) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Given {question_title: answer}, find email, phone, name."""
    email, phone, name = None, None, None
    for q, a in responses_normalized.items():
        if not isinstance(a, (str, int, float)): continue
        s = str(a).strip()
        ql = q.lower()
        if not email and (("email" in ql) or EMAIL_RE.fullmatch(s)):
            if EMAIL_RE.fullmatch(s): email = s.lower()
        if not phone and (("phone" in ql) or ("mobile" in ql) or ("contact" in ql and "number" in ql)):
            digits = re.sub(r"\D", "", s)
            if 8 <= len(digits) <= 15: phone = digits
        if not name and (("name" in ql) or ("full name" in ql)):
            if 2 <= len(s) <= 100 and not s.isdigit(): name = s
    return email, phone, name


def normalize_response(answer):
    """Tally responses can be strings, arrays, objects. Normalize to plain values."""
    if isinstance(answer, list):
        if all(isinstance(x, str) for x in answer):
            return ", ".join(answer)
        return answer  # leave as is — JSONB
    if isinstance(answer, dict):
        return answer  # JSONB
    return answer


def ingest_one_form(form_id: str, key: str, sb, max_pages: int = 100) -> dict:
    program, form_name, force_completed = FORGE_FORMS[form_id]
    print(f"\n{'='*60}\n  {form_id}: {form_name} (program={program})\n{'='*60}")

    total_seen = 0
    total_inserted = 0
    total_skipped = 0
    total_lead_upserts = 0
    questions = {}

    for page in range(1, max_pages + 1):
        d = fetch_form_submissions(form_id, key, page=page, limit=200, completed_only=force_completed)
        # Questions are embedded; parse on first page (and refresh in case schema changed)
        if not questions or page == 1:
            questions = extract_questions(d)
            if page == 1: print(f"  loaded {len(questions)} field definitions")
        items = d.get("submissions") or d.get("items") or d.get("data") or []
        if not items:
            break

        sub_rows = []
        lead_rows = []
        for s in items:
            sub_id = s.get("id") or s.get("submissionId")
            if not sub_id: continue
            total_seen += 1

            # Build {question_title: answer} — keyed by questionId from response → title from questions
            responses_normalized = {}
            for r in s.get("responses", []):
                qid = r.get("questionId")
                if not qid: continue
                title = questions.get(qid) or qid
                ans = normalize_response(r.get("answer"))
                if title:
                    responses_normalized[title] = ans

            email, phone, name = extract_lead_fields(responses_normalized)
            submitted_at = s.get("submittedAt") or s.get("createdAt")

            sub_rows.append({
                "id": sub_id,
                "form_id": form_id,
                "form_name": form_name,
                "program": program,
                "is_completed": bool(s.get("isCompleted", True)),
                "submitted_at": submitted_at,
                "email": email,
                "phone": phone,
                "name": name,
                "responses": responses_normalized,
                "raw": {"respondentId": s.get("respondentId")},
            })

            # Build lead upsert row (only if we have an identifier)
            if email or phone:
                lead_rows.append({
                    "email": email,
                    "phone": phone,
                    "name": name,
                    "program": program,
                })

        # Dedupe within page by (email/phone, program) — Postgres can't ON CONFLICT same row twice
        def dedupe(rows: list, key_field: str) -> list:
            seen = {}
            for r in rows:
                k = (r.get(key_field), r.get("program"))
                # Keep the row with most info (longer name preferred)
                existing = seen.get(k)
                if not existing or len(str(r.get("name") or "")) > len(str(existing.get("name") or "")):
                    seen[k] = r
            return list(seen.values())

        leads_with_email = dedupe([l for l in lead_rows if l.get("email")], "email")
        leads_phone_only = dedupe([l for l in lead_rows if not l.get("email") and l.get("phone")], "phone")
        try:
            if leads_with_email:
                sb.table("leads").upsert(leads_with_email, on_conflict="email,program", ignore_duplicates=False).execute()
                total_lead_upserts += len(leads_with_email)
            if leads_phone_only:
                sb.table("leads").upsert(leads_phone_only, on_conflict="phone,program", ignore_duplicates=False).execute()
                total_lead_upserts += len(leads_phone_only)
        except Exception as e:
            print(f"  ⚠️ lead upsert error on page {page}: {str(e)[:200]}")

        # Now look up lead_ids by email/phone for FK
        if sub_rows:
            emails = list({r["email"] for r in sub_rows if r.get("email")})
            phones = list({r["phone"] for r in sub_rows if r.get("phone") and not r.get("email")})
            email_map = {}
            phone_map = {}
            if emails:
                lr = sb.table("leads").select("id,email").in_("email", emails).eq("program", program).execute()
                email_map = {x["email"]: x["id"] for x in lr.data}
            if phones:
                lr = sb.table("leads").select("id,phone").in_("phone", phones).eq("program", program).execute()
                phone_map = {x["phone"]: x["id"] for x in lr.data}
            for r in sub_rows:
                if r.get("email") and r["email"] in email_map:
                    r["lead_id"] = email_map[r["email"]]
                elif r.get("phone") and r["phone"] in phone_map:
                    r["lead_id"] = phone_map[r["phone"]]

            # Insert submissions in bulk (upsert on id to be idempotent)
            try:
                # JSONB columns must be JSON-serializable
                clean_rows = [{k: v for k,v in r.items()} for r in sub_rows]
                sb.table("form_submissions").upsert(clean_rows, on_conflict="id").execute()
                total_inserted += len(clean_rows)
            except Exception as e:
                # Fall back to one-at-a-time so a single bad row doesn't kill the batch
                print(f"  ⚠️ bulk insert error on page {page}: {str(e)[:200]}; falling back to row-by-row")
                for r in sub_rows:
                    try:
                        sb.table("form_submissions").upsert([r], on_conflict="id").execute()
                        total_inserted += 1
                    except Exception as ee:
                        total_skipped += 1

        print(f"  page {page}: {len(items)} subs (total seen={total_seen}, inserted={total_inserted}, skipped={total_skipped})")
        if len(items) < 200: break  # last page

    # Bookkeeping
    sb.table("sync_state").upsert({
        "source": f"tally:{form_id}",
        "last_synced_at": "now()",
        "rows_imported": total_inserted,
        "status": "ok",
    }).execute()

    print(f"\n  ✅ {form_id}: seen={total_seen} inserted={total_inserted} skipped={total_skipped} lead_upserts={total_lead_upserts}")
    return {"form_id": form_id, "seen": total_seen, "inserted": total_inserted}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--form", help="Single form ID to ingest")
    ap.add_argument("--max-pages", type=int, default=100)
    ap.add_argument("--all-current", action="store_true", help="Ingest current FFM/FW/FAI/FC forms")
    ap.add_argument("--all-legacy", action="store_true", help="Ingest legacy 316Mel + 3lY56o")
    args = ap.parse_args()

    env = load_envs()
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    tally_key = env["TALLY_API_KEY"]

    forms = []
    if args.form:
        forms = [args.form]
    elif args.all_current:
        forms = ["nPJydd", "3NZXk0", "kdWEXR", "3EgP2L"]
    elif args.all_legacy:
        forms = ["316Mel", "3lY56o"]
    else:
        forms = ["nPJydd", "3NZXk0", "kdWEXR", "3EgP2L"]  # default = current

    results = []
    for fid in forms:
        if fid not in FORGE_FORMS:
            print(f"  unknown form: {fid}, skipping"); continue
        try:
            results.append(ingest_one_form(fid, tally_key, sb, max_pages=args.max_pages))
        except Exception as e:
            import traceback
            print(f"  ❌ {fid} failed: {type(e).__name__}: {str(e)[:200]}")
            traceback.print_exc()
    print("\n=== TOTAL ===")
    for r in results:
        print(f"  {r['form_id']}: {r['inserted']} inserted of {r['seen']} seen")


if __name__ == "__main__":
    main()
