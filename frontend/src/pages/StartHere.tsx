import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import PageHero from '../components/ui/PageHero';
import { greeting, todayIso } from '../lib/format';
import { ApiError } from '../api/client';
import { fireConfetti } from '../lib/confetti';
import { JOURNEY_STAGES } from '../lib/journey';
import type { DashboardResponse } from '../types/onboarding';
import Reveal from '../components/Reveal';
import JourneyTrack from '../components/JourneyTrack';
import AnimatedProgressBar from '../components/AnimatedProgressBar';

const PRE_CHECKPOINT_STATUSES = ['pre_onboarding', 'email_provisioned', 'checkpoint_pending'];


/** A new-to-Mac tip sheet — separate from the pre-checkpoint knowledge
 *  articles (which are department-scoped, come from the backend) since
 *  this applies to literally everyone regardless of onboarding stage
 *  and has nothing to do with department content. */
const MAC_TIPS = [
  { icon: '🔍', title: 'Spotlight search', content: 'Press Cmd+Space to instantly launch apps, find files, or do quick math — faster than digging through Finder.' },
  { icon: '🪟', title: 'Mission Control', content: 'Swipe up with three fingers (or press Control+Up) to see every open window and virtual desktop at once.' },
  { icon: '📋', title: 'Universal clipboard tricks', content: 'Cmd+C / Cmd+V work everywhere, and Cmd+Shift+4 grabs a screenshot of just the area you drag over.' },
  { icon: '🖱️', title: 'Trackpad gestures', content: 'Pinch to zoom, two-finger swipe to go back/forward in a browser, and a three-finger drag to move windows around.' },
  { icon: '🔒', title: 'Lock it fast', content: 'Cmd+Control+Q locks your screen instantly — good habit for the pantry coffee run.' },
  { icon: '🗂️', title: 'Quick Look', content: 'Select any file and hit Space to preview it without opening an app — works on PDFs, images, and more.' },
  { icon: '🛑', title: 'Force quit a frozen app', content: 'Cmd+Option+Esc opens the Force Quit window — pick the stuck app and end it without restarting your Mac.' },
  { icon: '😀', title: 'Emoji & symbols', content: 'Cmd+Control+Space opens the emoji picker from anywhere you can type, including Slack and email.' },
  { icon: '🪄', title: 'Split View', content: 'Hold the green full-screen button on any window to snap it to one side of the screen, then pick a second app for the other side.' },
  { icon: '📤', title: 'AirDrop', content: 'Share a file to a nearby colleague\'s Mac or iPhone instantly from the Share menu — no cable, no email needed.' },
  { icon: '🌗', title: 'Dark mode', content: 'System Settings → Appearance switches the whole OS to dark mode, or set it to change automatically at sunset.' },
  { icon: '📝', title: 'Quick Note', content: 'Swipe up from the bottom-right corner of the trackpad (or Fn+Q) to jot a note without opening an app.' },
  { icon: '🔠', title: 'Text replacement', content: 'System Settings → Keyboard → Text Replacement lets you type a short snippet (like "eml") that expands into your full company email.' },
  { icon: '🎙️', title: 'Dictation', content: 'Press the Fn key twice to start dictation — useful for drafting a quick Slack message hands-free.' },
];


/** Best-effort icon for a knowledge article by keyword in its title —
 *  purely cosmetic, falls back to a generic pin so an article never
 *  renders with no icon at all. */
function knowledgeIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes('pantry') || t.includes('water') || t.includes('washroom')) return '🚻';
  if (t.includes('lunch') || t.includes('meal') || t.includes('food')) return '🍱';
  if (t.includes('recreation') || t.includes('sport') || t.includes('game')) return '🏓';
  if (t.includes('parking') || t.includes('transport') || t.includes('commute')) return '🚗';
  if (t.includes('wifi') || t.includes('it') || t.includes('laptop')) return '💻';
  if (t.includes('dress') || t.includes('attire')) return '👔';
  if (t.includes('security') || t.includes('badge') || t.includes('access')) return '🪪';
  return '📌';
}

/**
 * PARKED: this page is no longer routed. The employee's Home is the task
 * trail (EmployeeTasks) — see App.tsx. Its office-guide and new-to-Mac
 * sections moved to EmployeeKnowledgeRail, which renders beside the trail;
 * its notes, quick-access and rating sections are commented out below and
 * come back by uncommenting. Kept rather than deleted so none of that has
 * to be rewritten if it is wanted again.
 *
 * The "Start Here" guided flow — everything a new employee needs on
 * one page: a greeting banner with live progress, the single most
 * urgent task surfaced up front ("do this first"), a step-by-step
 * view of the whole onboarding journey, today's due tasks, and
 * pre-checkpoint knowledge/notes/quick-links below. Clicking any task
 * opens it in a popup rather than acting on the row directly, so
 * there's always a moment to see the full detail before confirming.
 */
export default function StartHere() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [diary, setDiary] = useState<any[]>([]);
  const [diaryDraft, setDiaryDraft] = useState('');
  const [savingDiary, setSavingDiary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const hasCelebratedCompletionRef = useRef(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const dash = await authedFetch<DashboardResponse>('/onboardings/me');
      setDashboard(dash);

      // Pre-checkpoint: public + pre_email_auth articles, scoped to
      // this employee's department. Post-checkpoint, pre_email_auth
      // content genuinely stops applying, but the 'public' articles
      // (pantry, lunch, recreation, ...) are just as useful on day 90
      // as day 1 — so those stay up via /knowledge/public rather than
      // clearing the section to nothing once the checkpoint is done.
      const knowledgePath = PRE_CHECKPOINT_STATUSES.includes(dash.onboarding.status)
        ? '/knowledge/pre-checkpoint'
        : '/knowledge/public';
      const knowledgeRes = await authedFetch<{ data: any[] }>(knowledgePath);
      setKnowledge(knowledgeRes.data);

      // PARKED-FEATURE: diary. This shares the try block with the
      // dashboard and knowledge loads, so leaving it in place
      // against an unregistered /diary would 404 and take the whole home
      // page down with it — not just the diary section.
      //
      // const diaryRes = await authedFetch<any[]>('/diary');
      // setDiary(diaryRes);
      // const today = new Date().toISOString().slice(0, 10);
      // const todayEntry = diaryRes.find((d) => d.entry_date === today);
      // setDiaryDraft(todayEntry?.content ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  /**
   * The trail refreshes itself.
   *
   * HR can block a task while the joinee is looking at the page, and the
   * acceptance for this is that they see it without reloading. Nothing here
   * polled before — the page loaded once and stayed as it was.
   *
   * ponytail: 30s, paused while the tab is hidden and re-checked on focus,
   * reusing the loader the page already has. Same pattern and the same
   * ceiling as the HR greeting's counts; SSE is the upgrade if the delay
   * ever matters.
   */
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      void loadAll();
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // A one-time bigger celebration the moment this page sees the
  // onboarding reach 'completed' — whether that happened just now (the
  // last required task got confirmed) or the employee is simply
  // loading a page that was already fully done. Guarded by a ref, not
  // state, so it fires exactly once per visit rather than re-firing on
  // every loadAll() refresh after that.
  useEffect(() => {
    if (dashboard?.onboarding.status === 'completed' && !hasCelebratedCompletionRef.current) {
      hasCelebratedCompletionRef.current = true;
      fireConfetti();
      setTimeout(fireConfetti, 450);
    }
  }, [dashboard?.onboarding.status]);

  // PARKED-FEATURE: diary
  //
  // async function saveDiaryEntry(e: FormEvent) {
  //   e.preventDefault();
  //   if (!diaryDraft.trim()) return;
  //   setSavingDiary(true);
  //   try {
  //     await authedFetch('/diary', { method: 'POST', body: { content: diaryDraft } });
  //     await loadAll();
  //   } catch (err) {
  //     alert(err instanceof ApiError ? err.message : 'Something went wrong');
  //   } finally {
  //     setSavingDiary(false);
  //   }
  // }


  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!dashboard) return null;

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';
  /* "Day 1" is the joining date itself, so +1 — and never below 1, because
     an onboarding created ahead of its start date would otherwise greet the
     joinee with "Day -3". */
  const dayNumber = Math.max(
    1,
    differenceInCalendarDays(new Date(), parseISO(dashboard.onboarding.start_date)) + 1,
  );
  const docsDone = dashboard.steps.some(
    (s) => s.system_key === 'document_upload' && s.status === 'completed',
  );

  return (
    <div className="start-here">
      <PageHero
        title={
          <>
            {greeting()}, <em>{firstName}</em>
          </>
        }
        summary={
          <>
            Day {dayNumber} {'\u00b7'} {dashboard.progress.requiredCompleted} of{' '}
            {dashboard.progress.requiredTotal} steps done
          </>
        }
        action={
          <Link to="/tasks" className="page-hero-cta">
            {docsDone ? 'My tasks' : 'Start here'}
          </Link>
        }
      />

      <div style={{ marginTop: '1.25rem', marginBottom: '1.5rem', padding: '16px 20px', borderRadius: 16, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
        <p style={{ textAlign: 'center', fontSize: '0.95rem', margin: '0 0 10px', lineHeight: 1.6 }}>
          {(() => {
            const pct = dashboard.progress.percent;
            const done = dashboard.progress.requiredCompleted;
            if (pct === 100) return (
              <><span style={{ fontWeight: 600 }}>🎉 Congratulations!</span> Your onboarding is <strong>{pct}%</strong> completed. Welcome aboard for real!</>
            );
            if (pct >= 75) return (
              <><span style={{ fontWeight: 600, color: 'var(--color-success)' }}>Almost there!</span> Your onboarding is <strong>{pct}%</strong> completed. Just a few steps left to wrap up.</>
            );
            if (pct >= 50) return (
              <><span style={{ fontWeight: 600, color: 'var(--color-accent-dark)' }}>Great momentum!</span> Your onboarding is <strong>{pct}%</strong> completed. You're past the halfway mark, keep it going!</>
            );
            if (done >= 2) return (
              <><span style={{ fontWeight: 600, color: 'var(--color-info)' }}>Nice start!</span> Your onboarding is <strong>{pct}%</strong> completed. You're picking up speed!</>
            );
            if (pct > 0) return (
              <><span style={{ fontWeight: 600 }}>You're on your way!</span> Your onboarding is <strong>{pct}%</strong> completed. One step at a time.</>
            );
            return (
              <><span style={{ fontWeight: 600 }}>Your journey starts here.</span> Complete your first task to get the ball rolling.</>
            );
          })()}
        </p>
        <AnimatedProgressBar percent={dashboard.progress.percent} showIndicator />
      </div>

      {/* Quick access — commented out per request
      <Reveal>
        <section>
          <h2>Quick access</h2>
          <div className="quick-access-grid">
            {knowledge.length > 0 && (
              <a
                className="quick-access-tile"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('knowledge-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                href="#knowledge-section"
              >
                <span className="qa-icon">📚</span>
                Knowledge Base
              </a>
            )}
            {/* PARKED-FEATURE: diary, community — quick-access tiles.

            <a
              className="quick-access-tile"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('diary-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              href="#diary-section"
            >
              <span className="qa-icon">📔</span>
              My Diary
            </a>
            <a className="quick-access-tile" href="/community">
              <span className="qa-icon">💬</span>
              Community
            </a>
            
            <a className="quick-access-tile" href="/documents">
              <span className="qa-icon">📄</span>
              Documents
            </a>
            <a
              className="quick-access-tile"
              href="https://andhub.andpayments.com/andone/dashboard"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="qa-icon">🕘</span>
              Office Attendance
            </a>
          </div>
        </section>
      </Reveal>
      */}

{/* Office guide — lives in EmployeeKnowledgeRail beside the trail now.
      {knowledge.length > 0 && (
        <Reveal>
          <section id="knowledge-section">
            <h2>Office guide</h2>
            <div className="knowledge-grid">
              {knowledge.map((k, i) => (
                <div
                  key={k.id}
                  className="knowledge-card card card-hover"
                  style={{ animationDelay: `${i * 0.07}s` }}
                >
                  <span className="knowledge-icon">{knowledgeIcon(k.title)}</span>
                  <div>
                    <strong>{k.title}</strong>
                    <p>{k.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </Reveal>
      )}
      */}

{/* New to Mac — lives in EmployeeKnowledgeRail beside the trail now.
      <Reveal>
        <section>
          <h2>New to Mac? A few tips</h2>
          <div className="knowledge-emoji-row">
            {MAC_TIPS.map((tip, i) => (
              <div
                key={tip.title}
                className="knowledge-emoji-item"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <span className="knowledge-emoji-icon">{tip.icon}</span>
                <div className="knowledge-emoji-tooltip">
                  <strong>{tip.title}</strong>
                  <p>{tip.content}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </Reveal>
      */}

{/* Rate your experience — commented out per request, not required for now.
      <Reveal>
        <section>
          <h2>Rate your experience</h2>
          <p className="muted">
            {dashboard.onboarding.experience_rating
              ? "Thanks for rating — change it any time it doesn't feel right anymore."
              : 'How has onboarding felt so far? This goes to HR as a number only.'}
          </p>
          <div className="star-rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star-btn ${n <= (dashboard.onboarding.experience_rating ?? 0) ? 'filled' : ''}`}
                disabled={submittingRating}
                onClick={() => submitRating(n)}
                aria-label={`Rate ${n} out of 5`}
              >
                ★
              </button>
            ))}
            {ratingSaved && <span className="rating-saved">Saved</span>}
          </div>
          <textarea
            className="rating-comment"
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            onBlur={() => {
              if (dashboard.onboarding.experience_rating) submitRating(dashboard.onboarding.experience_rating);
            }}
            placeholder="Anything you'd add? (optional)"
          />
        </section>
      </Reveal>
      */}

{/* Private notes — commented out per request, not required for now.
      <Reveal>
        <section id="notes-section">
          <h2>Your private notes</h2>
          <p className="muted">
            Only you can see the note content — SuperAdmin can see that notes exist and read the text,
            but never who wrote them.
          </p>
          <form onSubmit={addNote} className="note-form">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Write something only you can see…"
            />
            <button type="submit">Add note</button>
          </form>
          <ul className="notes-list">
            {notes.map((n) => (
              <li key={n.id}>{n.content}</li>
            ))}
          </ul>
        </section>
      </Reveal>
      */}

      {/* PARKED-FEATURE: diary — the home page's diary section.

      <Reveal>
        <section id="diary-section">
          <h2>Your diary</h2>
          <p className="muted">
            A private log of what you got done each day — only you can ever see this, on your own
            dashboard. Newest day first.
          </p>
          <form onSubmit={saveDiaryEntry} className="note-form">
            <textarea
              value={diaryDraft}
              onChange={(e) => setDiaryDraft(e.target.value)}
              placeholder="What did you get done today?"
            />
            <button type="submit" disabled={savingDiary}>
              {savingDiary ? 'Saving…' : "Save today's entry"}
            </button>
          </form>
          <ul className="notes-list diary-list">
            {diary.map((d) => (
              <li key={d.id}>
                <span className="diary-date">{d.entry_date}</span>
                <span>{d.content}</span>
              </li>
            ))}
            {diary.length === 0 && <p className="muted">Nothing logged yet.</p>}
          </ul>
        </section>
      </Reveal>
      */}
    </div>
  );
}
