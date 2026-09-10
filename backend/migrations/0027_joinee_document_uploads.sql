-- 0027: The files a joinee actually uploads, and HR's review of them.
--       This is the table that makes "documents the joinee uploads are
--       visible to HR" a query.

-- Deliberately NOT the existing `documents` table. That one is
-- HR-authored company policy material, uploaded by superadmin_hr and
-- readable by every authenticated user (company-wide or own-department,
-- see DocumentsService). This is the opposite direction and trust
-- level: personal identity documents, uploaded by one employee,
-- readable only by that employee and HR. Sharing a table would mean one
-- bad WHERE clause exposes Aadhaar scans on the Documents page.
--
-- Separate from joinee_document_requirements (rather than a file_url
-- column on it) because a rejected document gets re-uploaded, and for
-- identity paperwork the superseded attempts are worth keeping rather
-- than silently overwriting.
CREATE TABLE joinee_document_uploads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id    uuid NOT NULL REFERENCES joinee_document_requirements(id),

  -- Normally the joinee themselves; recorded explicitly so an upload
  -- performed by HR on their behalf stays distinguishable after the fact.
  uploaded_by       uuid NOT NULL REFERENCES users(id),

  -- Server-generated filename (randomUUID() + extname), the same
  -- convention as documents.file_url — never the client-supplied name.
  file_url          text NOT NULL,
  -- The client-supplied name, kept for display only. Never used to
  -- build a path.
  original_filename text NOT NULL,
  -- Recorded at upload time so the Content-Type served on preview is
  -- the one that was validated on the way in, rather than being
  -- re-sniffed or guessed from the extension on the way out.
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL CHECK (size_bytes > 0),
  -- Lets a re-upload of a byte-identical file be recognised, and gives
  -- a tamper check on the uploads directory. Nullable: only populated
  -- if the application hashes on upload.
  checksum_sha256   text,

  -- HR's verdict on this specific file.
  review_status     text NOT NULL DEFAULT 'pending_review'
                      CHECK (review_status IN ('pending_review','approved','rejected')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  -- Why it was rejected — shown to the joinee so they know what to fix.
  review_note       text,

  -- Set when a newer upload replaces this one, so history is retained
  -- without ambiguity about which file is current.
  superseded_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- A review is either not done, or fully recorded — never a verdict
  -- with no reviewer attached. Same shape as chk_dual_confirmation on
  -- onboarding_tasks.
  CONSTRAINT chk_review_recorded CHECK (
    (review_status =  'pending_review' AND reviewed_by IS NULL     AND reviewed_at IS NULL)
    OR
    (review_status <> 'pending_review' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),

  -- A rejection must say why; an approval has nothing to explain.
  CONSTRAINT chk_rejection_has_note CHECK (
    review_status <> 'rejected' OR review_note IS NOT NULL
  )
);

-- At most one live upload per requirement. "Which file is current" is
-- answered by the database rather than by ORDER BY created_at DESC
-- LIMIT 1 repeated at every call site.
CREATE UNIQUE INDEX joinee_document_uploads_current_key
  ON joinee_document_uploads (requirement_id)
  WHERE superseded_at IS NULL;

CREATE INDEX idx_joinee_doc_uploads_requirement ON joinee_document_uploads (requirement_id);

-- Drives HR's "documents waiting on me" queue.
CREATE INDEX idx_joinee_doc_uploads_pending
  ON joinee_document_uploads (created_at)
  WHERE review_status = 'pending_review' AND superseded_at IS NULL;
