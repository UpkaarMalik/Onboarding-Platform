import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthedFetch } from '../../api/useAuthedFetch';
import { ApiError, API_BASE_URL, openFileInline } from '../../api/client';
import { formatDate } from '../../lib/format';
import type { JoineeDocumentRow } from '../../types/onboarding';

const STATUS_COPY: Record<JoineeDocumentRow['status'], { label: string; hint: string }> = {
  awaiting_upload: { label: 'Needed', hint: 'Not uploaded yet' },
  submitted: { label: 'Submitted', hint: 'Waiting for HR to review' },
  approved: { label: 'Approved', hint: 'Accepted by HR' },
  // The pill names the STATE; the button beside it already says Reupload, and
  // two controls both reading "Re-upload" made the state itself unreadable.
  rejected: { label: 'Rejected', hint: 'HR asked for a new copy' },
};

function prettyBytes(size: string | null): string | null {
  if (!size) return null;
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The document-upload task's popup body: one row per document HR requested,
 * with its review state, a preview of what was uploaded, and a replace control.
 *
 * Submitting the last outstanding document completes the gating task
 * server-side, which is why this reports completion upward the same way
 * SubtaskChecklist does.
 *
 * Uploads bypass apiFetch deliberately: the body is multipart/form-data and
 * apiFetch always JSON-encodes and sets a JSON Content-Type.
 */
export default function DocumentChecklist({
  onChanged,
  onParentCompleted,
}: {
  onChanged: () => void;
  onParentCompleted: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [docs, setDocs] = useState<JoineeDocumentRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(() => {
    authedFetch<JoineeDocumentRow[]>('/joinee-documents/mine')
      .then(setDocs)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load your documents'),
      );
  }, [authedFetch]);

  useEffect(load, [load]);

  async function upload(requirementId: string, file: File) {
    setBusyId(requirementId);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // Auth cookie is attached by `credentials: 'include'`; CSRF
      // token is echoed from the same-named cookie the login flow set
      // (double-submit pattern — see backend CsrfGuard).
      const csrf = document.cookie
        .split('; ')
        .find((c) => c.startsWith('csrf_token='))
        ?.slice('csrf_token='.length) ?? '';
      const res = await fetch(
        `${API_BASE_URL}/joinee-documents/requirements/${requirementId}/upload`,
        {
          method: 'POST',
          headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
          body: form,
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Upload failed' }));
        throw new Error(body.message ?? 'Upload failed');
      }
      const result = (await res.json().catch(() => ({}))) as { taskCompleted?: boolean };
      load();
      onChanged();
      if (result.taskCompleted) onParentCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusyId(null);
    }
  }

  async function preview(uploadId: string) {
    setError(null);
    try {
      // The file is served through the API with a Bearer token, so a plain
      // <a href> can't fetch it — openFileInline pulls it down and hands the
      // browser a blob URL, which its native image/PDF viewer renders.
      await openFileInline(`/joinee-documents/uploads/${uploadId}/file`);
    } catch {
      setError('Could not open that document');
    }
  }

  if (!docs) {
    return (
      <div className="checklist">
        {error ? <p className="error-text">{error}</p> : <p className="muted">Loading your documents…</p>}
      </div>
    );
  }

  const outstanding = docs.filter((d) => d.status === 'awaiting_upload' || d.status === 'rejected');
  const submitted = docs.length - outstanding.length;
  const pct = docs.length ? Math.round((submitted / docs.length) * 100) : 0;

  return (
    <div className="checklist">
      {error && <p className="error-text">{error}</p>}

      <div className="checklist-head">
        <div>
          <h4 className="checklist-title">Requested documents</h4>
          <p className="checklist-sub">
            {outstanding.length === 0
              ? 'Everything is submitted — you can move on to your next tasks.'
              : `${outstanding.length} document${outstanding.length === 1 ? '' : 's'} still needed. PDF or image, up to 10 MB.`}
          </p>
        </div>
        <span className="checklist-count">
          {submitted}
          <span className="checklist-count-of">/{docs.length}</span>
        </span>
      </div>

      <span className="checklist-track">
        <span className="checklist-track-fill" style={{ width: `${pct}%` }} />
      </span>

      <ul className="doc-grid">
        {docs.map((doc, i) => {
          const copy = STATUS_COPY[doc.status];
          const uploading = busyId === doc.requirement_id;
          return (
            <li
              key={doc.requirement_id}
              className={`doc-card doc-card--${doc.status}${dragId === doc.requirement_id ? ' is-dragover' : ''}`}
              style={{ ['--row' as string]: i }}
              onDragOver={(e) => {
                if (doc.status === 'approved') return;
                e.preventDefault();
                setDragId(doc.requirement_id);
              }}
              onDragLeave={() => setDragId(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragId(null);
                if (doc.status === 'approved') return;
                const file = e.dataTransfer.files?.[0];
                if (file) void upload(doc.requirement_id, file);
              }}
            >
              <span className={`doc-card-icon doc-card-icon--${doc.status}`} aria-hidden="true">
                <FileIcon mime={doc.mime_type} />
              </span>

              <div className="doc-card-main">
                <div className="doc-card-titlerow">
                  <strong className="doc-card-name">{doc.label}</strong>
                  <span className={`doc-status doc-status--${doc.status}`}>{copy.label}</span>
                </div>

                <span className="doc-card-hint">
                  {doc.original_filename ? (
                    <>
                      {doc.original_filename}
                      {prettyBytes(doc.size_bytes) && ` · ${prettyBytes(doc.size_bytes)}`}
                      {doc.uploaded_at && ` · ${formatDate(doc.uploaded_at)}`}
                    </>
                  ) : (
                    copy.hint
                  )}
                </span>

                {doc.status === 'rejected' && doc.review_note && (
                  <span className="doc-card-note">
                    <AlertIcon />
                    {doc.review_note}
                  </span>
                )}

                <div className="doc-card-actions">
                  {doc.upload_id && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => preview(doc.upload_id!)}
                    >
                      <EyeIcon />
                      Preview
                    </button>
                  )}
                  {doc.status !== 'approved' && (
                    <>
                      <input
                        ref={(el) => {
                          inputs.current[doc.requirement_id] = el;
                        }}
                        type="file"
                        className="visually-hidden"
                        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                        disabled={uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void upload(doc.requirement_id, file);
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        className={doc.upload_id ? 'btn-ghost btn-sm' : 'btn-solid btn-sm'}
                        disabled={uploading}
                        onClick={() => inputs.current[doc.requirement_id]?.click()}
                      >
                        {uploading ? (
                          <>
                            <span className="spinner" aria-hidden="true" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <UploadIcon />
                            {doc.upload_id ? 'Reupload' : 'Choose file'}
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="checklist-foot">
        Drag a file straight onto a card to upload it. Nothing is emailed — HR reviews these here.
      </p>
    </div>
  );
}

function FileIcon({ mime }: { mime: string | null }) {
  if (mime?.startsWith('image/')) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" />
      <path d="M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
    </svg>
  );
}
