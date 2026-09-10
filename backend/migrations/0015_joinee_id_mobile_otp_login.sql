-- Replaces the synthetic temp-login-email identifier and the fixed-code
-- TOTP stub with two independent, complete login methods:
--   1. Joinee ID + password: a permanent, DB-generated Joinee ID
--      (JN-<year>-<seq>, e.g. JN-2026-001) paired with the account's
--      password. company_email is no longer a login identifier at all
--      (it's still recorded by HR for other purposes — see
--      UsersService.recordCompanyEmail — just never used to log in).
--   2. Mobile number + OTP: a real, hashed + expiring + attempt-limited
--      one-time code sent to the user's own phone_number. No password
--      involved.
--
-- NOTE: this only ever runs forward (no down migration, matching every
-- other migration in this project) and is NOT applied automatically —
-- run `npm run migrate` yourself when ready. Existing seeded users
-- (bootstrap superadmin, the Bhupendra task-owner seed) lose their
-- temp_login_email here and get a backfilled joinee_id instead; look
-- it up with `SELECT full_name, joinee_id FROM users;` after migrating
-- if you need to hand out fresh login details for them.

-- 1. Per-year sequence counter backing Joinee ID generation.
CREATE TABLE joinee_id_counters (
  year     INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION generate_joinee_id() RETURNS TEXT AS $$
DECLARE
  yr  INTEGER := EXTRACT(YEAR FROM now())::INTEGER;
  seq INTEGER;
BEGIN
  INSERT INTO joinee_id_counters(year, last_seq) VALUES (yr, 1)
  ON CONFLICT (year) DO UPDATE SET last_seq = joinee_id_counters.last_seq + 1
  RETURNING last_seq INTO seq;
  RETURN 'JN-' || yr || '-' || LPAD(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- 2. Add the column, backfill existing rows in creation order (so seed
--    users get low, stable sequence numbers), then lock it down.
ALTER TABLE users ADD COLUMN joinee_id TEXT;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM users WHERE joinee_id IS NULL ORDER BY created_at LOOP
    UPDATE users SET joinee_id = generate_joinee_id() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE users
  ALTER COLUMN joinee_id SET NOT NULL,
  ADD CONSTRAINT users_joinee_id_key UNIQUE (joinee_id);

-- 3. Auto-generate joinee_id for every future insert that doesn't supply
--    one — the application never computes it, the database does.
CREATE OR REPLACE FUNCTION set_joinee_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.joinee_id IS NULL THEN
    NEW.joinee_id := generate_joinee_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_set_joinee_id
  BEFORE INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_joinee_id();

-- 4. phone_number becomes a login identifier (mobile+OTP) here, not
--    just a contact field — it must resolve to exactly one account.
--    If this fails, two existing users share a phone_number and one
--    needs correcting by hand before migrating.
ALTER TABLE users ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);

-- 5. Mobile-OTP second factor: a short-lived hashed code + expiry +
--    attempt counter, generated and sent (SMS — currently stubbed, see
--    backend/src/auth/utils/otp.ts) when a mobile+OTP login is
--    requested, and verified against these columns.
ALTER TABLE users
  ADD COLUMN login_otp_hash       TEXT,
  ADD COLUMN login_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN login_otp_attempts   INTEGER NOT NULL DEFAULT 0;

-- 6. Drop the synthetic temp-login-email identifier and the unused TOTP
--    columns it was seeded alongside — both fully replaced above.
ALTER TABLE users
  DROP COLUMN temp_login_email,
  DROP COLUMN totp_secret,
  DROP COLUMN totp_enrolled_at;
