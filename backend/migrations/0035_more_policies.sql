-- More company policies: Leave Policy and Stealth Mode Policy.
--
-- The four existing rows were seeded outside migrations, so this follows
-- their conventions rather than inventing new ones: company-wide
-- (department_id NULL) and the same '/uploads/<slug>.pdf' shape for
-- file_url. Note that none of those seeded PDFs actually exist on disk —
-- the readable copy lives in the frontend's POLICY_CONTENT map and is what
-- the Read button opens. These two are the same: a row so the policy is
-- listed and can be scoped or re-uploaded by HR, with the text in the app.
--
-- Idempotent on title, so re-running it cannot produce duplicate policies,
-- and skipped entirely if there is no user to attribute them to (a fresh
-- database before any seeding) — uploaded_by is NOT NULL.

INSERT INTO documents (title, file_url, department_id, uploaded_by)
SELECT
  v.title,
  v.file_url,
  NULL,
  COALESCE(
    (SELECT d.uploaded_by FROM documents d ORDER BY d.created_at LIMIT 1),
    (SELECT u.id FROM users u WHERE u.role = 'superadmin_hr' ORDER BY u.created_at LIMIT 1)
  )
FROM (VALUES
  ('Leave Policy',        '/uploads/leave-policy.pdf'),
  ('Stealth Mode Policy', '/uploads/stealth-mode-policy.pdf')
) AS v(title, file_url)
WHERE
  COALESCE(
    (SELECT d.uploaded_by FROM documents d ORDER BY d.created_at LIMIT 1),
    (SELECT u.id FROM users u WHERE u.role = 'superadmin_hr' ORDER BY u.created_at LIMIT 1)
  ) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM documents d
    WHERE lower(d.title) = lower(v.title) AND d.deleted_at IS NULL
  );
