-- Seeds a stable, named IT/task_owner account — the person company-
-- email/laptop-handover tasks get auto-assigned to (see
-- OnboardingsService.provisionCompanyEmail's auto-claim step). Same
-- pgcrypto pattern as 0004's bootstrap superadmin, same reason: a
-- fixed, reusable test login rather than one generated per test run.
--
-- Login (at the time this migration ran): temp_login_email below,
-- password 'Bhupendra123'. Once migration 0015 runs, that column is
-- dropped and this account gets an auto-generated Joinee ID instead —
-- find it with:
--   SELECT full_name, joinee_id FROM users WHERE full_name = 'Bhupendra';
-- and log in with that + the same password (forced reset on first
-- use), or with mobile +10000000002 + OTP, no password needed for
-- that path. Dev/seed data only.

INSERT INTO users (
  full_name, phone_number,
  temp_login_email, password_hash,
  role, department_id,
  status, must_reset_password
) VALUES (
  'Bhupendra', '+10000000002',
  'bhupendra@id.onboarding.internal',
  crypt('Bhupendra123', gen_salt('bf', 12)),
  'task_owner', NULL,
  'invited', true
);
