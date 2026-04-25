"""
Compute funnel_stage + MQL score for every lead.

Funnel stages:
  form_partial      — form exists but isCompleted=false, no payment
  form_submitted    — form completed, no payment
  app_fee_paid      — captured app_fee payment exists
  confirmed         — captured confirmation payment (₹15k Forge / ₹8k Live) exists
  balance_paid      — captured full payment (≥₹40k) exists
  lost              — manually marked by sales rep

Score (0-100):
  Funnel stage     35 max
  Demographics     20 max  (age band, profession)
  Engagement       20 max  ("Why Forge" length, comprehension)
  Recency          15 max
  Ad signal        10 max  (number of ad touches)
"""
import json
import re
from datetime import datetime, timezone, timedelta
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


def stage_points(stage: str) -> int:
    return {
        "form_partial":     4,
        "form_submitted":  12,
        "app_fee_paid":    22,
        "interview_booked":30,  # we don't have Calendly data yet
        "accepted":        35,  # rescue zone — paid app fee + accepted but not confirmed
        "confirmed":        0,  # already converted, not an MQL anymore
        "balance_paid":     0,
        "attended":         0,
        "lost":             0,
    }.get(stage, 0)


WORKING_PROF_HINTS = [
    "working professional", "professional", "founder", "ceo", "cto",
    "cofounder", "co-founder", "entrepreneur", "consultant", "manager",
    "director", "engineer", "developer", "designer", "writer", "creator",
    "filmmaker", "freelance", "lawyer", "doctor", "marketing", "product",
    "self employed", "self-employed", "business owner", "business",
    "startup", "corporate"
]
STUDENT_HINTS = ["student", "school", "college student"]


def score_demographics(responses: dict) -> tuple[int, dict]:
    """Returns (points 0-20, breakdown dict)."""
    bd = {}
    pts = 0

    # Age
    age = None
    for k, v in (responses or {}).items():
        kl = k.lower()
        if ("age" in kl and ("years" not in kl or "old" in kl)) or kl.startswith("age"):
            try:
                # Try to parse number from value
                if isinstance(v, (int, float)):
                    age = int(v)
                elif isinstance(v, str):
                    m = re.search(r"\b(\d{2})\b", v)
                    if m: age = int(m.group(1))
                elif isinstance(v, list) and v:
                    # Multi-choice age band like "25-30"
                    s = " ".join(str(x) for x in v)
                    m = re.search(r"\b(\d{2})\b", s)
                    if m: age = int(m.group(1))
                break
            except: pass
    if age is not None:
        if 25 <= age <= 40:
            pts += 12; bd["age_25_40"] = 12
        elif 22 <= age <= 45:
            pts += 6; bd["age_22_45"] = 6

    # Profession
    prof_text = ""
    for k, v in (responses or {}).items():
        kl = k.lower()
        if "profession" in kl or "occupation" in kl or "what do you do" in kl or "who are you" in kl or "currently doing" in kl:
            if isinstance(v, list): prof_text += " ".join(str(x) for x in v) + " "
            elif isinstance(v, str): prof_text += v + " "
    pl = prof_text.lower()
    is_student = any(h in pl for h in STUDENT_HINTS)
    is_working = any(h in pl for h in WORKING_PROF_HINTS)
    if is_working and not is_student:
        pts += 8; bd["profession_match"] = 8
    elif is_student:
        bd["student_no_pts"] = 0

    return min(pts, 20), bd


def score_engagement(responses: dict) -> tuple[int, dict]:
    bd = {}
    pts = 0

    # "Why Forge" length
    why_text = ""
    for k, v in (responses or {}).items():
        kl = k.lower()
        if "why" in kl and ("forge" in kl or "this program" in kl or "join" in kl or "apply" in kl or "interest" in kl):
            if isinstance(v, str): why_text += v + " "
            elif isinstance(v, list): why_text += " ".join(str(x) for x in v) + " "
    why_len = len(why_text.strip())
    if why_len > 250:
        pts += 15; bd["why_long"] = 15
    elif why_len > 100:
        pts += 10; bd["why_medium"] = 10
    elif why_len > 30:
        pts += 5; bd["why_short"] = 5

    return min(pts, 20), bd


def score_recency(last_activity: datetime | None) -> tuple[int, dict]:
    if not last_activity: return 0, {}
    now = datetime.now(timezone.utc)
    delta = (now - last_activity).total_seconds()
    if delta < 86400:        return 15, {"recency_24h": 15}
    if delta < 3 * 86400:    return 10, {"recency_3d": 10}
    if delta < 7 * 86400:    return 5,  {"recency_7d": 5}
    if delta < 14 * 86400:   return 2,  {"recency_14d": 2}
    return 0, {"recency_old": 0}


def compute_lead_state(lead: dict, submissions: list, payments: list) -> tuple[str, int, dict]:
    """Returns (funnel_stage, score, score_breakdown)."""
    bd = {}

    # Determine funnel stage
    has_completed_form = any(s.get("is_completed") for s in submissions)
    has_partial_form = bool(submissions) and not has_completed_form

    captured = [p for p in payments if p.get("status") == "captured"]
    has_app_fee  = any(p.get("payment_type") == "app_fee" for p in captured)
    has_confirm  = any(p.get("payment_type") == "confirmation" for p in captured)
    has_balance  = any(p.get("payment_type") == "full" for p in captured)

    if has_balance:        stage = "balance_paid"
    elif has_confirm:      stage = "confirmed"
    elif has_app_fee:      stage = "accepted"  # paid app fee, no confirmation yet — rescue zone
    elif has_completed_form: stage = "form_submitted"
    elif has_partial_form: stage = "form_partial"
    else:                  stage = "form_partial"

    # Combine all responses for demographic + engagement scoring
    all_responses = {}
    for s in submissions:
        if s.get("responses"):
            all_responses.update(s["responses"])

    # Score
    funnel_pts = stage_points(stage); bd[f"stage_{stage}"] = funnel_pts
    demo_pts, demo_bd = score_demographics(all_responses); bd.update(demo_bd)
    eng_pts, eng_bd = score_engagement(all_responses); bd.update(eng_bd)

    # Recency
    last_act = None
    for s in submissions + captured:
        ts = s.get("submitted_at") or s.get("paid_at")
        if ts:
            try:
                t = datetime.fromisoformat(ts.replace("Z","+00:00"))
                if not last_act or t > last_act: last_act = t
            except: pass
    rec_pts, rec_bd = score_recency(last_act); bd.update(rec_bd)

    # Ad signal — placeholder until we wire ad_touches
    ad_pts = 0

    score = min(funnel_pts + demo_pts + eng_pts + rec_pts + ad_pts, 100)
    return stage, score, bd, last_act


def main():
    env = load_envs()
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

    # Load all leads in batches
    print("Loading leads...")
    all_leads = []
    page_size = 1000
    offset = 0
    while True:
        r = sb.table("leads").select("id,email,phone,program").range(offset, offset+page_size-1).execute()
        if not r.data: break
        all_leads.extend(r.data)
        if len(r.data) < page_size: break
        offset += page_size
    print(f"  {len(all_leads)} leads loaded")

    # Load all submissions + payments at once (small enough)
    print("Loading submissions + payments...")
    all_subs = []
    offset = 0
    while True:
        r = sb.table("form_submissions").select("lead_id,is_completed,submitted_at,responses").range(offset, offset+page_size-1).execute()
        if not r.data: break
        all_subs.extend(r.data)
        if len(r.data) < page_size: break
        offset += page_size
    print(f"  {len(all_subs)} submissions")

    all_pays = []
    offset = 0
    while True:
        r = sb.table("payments").select("lead_id,payment_type,status,paid_at").range(offset, offset+page_size-1).execute()
        if not r.data: break
        all_pays.extend(r.data)
        if len(r.data) < page_size: break
        offset += page_size
    print(f"  {len(all_pays)} payments")

    # Index by lead_id
    subs_by_lead = {}
    for s in all_subs:
        if s.get("lead_id"):
            subs_by_lead.setdefault(s["lead_id"], []).append(s)
    pays_by_lead = {}
    for p in all_pays:
        if p.get("lead_id"):
            pays_by_lead.setdefault(p["lead_id"], []).append(p)

    # Compute + update each lead
    print("Computing scores...")
    updates = []
    stages_count = {}
    score_buckets = {"0-25": 0, "25-50": 0, "50-75": 0, "75-100": 0}
    for l in all_leads:
        subs = subs_by_lead.get(l["id"], [])
        pays = pays_by_lead.get(l["id"], [])
        stage, score, bd, last_act = compute_lead_state(l, subs, pays)
        updates.append({
            "id": l["id"],
            "funnel_stage": stage,
            "score": score,
            "score_breakdown": bd,
            "last_activity": last_act.isoformat() if last_act else None,
        })
        stages_count[stage] = stages_count.get(stage, 0) + 1
        if score < 25: score_buckets["0-25"] += 1
        elif score < 50: score_buckets["25-50"] += 1
        elif score < 75: score_buckets["50-75"] += 1
        else: score_buckets["75-100"] += 1

    # Batch update
    print(f"Updating {len(updates)} leads...")
    BATCH = 500
    for i in range(0, len(updates), BATCH):
        chunk = updates[i:i+BATCH]
        # Supabase upsert
        try:
            sb.table("leads").upsert(chunk, on_conflict="id").execute()
        except Exception as e:
            print(f"  ⚠️ batch {i}-{i+len(chunk)} error: {str(e)[:200]}")

    print("\n=== Funnel stage distribution ===")
    for s, n in sorted(stages_count.items(), key=lambda x: -x[1]):
        print(f"  {s:<20} {n:>5}")

    print("\n=== Score distribution ===")
    for b, n in score_buckets.items():
        print(f"  {b:<10} {n:>5}")

    print(f"\n✅ Scored {len(updates)} leads")


if __name__ == "__main__":
    main()
