import { useEffect, useState } from 'react';
import type { DashboardResponse, PersonRef } from '../types/onboarding';
import { useAuthedFetch } from '../api/useAuthedFetch';

/** Onboarding statuses where the joinee has not reached the checkpoint yet
 *  and so sees the pre-checkpoint article set rather than the public one. */
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
 * The reference rail beside the employee's trail: the department's office
 * guide and a new-to-Mac tip sheet.
 *
 * Sticky, because it is reference material read WHILE working through a
 * task — scrolling the trail to find the pantry article and then scrolling
 * back is exactly the friction that stops people reading it at all.
 *
 * Fetches its own articles rather than taking them as a prop: it is the
 * only thing on the page that needs them, and the path depends on the
 * onboarding's stage, which it already receives.
 */
export default function EmployeeKnowledgeRail({
  onboardingStatus,
  people,
}: {
  onboardingStatus: string;
  /** null while the dashboard is still loading. */
  people: DashboardResponse['people'] | null;
}) {
  const authedFetch = useAuthedFetch();
  const [knowledge, setKnowledge] = useState<{ id: string; title: string; content: string }[]>([]);

  useEffect(() => {
    let live = true;
    // Articles for someone who has not yet reached the checkpoint are a
    // different, narrower set than the public ones everyone sees later.
    const path = PRE_CHECKPOINT_STATUSES.includes(onboardingStatus)
      ? '/knowledge/pre-checkpoint'
      : '/knowledge/public';
    authedFetch<{ data: typeof knowledge }>(path)
      .then((res) => live && setKnowledge(res.data))
      // A rail of reference material is not worth an error state on a page
      // whose job is the trail; it just stays empty.
      .catch(() => live && setKnowledge([]));
    return () => {
      live = false;
    };
  }, [authedFetch, onboardingStatus]);

  return (
    <aside className="employee-rail">
      {people && (
        <section className="employee-rail-block employee-rail-block--people">
          <h2>People</h2>
          <ul className="people-list">
            <PersonLine role="Manager" person={people.manager} />
            <PersonLine role="Buddy" person={people.buddy} />
          </ul>
        </section>
      )}
      {knowledge.length > 0 && (
        <section className="employee-rail-block">
          <h2>Office guide</h2>
          {/* The same tile the old Home page used — one card per article,
              auto-fit means the grid collapses to a single column at the
              rail's width without a second set of rules. */}
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
      )}

      {/* Icons only; the tip itself is a tooltip on hover. Fourteen tips as
          full cards would be longer than the trail beside them, and none of
          them is something you read once and act on — they are a reference
          you dip into. */}
      <section className="employee-rail-block employee-rail-block--tips">
        <h2>New to Mac?</h2>
        <div className="knowledge-emoji-row">
          {MAC_TIPS.map((tip, i) => (
            <div
              key={tip.title}
              className="knowledge-emoji-item"
              style={{ animationDelay: `${i * 0.07}s` }}
              tabIndex={0}
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
    </aside>
  );
}

/** One of the two people HR picked. Initials on the app's amber avatar;
 *  no department tint, because no department is shown. */
function PersonLine({ role, person }: { role: string; person: PersonRef | null }) {
  const initials = person?.full_name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <li className="people-line">
      <span className={`people-avatar${person ? '' : ' is-empty'}`} aria-hidden="true">
        {initials ?? <PersonIcon />}
      </span>
      <span className="people-text">
        <span className="people-role">{role}</span>
        <span className="people-name">{person?.full_name ?? 'Not assigned yet'}</span>
      </span>
    </li>
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
