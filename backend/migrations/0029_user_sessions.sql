-- ============================================================
-- Server-side session store.
--
-- Before this migration every login was a stateless JWT pair (see
-- backend/src/auth/tokens/token.service.ts) with no server-side record
-- of who was signed in from where, no way to revoke a token before its
-- natural expiry, and no way to log out an actual session — logout
-- only cleared the browser's copy of the token.
--
-- One row per active login. The row is the source of truth for that
-- session's lifetime: the refresh cookie carries a JWT whose `jti` is
-- this row's `id`, but the cookie is only considered valid while the
-- matching row is un-revoked and still inside its idle and absolute
-- windows. Every refresh rotates the token in place and stamps the row.
--
-- Only the hashes live here. The raw refresh and CSRF tokens exist only
-- in the browser's cookie jar; a database read never yields anything
-- an attacker could replay.
-- ============================================================
CREATE TABLE user_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- sha256 of the raw refresh token, hex. UNIQUE so the same random
  -- string can never index two live rows even by accident; NOT NULL
  -- because a row without a hash could never be matched to a request
  -- and would just be dead weight.
  refresh_token_hash    TEXT NOT NULL UNIQUE,

  -- sha256 of the raw CSRF token, hex. Held per-session (not
  -- per-request) so a stolen CSRF token from an earlier cookie
  -- snapshot stops working the next time the session rotates.
  csrf_token_hash       TEXT NOT NULL,

  -- Truncated User-Agent string from the login request. Nice-to-have
  -- for auditing "which device signed in from here"; nullable because
  -- some clients don't send one.
  user_agent            TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bumped on every successful refresh. Together with idle_expires_at
  -- this is what implements the sliding timeout.
  last_used_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Hard cap: the session dies at this instant no matter how active
  -- the user is. Matches the initial refresh cookie's Max-Age.
  absolute_expires_at   TIMESTAMPTZ NOT NULL,
  -- Sliding cap: pushed forward on refresh. If now() overtakes it the
  -- session is treated as expired even if absolute is still in the
  -- future.
  idle_expires_at       TIMESTAMPTZ NOT NULL,

  -- Set by logout / password reset / admin disable. Once non-null the
  -- session can no longer refresh or authenticate a request; the row
  -- stays for the audit trail rather than being deleted.
  revoked_at            TIMESTAMPTZ,
  revoke_reason         TEXT
);

-- Look up a user's live sessions (e.g. to revoke them on password
-- reset). Partial index because that's the only shape of read that
-- benefits from indexing — a listing of revoked sessions is a rare
-- audit query and can scan.
CREATE INDEX idx_user_sessions_user_active
  ON user_sessions(user_id) WHERE revoked_at IS NULL;

-- The hot path: verifying a refresh cookie. Same hash lands here.
CREATE INDEX idx_user_sessions_refresh_hash
  ON user_sessions(refresh_token_hash);
