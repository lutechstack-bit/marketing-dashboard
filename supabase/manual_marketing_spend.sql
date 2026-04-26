-- Manual marketing spend table — for channels we can't auto-pull from APIs
-- (YouTube collaborations, influencer payouts, agency fees, sponsored newsletters, etc.)
-- These get summed into the Marketing Efficiency block on /insights alongside Meta Ads.
--
-- One-time setup: paste this entire block into Supabase Dashboard → SQL Editor → Run.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS manual_marketing_spend (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       TEXT NOT NULL DEFAULT 'youtube_collab',
                                  -- youtube_collab | influencer | agency | newsletter | event | other
  source_name   TEXT,             -- creator name, agency, etc.
  date          DATE NOT NULL,    -- date of spend / when collab went live
  amount_inr    NUMERIC NOT NULL,
  program       TEXT,             -- FFM | FW | FC | FAI | NULL=mixed/all
  utm_tag       TEXT,             -- optional: UTM tag set on the collab's link
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manual_spend_date    ON manual_marketing_spend(date DESC);
CREATE INDEX IF NOT EXISTS idx_manual_spend_program ON manual_marketing_spend(program);
CREATE INDEX IF NOT EXISTS idx_manual_spend_channel ON manual_marketing_spend(channel);

-- updated_at trigger (reuses touch_updated_at from supabase_schema_v1.sql)
DROP TRIGGER IF EXISTS manual_spend_updated_at ON manual_marketing_spend;
CREATE TRIGGER manual_spend_updated_at BEFORE UPDATE ON manual_marketing_spend
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
