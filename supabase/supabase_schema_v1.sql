-- ============================================================
-- LevelUp Forge — Lead Intelligence Schema v1
-- ============================================================
-- Run this in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Idempotent: safe to re-run (uses IF NOT EXISTS).
-- ============================================================

-- Programs (lookup table — populated by Claude after creation)
CREATE TABLE IF NOT EXISTS programs (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  family          TEXT NOT NULL CHECK (family IN ('forge','live','masterclass','b2b')),
  has_app_fee     BOOLEAN DEFAULT TRUE,
  has_interview   BOOLEAN DEFAULT TRUE,
  has_confirmation BOOLEAN DEFAULT TRUE,
  app_fee_inr     INTEGER,
  confirmation_inr INTEGER,
  full_fee_min    INTEGER,
  full_fee_max    INTEGER,
  active          BOOLEAN DEFAULT TRUE,
  rep_assigned    TEXT,
  notes           TEXT
);

-- Master leads table — one row per unique person across all programs
CREATE TABLE IF NOT EXISTS leads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT,
  phone                TEXT,
  name                 TEXT,
  program              TEXT REFERENCES programs(code),
  source_campaign_id   TEXT,
  source_campaign_name TEXT,
  source_ad_id         TEXT,
  source_utm_source    TEXT,
  source_utm_medium    TEXT,
  source_utm_campaign  TEXT,
  source_utm_content   TEXT,
  funnel_stage         TEXT,
  -- Stages: form_partial, form_submitted, app_fee_paid, interview_booked,
  --         interview_done, accepted, confirmed, balance_paid, attended, lost
  score                INTEGER DEFAULT 0,
  score_breakdown      JSONB DEFAULT '{}'::jsonb,
  first_seen           TIMESTAMPTZ DEFAULT NOW(),
  last_activity        TIMESTAMPTZ DEFAULT NOW(),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, program),
  UNIQUE(phone, program)
);
CREATE INDEX IF NOT EXISTS idx_leads_program       ON leads(program);
CREATE INDEX IF NOT EXISTS idx_leads_score_desc    ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_funnel_stage  ON leads(funnel_stage);
CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_phone         ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_last_activity ON leads(last_activity DESC);

-- Form submissions (Tally) — one row per submission, linked to lead
CREATE TABLE IF NOT EXISTS form_submissions (
  id              TEXT PRIMARY KEY,  -- Tally submission id
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  form_id         TEXT NOT NULL,
  form_name       TEXT,
  program         TEXT REFERENCES programs(code),
  is_completed    BOOLEAN DEFAULT FALSE,
  submitted_at    TIMESTAMPTZ NOT NULL,
  email           TEXT,
  phone           TEXT,
  name            TEXT,
  responses       JSONB,  -- { question_title: answer }
  raw             JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_subs_lead       ON form_submissions(lead_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_form       ON form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_subs_program    ON form_submissions(program);
CREATE INDEX IF NOT EXISTS idx_form_subs_submitted  ON form_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_subs_email      ON form_submissions(email);
CREATE INDEX IF NOT EXISTS idx_form_subs_phone      ON form_submissions(phone);

-- Payments (Razorpay, both accounts) — one row per payment
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,  -- pay_xxxxx
  lead_id      UUID REFERENCES leads(id) ON DELETE SET NULL,
  account      TEXT NOT NULL CHECK (account IN ('admin','edtech')),
  program      TEXT REFERENCES programs(code),
  payment_type TEXT,
  -- payment_type: app_fee, confirmation, balance, room, masterclass, full, unknown
  amount_inr   NUMERIC NOT NULL,
  status       TEXT,    -- captured, failed, authorized, refunded
  email        TEXT,
  phone        TEXT,
  paid_at      TIMESTAMPTZ NOT NULL,
  raw          JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_lead    ON payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments(paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_email   ON payments(email);
CREATE INDEX IF NOT EXISTS idx_payments_phone   ON payments(phone);
CREATE INDEX IF NOT EXISTS idx_payments_program ON payments(program);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status);

-- Ad touches — Meta ad impressions/clicks linked to leads (when UTM available)
CREATE TABLE IF NOT EXISTS ad_touches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  ad_id         TEXT,
  ad_name       TEXT,
  campaign_id   TEXT,
  campaign_name TEXT,
  program       TEXT REFERENCES programs(code),
  touched_at    TIMESTAMPTZ NOT NULL,
  touch_type    TEXT,  -- impression, click, conversion
  raw           JSONB
);
CREATE INDEX IF NOT EXISTS idx_ad_touches_lead       ON ad_touches(lead_id);
CREATE INDEX IF NOT EXISTS idx_ad_touches_touched_at ON ad_touches(touched_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_touches_program    ON ad_touches(program);

-- Lead activities — sales rep actions
CREATE TABLE IF NOT EXISTS lead_activities (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id   UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  rep_name  TEXT,  -- 'Pranaush', 'Sashank', 'Wilson'
  action    TEXT NOT NULL,
  -- action: called, messaged, no_answer, busy, interested, objection,
  --         scheduled_followup, converted, lost, note
  notes     TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activities_lead       ON lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON lead_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_rep        ON lead_activities(rep_name);

-- Sync state — bookkeeping per data source
CREATE TABLE IF NOT EXISTS sync_state (
  source           TEXT PRIMARY KEY,  -- 'tally:nPJydd', 'razorpay:admin', etc.
  last_synced_at   TIMESTAMPTZ NOT NULL,
  last_id_seen     TEXT,
  rows_imported    BIGINT DEFAULT 0,
  status           TEXT DEFAULT 'ok',
  error            TEXT,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Useful view: lead with their latest activity + last payment
CREATE OR REPLACE VIEW lead_view AS
SELECT
  l.*,
  (SELECT created_at FROM lead_activities a WHERE a.lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_contacted_at,
  (SELECT rep_name   FROM lead_activities a WHERE a.lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_contacted_by,
  (SELECT action     FROM lead_activities a WHERE a.lead_id = l.id ORDER BY created_at DESC LIMIT 1) AS last_action,
  (SELECT amount_inr FROM payments p WHERE p.lead_id = l.id AND p.status = 'captured' ORDER BY paid_at DESC LIMIT 1) AS last_payment_amount,
  (SELECT paid_at    FROM payments p WHERE p.lead_id = l.id AND p.status = 'captured' ORDER BY paid_at DESC LIMIT 1) AS last_payment_at,
  (SELECT COUNT(*)   FROM payments p WHERE p.lead_id = l.id AND p.status = 'captured') AS captured_payment_count
FROM leads l;

-- updated_at trigger for leads
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- Quick verification queries (run these after migration)
-- ============================================================
-- SELECT count(*) FROM leads;            -- should be 0
-- SELECT count(*) FROM payments;         -- should be 0
-- SELECT count(*) FROM form_submissions; -- should be 0
-- SELECT count(*) FROM programs;         -- should be 0 (Claude populates)
-- ============================================================
