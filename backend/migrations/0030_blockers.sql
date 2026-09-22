-- 0030: blockers (OP-36)
--
-- Numbered 0030, not 0029: migrations/ already contains TWO files
-- numbered 0029 (entitlements_category_and_seed, user_sessions) and
-- both are applied. The runner sorts lexically so they survived, but
-- nothing else should be added at that number.
--
-- WHAT THIS IS FOR
-- onboarding_tasks has carried a 'blocked' status and a blocked_reason
-- column since 0002, and nothing has ever written either one — the
-- whole read side (HR's "stuck" query, the roster health filter, the
-- trail gate, the frontend's blocked pill) was built against a value
-- that never appears. "Pending" is all the app can currently say about
-- a task nobody can move, which is why the answer to "since when, and
-- who's fixing it" lives on Slack.
--
-- A blocker is the record that answers those: why it is stuck, who
-- owns fixing it, when it got stuck, and when we expect it back.
-- blocked_reason stays, written in the same UPDATE as the status by
-- BlockersService, because five existing HR queries already read it —
-- keeping it in sync costs one SET clause, and migrating those queries
-- to a join is not this ticket.

CREATE TABLE blockers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_task_id  UUID NOT NULL REFERENCES onboarding_tasks(id),

  -- Who has to fix it. owner_role is always set (it is the answer to
  -- "which desk is this sitting on"); owner_user_id narrows it to a
  -- named person when there is one, and stays NULL when the blocker is
  -- owned by a function rather than an individual — "IT", not "Priya".
  owner_role          TEXT NOT NULL,
  owner_user_id       UUID REFERENCES users(id),

  reason              TEXT NOT NULL,
  waiting_since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A date, not a timestamp: "expected Wednesday" is the granularity
  -- anyone actually commits to. NULL means nobody would guess.
  expected_at         DATE,

  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID REFERENCES users(id),
  created_by          UUID NOT NULL REFERENCES users(id),

  -- OP-39 (provisioning requests) will point a blocker at the request
  -- that caused it. Nullable and unreferenced until then: adding the
  -- column now costs nothing and saves that ticket an ALTER on a table
  -- that will by then have rows in it.
  provisioning_request_id  UUID,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A blocker cannot be resolved by nobody, or by somebody at no time.
  CONSTRAINT chk_blocker_resolution CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

-- One OPEN blocker per task, enforced here rather than by a read-then-
-- write check in the service: two HR users hitting "Mark as blocked" on
-- the same task in the same second would both read "no open blocker"
-- and both insert. A partial index makes that physically impossible
-- while leaving the history of resolved blockers unconstrained, so a
-- task can be blocked, resolved and blocked again as often as reality
-- requires.
CREATE UNIQUE INDEX idx_blockers_one_open_per_task
  ON blockers (onboarding_task_id)
  WHERE resolved_at IS NULL;

-- Backs the LEFT JOIN that every task payload now carries.
CREATE INDEX idx_blockers_task ON blockers (onboarding_task_id);

CREATE TRIGGER trg_blockers_updated_at
  BEFORE UPDATE ON blockers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- No GRANT block: 0007's ALTER DEFAULT PRIVILEGES already grants
-- app_runtime SELECT/INSERT/UPDATE/DELETE on tables created after it by
-- the migrating role. blockers is not activity_logs — it has no
-- append-only carve-out, because resolving one is an UPDATE.
