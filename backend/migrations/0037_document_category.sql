-- A stored category (type) for a policy, chosen by HR at upload.
--
-- Until now the category was inferred on the frontend from keywords in the
-- title — 'health'/'insurance' -> Health, 'travel'/'meal' -> Travel, else
-- General. That is a guess, and a policy whose name contains none of those
-- words ("Remote Work Policy") always fell to General with no way to correct
-- it. This column lets HR set it outright.
--
-- Nullable on purpose: every existing row keeps NULL and the frontend falls
-- back to the title-based guess for those, so nothing needs backfilling and
-- old rows behave exactly as before until someone edits them.
--
-- CHECK rather than an enum type: the set is small, tied to the frontend's
-- own three tabs, and a plain text+CHECK is far easier to extend later than
-- an ALTER TYPE.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS category TEXT
  CHECK (category IN ('health', 'travel', 'general'));
