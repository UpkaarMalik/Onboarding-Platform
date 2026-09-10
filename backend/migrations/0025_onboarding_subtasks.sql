-- 0025: The instantiated, checkable subtasks.
--
-- Snapshotted from template_subtasks at instantiation, the same way
-- onboarding_tasks snapshots template_tasks — so publishing a new
-- template version never rewrites the checklist of an in-flight
-- onboarding.

CREATE TABLE onboarding_subtasks (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_task_id         uuid NOT NULL REFERENCES onboarding_tasks(id),

  -- NULL for a subtask added ad hoc to a live onboarding. That feature
  -- is deliberately not built yet, so nothing writes NULL here today —
  -- the column stays nullable because it costs nothing and makes adding
  -- the feature a service-layer change rather than another migration.
  source_template_subtask_id uuid REFERENCES template_subtasks(id),

  title                      text NOT NULL,
  description                text,
  display_order              integer NOT NULL,

  -- Gates the parent task's auto-completion, same as on
  -- template_subtasks.
  is_required                boolean NOT NULL DEFAULT true,

  -- "Marked as done" is a timestamp plus an actor rather than a
  -- boolean: one column pair answers done?, when?, and by whom?, and
  -- there is no way to be done with no record of who did it. Clearing
  -- both un-ticks it.
  completed_at               timestamptz,
  completed_by               uuid REFERENCES users(id),

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_subtask_completion_recorded CHECK (
    (completed_at IS NULL     AND completed_by IS NULL)
    OR
    (completed_at IS NOT NULL AND completed_by IS NOT NULL)
  ),

  UNIQUE (onboarding_task_id, display_order)
);

CREATE INDEX idx_onboarding_subtasks_task ON onboarding_subtasks (onboarding_task_id);

-- Answers both "what's left in this popup" and the auto-completion
-- check ("are there any required subtasks still open for this task?")
-- without scanning completed rows.
CREATE INDEX idx_onboarding_subtasks_open
  ON onboarding_subtasks (onboarding_task_id)
  WHERE completed_at IS NULL;

-- Reuses set_updated_at(), defined in migration 0002.
CREATE TRIGGER trg_onboarding_subtasks_updated_at
  BEFORE UPDATE ON onboarding_subtasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
