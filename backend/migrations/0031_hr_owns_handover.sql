-- 0031: "Company email & laptop handover" becomes HR's to close.
--
-- NOT APPLIED BY ME. Read it, then run `npm run migrate` yourself.
--
-- WHY
-- The task is completion_mode = 'employee' today, so the only person who can
-- close it is the joinee — they self-certify that they were given a laptop
-- and an email address. Closing it is also what opens the rest of the
-- journey. The flow this implements says HR confirms the handover, so this
-- moves it to the owner side and names HR as the owner.
--
-- 'owner', not 'dual': a dual task needs BOTH sides, so the employee would
-- still have to tick it and the stage would still wait on them. If you want
-- the joinee to acknowledge receipt as well, change 'owner' to 'dual' here
-- and nothing else — applyDualConfirmation already handles it.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
-- Rows already 'completed'. Seven joinees closed this task themselves under
-- the old rule; that is history, and rewriting who owned a task after it was
-- finished would make the activity log disagree with the row it describes.

-- The template, so every onboarding created from here on is right.
UPDATE template_tasks
   SET owner_role      = 'superadmin_hr',
       completion_mode = 'owner'
 WHERE title = 'Company email & laptop handover';

-- In-flight onboardings, so joinees who are mid-journey get the new rule too.
-- owner_user_id is cleared with it: a task_owner who had claimed this task no
-- longer owns it, and leaving their id behind would let exactly one
-- non-HR person keep closing it (completeAsOwner checks owner_user_id first).
UPDATE onboarding_tasks
   SET owner_role      = 'superadmin_hr',
       completion_mode = 'owner',
       owner_user_id   = NULL
 WHERE title = 'Company email & laptop handover'
   AND status NOT IN ('completed', 'cancelled');

-- The checkpoint flag stays as it is. It still marks this task as the one
-- that flips the onboarding to 'active' when it completes
-- (applyCompletionSideEffects). What it no longer decides is which tasks are
-- open — that is the three-stage gate in utils/trail-order.util.ts, which
-- reads the tasks themselves rather than a single flag.
