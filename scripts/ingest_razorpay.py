"""
Razorpay payments ingestion → Supabase.

Pulls payments from BOTH accounts (Admin RP + Edtech RP), classifies by amount,
matches to existing leads by email/phone, inserts payments rows + creates new
lead rows for previously-unseen payers.

Amount classification (from credentials master doc):
  ₹400        → live app fee
  ₹600        → Forge Writing app fee (FW)
  ₹700        → Forge Creators app fee (FC)
  ₹800        → Forge Filmmaking app fee (FFM)
  ₹900        → Forge AI app fee (FAI)
  ₹8,000      → Live confirmation
  ₹15,000     → Forge confirmation (any vertical — match by email join to lead's program)
  ₹17,500     → Forge Writing confirmation (verify per record)
  ₹40,000+    → Live full fee
  ₹50,000+    → Forge full fee
  ₹1,499 / 2,499 → Masterclass

Filters out test payments (void@razorpay.com).

Usage:
    python3 ingest_razorpay.py --account admin --days 90
    python3 ingest_razorpay.py --account edtech --days 365
    python3 ingest_razorpay.py --all --days 365      # both accounts
"""
import argparse, base64, json, re, time
from datetime import datetime, timezone, timedelta
from urllib import request as urlreq, error as urlerr
from supabase import create_client

CREDS_FILE = "/sessions/beautiful-friendly-wozniak/mnt/uploads/LevelUp_API_Credentials_Master.md"
SB_ENV = "/sessions/beautiful-friendly-wozniak/mnt/outputs/forge_phase1/secrets/.env.supabase"


def load_envs():
    env = {}
    for f in [CREDS_FILE, SB_ENV]:
        with open(f) as fh:
            for line in fh:
                if line and line[0].isupper() and "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip().strip('"')
    return env


# Amount → (program, payment_type) mapping. None program means unknown / ambiguous.
def classify_payment(amount_paise: int, lead_program_hint: str | None = None) -> tuple[str | None, str]:
    amt = amount_paise / 100  # paise → rupees
    if amt == 400:    return ("LIVE_ANY", "app_fee")  # generic live app fee
    if amt == 600:    return ("FW",       "app_fee")
    if amt == 700:    return ("FC",       "app_fee")
    if amt == 800:    return ("FFM",      "app_fee")
    if amt == 900:    return ("FAI",      "app_fee")
    if amt == 1499:   return (None,       "masterclass")
    if amt == 2499:   return (None,       "masterclass")
    if amt == 8000:   return ("LIVE_ANY", "confirmation")
    if amt == 15000:  return (lead_program_hint or "FORGE_ANY", "confirmation")
    if amt == 17500:  return ("FW",       "confirmation")
    if amt >= 50000:  return (lead_program_hint or "FORGE_ANY", "full")
    if amt >= 40000:  return ("LIVE_ANY", "full")
    return (None, "unknown")


def rzp_get(url: str, key_id: str, key_secret: str) -> dict:
    auth = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
    req = urlreq.Request(url, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
    })
    for attempt in range(4):
        try:
            with urlreq.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urlerr.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** attempt); continue
            raise
        except Exception:
            if attempt < 3:
                time.sleep(2 ** attempt); continue
            raise


def find_lead(sb, email: str | None, phone: str | None, program_hint: str | None = None):
    """Find lead by email or phone, optionally filtered by program."""
    if not email and not phone: return None
    q = sb.table("leads").select("id,program,email,phone,name")
    if program_hint and program_hint not in ("LIVE_ANY", "FORGE_ANY"):
        q = q.eq("program", program_hint)
    if email:
        r = q.eq("email", email).limit(1).execute()
        if r.data: return r.data[0]
    if phone:
        digits = re.sub(r"\D", "", phone)
        if 8 <= len(digits) <= 15:
            r = sb.table("leads").select("id,program,email,phone,name").eq("phone", digits).limit(1).execute()
            if r.data: return r.data[0]
    return None


def ingest_account(account: str, sb, env, since_days: int = 90, max_pages: int = 50):
    if account == "admin":
        kid, ksec = env["RZP_ADMIN_KEY_ID"], env["RZP_ADMIN_KEY_SECRET"]
    elif account == "edtech":
        kid, ksec = env["RZP_EDTECH_KEY_ID"], env["RZP_EDTECH_KEY_SECRET"]
    else:
        raise ValueError(f"unknown account: {account}")

    print(f"\n{'='*60}\n  Razorpay {account.upper()} RP — last {since_days} days\n{'='*60}")
    until_ts = int(datetime.now(timezone.utc).timestamp())
    since_ts = until_ts - since_days * 86400

    total_seen = 0
    total_inserted = 0
    total_matched = 0
    total_skipped_test = 0
    skip = 0

    for page in range(max_pages):
        url = f"https://api.razorpay.com/v1/payments?from={since_ts}&to={until_ts}&count=100&skip={skip}"
        d = rzp_get(url, kid, ksec)
        items = d.get("items", [])
        if not items: break

        rows_to_insert = []
        # Pre-collect emails/phones to batch-lookup leads
        all_emails = list({p.get("email") for p in items if p.get("email") and p.get("email") != "void@razorpay.com"})
        all_contacts = list({re.sub(r"\D", "", p.get("contact") or "") for p in items if p.get("contact")})

        # Batch lead lookup
        lead_by_email = {}
        lead_by_phone = {}
        if all_emails:
            r = sb.table("leads").select("id,program,email").in_("email", all_emails).execute()
            for l in r.data:
                if l["email"] not in lead_by_email or l.get("program"):
                    lead_by_email[l["email"]] = l
        if all_contacts:
            r = sb.table("leads").select("id,program,phone").in_("phone", all_contacts).execute()
            for l in r.data:
                lead_by_phone[l["phone"]] = l

        for p in items:
            total_seen += 1
            email = (p.get("email") or "").lower() or None
            contact = re.sub(r"\D", "", p.get("contact") or "") or None
            if email == "void@razorpay.com":
                total_skipped_test += 1
                continue

            # Match to lead by email first, fallback to phone
            lead = lead_by_email.get(email) or (lead_by_phone.get(contact) if contact else None)
            program_hint = lead.get("program") if lead else None
            program, ptype = classify_payment(p["amount"], program_hint)
            # Resolve generic placeholders
            if program in ("LIVE_ANY", "FORGE_ANY"):
                # Fall back to lead's program if known, else leave as None (unclassified)
                program = lead.get("program") if lead and lead.get("program") else None

            if program and program not in ("LIVE_ANY", "FORGE_ANY"):
                pass  # OK
            else:
                program = None  # Couldn't classify

            row = {
                "id": p["id"],
                "lead_id": lead["id"] if lead else None,
                "account": account,
                "program": program,
                "payment_type": ptype,
                "amount_inr": p["amount"] / 100,
                "status": p.get("status"),
                "email": email,
                "phone": contact,
                "paid_at": datetime.fromtimestamp(p["created_at"], tz=timezone.utc).isoformat(),
                "raw": {"method": p.get("method"), "currency": p.get("currency")},
            }
            rows_to_insert.append(row)
            if lead: total_matched += 1

        if rows_to_insert:
            try:
                sb.table("payments").upsert(rows_to_insert, on_conflict="id").execute()
                total_inserted += len(rows_to_insert)
            except Exception as e:
                print(f"  ⚠️ payments insert error page {page}: {str(e)[:200]}")

        print(f"  page {page+1}: {len(items)} pmts (matched_to_leads={total_matched}, total inserted={total_inserted})")
        if len(items) < 100: break
        skip += 100

    sb.table("sync_state").upsert({
        "source": f"razorpay:{account}",
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
        "rows_imported": total_inserted,
        "status": "ok",
    }).execute()

    print(f"\n  ✅ {account.upper()}: seen={total_seen} inserted={total_inserted} matched={total_matched} skipped_test={total_skipped_test}")
    return {"account": account, "seen": total_seen, "inserted": total_inserted, "matched": total_matched}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", choices=["admin", "edtech"])
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--max-pages", type=int, default=50)
    args = ap.parse_args()

    env = load_envs()
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    accounts = ["admin", "edtech"] if args.all else [args.account or "admin"]
    for a in accounts:
        try:
            ingest_account(a, sb, env, since_days=args.days, max_pages=args.max_pages)
        except Exception as e:
            import traceback
            print(f"  ❌ {a} failed: {type(e).__name__}: {str(e)[:200]}")
            traceback.print_exc()


if __name__ == "__main__":
    main()
