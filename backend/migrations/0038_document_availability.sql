-- Whether a policy is available to staff.
--
-- 'Unavailable' is the softer sibling of delete: the row stays, HR still
-- sees it and can turn it back on, but employees do not see it in their
-- list or their download. Delete (deleted_at, below via the service) is the
-- permanent removal; this is a reversible "take it down for now".
--
-- Default true so every existing policy stays visible exactly as before.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true;
