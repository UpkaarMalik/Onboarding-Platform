-- 0021: The Create New Joinee fields the schema had nowhere to put:
--       personal email, manager, buddy. Full name, department and date
--       of joining already map to users.full_name,
--       users/onboardings.department_id and onboardings.start_date.

-- --- Personal email -------------------------------------------------
-- Where the temp Joinee ID + password will be sent once credential
-- email is built. Deliberately separate from company_email: that one is
-- issued later by HR, is not a login identifier (see AuthService), and
-- does not exist yet at the moment HR creates the account.
ALTER TABLE users ADD COLUMN personal_email text;

-- Nullable at the DB level only because the two pre-existing seeded
-- superadmins have none. CreateUserDto requires it for every new joinee.
--
-- Unique on lower(...) because 'Jatin@x.com' and 'jatin@x.com' are the
-- same mailbox, and scoped to live rows so a soft-deleted joinee does
-- not permanently reserve their address. This matters most once
-- credential email exists: without it, two joinees' credentials could
-- be delivered to the same inbox.
CREATE UNIQUE INDEX users_personal_email_live_key
  ON users (lower(personal_email))
  WHERE personal_email IS NOT NULL AND deleted_at IS NULL;

-- --- Manager and buddy ----------------------------------------------
-- On onboardings rather than users: these are assignments made for a
-- person's onboarding, alongside start_date and template_version, not
-- permanent identity facts.
--
-- Free text, matching the form's plain inputs. Kept nullable so the
-- existing POST /onboardings path and the e2e suite keep working
-- without supplying them.
ALTER TABLE onboardings
  ADD COLUMN manager_name text,
  ADD COLUMN buddy_name   text;
