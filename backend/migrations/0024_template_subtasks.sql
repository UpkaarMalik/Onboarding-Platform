-- 0024: Subtask templates under a major template task.
--
-- Mirrors how template_tasks hang off onboarding_templates, one level
-- down. The employee's task list shows only major tasks; clicking one
-- opens a popup of these.
--
-- Their own table rather than a parent_task_id on template_tasks: with
-- self-referencing rows, every existing query that reads template_tasks
-- (instantiation, the template detail view, the immutability e2e suite)
-- would start seeing subtasks as though they were top-level tasks
-- unless each one remembered `WHERE parent_task_id IS NULL`. A separate
-- table makes that impossible instead of merely avoidable.

CREATE TABLE template_subtasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_task_id uuid NOT NULL REFERENCES template_tasks(id),

  title            text NOT NULL,
  description      text,
  display_order    integer NOT NULL,

  -- Load-bearing: only required subtasks hold the parent task open when
  -- the auto-completion rule runs (see
  -- OnboardingSubtasksService.markDone). An optional one can be left
  -- unticked forever without blocking the onboarding.
  is_required      boolean NOT NULL DEFAULT true,

  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Deterministic popup ordering. Safe as a hard constraint because
  -- templates are versioned and immutable in this project (see
  -- test/template-immutability.e2e-spec.ts) — subtasks are written once
  -- per template version and never reordered in place, so this never
  -- needs the temporary-value shuffle that reordering under a unique
  -- constraint normally requires.
  UNIQUE (template_task_id, display_order)
);

CREATE INDEX idx_template_subtasks_task ON template_subtasks (template_task_id);
