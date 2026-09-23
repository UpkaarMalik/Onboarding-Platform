--
-- 0033: manager and buddy as real users
--
-- onboardings.manager_name / buddy_name are free text: HR types "Priya" and
-- nothing links it to a person, so the manager cannot own the "Meet your
-- reporting manager" task and the joinee cannot see who their manager is.
-- These two columns point at the actual user instead.
--
-- Who is ELIGIBLE (an employee whose own onboarding is completed) is a rule
-- about another table's current state, which a CHECK or FK cannot express;
-- OnboardingsService enforces it on every write. What the database does
-- guarantee: the id is a real user, and nobody is their own manager/buddy.

ALTER TABLE onboardings
  ADD COLUMN manager_user_id UUID REFERENCES users(id),
  ADD COLUMN buddy_user_id   UUID REFERENCES users(id),
  ADD CONSTRAINT chk_onboarding_manager_not_self CHECK (manager_user_id <> user_id),
  ADD CONSTRAINT chk_onboarding_buddy_not_self   CHECK (buddy_user_id <> user_id);

-- "Whose manager/buddy am I" — for a future People view from the other side,
-- and it keeps the FK checks on a user delete from scanning the table.
CREATE INDEX idx_onboardings_manager ON onboardings (manager_user_id) WHERE manager_user_id IS NOT NULL;
CREATE INDEX idx_onboardings_buddy   ON onboardings (buddy_user_id)   WHERE buddy_user_id IS NOT NULL;

-- BACKFILL (proposed — see the question in the handover): link a typed name
-- to a user only when it matches exactly ONE eligible person, so a common
-- first name is never guessed. On today's data this links "Siddhesh" on three
-- onboardings and leaves "Atul" as text.
UPDATE onboardings o
   SET manager_user_id = m.id
  FROM (SELECT u.id, u.full_name
          FROM users u JOIN onboardings uo ON uo.user_id = u.id
         WHERE u.role = 'employee' AND u.deleted_at IS NULL AND uo.status = 'completed') m
 WHERE o.manager_user_id IS NULL
   AND lower(trim(o.manager_name)) = lower(m.full_name)
   AND m.id <> o.user_id
   AND (SELECT count(*) FROM users x JOIN onboardings xo ON xo.user_id = x.id
         WHERE xo.status = 'completed' AND x.deleted_at IS NULL
           AND lower(x.full_name) = lower(trim(o.manager_name))) = 1;

UPDATE onboardings o
   SET buddy_user_id = m.id
  FROM (SELECT u.id, u.full_name
          FROM users u JOIN onboardings uo ON uo.user_id = u.id
         WHERE u.role = 'employee' AND u.deleted_at IS NULL AND uo.status = 'completed') m
 WHERE o.buddy_user_id IS NULL
   AND lower(trim(o.buddy_name)) = lower(m.full_name)
   AND m.id <> o.user_id
   AND (SELECT count(*) FROM users x JOIN onboardings xo ON xo.user_id = x.id
         WHERE xo.status = 'completed' AND x.deleted_at IS NULL
           AND lower(x.full_name) = lower(trim(o.buddy_name))) = 1;

-- And give the matching "Meet your…" tasks their owner, unless already done.
UPDATE onboarding_tasks ot
   SET owner_user_id = o.manager_user_id
  FROM onboardings o
 WHERE o.id = ot.onboarding_id AND o.manager_user_id IS NOT NULL
   AND ot.title = 'Meet your reporting manager'
   AND ot.status NOT IN ('completed', 'cancelled');

UPDATE onboarding_tasks ot
   SET owner_user_id = o.buddy_user_id
  FROM onboardings o
 WHERE o.id = ot.onboarding_id AND o.buddy_user_id IS NOT NULL
   AND ot.title = 'Meet your onboarding buddy'
   AND ot.status NOT IN ('completed', 'cancelled');

-- manager_name / buddy_name are KEPT for one release, as the ticket asks, and
-- the service keeps writing the picked person's name into them so anything
-- still reading them stays correct. A later migration drops both.
