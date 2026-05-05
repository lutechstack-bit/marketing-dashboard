-- =============================================================================
-- LevelUp Sales Intelligence — Auth + Roles + Reps + Incentive Ledger schema
-- =============================================================================
-- ONE-TIME SETUP. Paste into Supabase Dashboard → SQL Editor → Run.
-- Idempotent — safe to re-run.
--
-- Adds:
--   sales_reps           — one row per logged-in user, role + active flag
--   products             — programs (FFM/FW/FC/FAI/BFP/VE/L3C/...)
--   rep_assignments      — who earns what, with edition + effective dates
--   incentive_earnings   — the ledger (locked / unlocked / approved / paid_out / reverted)
--   earnings_audit       — every state change logged for refund traceability
-- =============================================================================

-- ---------------------------------------------------------------- sales_reps
CREATE TABLE IF NOT EXISTS sales_reps (
  id           UUID PRIMARY KEY,                       -- matches auth.users.id
  email        TEXT UNIQUE NOT NULL,
  full_name    TEXT,
  phone        TEXT,
  role         TEXT NOT NULL CHECK (role IN ('sales', 'founder', 'admin')),
  active       BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_reps_email ON sales_reps(email);
CREATE INDEX IF NOT EXISTS idx_sales_reps_role  ON sales_reps(role);
CREATE INDEX IF NOT EXISTS idx_sales_reps_active ON sales_reps(active);

-- ---------------------------------------------------------------- products
CREATE TABLE IF NOT EXISTS products (
  code           TEXT PRIMARY KEY,                     -- FFM, FW, FC, FAI, BFP, VE, L3C, ...
  name           TEXT NOT NULL,
  long_name      TEXT,
  family         TEXT NOT NULL CHECK (family IN ('forge', 'live', 'masterclass', 'b2b')),
  app_fee_inr    NUMERIC,
  full_fee_inr   NUMERIC,
  active         BOOLEAN DEFAULT TRUE,
  display_order  INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the products we have
INSERT INTO products (code, name, long_name, family, app_fee_inr, display_order) VALUES
  ('FFM', 'Filmmaking',   'Forge Filmmaking',                       'forge', 800, 1),
  ('FW',  'Writing',      'Forge Writing',                          'forge', 600, 2),
  ('FC',  'Creators',     'Forge Creators',                         'forge', 700, 3),
  ('FAI', 'AI',           'Forge AI',                               'forge', 900, 4),
  ('VE',  'Video Editing','Video Editing Academy',                  'live',  400, 5),
  ('BFP', 'BFP',          'Breakthrough Filmmakers'' Program',      'live',  400, 6),
  ('L3C', 'L3 Creators',  'LevelUp Creator Academy',                'live',  400, 7)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------- rep_assignments
-- Edition match is a regex applied to lead's "Are you available?" form answer.
-- effective_from/to allow rate changes without recalculating historical earnings.
CREATE TABLE IF NOT EXISTS rep_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id          UUID REFERENCES sales_reps(id) ON DELETE CASCADE,
  product_code    TEXT REFERENCES products(code) ON DELETE CASCADE,
  edition_match   TEXT,                                -- regex pattern, NULL = catch-all
  edition_label   TEXT,                                -- 'Goa', 'Bali', NULL = default
  incentive_inr   NUMERIC NOT NULL,
  effective_from  DATE DEFAULT CURRENT_DATE,
  effective_to    DATE,                                -- NULL = ongoing
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_assignments_rep     ON rep_assignments(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_assignments_product ON rep_assignments(product_code);
CREATE INDEX IF NOT EXISTS idx_rep_assignments_active  ON rep_assignments(active);

-- ---------------------------------------------------------------- incentive_earnings
-- The ledger. One row per (lead × rep × payment-event).
-- Status flow:  locked → unlocked → approved → paid_out
--                          ↓
--                       reverted (refund)
CREATE TABLE IF NOT EXISTS incentive_earnings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            UUID REFERENCES leads(id) ON DELETE SET NULL,
  rep_id             UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
  product_code       TEXT,
  edition_label      TEXT,
  amount_inr         NUMERIC NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('locked','unlocked','approved','paid_out','reverted')),

  -- timeline
  locked_at          TIMESTAMPTZ,                      -- slot confirmation paid
  unlocked_at        TIMESTAMPTZ,                      -- balance paid
  approved_at        TIMESTAMPTZ,
  approved_by        UUID REFERENCES sales_reps(id),
  paid_out_at        TIMESTAMPTZ,
  reverted_at        TIMESTAMPTZ,
  reverted_reason    TEXT,

  -- which Razorpay payments triggered each transition
  trigger_slot_payment_id    TEXT,
  trigger_balance_payment_id TEXT,

  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earnings_rep        ON incentive_earnings(rep_id);
CREATE INDEX IF NOT EXISTS idx_earnings_status     ON incentive_earnings(status);
CREATE INDEX IF NOT EXISTS idx_earnings_lead       ON incentive_earnings(lead_id);
CREATE INDEX IF NOT EXISTS idx_earnings_unlocked   ON incentive_earnings(unlocked_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_locked     ON incentive_earnings(locked_at DESC);

-- ---------------------------------------------------------------- earnings_audit
-- Every state transition recorded for refund traceability.
-- Per founder choice: silent revert in UI, but audit log persists everything.
CREATE TABLE IF NOT EXISTS earnings_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  earning_id    UUID REFERENCES incentive_earnings(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  changed_by    UUID REFERENCES sales_reps(id),       -- NULL = system (webhook)
  reason        TEXT,
  payload       JSONB,                                 -- raw event for debugging
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_earning  ON earnings_audit(earning_id);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON earnings_audit(created_at DESC);

-- ---------------------------------------------------------------- updated_at triggers
CREATE OR REPLACE FUNCTION touch_updated_at_v2() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sales_reps_updated_at ON sales_reps;
CREATE TRIGGER sales_reps_updated_at BEFORE UPDATE ON sales_reps
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_v2();

DROP TRIGGER IF EXISTS earnings_updated_at ON incentive_earnings;
CREATE TRIGGER earnings_updated_at BEFORE UPDATE ON incentive_earnings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_v2();

-- =============================================================================
-- DONE. Now seed the 6 initial users + their assignments.
-- These INSERTs use ON CONFLICT to be safe to re-run.
-- =============================================================================

-- Sales reps placeholder rows — id will be filled in once auth users exist
-- (the Next.js server will UPSERT on first login by email match)

-- Default rep assignments (incentive amounts founder-set):
-- These reference rep_id by email match via a CTE.
INSERT INTO rep_assignments (rep_id, product_code, edition_match, edition_label, incentive_inr, notes)
SELECT sr.id, ra.product_code, ra.edition_match, ra.edition_label, ra.incentive_inr, ra.notes
FROM (
  VALUES
    ('Pranaush47@gmail.com',         'FFM', NULL,   NULL,    5000, 'Default'),
    ('Pranaush47@gmail.com',         'FW',  NULL,   NULL,    6500, 'Default'),
    ('saisashank27@gmail.com',       'FC',  'goa',  'Goa',   4500, 'Goa edition'),
    ('saisashank27@gmail.com',       'FC',  'bali', 'Bali',  7000, 'Bali edition'),
    ('saisashank27@gmail.com',       'FAI', NULL,   NULL,    8000, 'Default'),
    ('saisashank27@gmail.com',       'BFP', NULL,   NULL,    5000, 'Default'),
    ('wilsonindrapalli@gmail.com',   'VE',  NULL,   NULL,    4000, 'Default'),
    ('wilsonindrapalli@gmail.com',   'L3C', NULL,   NULL,    6000, 'Default')
) AS ra(email, product_code, edition_match, edition_label, incentive_inr, notes)
JOIN sales_reps sr ON sr.email = ra.email
ON CONFLICT DO NOTHING;
