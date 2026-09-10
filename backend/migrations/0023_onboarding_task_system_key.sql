-- 0023: A stable machine key on instantiated tasks.
--
-- Lets the application find the document-upload task on an onboarding
-- without matching on its title, and lets the frontend decide which
-- popup body to render for it (document rows rather than the generic
-- subtask checklist).
--
-- Title-matching is exactly the trap migration 0011's seeded
-- 'Bhupendra' task owner already fell into — rename the row and the
-- feature silently no-ops. A key the application controls avoids
-- repeating that.
--
-- NULL for every ordinary template-derived or ad-hoc task.
ALTER TABLE onboarding_tasks ADD COLUMN system_key text;

-- One system task of a given kind per onboarding, enforced rather than
-- assumed by the code that inserts it.
CREATE UNIQUE INDEX onboarding_tasks_system_key_per_onboarding
  ON onboarding_tasks (onboarding_id, system_key)
  WHERE system_key IS NOT NULL;
