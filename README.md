# LevelUp Marketing Sync + Lead Intelligence

Production stack powering [forge-marketing-sync.vercel.app](https://forge-marketing-sync.vercel.app).

Two products in one repo:

1. **Founders Dashboard** (`/`) — live P&L, per-program scorecards, marketing efficiency, campaign performance, top ads, paid students, recent confirmations.
2. **Lead Intelligence** (`/leads`) — every Tally form lead joined with Razorpay payments, MQL-scored 0–100, filtered per sales rep with rescue-zone surfacing.

---

## Architecture

```
Meta Marketing API ──┐
Tally form API   ──┼─▶ scripts/ (Python ingestion, run via cron / locally)
Razorpay API     ──┤
                    ↓
              Supabase Postgres
                    ↓
              dashboard/ (Next.js, deployed on Vercel)
                    ↓
              Google Sheet (Founders' finance sheet — auto-updates daily)
```

### Tech stack

- **Frontend / dashboard:** Next.js 15, React 19, Tailwind CSS, Recharts, Lucide icons
- **Database:** Supabase Postgres (project: `hdngbwovjrfgsyvcygug`)
- **Hosting:** Vercel (Hobby tier, auto-deploys from `main`)
- **Data sources:** Meta Marketing API v21, Tally Forms API, Razorpay API (Admin RP + Edtech RP), Google Sheets API
- **Ingestion / scoring:** Python (run locally or as scheduled jobs)

---

## Repo layout

```
.
├── dashboard/          # Next.js app — what users see at the URL
│   ├── app/
│   │   ├── page.tsx           # /  — Founders dashboard
│   │   ├── leads/page.tsx     # /leads — Lead Intelligence
│   │   ├── api/sync/route.ts  # cron-triggered Meta Ads sync
│   │   └── globals.css
│   ├── components/     # React components (KpiCard, charts, LeadsTable, etc.)
│   ├── lib/            # Sheet + Supabase data layer + formatters
│   ├── package.json
│   └── vercel.json     # cron schedule: "30 0 * * *" daily at 6 AM IST
│
├── scripts/            # Python ingestion + scoring (run locally or via cron)
│   ├── ingest_tally.py        # Tally form submissions → Supabase
│   ├── ingest_razorpay.py     # Razorpay payments (both accounts) → Supabase
│   ├── compute_scores.py      # Funnel stage + MQL scoring
│   ├── forge_meta_sync.py     # Meta Ads → Google Sheet (also runs as Vercel cron in TS)
│   ├── forge_campaign_parser.py  # Forge campaign classifier (FFM/FW/FC/FAI)
│   └── run_full_backfill.py
│
├── supabase/
│   └── supabase_schema_v1.sql   # 7 tables: programs, leads, form_submissions,
│                                #            payments, ad_touches, lead_activities,
│                                #            sync_state + lead_view view
│
├── .gitignore
└── README.md
```

---

## Run it locally (dashboard)

```bash
cd dashboard
npm install --legacy-peer-deps
cp .env.example .env.local   # then fill in Vercel-managed env vars
npm run dev                   # http://localhost:3000
```

### Required env vars

```
# Google Sheets
SHEET_ID=<finance sheet id>
GCP_SERVICE_ACCOUNT_JSON=<full JSON content of service account key>

# Meta Marketing API
META_ACCESS_TOKEN=<system user token, ads_read scope>
META_AD_ACCOUNT_ID_API=act_798786164101616

# Supabase
SUPABASE_URL=https://hdngbwovjrfgsyvcygug.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT>
```

All five live in Vercel project env. Pull locally with `vercel env pull .env.local`.

---

## Run ingestion (scripts/)

```bash
cd scripts
pip3 install --break-system-packages supabase google-auth gspread

# Tally — pull form submissions
python3 ingest_tally.py --form nPJydd --max-pages 50          # FFM
python3 ingest_tally.py --form 3NZXk0 --max-pages 50          # FW
python3 ingest_tally.py --form kdWEXR --max-pages 5           # FAI
python3 ingest_tally.py --form 3EgP2L --max-pages 50          # FC

# Razorpay — pull payments from both accounts
python3 ingest_razorpay.py --account admin --days 365
python3 ingest_razorpay.py --account edtech --days 730

# Compute funnel + MQL scores for every lead
python3 compute_scores.py
```

Scripts read credentials from a credentials file at the path defined in each script. See script header for env var names.

---

## Sales reps

| Rep | Forge product | Live product |
|---|---|---|
| Pranaush | FFM (Filmmaking) | FW (Writing) |
| Sashank | FC (Creators) | BFP |
| Wilson | — | VE + L3C |

The `/leads` page filters by rep via URL param: `/leads?rep=Pranaush`.

---

## MQL scoring (v1)

Score 0–100, weighted as:

- **Funnel stage** (35 pts max): `accepted` (paid app fee, no confirmation = "rescue zone") = 35; `app_fee_paid` = 22; `form_submitted` = 12; `form_partial` = 4
- **Demographics** (20 pts): age 25–40 (+12); profession ∈ {working professional, founder, entrepreneur, ...} (+8)
- **Engagement** (20 pts): "Why Forge" answer length > 250 chars (+15) / > 100 chars (+10) / > 30 chars (+5)
- **Recency** (15 pts): last activity within 24h (+15) / 3d (+10) / 7d (+5) / 14d (+2)
- **Ad signal** (10 pts): repeat ad impressions before applying — placeholder until UTM attribution wired

Tunable in `scripts/compute_scores.py`.

---

## Deployment

This repo is connected to Vercel. Any push to `main` auto-deploys to `forge-marketing-sync.vercel.app`.

- **Build command:** `next build`
- **Install command:** `npm install --legacy-peer-deps`
- **Cron:** `30 0 * * *` (6:00 AM IST daily) hits `/api/sync` to refresh Meta Ads data

---

## What's next

- [ ] AI-generated lead summaries (GPT-4o-mini over Tally responses)
- [ ] Activity logging UI (rep marks called/converted/lost + notes)
- [ ] Calendly integration for `interview_booked` funnel stage
- [ ] Tele CRM bidirectional sync
- [ ] Live + Masterclass + B2B program ingestion
- [ ] Permanent Meta token (current expires 2026-06-19)
