-- 0019: enforce phone_number normalization at the database level.
--
-- Migration 0018 normalized existing rows to digits-only, and
-- UsersService.insertUser/findByPhoneNumber normalize on every write
-- and read the APPLICATION makes — but neither stops a raw SQL
-- INSERT/UPDATE (psql, a GUI client, a hand-run migration snippet)
-- from writing phone_number with a '+' back in, which is exactly what
-- happened to re-break mobile+OTP login after 0018 already fixed it
-- once. A trigger closes that gap for good, the same way
-- trg_users_set_joinee_id (migration 0015) guarantees joinee_id
-- regardless of how a row is written.
CREATE OR REPLACE FUNCTION normalize_phone_number() RETURNS TRIGGER AS $$
BEGIN
  NEW.phone_number := regexp_replace(NEW.phone_number, '\D', '', 'g');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_normalize_phone_number
  BEFORE INSERT OR UPDATE OF phone_number ON users
  FOR EACH ROW
  EXECUTE FUNCTION normalize_phone_number();

-- One-time repeat of 0018's fix, in case any row (like Bootstrap
-- Admin here) drifted back to having a '+' after 0018 already ran.
UPDATE users SET phone_number = regexp_replace(phone_number, '\D', '', 'g');
