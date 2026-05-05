-- Tasks / reminders — the foundation for follow-up automation.
-- Each task is "do X about lead Y by time Z". Reps see their pending +
-- overdue tasks at the top of /queue and as a notification bell count
-- in the header.

CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to     UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
  due_at          TIMESTAMPTZ NOT NULL,

  -- semantic type so we can render different chips / sort priorities later
  type            TEXT NOT NULL DEFAULT 'callback'
                  CHECK (type IN ('callback', 'follow_up', 'interview', 'whatsapp', 'email', 'custom')),
  notes           TEXT,

  -- pending → completed | snoozed | cancelled
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed', 'snoozed', 'cancelled')),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  snoozed_until   TIMESTAMPTZ,           -- when snoozed, becomes the new due_at on resume
  created_by      UUID REFERENCES sales_reps(id) ON DELETE SET NULL,

  -- where the task came from — so we can show "auto-created" etc.
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'activity_followup', 'auto_rule', 'webhook'))
);

-- Hot path: rep opens /queue → "give me my pending+overdue tasks ordered by due_at"
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_due
  ON tasks (assigned_to, due_at)
  WHERE status = 'pending';

-- Lead detail: "tasks for this lead"
CREATE INDEX IF NOT EXISTS idx_tasks_lead
  ON tasks (lead_id);

-- Updated_at trigger (matches the pattern used by other tables in this schema)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.created_at = NEW.created_at; RETURN NEW; END; $$ LANGUAGE plpgsql;
