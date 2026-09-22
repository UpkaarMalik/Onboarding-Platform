import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, describeError, openFileInline } from '../api/client';
import { formatDate, todayIso, daysAgoIso, greeting } from '../lib/format';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import LoadError from '../components/LoadError';
import EmployeeProfileModal from '../components/EmployeeProfileModal';
import CopyButton from '../components/CopyButton';
import HrOverview, { CreateJoineeWizard, CustomSelect, type RosterFilter } from './HrOverview';
import { ROSTER_PARAMS } from '../lib/rosterQuery';
import { deptArt } from '../lib/deptArt';
import badgeLanyard from '../assets/badge-lanyard.png';
import PageHero from '../components/ui/PageHero';
import ActivityFeed from '../components/ActivityFeed';
import DepartmentDonut from '../components/DepartmentDonut';
import { deptLightClass, deptSlots, type DeptSlots } from '../lib/deptColor';

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

interface TaskBlocker {
  id: string;
  reason: string;
  owner_role: string;
  waiting_since: string;
  expected_at: string | null;
}

interface ProfileTask {
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


const isoDaysAgo = daysAgoIso;



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
  /* The real number of joinees, straight from the API's `total`. The list
     beside it is capped at limit=100 and is only ever used for the filters
     and the drill-downs, never for a headline figure. */
  const [totalJoiners, setTotalJoiners] = useState<number | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
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
  /** The greeting's live line. null = the server has not answered yet, which
   *  is a different thing from zero and renders differently. */
  const [summary, setSummary] = useState<{ upcoming: number; blocked: number } | null>(
    null,
  );
  /* The cards scroll the roster into view rather than opening a panel that
     shoves it down the page with no warning. */
  const rosterRef = useRef<HTMLDivElement>(null);
  /* One slot map per page, from the full department list, so the cards below
     and the donut agree with each other and with the roster. */
  const slots = useMemo(() => deptSlots(departments), [departments]);
  /* Joined into one string so the effect below has a primitive to compare:
     a fresh URLSearchParams object every render would re-fire it forever. */
  const [searchParams] = useSearchParams();
  const rosterQuery = ROSTER_PARAMS.map((k) => searchParams.get(k) ?? '').join('\u0000');

  useEffect(() => {
    authedFetch<Department[]>('/departments')
      .then(setDepartments)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOverview() {
    setOverviewBusy(true);
    try {
      const [all, stuck, rating] = await Promise.all([
        authedFetch<{ data: any[]; total: number }>('/onboardings?limit=100'),
        authedFetch<{ data: any[]; total: number }>('/onboardings/stuck?limit=50'),
        authedFetch<{ average: number | null; count: number }>('/onboardings/ratings/summary'),
      ]);
      setOverviewRows(all.data);
      // `total` is the count the query found, not the length of the page it
      // returned — see paginateRows in the backend. Reading rows.length here
      // was the bug: correct while the org fits in one page of 100, and
      // silently frozen at 100 forever after.
      setTotalJoiners(all.total);
      setStuckTotal(stuck.total);
      setAttention(stuck.data);
      setRatingSummary(rating);
      setOverviewError(null);
    } catch (err) {
      // Not swallowed. An empty catch here rendered a dashboard of zeros
      // that was indistinguishable from a real org with no joinees, so the
      // one state the reader most needed to act on was the one state the
      // page could not express.
      setOverviewError(describeError(err));
    } finally {
      setOverviewBusy(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  /**
   * The greeting summary, counted by the server and polled.
   *
   * It used to be derived here from overviewRows and the stuck feed. Both are
   * capped lists — limit=100 and limit=50 — so the counts silently stopped
   * being true past those sizes, and "blocked" could only ever mean what the
   * stuck feed happened to have fetched. A COUNT has no page size.
   *
   * ponytail: 30s polling, paused while the tab is hidden and refreshed the
   * moment it comes back, so a backgrounded dashboard costs nothing. Two
   * integers per query — cheaper than the limit=100 fetch this page already
   * issues. If "the instant it happens" ever replaces "without pressing
   * reload", this is the one thing to swap for SSE.
   */
  const loadSummary = useCallback(() => {
    if (document.hidden) return;
    authedFetch<{ upcoming: number; blocked: number }>('/onboardings/summary')
      .then((next) => {
        setSummary(next);
        setSummaryError(null);
      })
      // A poll that fails keeps the last good numbers rather than blanking
      // the greeting — but it says so, because a figure that has quietly
      // stopped updating is worse than one that admits it.
      .catch((err) => setSummaryError(describeError(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSummary();
    const id = window.setInterval(loadSummary, 30_000);
    document.addEventListener('visibilitychange', loadSummary);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', loadSummary);
    };
  }, [loadSummary]);

  function refreshEverything() {
    void loadOverview();
    loadSummary();
    setRosterReload((n) => n + 1);
  }

  const today = todayIso();

  /* The four home cards. "Joiners" counts every onboarding on record;
     "recently joined" is a start date inside the trailing 15 days (today
     included), which is the window HR treats as still-settling-in; "email
     issued" takes the provisioned address when there is one and falls back to
     the stage, because rows created before the provision flow existed carry a
     later status with no address recorded against them. */

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
      value: totalJoiners ?? 0,
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

  /* The nav's search narrows the roster further down this page, so searching
     brings it into view — a filter applied to a list below the fold looks
     like nothing happened. Same rule as the cards below: only move the page
     when the roster is actually off-screen, so later keystrokes do not
     re-scroll a list you are already reading. */
  useEffect(() => {
    if (!rosterQuery.replace(/\u0000/g, '')) return;
    const el = rosterRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.75 || top < 0) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [rosterQuery]);

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

  return (
    <div className="hr-dashboard">
      <PageHero
        title={
          <>
            {greeting()}, <em>{user?.full_name?.split(' ')[0] ?? 'there'}</em>
          </>
        }
        summary={
          /* aria-live so a change reaching a screen reader does not depend on
             the user happening to be on this line when it polls. */
          <span className="page-hero-status" aria-live="polite">
            {summary === null ? (
              /* Nothing at all until the server answers, rather than a
                 placeholder. The line keeps its height from the paragraph's
                 own line-height, so the hero does not resize when the
                 numbers land — and a wrong-looking "0" never flashes. */
              summaryError ? (
                <span className="muted">Could not load counts — {summaryError}</span>
              ) : (
                // Two blank lines, because the loaded state is two lines. One
                // would let the hero grow under the reader as the numbers
                // land, which is the jump this placeholder exists to avoid.
                <>
                  <span>{'\u00a0'}</span>
                  <span>{'\u00a0'}</span>
                </>
              )
            ) : (
              <>
                <span>{plural(summary.upcoming, 'upcoming onboarding')}</span>
                {/* The blocker state gets its own line and always states
                    itself, including when there is nothing wrong. "No
                    blockers" read affirmatively is worth more than the
                    absence of a warning, which is indistinguishable from the
                    line having failed to load.

                    The dot is a second channel, never the only one: the words
                    beside it already say which state this is, so nothing is
                    carried by colour alone. */}
                <span
                  className={`hero-status${summary.blocked > 0 ? ' hero-status--warn' : ''}`}
                >
                  <span className="hero-status-dot" aria-hidden="true" />
                  {summary.blocked > 0
                    ? `${plural(summary.blocked, 'joinee')} blocked`
                    : 'No blockers'}
                </span>
                {/* Last good numbers, but honest that they have stopped
                    moving — a frozen figure with no mark is worse than one
                    that admits it. */}
                {summaryError && <span className="muted">Not updating — {summaryError}</span>}
              </>
            )}
          </span>
        }
        action={
          <button type="button" className="page-hero-cta" onClick={() => setShowAddJoiner(true)}>
            + Create New Joinee
          </button>
        }
      />

      {error && <p className="error-text">{error}</p>}

      <Reveal>
        {/* Upcoming joinees on the left, the department split on the right.
            Each column owns its heading so the two baselines line up, and the
            grid stretches them to equal height. */}
        <div className="home-panels">
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
              <EventsRail rows={pipelineRows} slots={slots} onPick={(id) => setProfileUserId(id)} />
            )}
          </div>

          <div className="home-panel dept-panel">
            <div className="home-section-head">
              <h2>Joinees by department</h2>
            </div>
            {/* Decorative only — empty alt and aria-hidden, so it is not
                announced and adds nothing for anyone navigating by screen
                reader. The chart below carries the actual information. */}
            <img className="dept-panel-art" src={badgeLanyard} alt="" aria-hidden="true" />
            {/* Counted from the same rows the cards and the roster use, so the
                three can never disagree. */}
            <DepartmentDonut rows={overviewRows} slots={slots} />
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        {/* The four numbers, on one line under the two panels above. */}
        <div className="home-panels home-panels--wide">
          <div className="home-panel">
            <div className="home-section-head">
              <h2>At a glance</h2>
            </div>
            {/* The numbers are REPLACED, not decorated. A warning banner above
                a row of zeros still reads as "this org has no joinees" at a
                glance, which is the exact misreading this ticket is about. */}
            {overviewError ? (
              <LoadError
                message={overviewError}
                busy={overviewBusy}
                onRetry={() => void loadOverview()}
              />
            ) : (
            <div className="home-cards home-cards--row">
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
            )}
          </div>
        </div>
      </Reveal>

      {/* The roster IS the cards' drill-down: picking one narrows this list
          and scrolls to it, instead of opening a second list above it. */}
      <div ref={rosterRef} className="home-roster-row">
        <HrOverview
          embedded
          reloadKey={rosterReload}
          cardFilter={rosterFilter}
          onClearCardFilter={() => setActiveStatFilter(null)}
        />
        {/* Same data as /audit-log, six rows of it — HR shouldn't have to
            open another page to see whether anything moved today. */}
        <ActivityFeed />
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
 * The upcoming joinees, as an endless coverflow.
 *
 * The card at the front is full size and fully lit; its neighbours sit
 * further back, smaller and faded; anything beyond them is invisible. On a
 * timer the whole row slides one place, so every joinee takes a turn at the
 * front, and it never reaches an end — the offsets are computed modulo the
 * list, so card 0 is one place after the last one.
 *
 * This is a transform carousel rather than the scroll container it replaced.
 * A scroller could not do either half of the brief: it has real ends, so
 * "infinite" meant a visible jump back, and scaling the middle card means
 * styling by distance from the centre, which a scroll position does not give
 * you. Here each card's offset from the front IS its style, so the two fall
 * out of the same number — and the buttons just change that number, which is
 * why neither of them is ever disabled.
 *
 * Hover and focus stop the timer (you cannot click a moving target) and
 * `prefers-reduced-motion` stops it entirely, leaving a readable row.
 */
function EventsRail({
  rows,
  slots,
  onPick,
}: {
  rows: any[];
  slots: DeptSlots;
  onPick: (userId: string) => void;
}) {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setCalm(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Stay in range if the filter shrinks the list under us.
  useEffect(() => {
    setAt((i) => (i < rows.length ? i : 0));
  }, [rows.length]);

  /* The timer. `at` is in the deps, so a button press also restarts the wait
     instead of being overtaken a moment later. */
  useEffect(() => {
    if (calm || paused || rows.length < 2) return;
    const id = setTimeout(() => setAt((i) => (i + 1) % rows.length), 3400);
    return () => clearTimeout(id);
  }, [at, calm, paused, rows.length]);

  const n = rows.length;
  const go = (delta: number) => setAt((i) => (i + delta + n) % n);

  return (
    <div
      className="home-rail"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="home-rail-stage">
        {rows.map((o, i) => {
          /* Shortest signed distance from the front, so the row wraps in
             whichever direction is nearer and no card ever travels the long
             way round. */
          const raw = (i - at + n) % n;
          const offset = raw > n / 2 ? raw - n : raw;
          const depth = Math.abs(offset);
          const isFront = offset === 0;
          return (
            <button
              key={o.id}
              type="button"
              className={`home-event home-rail-card ${deptLightClass(slots, o.department_id)}`}
              data-depth={Math.min(depth, 3)}
              style={{ ['--offset' as string]: offset }}
              aria-hidden={!isFront || undefined}
              tabIndex={isFront ? 0 : -1}
              onClick={() => (isFront ? onPick(o.user_id) : setAt(i))}
            >
              <EventCardBody row={o} />
            </button>
          );
        })}
      </div>

      {n > 1 && (
        <div className="home-rail-nav">
          <span className="home-rail-count">
            {at + 1} / {n}
          </span>
          {/* Never disabled: the row wraps, so there is always a next and a
              previous card. */}
          <button
            type="button"
            className="home-rail-btn"
            onClick={() => go(-1)}
            aria-label="Previous joinee"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="home-rail-btn"
            onClick={() => go(1)}
            aria-label="Next joinee"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The card face, on four anchors: the illustration fills the upper left, the
 * department sits top right, the joining date bottom left under its own
 * label, and the name bottom right. A grid rather than absolute corners, so
 * nothing can overlap when a long name meets a long department.
 */
function EventCardBody({ row }: { row: any }) {
  return (
    <span className="home-event-text">
      {/* Decoration, so it carries no alt text — the card already says who
          this is and which team in words. Which illustration depends on the
          department (lib/deptArt.ts). */}
      <img className="home-event-art" src={deptArt(row.department_name)} alt="" aria-hidden="true" />
      {row.department_name && <span className="home-event-dept">{row.department_name}</span>}
      {/* One row, not two cells: the department label's column is a fixed
          width, and the name was inheriting it and truncating. */}
      <span className="home-event-foot">
        <span className="home-event-when">
          <small>Date of Joining</small>
          <strong>{formatDate(row.start_date)}</strong>
        </span>
        <strong className="home-event-name">{row.employee_name}</strong>
      </span>
    </span>
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

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}


