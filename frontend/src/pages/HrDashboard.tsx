import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, openFileInline } from '../api/client';
import { formatDate, formatDateShort, todayIso } from '../lib/format';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import OceanBanner from '../components/OceanBanner';
import HrOverview, { CreateJoineeWizard, CustomSelect, type RosterFilter } from './HrOverview';

interface Department {
  id: string;
  name: string;
}

interface DocumentType {
  id: string;
  code: string;
  label: string;
  is_default_required: boolean;
  is_sensitive: boolean;
}

/** One requirement plus its current (non-superseded) upload, as returned
 *  by /employee-profile/:id and /joinee-documents/users/:id. */
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
  id: string;
  title: string;
  status: string;
  due_date: string;
  priority: string;
  is_required: boolean;
  system_key: string | null;
  completed_at: string | null;
  subtask_count: number;
  subtask_completed_count: number;
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


/** ISO date `n` days before today, in the viewer's calendar. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The HR/SuperAdmin dashboard: an overview (stat tiles, pipeline stage
 * counts, per-employee progress, a needs-attention feed pulled from
 * /onboardings/stuck) sitting above the detailed, filterable table
 * that already existed (Step 19/26/32/33 — allow-listed keys, {data,
 * total, limit, offset}). The overview reuses the same endpoints at a
 * larger page size rather than adding new summary endpoints — good
 * enough for the onboarding volumes this app deals with.
 */
export default function HrDashboard() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [timeOfDay, setTimeOfDay] = useState<number | null>(null);
  const [sliderDragging, setSliderDragging] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedOnboarding, setSelectedOnboarding] = useState<any | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(
    // The Dashboard roster links here as /hr?profile=<userId> so its View
    // button lands on the joinee instead of making HR search again.
    () => new URLSearchParams(window.location.search).get('profile'),
  );

  const [overviewRows, setOverviewRows] = useState<any[]>([]);
  const [stuckTotal, setStuckTotal] = useState(0);
  const [attention, setAttention] = useState<any[]>([]);
  const [ratingSummary, setRatingSummary] = useState<{ average: number | null; count: number }>({
    average: null,
    count: 0,
  });

  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);
  const [upcomingDeptFilter, setUpcomingDeptFilter] = useState('');
  const [showAddJoiner, setShowAddJoiner] = useState(false);
  const [showAddTaskOwner, setShowAddTaskOwner] = useState(false);
  const [joinerCredentials, setJoinerCredentials] = useState<{
    loginId: string;
    temporaryPassword: string;
  } | null>(null);
  const [provisionedEmail, setProvisionedEmail] = useState<string | null>(null);
  /** Bumped whenever something below changes the roster, so the embedded
   *  HrOverview refetches instead of showing a stale list. */
  const [rosterReload, setRosterReload] = useState(0);
  const [clockOpen, setClockOpen] = useState(false);
  /* The cards scroll the roster into view rather than opening a panel that
     shoves it down the page with no warning. */
  const rosterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authedFetch<Department[]>('/departments')
      .then(setDepartments)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOverview() {
    try {
      const [all, stuck, rating] = await Promise.all([
        authedFetch<{ data: any[]; total: number }>('/onboardings?limit=100'),
        authedFetch<{ data: any[]; total: number }>('/onboardings/stuck?limit=50'),
        authedFetch<{ average: number | null; count: number }>('/onboardings/ratings/summary'),
      ]);
      setOverviewRows(all.data);
      setStuckTotal(stuck.total);
      setAttention(stuck.data);
      setRatingSummary(rating);
    } catch {
      // The detailed table below surfaces its own errors — the
      // overview degrades to "nothing to show" rather than blocking
      // the page on a second failure.
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  function refreshEverything() {
    void loadOverview();
    setRosterReload((n) => n + 1);
  }

  const today = todayIso();

  /* The four home cards. "Joiners" counts every onboarding on record;
     "recently joined" is a start date inside the trailing 15 days (today
     included), which is the window HR treats as still-settling-in; "email
     issued" takes the provisioned address when there is one and falls back to
     the stage, because rows created before the provision flow existed carry a
     later status with no address recorded against them. */
  const totalJoiners = overviewRows.length;
  const recentCutoff = isoDaysAgo(15);
  const recentRows = overviewRows.filter(
    (o) => o.start_date >= recentCutoff && o.start_date <= today,
  );
  const emailIssuedRows = overviewRows.filter(
    (o) =>
      !!o.company_email ||
      ['email_provisioned', 'checkpoint_pending', 'active', 'completed'].includes(o.status),
  );

  /* /onboardings/stuck returns one row per stuck TASK. The other three cards
     count people, so reading "13" next to "12 total joiners" said more people
     were in trouble than exist. Collapse to distinct onboardings and describe
     the tasks underneath.

     A task counts as needing attention when ALL of these hold (the query is
     OnboardingsService.listStuckTasks):
       - the onboarding is still running (not completed, not cancelled)
       - the task is required, and not completed or cancelled
       - and it is either explicitly 'blocked', or past its due date

     'locked' is deliberately excluded from the overdue half: a phase-2 task's
     due date is computed from the start date at instantiation, so it can show
     a past date before the checkpoint has even unlocked it. That is "not
     started yet", not "stuck" (backend utils/overdue.util.ts). */
  const attentionIds = new Set<string>(attention.map((t) => t.onboarding_id));
  const attentionRows = overviewRows.filter((o) => attentionIds.has(o.id));
  const blockedCount = attention.filter((t) => t.is_blocked).length;
  const overdueCount = attention.length - blockedCount;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  /* Say which of the two it actually is. "13 blocked or overdue tasks" made
     the reader guess, and left "13" looking unrelated to the 5 above it. */
  const attentionDetail =
    attention.length === 0
      ? 'Everyone on track'
      : blockedCount && overdueCount
        ? `${plural(blockedCount, 'task')} blocked, ${overdueCount} overdue`
        : blockedCount
          ? `${plural(blockedCount, 'task')} blocked`
          : `${plural(overdueCount, 'task')} past the due date`;

  const pipelineRows = overviewRows
    .filter((o) => o.status !== 'completed' && o.status !== 'cancelled' && o.start_date >= today)
    .filter((o) => !upcomingDeptFilter || o.department_id === upcomingDeptFilter);

  const ratedRows = overviewRows.filter((o) => o.experience_rating != null);

  const HOME_CARDS = [
    {
      key: 'total',
      icon: '👥',
      tone: 'info' as const,
      value: totalJoiners,
      label: 'Total Joiners',
      sub: 'Joiners on record',
      rows: overviewRows,
    },
    {
      key: 'recent',
      icon: '🌱',
      tone: 'success' as const,
      value: recentRows.length,
      label: 'Recently Joined',
      sub: 'Joiners in the last 15 days',
      rows: recentRows,
    },
    {
      key: 'attention',
      icon: '⚠️',
      tone: 'danger' as const,
      value: attentionRows.length,
      label: 'Needs Attention',
      sub: attentionDetail,
      rows: attentionRows,
    },
    {
      key: 'email',
      icon: '✉️',
      tone: 'accent' as const,
      value: emailIssuedRows.length,
      label: 'Email Issued',
      sub: 'Joiners with a company address',
      rows: emailIssuedRows,
    },
  ];

  const activeCard = HOME_CARDS.find((c) => c.key === activeStatFilter) ?? null;
  const rosterFilter: RosterFilter | null = activeCard
    ? {
        key: activeCard.key,
        label: activeCard.label,
        ids: new Set(activeCard.rows.map((o: any) => o.id)),
      }
    : null;

  function pickCard(key: string) {
    const next = activeStatFilter === key ? null : key;
    setActiveStatFilter(next);
    if (!next) return;
    // Give React the frame it needs to render the chip before measuring, then
    // only move the page if the roster is actually off-screen — scrolling to
    // something already in view is a jolt with nothing gained.
    requestAnimationFrame(() => {
      const el = rosterRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.75 || top < 0) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  const clockValue =
    timeOfDay ?? (new Date().getHours() + new Date().getMinutes() / 60) / 24;
  const clockLabel = `${String(Math.floor(clockValue * 24) % 24).padStart(2, '0')}:${String(
    Math.floor(((clockValue * 24) % 1) * 60),
  ).padStart(2, '0')}`;

  return (
    <div className="hr-dashboard">
      <div className="hr-hero">
        <OceanBanner height={240} timeOfDay={timeOfDay ?? undefined} animSpeed={sliderDragging ? 6 : 1} />

        <div className="hr-hero-clock">
          {clockOpen ? (
            <div className="hr-clock-panel">
              <span>DAWN</span>
              <input
                type="range" min="0" max="1000"
                value={Math.round(clockValue * 1000)}
                onChange={(e) => setTimeOfDay(parseInt(e.target.value) / 1000)}
                onMouseDown={() => setSliderDragging(true)} onMouseUp={() => setSliderDragging(false)}
                onTouchStart={() => setSliderDragging(true)} onTouchEnd={() => setSliderDragging(false)}
                aria-label="Time of day"
              />
              <span>NIGHT</span>
              <button type="button" className="hr-clock-toggle" onClick={() => setClockOpen(false)} aria-label="Close time control">
                {clockLabel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="hr-clock-toggle"
              onClick={() => setClockOpen(true)}
              aria-expanded={false}
              aria-label={`Scene time ${clockLabel}. Adjust`}
            >
              ☀ {clockLabel}
            </button>
          )}
        </div>

        <div className="hr-hero-overlay">
          <span className="hr-hero-badge">HR / SuperAdmin</span>
          <div className="hr-hero-row">
            <h1 className="hr-hero-title">
              {greeting()}, <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600 }}>{user?.full_name?.split(' ')[0] ?? 'there'}</span>
            </h1>
            <button type="button" className="hr-hero-cta" onClick={() => setShowAddJoiner(true)}>
              <span className="hr-hero-cta-label">+ Create New Joinee</span>
            </button>
          </div>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* Exactly two flex items: the bullet, and the whole sentence. Leaving
          the words as bare text made every inline span its own flex item,
          which on a phone broke the line into side-by-side columns. */}
      <p className="hr-lede">
        <span className="hr-lede-bullet" aria-hidden="true" />
        <span className="hr-lede-text">
          Create joinees, manage onboarding access, track progress
          <span className="hr-lede-amp"> &amp; </span>
          explore all HR features <span className="hr-lede-here">right from here.</span>
        </span>
      </p>

      <Reveal>
        {/* One rectangle, two boxes. Each column owns its heading so the two
            baselines line up, and the grid stretches them to equal height. */}
        <div className="home-panels">
          <div className="home-panel">
            <div className="home-section-head">
              <h2>At a glance</h2>
            </div>
            <div className="home-cards">
              {HOME_CARDS.map((c) => (
                <button
                  type="button"
                  key={c.key}
                  className={`home-card home-card--${c.tone}${activeStatFilter === c.key ? ' is-active' : ''}`}
                  aria-pressed={activeStatFilter === c.key}
                  onClick={() => pickCard(c.key)}
                >
                  <span className={`home-card-icon ${c.tone}`} aria-hidden="true">{c.icon}</span>
                  <span className="home-card-text">
                    <span className="home-card-value">{c.value}</span>
                    <span className="home-card-label">{c.label}</span>
                    <span className="home-card-sub">{c.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="home-panel">
            <div className="home-section-head">
              <h2>Upcoming joinees</h2>
              {/* The same control as the roster's filters. A native <select>
                  here could not reach a 44pt target (no pseudo-element) and
                  was the one piece of unstyled chrome left on the page. */}
              <div className="home-panel-filter">
                <CustomSelect
                  value={upcomingDeptFilter}
                  onChange={setUpcomingDeptFilter}
                  placeholder="All departments"
                  options={[
                    { value: '', label: 'All departments' },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </div>
            </div>
            {pipelineRows.length === 0 ? (
              <p className="home-events-empty">No joinees are due to start right now.</p>
            ) : (
              <EventsRail rows={pipelineRows} onPick={(id) => setProfileUserId(id)} />
            )}
          </div>
        </div>
      </Reveal>

      {/* The roster IS the cards' drill-down: picking one narrows this list
          and scrolls to it, instead of opening a second list above it. */}
      <div ref={rosterRef}>
        <HrOverview
          embedded
          reloadKey={rosterReload}
          cardFilter={rosterFilter}
          onClearCardFilter={() => setActiveStatFilter(null)}
        />
      </div>

      <Reveal>
        <section>
          <h2>Feedback &amp; ratings</h2>
          {ratedRows.length === 0 ? (
            <p className="muted">No one has submitted feedback yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Rating</th>
                  <th>Comment</th>
                  <th>Rated on</th>
                </tr>
              </thead>
              <tbody>
                {ratedRows.map((o) => (
                  <tr key={o.id} onClick={() => setProfileUserId(o.user_id)} style={{ cursor: 'pointer' }}>
                    <td>{o.employee_name}</td>
                    <td>{o.department_name}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: '#e8930c' }}>
                        {'★'.repeat(Math.round(o.experience_rating))}{'☆'.repeat(5 - Math.round(o.experience_rating))}
                      </span>
                      <span style={{ marginLeft: 6, fontSize: 13, color: 'var(--color-muted)' }}>{o.experience_rating}/5</span>
                    </td>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.experience_comment || <span className="muted">—</span>}
                    </td>
                    <td>{formatDate(o.experience_rated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </Reveal>

      {selectedOnboarding && (
        <OnboardingDetailModal
          onboarding={selectedOnboarding}
          onClose={() => setSelectedOnboarding(null)}
          onTaskScheduled={refreshEverything}
          onEmailProvisioned={(companyEmail) => {
            setProvisionedEmail(companyEmail);
            setSelectedOnboarding(null);
            refreshEverything();
          }}
        />
      )}

      {profileUserId && (
        <EmployeeProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onChanged={refreshEverything}
        />
      )}

      {showAddJoiner && (
        <CreateJoineeWizard
          departments={departments}
          onClose={() => setShowAddJoiner(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowAddJoiner(false);
            refreshEverything();
          }}
        />
      )}

      {showAddTaskOwner && (
        <AddTaskOwnerModal
          departments={departments}
          onClose={() => setShowAddTaskOwner(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowAddTaskOwner(false);
          }}
        />
      )}

      {joinerCredentials && (
        <Modal title="Account created" onClose={() => setJoinerCredentials(null)}>
          <p>
            Shown once — deliver these to them directly. Use Copy rather than retyping them by hand:
            the temporary password mixes case and symbols on purpose, so a single mistyped character
            is easy to miss and will make it look like the credentials "don't work."
          </p>
          <p className="credential-row">
            <strong>Login:</strong> <code>{joinerCredentials.loginId}</code>
            <CopyButton text={joinerCredentials.loginId} />
          </p>
          <p className="credential-row">
            <strong>Password:</strong> <code>{joinerCredentials.temporaryPassword}</code>
            <CopyButton text={joinerCredentials.temporaryPassword} />
          </p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setJoinerCredentials(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {provisionedEmail && (
        <Modal title="Company email recorded" onClose={() => setProvisionedEmail(null)}>
          <p>
            This is a record only — it can't be used to log in. The employee still signs in with
            their Joinee ID + password or their registered mobile number + OTP.
          </p>
          <p className="credential-row">
            <strong>Company email:</strong> <code>{provisionedEmail}</code>
            <CopyButton text={provisionedEmail} />
          </p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setProvisionedEmail(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The upcoming-joiners rail, on a slow loop.
 *
 * The list is rendered twice and the track is animated from 0 to -50%, so the
 * moment the first copy scrolls out the second is exactly where it began and
 * the wrap is invisible. Duration is derived from the number of entries rather
 * than fixed, so the speed stays the same however many there are — a fixed
 * duration would make a busy month race past.
 *
 * It only loops when there is more content than fits; four names that all fit
 * on screen have no reason to move. Hover and keyboard focus pause it, because
 * you cannot click a moving target, and `prefers-reduced-motion` stops it
 * entirely (handled in CSS) leaving a normal scrollable list.
 */
function EventsRail({ rows, onPick }: { rows: any[]; onPick: (userId: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);
  const [looping, setLooping] = useState(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    /* CSS alone is not enough here. The reduced-motion block stops the
       animation, but the clones are rendered by this component, so without
       this check a reduced-motion reader would be handed a list with every
       name in it twice. Read the preference and simply never loop. */
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (calm.matches) {
      setLooping(false);
      const onChange = () => setLooping(false);
      calm.addEventListener('change', onChange);
      return () => calm.removeEventListener('change', onChange);
    }

    const measure = () => {
      /* One "copy" is the N entries plus one trailing gap — that trailing gap
         is what the next copy starts after, and it is exactly the distance
         translateY(-50%) covers. Which means the sum has to be read
         differently depending on whether the clones are on the page yet:
         before the first loop starts they are not, and halving the height
         then would report a list half its real size. */
      const gap = parseFloat(getComputedStyle(track).rowGap) || 0;
      const cloned = track.children.length > rows.length;
      const oneCopy = cloned ? track.scrollHeight / 2 : track.scrollHeight + gap;

      /* Hysteresis: it takes a clear overflow to start looping and a clear
         fit to stop. Comparing against a single threshold lets a list sitting
         right on the boundary flip on, grow by its clone, flip off, and
         oscillate forever. */
      setLooping((was) => (was ? oneCopy > viewport.clientHeight + 4 : oneCopy > viewport.clientHeight + 12));
      // ~26px a second: slow enough to read a name as it passes.
      setDuration(oneCopy / 26);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(track);
    // Re-run the whole effect if the preference is switched on mid-session.
    const onChange = () => setLooping(false);
    calm.addEventListener('change', onChange);
    return () => {
      ro.disconnect();
      calm.removeEventListener('change', onChange);
    };
  }, [rows.length]);

  const item = (o: any, cloned: boolean) => (
    <li key={`${o.id}${cloned ? '-clone' : ''}`} aria-hidden={cloned || undefined}>
      <button
        type="button"
        className="home-event"
        tabIndex={cloned ? -1 : undefined}
        onClick={() => onPick(o.user_id)}
      >
        <span className="home-event-date">
          <strong>{formatDateShort(o.start_date)?.split(' ')[0]}</strong>
          <small>{formatDateShort(o.start_date)?.split(' ')[1]}</small>
        </span>
        <span className="home-event-text">
          <strong>{o.employee_name} joins</strong>
          <small>{o.department_name}</small>
        </span>
      </button>
    </li>
  );

  return (
    <div
      className={`home-events-viewport${looping ? ' is-looping' : ''}`}
      ref={viewportRef}
    >
      <ul
        className="home-events"
        ref={trackRef}
        style={looping ? { animationDuration: `${duration}s` } : undefined}
      >
        {rows.map((o) => item(o, false))}
        {/* The second copy is what makes the wrap seamless. It is hidden from
            assistive tech and skipped by tabbing so nothing is announced or
            reachable twice. */}
        {looping && rows.map((o) => item(o, true))}
      </ul>
    </div>
  );
}

/**
 * The employee detail popup, extended into the task scheduler: it
 * loads the onboarding's full task list (every status, not just what
 * the employee's own dashboard shows) and lets HR schedule a new
 * one-off task straight onto it. Completion itself still only ever
 * happens through the employee/task_owner endpoints — this view is
 * read-only on existing tasks, checkbox-styled to show progress.
 */
function OnboardingDetailModal({
  onboarding,
  onClose,
  onTaskScheduled,
  onEmailProvisioned,
}: {
  onboarding: any;
  onClose: () => void;
  onTaskScheduled: () => void;
  onEmailProvisioned: (companyEmail: string) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [showScheduler, setShowScheduler] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function provisionEmail() {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await authedFetch<{
        companyEmail: string;
      }>(`/onboardings/${onboarding.id}/provision-email`, { method: 'POST', body: {} });
      onEmailProvisioned(res.companyEmail);
    } catch (err) {
      setProvisionError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setProvisioning(false);
    }
  }

  async function loadTasks() {
    setLoadingTasks(true);
    try {
      const res = await authedFetch<any[]>(`/onboardings/${onboarding.id}/tasks`);
      setTasks(res);
    } catch {
      // Detail view degrades to "no task list" rather than blocking
      // the rest of the popup on a failed fetch.
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding.id]);

  return (
    <Modal title={onboarding.employee_name} onClose={onClose}>
      <div className="detail-row">
        <span className="detail-label">Department</span>
        <span className="detail-value">{onboarding.department_name}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Template</span>
        <span className="detail-value">{onboarding.template_name ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Status</span>
        <span className="detail-value">{onboarding.status}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Start date</span>
        <span className="detail-value">{onboarding.start_date}</span>
      </div>

      {onboarding.status === 'pre_onboarding' && (
        <>
          {provisionError && <p className="error-text">{provisionError}</p>}
          <button
            className="btn-primary"
            style={{ marginTop: '0.6rem' }}
            disabled={provisioning}
            onClick={provisionEmail}
          >
            {provisioning ? 'Assigning…' : '📧 Assign company email'}
          </button>
        </>
      )}

      {!loadingTasks && tasks.some((t) => t.is_required) && (
        <div className="detail-row">
          <span className="detail-label">Progress</span>
          <span className="detail-value">
            {tasks.filter((t) => t.is_required && t.status === 'completed').length}/
            {tasks.filter((t) => t.is_required).length} required tasks
          </span>
        </div>
      )}

      <h3 style={{ marginTop: '1.1rem', marginBottom: '0.5rem' }}>Tasks</h3>
      {loadingTasks && <p className="muted">Loading…</p>}
      {!loadingTasks && (
        <ul className="task-list" style={{ marginBottom: '0.75rem' }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ cursor: 'default', display: 'flex', gap: '0.7rem' }}>
              <span className={`checkbox-mark ${t.status === 'completed' ? 'checked' : ''}`} />
              <div>
                <strong>{t.title}</strong>
                {t.is_checkpoint && <span className="badge">Checkpoint</span>}
                <span className="task-meta">
                  {t.owner_role} · {t.status} · due {t.due_date}
                </span>
              </div>
            </li>
          ))}
          {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
        </ul>
      )}

      {showScheduler ? (
        <ScheduleTaskForm
          onboardingId={onboarding.id}
          onCancel={() => setShowScheduler(false)}
          onScheduled={() => {
            setShowScheduler(false);
            void loadTasks();
            onTaskScheduled();
          }}
        />
      ) : (
        <button className="btn-primary" onClick={() => setShowScheduler(true)}>
          + Schedule task
        </button>
      )}
    </Modal>
  );
}

/** The task scheduler form itself — a one-off task onto a specific
 *  onboarding, outside the template. Kept as its own component so
 *  OnboardingDetailModal doesn't carry form state it only needs while
 *  the scheduler is open. */
function ScheduleTaskForm({
  onboardingId,
  onCancel,
  onScheduled,
}: {
  onboardingId: string;
  onCancel: () => void;
  onScheduled: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ownerRole, setOwnerRole] = useState<'employee' | 'task_owner'>('employee');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [isRequired, setIsRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/onboardings/${onboardingId}/tasks`, {
        method: 'POST',
        body: {
          title,
          dueDate,
          ownerRole,
          priority,
          isRequired,
          completionMode: ownerRole === 'employee' ? 'employee' : 'owner',
        },
      });
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.85rem' }}>
      {error && <p className="error-text">{error}</p>}
      <label>
        Task title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Due date
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
      </label>
      <label>
        Assigned to
        <select value={ownerRole} onChange={(e) => setOwnerRole(e.target.value as 'employee' | 'task_owner')}>
          <option value="employee">Employee</option>
          <option value="task_owner">Task owner</option>
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high')}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
        <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
        Required for completion
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Scheduling…' : 'Schedule task'}
        </button>
      </div>
    </form>
  );
}

/** Digits only, live-filtered as the user types (rather than
 *  validated after the fact) so a pasted or typed letter never makes
 *  it into the field at all. 7–15 digits covers real phone numbers
 *  without hard-coding a country-specific length. */
/** Fixed +91 prefix, same as the login page's mobile+OTP field — the
 *  two must agree on format, since login matches phone_number as
 *  stored (91 + 10 digits). `value`/`onChange` carry just the 10 local
 *  digits; the caller prepends '91' when sending to the API. */
function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <div className="phone-input-group">
        <span className="phone-prefix">+91</span>
        <span className="phone-divider">|</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          pattern="[0-9]{10}"
          title="Phone number must be exactly 10 digits"
          placeholder="9876543210"
          maxLength={10}
          required
        />
      </div>
      {value.length > 0 && value.length < 10 && (
        <span className="field-error">Enter all 10 digits</span>
      )}
    </>
  );
}

function AddJoinerModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [managerName, setManagerName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pre-ticked set comes from document_types.is_default_required
  // rather than being hardcoded here, so changing the defaults is a data
  // change and not a frontend deploy.
  useEffect(() => {
    authedFetch<DocumentType[]>('/joinee-documents/types')
      .then((types) => {
        setDocTypes(types);
        setSelectedDocs(
          new Set(types.filter((t) => t.is_default_required).map((t) => t.id)),
        );
      })
      .catch(() => setDocTypes([]));
  }, [authedFetch]);

  function toggleDoc(id: string) {
    setSelectedDocs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const userRes = await authedFetch<{
        user: { id: string };
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/auth/users', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          personalEmail,
          role: 'employee',
          departmentId,
        },
      });
      await authedFetch('/onboardings', {
        method: 'POST',
        body: {
          userId: userRes.user.id,
          startDate,
          // Both optional — HR often doesn't know the buddy on day one,
          // and can fill either in later from the joinee's profile.
          managerName: managerName || undefined,
          buddyName: buddyName || undefined,
          requiredDocumentTypeIds: selectedDocs.size ? [...selectedDocs] : undefined,
        },
      });
      onCreated({
        loginId: userRes.credentials.joineeId,
        temporaryPassword: userRes.credentials.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add joiner" onClose={onClose} wide>
      {error && <p className="error-text">{error}</p>}
      <form onSubmit={submit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Mobile number
          <PhoneInput value={phoneNumber} onChange={setPhoneNumber} />
        </label>
        <label>
          Personal email
          <input
            type="email"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
            placeholder="arjun@gmail.com"
            required
          />
        </label>
        <span className="field-hint">
          Recorded for the joinee's records. Credentials are handed over below, not emailed.
        </span>
        <label>
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date of joining
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          Manager name <span className="muted">(optional)</span>
          <input
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            placeholder="Can be added later"
          />
        </label>
        <label>
          Buddy name <span className="muted">(optional)</span>
          <input
            value={buddyName}
            onChange={(e) => setBuddyName(e.target.value)}
            placeholder="Can be added later"
          />
        </label>

        <fieldset className="doc-picker">
          <legend>Documents the joinee must upload</legend>
          <div className="doc-picker__grid">
            {docTypes.map((type) => (
              <label
                key={type.id}
                className={`doc-picker__item${selectedDocs.has(type.id) ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.has(type.id)}
                  onChange={() => toggleDoc(type.id)}
                />
                {type.label}
              </label>
            ))}
          </div>
          <span className="field-hint">
            {selectedDocs.size === 0
              ? 'None selected — no upload task will be created.'
              : `${selectedDocs.size} document${selectedDocs.size === 1 ? '' : 's'} selected. These become one "Upload your documents" task.`}
          </span>
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create & show credentials'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Unlike a joiner, a task owner has no onboarding of their own — this
 *  is a single call to /auth/users with role 'task_owner' and nothing
 *  else. Department is optional (CreateUserDto): most task owners
 *  (IT, facilities) support every department, so leaving it unset
 *  scopes them to nothing in particular rather than one department. */
function AddTaskOwnerModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const userRes = await authedFetch<{
        user: { id: string };
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/auth/users', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          role: 'task_owner',
          departmentId: departmentId || undefined,
        },
      });
      onCreated({
        loginId: userRes.credentials.joineeId,
        temporaryPassword: userRes.credentials.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add task owner" onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      <form onSubmit={submit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Phone number
          <PhoneInput value={phoneNumber} onChange={setPhoneNumber} />
        </label>
        <label>
          Department (optional)
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">No specific department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * HR's "click a joinee, see everything" view: the details captured at
 * creation, the documents they uploaded (previewable inline), and their
 * tasks split into outstanding and done.
 *
 * One request to /employee-profile/:id assembles all three server-side,
 * so this doesn't fan out into a request per section.
 */
function EmployeeProfileModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingAssignments, setEditingAssignments] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [credentials, setCredentials] = useState<CredentialSummary | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<EmployeeProfile>(`/employee-profile/${userId}`)
      .then((p) => {
        setProfile(p);
        setManagerName(p.onboarding?.manager_name ?? '');
        setBuddyName(p.onboarding?.buddy_name ?? '');
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
      // Empty string is meaningful here — it clears the field, rather
      // than leaving it untouched the way omitting the key does.
      await authedFetch(`/onboardings/${profile.onboarding.id}/assignments`, {
        method: 'PATCH',
        body: { managerName, buddyName },
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

  async function review(uploadId: string, decision: 'approved' | 'rejected') {
    setReviewing(uploadId);
    setError(null);
    try {
      const note =
        decision === 'rejected'
          ? window.prompt('Why is this being rejected? The joinee will see this.')
          : undefined;
      // A rejection with no reason is refused by the API (and by a CHECK
      // constraint underneath it), so don't send one.
      if (decision === 'rejected' && !note) return;
      await authedFetch(`/joinee-documents/uploads/${uploadId}/review`, {
        method: 'POST',
        body: { decision, ...(note ? { note } : {}) },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review');
    } finally {
      setReviewing(null);
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

  return (
    <Modal title={user.full_name} onClose={onClose} wide>
      {error && <p className="error-text">{error}</p>}

      <section className="profile-section">
        <h3>Details</h3>
        <dl className="profile-grid">
          <div>
            <dt>Joinee ID</dt>
            <dd>
              <code>{user.joinee_id}</code>
            </dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>{user.phone_number}</dd>
          </div>
          <div>
            <dt>Personal email</dt>
            <dd>{user.personal_email ?? <span className="muted">Not recorded</span>}</dd>
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
          <h3>
            Manager &amp; buddy{' '}
            {!editingAssignments && (
              <button type="button" onClick={() => setEditingAssignments(true)}>
                Edit
              </button>
            )}
          </h3>
          {editingAssignments ? (
            <form onSubmit={saveAssignments}>
              <label>
                Manager name
                <input
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  placeholder="Leave blank to clear"
                />
              </label>
              <label>
                Buddy name
                <input
                  value={buddyName}
                  onChange={(e) => setBuddyName(e.target.value)}
                  placeholder="Leave blank to clear"
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditingAssignments(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={savingAssignments}>
                  {savingAssignments ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="profile-grid">
              <div>
                <dt>Manager</dt>
                <dd>{onboarding.manager_name ?? <span className="muted">Not assigned yet</span>}</dd>
              </div>
              <div>
                <dt>Buddy</dt>
                <dd>{onboarding.buddy_name ?? <span className="muted">Not assigned yet</span>}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      <section className="profile-section">
        <h3>Documents ({documents.length})</h3>
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
                    <span className="field-hint">
                      {doc.original_filename} · uploaded {formatDate(doc.uploaded_at)}
                    </span>
                    {doc.review_note && (
                      <span className="field-hint">Rejection note: {doc.review_note}</span>
                    )}
                    <div className="doc-list__actions">
                      {/* The file needs a Bearer token, which a plain
                          <a href> can't attach — openFileInline fetches
                          it and hands the blob to a new tab. */}
                      <button
                        type="button"
                        onClick={() =>
                          openFileInline(
                            `/joinee-documents/uploads/${doc.upload_id}/file`,
                            accessToken,
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
                            onClick={() => review(doc.upload_id!, 'rejected')}
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
        <h3>
          Tasks — {tasks.requiredCompleted}/{tasks.requiredTotal} required done
        </h3>
        <h4 className="muted">Pending ({tasks.pending.length})</h4>
        <ul className="task-list">
          {tasks.pending.map((t) => (
            <li key={t.id}>
              {t.title}
              {t.subtask_count > 0 && (
                <span className="field-hint">
                  {' '}
                  · {t.subtask_completed_count}/{t.subtask_count} steps
                </span>
              )}
              <span className={`status-pill status-${t.status}`}>{t.status}</span>
            </li>
          ))}
          {tasks.pending.length === 0 && <li className="muted">Nothing outstanding.</li>}
        </ul>
        <h4 className="muted">Completed ({tasks.completed.length})</h4>
        <ul className="task-list">
          {tasks.completed.map((t) => (
            <li key={t.id}>
              {t.title}
              {t.subtask_count > 0 && (
                <span className="field-hint">
                  {' '}
                  · {t.subtask_completed_count}/{t.subtask_count} steps
                </span>
              )}
            </li>
          ))}
          {tasks.completed.length === 0 && <li className="muted">Nothing completed yet.</li>}
        </ul>
      </section>

      <section className="profile-section profile-section--creds">
        <h3>Login credentials</h3>
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
    </Modal>
  );
}

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}

function LockedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. an insecure/non-HTTPS
      // context) — fail silently rather than block on it; the value
      // is still shown in plain text right next to this button.
    }
  }

  return (
    <button type="button" onClick={copy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
