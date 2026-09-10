-- 0026: Which documents a given joinee has been asked to upload —
--       one row per ticked checkbox in the Documents step, written when
--       HR creates the joinee.

-- Keyed to user_id, not onboarding_id, because HR creates the user and
-- the onboarding in two separate calls: if the second one fails, the
-- requirements still have a valid owner. onboardings.user_id is UNIQUE
-- anyway, so nothing is lost by hanging off the user instead.
CREATE TABLE joinee_document_requirements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  document_type_id   uuid NOT NULL REFERENCES document_types(id),

  -- The gating task whose popup renders these rows. Nullable so
  -- requirements can be written before the onboarding — and therefore
  -- the task — exists.
  onboarding_task_id uuid REFERENCES onboarding_tasks(id),

  -- Denormalized from the requirement's current upload, maintained by
  -- the application in the same transaction as the upload or review
  -- that changes it. Stored rather than derived so HR's "who still owes
  -- paperwork" view can filter without a correlated subquery per row —
  -- the same tradeoff already taken by onboarding_tasks.status.
  --   awaiting_upload — requested, nothing uploaded yet
  --   submitted       — file uploaded, HR has not reviewed it
  --   approved        — HR accepted the current upload
  --   rejected        — HR rejected it; the joinee needs to re-upload
  status             text NOT NULL DEFAULT 'awaiting_upload'
                       CHECK (status IN ('awaiting_upload','submitted','approved','rejected')),

  -- Which HR user asked for this document.
  requested_by       uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A joinee is never asked for the same document type twice; HR
  -- ticking Aadhaar again is an idempotent no-op, not a second row.
  UNIQUE (user_id, document_type_id)
);

CREATE INDEX idx_joinee_doc_reqs_user   ON joinee_document_requirements (user_id);
CREATE INDEX idx_joinee_doc_reqs_task   ON joinee_document_requirements (onboarding_task_id);
CREATE INDEX idx_joinee_doc_reqs_status ON joinee_document_requirements (status);

-- Reuses set_updated_at(), defined in migration 0002.
CREATE TRIGGER trg_joinee_document_requirements_updated_at
  BEFORE UPDATE ON joinee_document_requirements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
