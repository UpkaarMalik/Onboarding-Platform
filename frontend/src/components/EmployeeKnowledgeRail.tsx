import { useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import MacBookCard from './MacBookCard';

/** Onboarding statuses where the joinee has not reached the checkpoint yet
 *  and so sees the pre-checkpoint article set rather than the public one. */
const PRE_CHECKPOINT_STATUSES = ['pre_onboarding', 'email_provisioned', 'checkpoint_pending'];


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

/** A short, plainly-worded heading for the rail.
 *
 *  The articles' own titles are written for a page that shows the body
 *  text with them ("Pantry, water & washrooms"). In the rail the body is
 *  hidden until you hover, so the heading is all there is to go on and it
 *  has to fit one line. Cosmetic, and display-only — the article keeps
 *  its real title everywhere else. Anything unrecognised falls through
 *  unchanged, so a new article is never mislabelled, only unshortened. */
function knowledgeHeading(title: string) {
  const t = title.toLowerCase();
  if (t.includes('pantry') || t.includes('water') || t.includes('washroom')) return 'Pantry & washrooms';
  if (t.includes('lunch') || t.includes('meal') || t.includes('food')) return 'Lunch time';
  if (t.includes('recreation') || t.includes('sport') || t.includes('game')) return 'Games & recreation';
  if (t.includes('parking') || t.includes('transport') || t.includes('commute')) return 'Getting here';
  if (t.includes('wifi') || t.includes('it ') || t.includes('laptop')) return 'Wi-Fi & IT';
  if (t.includes('dress') || t.includes('attire')) return 'What to wear';
  if (t.includes('security') || t.includes('badge') || t.includes('access')) return 'Badge & access';
  return title;
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
}: {
  onboardingStatus: string;
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
      {knowledge.length > 0 && (
        <section className="employee-rail-block employee-rail-block--guide">
          <h2>Office guide</h2>
          {/* Heading only, with the body on hover. Shown together they
              did not fit: the rail is a quarter of the page, the block's
              height moves as the hero above it condenses on scroll, and
              the paragraphs were being cut mid-sentence at whatever
              height was left. A heading always fits. */}
          <div className="knowledge-grid">
            {knowledge.map((k, i) => (
              <div
                key={k.id}
                className="knowledge-card card card-hover"
                style={{ animationDelay: `${i * 0.07}s` }}
              >
                <span className="knowledge-icon">{knowledgeIcon(k.title)}</span>
                <div className="knowledge-card__body">
                  <strong title={k.title}>{knowledgeHeading(k.title)}</strong>
                  <p>{k.content}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The tips themselves live on the Mac Tools page now. What's left
          here is the way in: a laptop that says what it is on hover and
          opens that page. The icon row it replaces put every tip behind a
          hover tooltip, which no keyboard or touch user could reach. */}
      <section className="employee-rail-block employee-rail-block--tips">
        <MacBookCard />
      </section>
    </aside>
  );
}

