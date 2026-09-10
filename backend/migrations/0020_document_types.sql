-- 0020: Catalogue of document types HR can require from a joinee.
--
-- A table rather than a CHECK-constrained text column, because this list
-- is HR-facing UI data and not a domain invariant: it carries display
-- order and default-selection state for the "Documents" step of Create
-- New Joinee, and requirement rows need a stable id to reference. With a
-- CHECK enum, relabelling 'Aadhaar Card' would mean rewriting every
-- historical requirement row that used the old spelling.

CREATE TABLE document_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable machine name. The application refers to types by code, never
  -- by label, so labels stay free to change.
  code                text NOT NULL UNIQUE,
  label               text NOT NULL,
  display_order       integer NOT NULL,
  -- Pre-ticked when HR opens the Documents step, so the default set is
  -- configurable data rather than hardcoded frontend checkboxes.
  is_default_required boolean NOT NULL DEFAULT false,
  -- Identity/financial documents that warrant tighter handling than a
  -- degree certificate. Nothing enforces this yet — it exists so an
  -- access rule or redaction policy has something to key off later.
  is_sensitive        boolean NOT NULL DEFAULT false,
  -- Retire a type without deleting it: existing requirement rows keep
  -- resolving, but it disappears from the grid for new joinees.
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_types_active_order
  ON document_types (display_order)
  WHERE is_active;

INSERT INTO document_types (code, label, display_order, is_default_required, is_sensitive) VALUES
  ('aadhaar_card',               'Aadhaar Card',               1, true,  true),
  ('pan_card',                   'PAN Card',                   2, true,  true),
  ('passport',                   'Passport',                   3, false, true),
  ('degree_certificate',         'Degree Certificate',         4, false, false),
  ('offer_letter',               'Offer Letter',               5, false, false),
  ('previous_experience_letter', 'Previous Experience Letter', 6, false, false),
  ('bank_account_details',       'Bank Account Details',       7, true,  true),
  ('passport_size_photo',        'Passport Size Photo',        8, true,  false),
  ('address_proof',              'Address Proof',              9, false, false);
