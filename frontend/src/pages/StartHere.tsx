import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { fireConfetti } from '../lib/confetti';
import type { DashboardResponse } from '../types/onboarding';
import Reveal from '../components/Reveal';
import JourneyTrack from '../components/JourneyTrack';
import AnimatedProgressBar from '../components/AnimatedProgressBar';
import OceanBanner from '../components/OceanBanner';

const PRE_CHECKPOINT_STATUSES = ['pre_onboarding', 'email_provisioned', 'checkpoint_pending'];

const JOURNEY_STAGES = [
  { key: 'pre_onboarding', label: 'Pre-joining' },
  { key: 'email_provisioned', label: 'Email' },
  { key: 'checkpoint_pending', label: 'Checkpoint' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

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
  const [entrancePhase, setEntrancePhase] = useState<'greeting' | 'dashboard'>('greeting');
  const [timeOfDay, setTimeOfDay] = useState<number | null>(null);
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

      const diaryRes = await authedFetch<any[]>('/diary');
      setDiary(diaryRes);
      const today = new Date().toISOString().slice(0, 10);
      const todayEntry = diaryRes.find((d) => d.entry_date === today);
      setDiaryDraft(todayEntry?.content ?? '');
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
    entranceTimer.current = setTimeout(() => setEntrancePhase('dashboard'), 1400);
    return () => clearTimeout(entranceTimer.current);
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

  async function saveDiaryEntry(e: FormEvent) {
    e.preventDefault();
    if (!diaryDraft.trim()) return;
    setSavingDiary(true);
    try {
      await authedFetch('/diary', { method: 'POST', body: { content: diaryDraft } });
      await loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSavingDiary(false);
    }
  }

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
        <OceanBanner height={220} timeOfDay={timeOfDay ?? undefined} />
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', flexDirection: 'column', padding: '20px 36px', pointerEvents: 'none' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 'auto' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.9)', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, padding: '3px 10px', letterSpacing: '0.5px' }}>
              {user?.role === 'superadmin_hr' ? 'HR / SuperAdmin' : user?.role === 'task_owner' ? 'Task Owner' : 'Employee'}
            </span>
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 34, fontWeight: 800, color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.3)' }}>
            {greeting()}, <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600 }}>{firstName}</span>
          </h1>
        </div>
      </div>

      {/* Time-of-day slider */}
      <div style={{ margin: '12px 0 0', background: '#fff', border: '1px solid #e8e4dc', borderRadius: 12, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, whiteSpace: 'nowrap' }}>DAWN</span>
        <input
          type="range" min="0" max="1000"
          value={Math.round((timeOfDay ?? (new Date().getHours() + new Date().getMinutes() / 60) / 24) * 1000)}
          onChange={e => setTimeOfDay(parseInt(e.target.value) / 1000)}
          style={{ flex: 1, height: 4, borderRadius: 4, background: 'linear-gradient(90deg, #3a4a8a 0%, #6fa8d4 25%, #ffd27f 55%, #ff7e54 78%, #1a2244 100%)', outline: 'none', cursor: 'grab', WebkitAppearance: 'none', appearance: 'none' as never }}
        />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 1, whiteSpace: 'nowrap' }}>NIGHT</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#e8930c', minWidth: 44, textAlign: 'center' }}>
          {(() => { const t = timeOfDay ?? (new Date().getHours() + new Date().getMinutes() / 60) / 24; const h = Math.floor(t * 24) % 24; const m = Math.floor((t * 24 % 1) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; })()}
        </span>
      </div>

      {/* Description */}
      <p style={{ margin: '10px 0 0', fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontSize: 15, color: '#6f6a62', lineHeight: 1.6 }}>
        Welcome to AND Payments — your personalised onboarding journey starts here. Track progress &amp; explore all features right from this page.
      </p>
      <div className="greeting-banner warm-banner">
        <div className="warm-banner-badge">
          <span className="warm-banner-dot" />
          AND Onboard
        </div>
        <span className="eyebrow">
          {dashboard.progress.requiredCompleted} of {dashboard.progress.requiredTotal} steps done
        </span>
        <h1>
          {greeting()}, {firstName} 👋
        </h1>
        <p className="warm-banner-desc">
          Welcome to AND Payments — your personalised onboarding journey starts here.
        </p>
        {dashboard.onboarding.status === 'completed' ? (
          <p className="onboarding-complete-banner">
            🎉 You've completed your onboarding — welcome aboard for real!
          </p>
        ) : (
          <p>Your onboarding is {dashboard.progress.percent}% complete — here's what's next.</p>
        )}
        <AnimatedProgressBar percent={dashboard.progress.percent} />
        <JourneyTrack stages={JOURNEY_STAGES} currentKey={dashboard.onboarding.status} />
      </div>

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
          <div className="knowledge-grid">
            {MAC_TIPS.map((tip, i) => (
              <div
                key={tip.title}
                className="knowledge-card card card-hover"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <span className="knowledge-icon">{tip.icon}</span>
                <div>
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
      </div>{/* end entrance-body */}
    </div>
  );
}
