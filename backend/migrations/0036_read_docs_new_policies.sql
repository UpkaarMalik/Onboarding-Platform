-- Add the Leave and Stealth Mode policies (0035) to the "Read the docs"
-- checklist, which 0034 built with four items.
--
-- Both halves mirror 0034: template_subtasks so future onboardings get them,
-- and onboarding_subtasks so the ones already in flight do too.
--
-- The completed-task case is the part that matters. "Read the docs" closes
-- itself when every subtask is ticked, so adding two unticked items to a task
-- someone already finished would REOPEN it — a step they completed weeks ago
-- reappearing as outstanding work because HR published a new policy. Where
-- the parent task is already completed the new items are inserted already
-- ticked, attributed to the same person and timestamp 0034 used. Someone
-- mid-onboarding gets them unticked, which is correct: they have genuinely
-- not read these yet.
--
-- Idempotent per title, so a re-run adds nothing.

INSERT INTO template_subtasks (template_task_id, title, description, display_order, is_required)
SELECT tt.id, p.title, p.description, p.display_order, true
FROM template_tasks tt
CROSS JOIN (VALUES
  ('Leave Policy', 'What you get, how to ask for it, and what happens to what you do not use.', 5),
  ('Stealth Mode Policy', 'What can and cannot be said publicly about work that has not launched.', 6)
) AS p(title, description, display_order)
WHERE tt.title = 'Read the docs'
  AND NOT EXISTS (
    SELECT 1 FROM template_subtasks ts
    WHERE ts.template_task_id = tt.id AND ts.title = p.title
  );

INSERT INTO onboarding_subtasks (
  onboarding_task_id, title, description, display_order, is_required,
  completed_at, completed_by
)
SELECT
  ot.id,
  p.title,
  p.description,
  p.display_order,
  true,
  CASE WHEN ot.status = 'completed' THEN COALESCE(ot.completed_at, now()) END,
  CASE WHEN ot.status = 'completed' THEN ob.user_id END
FROM onboarding_tasks ot
JOIN onboardings ob ON ob.id = ot.onboarding_id
CROSS JOIN (VALUES
  ('Leave Policy', 'What you get, how to ask for it, and what happens to what you do not use.', 5),
  ('Stealth Mode Policy', 'What can and cannot be said publicly about work that has not launched.', 6)
) AS p(title, description, display_order)
WHERE ot.title = 'Read the docs'
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_subtasks os
    WHERE os.onboarding_task_id = ot.id AND os.title = p.title
  );

-- The task's own description enumerated the original four by name
-- ("Four policies to read on the Documents page: Employee Handbook, ...",
-- from 0010), so it is wrong the moment a fifth exists. Replaced with
-- wording that does not count or list, which is what stops it going stale
-- again the next time HR publishes a policy.
--
-- Matched on the old text rather than on the title alone: a description HR
-- has since rewritten is theirs, and this should not overwrite it.
UPDATE template_tasks
SET description = 'The company policies worth knowing before you need them. Each one is a card here — open it to read it, then tick it off.'
WHERE title = 'Read the docs' AND description LIKE 'Four policies%';

UPDATE onboarding_tasks
SET description = 'The company policies worth knowing before you need them. Each one is a card here — open it to read it, then tick it off.'
WHERE title = 'Read the docs' AND description LIKE 'Four policies%';
