-- 0028: Every task is completed by the employee alone.
--
-- Removes both non-employee completion modes:
--   'dual'  — the task stayed open until BOTH the employee and a
--             task_owner confirmed independently. This is what surfaced
--             as "🤝 needs confirmation from both you and the task
--             owner" and "Waiting for owner" in the employee's list.
--   'owner' — a task only a task_owner could close, which appeared on
--             the employee's dashboard with no way for them to act on
--             it.
--
-- Twenty seeded template tasks were affected: 15 'dual' (Meet your
-- reporting manager, Meet your onboarding buddy, Company email & laptop
-- handover, ...) and 5 'owner' (Register for office entry & exit access,
-- Grant repo & CI/CD access, Grant ERP/accounting system access, ...).
--
-- CreateAdHocTaskDto and TemplateTaskInputDto now accept 'employee'
-- only, so neither mode can be reintroduced through the API. The
-- completion_mode CHECK constraint still permits all three, and
-- completeAsOwner still exists — the code tolerates modes it no longer
-- creates, so nothing has to be torn out.
--
-- IMPORTANT — this migration is only safe alongside the code change in
-- OnboardingTasksService that moved unlockPhaseTwoTasks/
-- activateOnboarding out of applyDualConfirmation and into
-- applyCompletionSideEffects. The checkpoint task is 'dual' today, and
-- completing a checkpoint is what unlocks every phase-2 task and moves
-- the onboarding to 'active'. That unlock used to hang off the
-- dual-confirmation path specifically, so flipping the checkpoint to
-- 'employee' WITHOUT that code change would strand every locked task
-- forever and leave the onboarding stuck in 'pre_onboarding'.
--
-- 1. Future joinees: every template task becomes employee-completable.
UPDATE template_tasks
SET completion_mode = 'employee'
WHERE completion_mode <> 'employee';

-- 2. Onboardings already in flight snapshot their own copy of each
--    task, so they need the same flip or they keep showing it.
UPDATE onboarding_tasks
SET completion_mode = 'employee'
WHERE completion_mode <> 'employee';

-- 3. Any task that had ALREADY collected the employee's half of a dual
--    confirmation is now a single-sided task whose one confirmation is
--    present — so it is, by the new rule, complete. Without this it
--    would be permanently unfinishable: completeAsEmployee refuses a
--    second confirmation from the same side ("Already confirmed by the
--    employee") and nothing else could ever close it.
UPDATE onboarding_tasks
SET status = 'completed',
    completed_at = COALESCE(completed_at, employee_confirmed_at, now())
WHERE completion_mode = 'employee'
  AND employee_confirmed_at IS NOT NULL
  AND status NOT IN ('completed', 'cancelled');

-- 4. A task where only the OWNER had confirmed keeps that record
--    (owner_confirmed_by/_at are facts about what happened) but stays
--    open, because the employee — who now owns completion — has not
--    acted. It is still finishable: completeAsEmployee only refuses a
--    second confirmation from the EMPLOYEE side, and that column is
--    still NULL on these rows. Deliberately asymmetric with step 3,
--    not an oversight.

-- 5. Step 3 completes tasks with a plain UPDATE, which does NOT run
--    OnboardingTasksService.applyCompletionSideEffects — so a CHECKPOINT
--    completed back in step 3 would leave its onboarding's phase-2 tasks
--    locked and the onboarding itself stuck before 'active'. These two
--    statements are that helper's SQL equivalent, applied once as a
--    backfill. (New completions from here on go through the service and
--    get it automatically.)
UPDATE onboarding_tasks ot
SET status = 'pending'
WHERE ot.status = 'locked'
  AND EXISTS (
    SELECT 1 FROM onboarding_tasks cp
    WHERE cp.onboarding_id = ot.onboarding_id
      AND cp.is_checkpoint
      AND cp.status = 'completed'
  );

UPDATE onboardings o
SET status = 'active'
WHERE o.status IN ('pre_onboarding', 'email_provisioned', 'checkpoint_pending')
  AND EXISTS (
    SELECT 1 FROM onboarding_tasks cp
    WHERE cp.onboarding_id = o.id
      AND cp.is_checkpoint
      AND cp.status = 'completed'
  );

-- chk_dual_confirmation is left in place. It only constrains rows whose
-- completion_mode is 'dual', so it becomes vacuous rather than wrong,
-- and it keeps guarding the mode if it is ever reintroduced.
