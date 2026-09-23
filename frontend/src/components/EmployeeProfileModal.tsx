import { useCallback, useEffect, useState, type FormEvent } from 'react';
import PersonSelect, { useEligiblePeople } from './PersonSelect';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { ApiError, openFileInline } from '../api/client';
import { formatDate, formatPhone, todayIso } from '../lib/format';
import Modal from './Modal';
import AnimatedProgressBar from './AnimatedProgressBar';
import BlockerLine, { type TaskBlocker } from './BlockerLine';
import CopyButton from './CopyButton';
import ReasonDialog from './tasks/ReasonDialog';

/**
 * HR's view of one joinee: their details, their documents, their tasks, and
 * the actions HR takes on all three.
 *
 * THIS FILE EXISTS BECAUSE THERE WERE TWO OF IT.
 * A near-identical copy lived in HrDashboard.tsx and another in
 * HrOverview.tsx — the dashboard's upcoming-joinee cards and ratings table
 * opened one, the roster's View button opened the other. They drifted, as two
 * copies do: the dashboard's grew manager/buddy editing and subtask counts,
 * and when the document-rejection prompt was replaced with a real dialog it
 * was replaced in one of them, so the path almost everyone actually uses kept
 * showing a browser prompt. Neither copy was dead, which is why neither was
 * noticed.
 *
 * It lives in components/ rather than in either page because both pages need
 * it and HrDashboard already imports HrOverview — putting it in either one
 * would make that import cycle.
 */

interface JoineeDocument {
  requirement_id: string;
  status: 'awaiting_upload' | 'submitted' | 'approved' | 'rejected';
  label: string;
  upload_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  uploaded_at: string | null;
  review_status: 'pending_review' | 'approved' | 'rejected' | null;
  review_note: string | null;
}

interface ProfileTask {
  completion_mode?: string;
  id: string;
  blocker?: TaskBlocker | null;
  title: string;
  status: string;
  due_date: string;
  priority: string;
  is_required: boolean;
  system_key: string | null;
  completed_at: string | null;
  subtask_count: number;
  subtask_completed_count: number;
  /** Whether the step-by-step gate has opened this task yet — the server
   *  refuses to complete it until it has. */
  is_open: boolean;
}

interface EmployeeProfile {
  user: {
    id: string;
    full_name: string;
    joinee_id: string;
    phone_number: string;
    personal_email: string | null;
    company_email: string | null;
    status: string;
    must_reset_password: boolean;
    department_name: string | null;
  };
  onboarding: {
    id: string;
    status: string;
    start_date: string;
    manager_name: string | null;
    buddy_name: string | null;
    manager_user_id: string | null;
    buddy_user_id: string | null;
    template_name: string;
  } | null;
  documents: JoineeDocument[];
  tasks: {
    pending: ProfileTask[];
    completed: ProfileTask[];
    requiredTotal: number;
    requiredCompleted: number;
  };
}

interface Department {
  id: string;
  name: string;
}

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}

export default function EmployeeProfileModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingAssignments, setEditingAssignments] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const people = useEligiblePeople();
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [credentials, setCredentials] = useState<CredentialSummary | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  /* Which upload is mid-rejection, and which task is mid-block/resolve. Held
     as the row itself, not a boolean, so the dialog can name what it is
     about — the thing a window.prompt could never do. */
  const [rejecting, setRejecting] = useState<JoineeDocument | null>(null);
  const [blocking, setBlocking] = useState<ProfileTask | null>(null);
  const [resolving, setResolving] = useState<ProfileTask | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<EmployeeProfile>(`/employee-profile/${userId}`)
      .then((p) => {
        setProfile(p);
        setManagerId(p.onboarding?.manager_user_id ?? '');
        setBuddyId(p.onboarding?.buddy_user_id ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load profile'));
    // Loaded with the profile rather than behind a "View credentials" click —
    // the Joinee ID is the first thing HR needs when they open a joinee, and
    // burying it was the whole complaint.
    authedFetch<CredentialSummary>(`/auth/users/${userId}/credentials`)
      .then(setCredentials)
      .catch(() => setCredentials(null));
  }, [authedFetch, userId]);

  useEffect(load, [load]);

  async function saveAssignments(e: FormEvent) {
    e.preventDefault();
    if (!profile?.onboarding) return;
    setSavingAssignments(true);
    setError(null);
    try {
      // null clears; both are always sent, so what the form shows is what
      // gets saved.
      await authedFetch(`/onboardings/${profile.onboarding.id}/assignments`, {
        method: 'PATCH',
        body: { managerUserId: managerId || null, buddyUserId: buddyId || null },
      });
      setEditingAssignments(false);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSavingAssignments(false);
    }
  }

  /**
   * Approving is one click — there is nothing to say about a document that
   * was fine. Rejecting opens the same dialog blocking uses, because the
   * joinee reads the reason and a required field is the only thing that
   * makes sure there is one.
   *
   * This used to be a window.prompt. A prompt cannot be styled, cannot show
   * which document is being rejected, and is suppressible in some browsers —
   * where the old `if (!note) return` turned that into the button silently
   * doing nothing.
   */
  async function review(uploadId: string, decision: 'approved' | 'rejected', note?: string) {
    setReviewing(uploadId);
    setError(null);
    try {
      await authedFetch(`/joinee-documents/uploads/${uploadId}/review`, {
        method: 'POST',
        body: { decision, ...(note ? { note } : {}) },
      });
      setRejecting(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review');
    } finally {
      setReviewing(null);
    }
  }

  /* Blocking and resolving both refresh the profile AND the page behind it:
     the roster's "needs attention" figures and the greeting's blocked count
     are the same fact seen from two places, and leaving one stale is how a
     dashboard starts disagreeing with itself. */
  /**
   * The owner side of a task, from HR's desk.
   *
   * Migration 0031 made the company email & laptop handover
   * completion_mode 'owner' with owner_role 'superadmin_hr', so the joinee
   * can no longer tick it — which left nobody able to, because HR had no
   * control for it anywhere. This is that control.
   *
   * The gate still applies: completeAsOwner refuses a task the stage has not
   * opened, so this cannot be used to jump ahead of the documents.
   */
  async function completeAsOwner(taskId: string) {
    setCompletingTaskId(taskId);
    setBlockError(null);
    try {
      await authedFetch(`/onboarding-tasks/${taskId}/complete-as-owner`, { method: 'POST' });
      load();
      onChanged();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'Could not complete this task');
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function blockTask(taskId: string, reason: string, expectedAt?: string) {
    setBlockBusy(true);
    setBlockError(null);
    try {
      await authedFetch(`/onboarding-tasks/${taskId}/block`, {
        method: 'POST',
        body: { reason, ...(expectedAt ? { expectedAt } : {}) },
      });
      setBlocking(null);
      load();
      onChanged();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'Could not block this task');
    } finally {
      setBlockBusy(false);
    }
  }

  async function resolveBlocker(blockerId: string, note?: string) {
    setBlockBusy(true);
    setBlockError(null);
    try {
      await authedFetch(`/blockers/${blockerId}/resolve`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      setResolving(null);
      load();
      onChanged();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'Could not resolve this blocker');
    } finally {
      setBlockBusy(false);
    }
  }

  async function regenerate() {
    setError(null);
    setRegenerating(true);
    try {
      const res = await authedFetch<{
        credentials: { loginId: string; temporaryPassword: string };
      }>(`/auth/users/${userId}/regenerate-credentials`, { method: 'POST' });
      setCredentials({
        joineeId: res.credentials.loginId,
        temporaryPassword: res.credentials.temporaryPassword,
        awaitingFirstReset: true,
        hasLoggedIn: false,
        canRegenerate: true,
        note: 'New temporary password — shown once. Share it with the joinee now.',
      });
      // Deliberately not reloading the profile here: load() re-fetches the
      // credentials summary, whose temporaryPassword is always null, which
      // would wipe the freshly-minted password off the screen before HR could
      // copy it.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate');
    } finally {
      setRegenerating(false);
    }
  }

  if (!profile) {
    return (
      <Modal title="Employee profile" onClose={onClose}>
        {error ? <p className="error-text">{error}</p> : <p className="muted">Loading…</p>}
      </Modal>
    );
  }

  const { user, onboarding, documents, tasks } = profile;
  // The step the gate is currently on — what a not-yet-open task waits for.
  const waitingOn = tasks.pending.find((t) => t.is_required && t.is_open)?.title;
  const percent = tasks.requiredTotal
    ? Math.round((tasks.requiredCompleted / tasks.requiredTotal) * 100)
    : 0;

  return (
    <Modal
      title={user.full_name}
      onClose={onClose}
      size="xl"
      icon={<span className="profile-avatar">{initials(user.full_name)}</span>}
      subtitle={
        <>
          {user.department_name ?? 'No department'}
          {onboarding && (
            <>
              {' · '}
              {onboarding.start_date > todayIso() ? 'Joins' : 'Joined'} {formatDate(onboarding.start_date)}
            </>
          )}
        </>
      }
    >
      <div className="profile-page">
      {error && <p className="error-text">{error}</p>}

      <section className="profile-section">
        <div className="profile-section-head">
          <h3>Details</h3>
        </div>
        <dl className="profile-grid">
          <div>
            <dt>Joinee ID</dt>
            <dd>
              <code>{user.joinee_id}</code>
            </dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>
              <a className="profile-link" href={`tel:+${user.phone_number}`}>
                {formatPhone(user.phone_number)}
              </a>
            </dd>
          </div>
          <div>
            <dt>Personal email</dt>
            <dd>
              {user.personal_email ? (
                <a className="profile-link" href={`mailto:${user.personal_email}`}>
                  {user.personal_email}
                </a>
              ) : (
                <span className="muted">Not recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{user.department_name ?? <span className="muted">None</span>}</dd>
          </div>
          <div>
            <dt>Date of joining</dt>
            <dd>{formatDate(onboarding?.start_date) ?? <span className="muted">Not onboarded</span>}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>
              <span className={`status-pill status-${user.status}`}>{user.status}</span>
            </dd>
          </div>
        </dl>
      </section>

      {onboarding && (
        <section className="profile-section">
          <div className="profile-section-head">
            <h3>Manager &amp; buddy</h3>
            {!editingAssignments && (
              <button type="button" className="profile-head-btn" onClick={() => setEditingAssignments(true)}>
                Edit
              </button>
            )}
          </div>
          {editingAssignments ? (
            <form className="profile-assign-form" onSubmit={saveAssignments}>
              {/* Divs, not labels: a <label> would forward clicks on its
                  caption to the dropdown's trigger. */}
              <div className="profile-assign-field">
                Manager
                <PersonSelect value={managerId} onChange={setManagerId} people={people} exclude={userId} placeholder="Select manager" />
              </div>
              <div className="profile-assign-field">
                Buddy
                <PersonSelect value={buddyId} onChange={setBuddyId} people={people} exclude={userId} placeholder="Select buddy" />
              </div>
              <div className="profile-assign-actions">
                <button type="button" onClick={() => setEditingAssignments(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={savingAssignments}>
                  {savingAssignments ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div className="profile-people">
              <AssignedPerson role="Manager" linked={!!onboarding.manager_user_id} name={onboarding.manager_name} />
              <AssignedPerson role="Buddy" linked={!!onboarding.buddy_user_id} name={onboarding.buddy_name} />
            </div>
          )}
        </section>
      )}

      <section className="profile-section">
        <div className="profile-section-head">
          <h3>Documents <span className="profile-count">{documents.length}</span></h3>
        </div>
        {documents.length === 0 ? (
          <p className="muted">No documents were requested for this joinee.</p>
        ) : (
          <ul className="doc-list">
            {documents.map((doc) => (
              <li key={doc.requirement_id} className="doc-list__item">
                <div className="doc-list__head">
                  <strong>{doc.label}</strong>
                  <span className={`status-pill status-${doc.status}`}>
                    {doc.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {doc.upload_id ? (
                  <>
                    {/* The filename can be long and unbroken; it truncates
                        and the full name is one hover away. */}
                    <span className="doc-list__meta" title={doc.original_filename ?? undefined}>
                      <span className="doc-list__file">{doc.original_filename}</span>
                      <span>· uploaded {formatDate(doc.uploaded_at)}</span>
                    </span>
                    {doc.review_note && (
                      <span className="field-hint">Rejection note: {doc.review_note}</span>
                    )}
                    <div className="doc-list__actions">
                      {/* Cookie-authenticated; a plain <a href> would work
                          in principle, but openFileInline fetches the blob
                          and hands it to a new tab so the download-vs-view
                          decision stays with the browser's PDF viewer. */}
                      <button
                        type="button"
                        onClick={() =>
                          openFileInline(
                            `/joinee-documents/uploads/${doc.upload_id}/file`,
                          ).catch(() => setError('Could not open this document'))
                        }
                      >
                        Preview
                      </button>
                      {doc.review_status === 'pending_review' && (
                        <>
                          <button
                            type="button"
                            disabled={reviewing === doc.upload_id}
                            onClick={() => review(doc.upload_id!, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={reviewing === doc.upload_id}
                            onClick={() => setRejecting(doc)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="field-hint">Not uploaded yet.</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-section">
        <div className="profile-section-head">
          <h3>Tasks</h3>
          <span className="profile-progress-label">
            <strong>{tasks.requiredCompleted}</strong> of {tasks.requiredTotal} required done
          </span>
        </div>
        <AnimatedProgressBar percent={percent} thin />
        <h4 className="profile-subhead">Pending <span className="profile-count">{tasks.pending.length}</span></h4>
        <ul className="profile-tasks">
          {tasks.pending.map((t) => (
            <li key={t.id} className="profile-task">
              <span className="profile-task-title">
                {t.title}
                {t.subtask_count > 0 && (
                  <span className="profile-task-steps">
                    {t.subtask_completed_count}/{t.subtask_count} steps
                  </span>
                )}
              </span>
              <span className={`status-pill status-${t.status}`}>{t.status.replace(/_/g, ' ')}</span>
              <span className="profile-task-actions">
              {/* Quiet actions: a link-weight button, not a filled one. This
                  is a list of a dozen tasks and a dozen solid buttons would
                  read as a dozen things HR is being asked to do. */}
              {/* Only on a task HR owns. Shown but disabled until the gate
                  opens it — the API refuses it until then (409) — with the
                  step it is waiting on, so HR can see why. */}
              {t.completion_mode === 'owner' && t.status !== 'locked' && !t.blocker && (
                <button
                  type="button"
                  className="task-chip task-chip--done"
                  disabled={completingTaskId === t.id || !t.is_open}
                  title={
                    t.is_open
                      ? undefined
                      : `Opens once "${waitingOn ?? 'the step before it'}" is done`
                  }
                  onClick={() => void completeAsOwner(t.id)}
                >
                  {completingTaskId === t.id ? 'Marking done…' : 'Mark done'}
                </button>
              )}
              {t.blocker ? (
                <button type="button" className="task-chip task-chip--resolve" onClick={() => setResolving(t)}>
                  Resolve
                </button>
              ) : (
                /* Shown for a locked task too, DISABLED rather than absent.
                   A typical joinee's pending list is nine locked rows and one
                   or two open ones, so hiding the action on the locked ones
                   made the feature look like it had not shipped. An action
                   that is not available should say so; only an action that
                   does not exist should be missing. */
                <button
                  type="button"
                  className="task-chip task-chip--block"
                  disabled={t.status === 'locked'}
                  title={
                    t.status === 'locked'
                      ? 'This step has not started yet — block the step it is waiting on instead'
                      : undefined
                  }
                  onClick={() => setBlocking(t)}
                >
                  Mark as blocked
                </button>
              )}
              </span>
              {t.blocker && (
                <span className="profile-task-blocker">
                  <BlockerLine blocker={t.blocker} />
                </span>
              )}
            </li>
          ))}
          {tasks.pending.length === 0 && <li className="profile-empty">Nothing outstanding.</li>}
        </ul>
        <h4 className="profile-subhead">Completed <span className="profile-count">{tasks.completed.length}</span></h4>
        <ul className="profile-tasks">
          {tasks.completed.map((t) => (
            <li key={t.id} className="profile-task profile-task--done">
              <span className="profile-task-title">
                <CheckIcon />
                {t.title}
                {t.subtask_count > 0 && (
                  <span className="profile-task-steps">
                    {t.subtask_completed_count}/{t.subtask_count} steps
                  </span>
                )}
              </span>
              {t.completed_at && <span className="profile-task-date">{formatDate(t.completed_at)}</span>}
            </li>
          ))}
          {tasks.completed.length === 0 && <li className="profile-empty">Nothing completed yet.</li>}
        </ul>
      </section>

      <section className="profile-section profile-section--creds">
        <div className="profile-section-head">
          <h3>Login credentials</h3>
        </div>
        {credentials ? (
          <>
            <div className="cred-row">
              <div className="cred-field">
                <span className="cred-label">Joinee ID</span>
                <span className="cred-value">
                  <code>{credentials.joineeId}</code>
                  <CopyButton text={credentials.joineeId} />
                </span>
              </div>
              <div className="cred-field">
                <span className="cred-label">Temporary password</span>
                <span className="cred-value">
                  {credentials.temporaryPassword ? (
                    <>
                      <code className="cred-secret">{credentials.temporaryPassword}</code>
                      <CopyButton text={credentials.temporaryPassword} />
                    </>
                  ) : (
                    <span className="cred-hidden">
                      <LockedIcon />
                      Not retrievable
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Not an error state — the temp password is bcrypt-hashed the moment
                it is issued, so there is nothing to show a second time. Says so
                plainly, with the one action that does work. */}
            <p className="cred-note">
              {credentials.temporaryPassword
                ? credentials.note
                : credentials.hasLoggedIn
                  ? 'This joinee has already signed in and chosen their own password, so no temporary password exists. Regenerating would lock them out of the one they set.'
                  : 'Temporary passwords are stored one-way (hashed) and cannot be shown twice. If it was lost before reaching the joinee, issue a fresh one below — the original was never used.'}
            </p>

            <div className="cred-actions">
              <button
                type="button"
                className={credentials.hasLoggedIn ? '' : 'btn-solid'}
                disabled={regenerating}
                onClick={regenerate}
              >
                {regenerating ? 'Issuing…' : 'Issue a new temporary password'}
              </button>
              {credentials.hasLoggedIn && (
                <span className="field-hint">Only do this if they’re locked out.</span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Loading credentials…</p>
        )}
      </section>

      {/* The three "say why" dialogs. All the same component: this is one
          form with two booleans, not three forms that would drift. */}
      {blockError && <p className="error-text">{blockError}</p>}

      {rejecting && (
        <ReasonDialog
          title="Reject this document"
          subtitle={rejecting.label}
          label="Why is this being rejected?"
          placeholder="The scan is cut off at the bottom"
          confirmLabel="Reject"
          busy={reviewing === rejecting.upload_id}
          error={error}
          onClose={() => setRejecting(null)}
          onSubmit={({ reason }) => void review(rejecting.upload_id!, 'rejected', reason)}
        />
      )}

      {blocking && (
        <ReasonDialog
          title="Mark as blocked"
          subtitle={blocking.title}
          label="What is it waiting on?"
          withDate
          confirmLabel="Mark as blocked"
          busy={blockBusy}
          error={blockError}
          onClose={() => {
            setBlocking(null);
            setBlockError(null);
          }}
          onSubmit={({ reason, expectedAt }) => void blockTask(blocking.id, reason, expectedAt)}
        />
      )}

      {resolving?.blocker && (
        <ReasonDialog
          title="Resolve blocker"
          subtitle={resolving.title}
          context={<BlockerLine blocker={resolving.blocker} />}
          label="What changed?"
          required={false}
          confirmLabel="Resolve"
          busy={blockBusy}
          error={blockError}
          onClose={() => {
            setResolving(null);
            setBlockError(null);
          }}
          onSubmit={({ reason }) =>
            void resolveBlocker(resolving.blocker!.id, reason || undefined)
          }
        />
      )}
      </div>
    </Modal>
  );
}

function LockedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" />
    </svg>
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function CheckIcon() {
  return (
    <svg className="profile-task-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A picked person as a small tile. A typed name from before the picker
 *  existed that matched nobody (the migration only linked exact matches) is
 *  shown as such, so HR knows to pick someone. */
function AssignedPerson({ role, linked, name }: { role: string; linked: boolean; name: string | null }) {
  return (
    <div className="profile-person">
      <span className={`profile-person-avatar${linked ? '' : ' is-empty'}`} aria-hidden="true">
        {linked && name ? initials(name) : <PersonIcon />}
      </span>
      <span className="profile-person-text">
        <span className="profile-person-role">{role}</span>
        {linked && name ? (
          <span className="profile-person-name">{name}</span>
        ) : name ? (
          <span className="profile-person-name">
            {name} <span className="profile-person-note">typed, not linked — edit to pick someone</span>
          </span>
        ) : (
          <span className="profile-person-name is-empty">Not assigned yet</span>
        )}
      </span>
    </div>
  );
}

/** Shown in an avatar when nobody is assigned yet. */
function PersonIcon() {
  return (
    <svg className="person-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </svg>
  );
}
