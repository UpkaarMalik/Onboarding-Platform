-- Consolidate the per-app install tasks into one task with a checklist, and
-- give "Read the docs" the same shape.
--
-- WHY. Every app to install was its own trail step, so an Engineering joiner
-- walked five near-identical cards that each said "install this, then tick it".
-- That is one piece of work — get your machine set up — split five ways, and it
-- made the trail look longer than the job actually is. One task with one card
-- per app says the same thing and reads as a single step.
--
-- The subtask machinery this uses (template_subtasks → onboarding_subtasks,
-- migrations 0025 and the templates service) already existed and had never been
-- used by any seeded template. This is its first caller.
--
-- WHAT IS LOST. The old install tasks are deleted, including ones already
-- completed. Their completion carries over onto the matching checklist item, so
-- nobody is asked to redo work, but the task rows themselves and their
-- completed_at timestamps do not survive. Accepted deliberately: the alternative
-- was leaving in-flight joiners on a shape no template produces any more.
--
-- Safe to delete those rows because nothing points at them: task_dependencies
-- and blockers are both empty, and notifications reference a task by URL path
-- rather than by foreign key (a stale link resolves to nothing and the trail
-- drops the param — see the deep-link effect in EmployeeTasks).

-- The titles that get folded together. Matched with LIKE 'Install %' rather
-- than listed, so a department template that seeds its own tool (Finance's
-- accounting system, Operations' scheduling tool) is folded in too.

/* ------------------------------------------------------------------ */
/*  A. Templates                                                       */
/* ------------------------------------------------------------------ */

-- The old per-app template tasks, captured before anything is inserted so the
-- LIKE below cannot pick up the consolidated task it is about to create.
CREATE TEMP TABLE old_install_template_tasks ON COMMIT DROP AS
SELECT
  tt.id,
  tt.template_id,
  tt.title,
  tt.description,
  tt.due_offset_days,
  row_number() OVER (PARTITION BY tt.template_id ORDER BY tt.due_offset_days, tt.title) AS display_order
FROM template_tasks tt
WHERE tt.title LIKE 'Install %';

-- One consolidated task per template, inheriting the latest due offset of the
-- group so nothing comes due earlier than it used to.
CREATE TEMP TABLE new_install_template_tasks ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO template_tasks (
    template_id, title, description, owner_role, due_offset_days,
    priority, is_required, completion_mode, is_checkpoint
  )
  SELECT
    o.template_id,
    'Install your software',
    'Everything that needs to be on your machine. Work through the apps below — this step closes itself once every one of them is ticked.',
    'employee',
    max(o.due_offset_days),
    'normal',
    true,
    'employee',
    false
  FROM old_install_template_tasks o
  GROUP BY o.template_id
  RETURNING id, template_id
)
SELECT id, template_id FROM inserted;

-- One checklist item per app that used to be its own task.
INSERT INTO template_subtasks (template_task_id, title, description, display_order, is_required)
SELECT n.id, o.title, o.description, o.display_order, true
FROM old_install_template_tasks o
JOIN new_install_template_tasks n ON n.template_id = o.template_id;

-- "Read the docs" gets the same treatment: one item per policy, so the four
-- documents are tickable rather than implied by a single sentence.
INSERT INTO template_subtasks (template_task_id, title, description, display_order, is_required)
SELECT tt.id, p.title, p.description, p.display_order, true
FROM template_tasks tt
CROSS JOIN (VALUES
  ('Employee Handbook', 'Working hours, leave, conduct, IT and security. The one to read properly.', 1),
  ('Group Health Insurance', 'Who is covered, for how much, and how a claim actually gets made.', 2),
  ('Meal Reimbursement Policy', 'What the card covers, and what to do on a late shift or a client visit.', 3),
  ('Domestic Travel Policy', 'Worth skimming now and returning to the first time you have a trip booked.', 4)
) AS p(title, description, display_order)
WHERE tt.title = 'Read the docs';

/* ------------------------------------------------------------------ */
/*  B. Onboardings already in flight                                   */
/* ------------------------------------------------------------------ */

CREATE TEMP TABLE old_install_tasks ON COMMIT DROP AS
SELECT
  ot.id,
  ot.onboarding_id,
  ot.title,
  ot.description,
  ot.due_date,
  ot.status,
  ot.completed_at,
  row_number() OVER (PARTITION BY ot.onboarding_id ORDER BY ot.due_date, ot.title) AS display_order
FROM onboarding_tasks ot
WHERE ot.title LIKE 'Install %';

-- The consolidated task is complete only if every app it absorbed was.
-- Anything else starts as pending and is re-gated on read by
-- applySequenceGate, which decides what is actually open.
CREATE TEMP TABLE new_install_tasks ON COMMIT DROP AS
WITH grouped AS (
  SELECT
    o.onboarding_id,
    max(o.due_date) AS due_date,
    bool_and(o.status = 'completed') AS all_done,
    max(o.completed_at) AS last_completed_at
  FROM old_install_tasks o
  GROUP BY o.onboarding_id
),
inserted AS (
  INSERT INTO onboarding_tasks (
    onboarding_id, source_template_task_id, title, description, owner_role,
    due_date, priority, is_required, completion_mode, is_checkpoint, status,
    completed_at
  )
  SELECT
    g.onboarding_id,
    n.id,
    'Install your software',
    'Everything that needs to be on your machine. Work through the apps below — this step closes itself once every one of them is ticked.',
    'employee',
    g.due_date,
    'normal',
    true,
    'employee',
    false,
    CASE WHEN g.all_done THEN 'completed' ELSE 'pending' END,
    CASE WHEN g.all_done THEN g.last_completed_at ELSE NULL END
  FROM grouped g
  JOIN onboardings ob ON ob.id = g.onboarding_id
  -- The template row this onboarding's own template now carries. LEFT so an
  -- onboarding whose template has no consolidated task still gets one; its
  -- source is simply unrecorded.
  LEFT JOIN new_install_template_tasks n ON n.template_id = ob.template_id
  RETURNING id, onboarding_id
)
SELECT id, onboarding_id FROM inserted;

-- Carry each old task's completion onto its checklist item, so somebody who
-- had already installed VS Code is not asked to do it again. completed_by is
-- the joinee: the constraint requires both columns or neither.
INSERT INTO onboarding_subtasks (
  onboarding_task_id, title, description, display_order, is_required,
  completed_at, completed_by
)
SELECT
  n.id,
  o.title,
  o.description,
  o.display_order,
  true,
  CASE WHEN o.status = 'completed' THEN COALESCE(o.completed_at, now()) END,
  CASE WHEN o.status = 'completed' THEN ob.user_id END
FROM old_install_tasks o
JOIN new_install_tasks n ON n.onboarding_id = o.onboarding_id
JOIN onboardings ob ON ob.id = o.onboarding_id;

-- The same four policies on every existing "Read the docs". A task already
-- completed has all four ticked, so it does not reopen.
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
  ('Employee Handbook', 'Working hours, leave, conduct, IT and security. The one to read properly.', 1),
  ('Group Health Insurance', 'Who is covered, for how much, and how a claim actually gets made.', 2),
  ('Meal Reimbursement Policy', 'What the card covers, and what to do on a late shift or a client visit.', 3),
  ('Domestic Travel Policy', 'Worth skimming now and returning to the first time you have a trip booked.', 4)
) AS p(title, description, display_order)
WHERE ot.title = 'Read the docs';

/* ------------------------------------------------------------------ */
/*  C. Remove what was folded in                                       */
/* ------------------------------------------------------------------ */

-- Onboarding tasks first: they carry a foreign key to the template tasks
-- deleted below.
DELETE FROM onboarding_tasks WHERE id IN (SELECT id FROM old_install_tasks);
DELETE FROM template_tasks WHERE id IN (SELECT id FROM old_install_template_tasks);
