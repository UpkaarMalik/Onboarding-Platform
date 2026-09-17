import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { greeting, todayIso } from '../lib/format';
import { ApiError } from '../api/client';
import { fireConfetti } from '../lib/confetti';
import { JOURNEY_STAGES } from '../lib/journey';
import type { DashboardResponse } from '../types/onboarding';
import Reveal from '../components/Reveal';
import JourneyTrack from '../components/JourneyTrack';
import AnimatedProgressBar from '../components/AnimatedProgressBar';
import OceanBanner from '../components/OceanBanner';

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
 * The "Start Here" guided flow — everything a new employee needs on
 * one page: a greeting banner with live progress, the single most
 * urgent task surfaced up front ("do this first"), a step-by-step
 * view of the whole onboarding journey, today's due tasks, and
 * pre-checkpoint knowledge/notes/quick-links below. Clicking any task
 * opens it in a popup rather than acting on the row directly, so
 * there's always a moment to see the full detail before confirming.
 */
let hasPlayedEntrance = false;

export default function StartHere() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState('');
  const [diary, setDiary] = useState<any[]>([]);
  const [diaryDraft, setDiaryDraft] = useState('');
  const [savingDiary, setSavingDiary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingSaved, setRatingSaved] = useState(false);
  const [entrancePhase, setEntrancePhase] = useState<'greeting' | 'dashboard'>(hasPlayedEntrance ? 'dashboard' : 'greeting');
  const [timeOfDay, setTimeOfDay] = useState<number | null>(null);
  const [clockOpen, setClockOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const entranceTimer = useRef<ReturnType<typeof setTimeout>>();
  const hasCelebratedCompletionRef = useRef(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const dash = await authedFetch<DashboardResponse>('/onboardings/me');
      setDashboard(dash);
      setRatingComment(dash.onboarding.experience_comment ?? '');

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

      const notesRes = await authedFetch<{ data: any[] }>('/notes');
      setNotes(notesRes.data);

      // PARKED-FEATURE: diary. This shares the try block with the
      // dashboard, knowledge and notes loads, so leaving it in place
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

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasPlayedEntrance) return;
    entranceTimer.current = setTimeout(() => {
      setEntrancePhase('dashboard');
      hasPlayedEntrance = true;
    }, 1400);
    return () => clearTimeout(entranceTimer.current);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
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

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!newNote.trim()) return;
    try {
      await authedFetch('/notes', { method: 'POST', body: { content: newNote } });
      setNewNote('');
      await loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

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

  async function submitRating(rating: number) {
    setSubmittingRating(true);
    setRatingSaved(false);
    try {
      await authedFetch('/onboardings/me/rating', {
        method: 'POST',
        body: { rating, comment: ratingComment.trim() || undefined },
      });
      setRatingSaved(true);
      await loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmittingRating(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error-text">{error}</p>;
  if (!dashboard) return null;

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="start-here">
      {/* Entrance animation: greeting first, then dashboard slides in */}
      <div className={`entrance-greeting${entrancePhase === 'dashboard' ? ' entrance-greeting--up' : ''}`}>
        <h1 className="entrance-hello">{greeting()}, {firstName} 👋</h1>
        <p className="entrance-sub">Let's pick up where you left off</p>
      </div>

      <div className={`entrance-body${entrancePhase === 'dashboard' ? ' entrance-body--visible' : ''}`}>
      {/* Ocean banner with overlay */}
      <div style={{ margin: '0 0 0', borderRadius: 20, overflow: 'hidden', position: 'relative', height: 220 }}>
        <OceanBanner height={220} timeOfDay={timeOfDay ?? (now.getHours() + now.getMinutes() / 60) / 24} />
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', padding: '20px 36px', pointerEvents: 'none' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 'auto' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '3px 10px', letterSpacing: '0.5px' }}>
              {user?.role === 'superadmin_hr' ? 'HR / SuperAdmin' : user?.role === 'task_owner' ? 'Task Owner' : 'Employee'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <h1 style={{ margin: '0 0 6px', fontSize: 34, fontWeight: 800, color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.3)' }}>
              {greeting()}, <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600 }}>{firstName}</span>
            </h1>
            <Link to="/tasks" style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: 14, fontWeight: 700, color: '#fff', background: 'var(--gradient-accent)', border: 'none', borderRadius: 12, textDecoration: 'none', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(232,147,12,0.35)', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', flexShrink: 0, marginBottom: 6 }}>
              {dashboard.steps.some(s => s.system_key === 'document_upload' && s.status === 'completed') ? 'My Tasks ✓' : 'Start Here →'}
            </Link>
          </div>
        </div>
        {/* Frosted glass time card */}
        <div className="hr-hero-clock">
          <div className="hr-time-card" onClick={() => setClockOpen(!clockOpen)}>
            <span className="hr-time-card-icon">{(() => { const t = timeOfDay ?? (now.getHours() + now.getMinutes() / 60) / 24; return t < 0.25 || t >= 0.83 ? '🌙' : t < 0.5 ? '☀️' : '🌤️'; })()}</span>
            <span className="hr-time-card-value">
              {(() => { const t = timeOfDay ?? (now.getHours() + now.getMinutes() / 60) / 24; const h = Math.floor(t * 24) % 24; const m = Math.floor((t * 24 % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; })()}
            </span>
            {clockOpen && (
              <div className="hr-time-card-slider" onClick={e => e.stopPropagation()}>
                <span>DAWN</span>
                <input
                  type="range" min="0" max="1000"
                  value={Math.round((timeOfDay ?? (now.getHours() + now.getMinutes() / 60) / 24) * 1000)}
                  onChange={e => setTimeOfDay(parseInt(e.target.value) / 1000)}
                  aria-label="Time of day"
                />
                <span>NIGHT</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="hr-lede" style={{ marginTop: '1.25rem' }}>
        <span className="hr-lede-bullet" aria-hidden="true" />
        <span className="hr-lede-text">
          Welcome to AND Payments — your personalised onboarding journey
          <span className="hr-lede-amp"> &amp; </span>
          everything you need <span className="hr-lede-here">starts right here.</span>
        </span>
      </p>

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
            <a
              className="quick-access-tile"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById('notes-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              href="#notes-section"
            >
              <span className="qa-icon">📝</span>
              My Notes
            </a>
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
            */}
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
      </div>{/* end entrance-body */}
    </div>
  );
}
