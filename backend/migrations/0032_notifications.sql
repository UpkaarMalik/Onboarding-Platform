-- 0032: notifications
--
-- One row per person per event: who it is for, what happened, a short
-- message, where to go when it is clicked, and whether they have seen it.
-- Written by NotificationsService.notify() from inside the transaction of
-- the change it announces, so a rolled-back approval never leaves a
-- "your document was approved" behind.

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  -- Free text, not a CHECK list: a new event kind should not need a
  -- migration. Examples: document_approved, task_blocked, task_available.
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  -- A frontend path such as '/start-here'. Never an absolute URL.
  link        TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_notifications_link_is_path CHECK (link LIKE '/%')
);

-- Backs all three queries the bell makes: newest-first list, the
-- unread-only list, and COUNT(*) WHERE read_at IS NULL.
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, read_at, created_at DESC);

-- No GRANT block: 0007's ALTER DEFAULT PRIVILEGES already covers
-- app_runtime for tables created after it. Marking read is an UPDATE.
