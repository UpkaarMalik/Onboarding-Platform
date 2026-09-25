import { useCallback, useEffect, useRef, useState } from 'react';

/** Where onboarding ends and the day job begins. */
export const ANDHUB_URL = 'https://andhub.andpayments.com/home';
/** Seconds on screen before it takes them there by itself. */
const COUNTDOWN_S = 10;

/**
 * The send-off: a full-screen card raised when the mark reaches the end of a
 * finished trail, which reads the onboarding its last rites and then hands
 * the person over to AndHub.
 *
 * It takes over the whole window rather than sitting in the page, because
 * this is the one moment the trail behind it is no longer the thing to look
 * at — and because a countdown that is about to navigate the browser should
 * not be something you can scroll away from and be surprised by.
 *
 * The clock is the only thing here that acts on its own, so it is also the
 * only thing that can be stopped: Escape, the close button, or the backdrop
 * cancels it and leaves the person on the trail. The link goes straight
 * there without waiting.
 */
export default function OnboardingSplash({
  name,
  onDismiss,
}: {
  name: string;
  onDismiss: () => void;
}) {
  const [left, setLeft] = useState(COUNTDOWN_S);
  /** Guards the navigation: a re-render must not be able to fire it twice,
   *  and a dismissal arriving in the same tick must be able to stop it. */
  const goneRef = useRef(false);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const go = useCallback(() => {
    if (goneRef.current) return;
    goneRef.current = true;
    window.location.href = ANDHUB_URL;
  }, []);

  const cancel = useCallback(() => {
    goneRef.current = true;
    onDismiss();
  }, [onDismiss]);

  /* One interval for the whole countdown rather than a timeout per second:
     the number on screen and the moment it navigates then come off the same
     clock and cannot drift apart. */
  useEffect(() => {
    const id = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          go();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [go]);

  /* The link takes focus, so Enter does the expected thing and a screen
     reader lands on the way out rather than on the heading it just read. */
  useEffect(() => {
    linkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [cancel]);

  return (
    <div
      className="splash"
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div className="splash__card">
        {/* The app's own close button — same circle, same turn on hover as
            every modal HR closes. .splash__close only puts it in the corner;
            everything it looks like comes from .modal-close. */}
        <button
          className="modal-close splash__close"
          type="button"
          onClick={cancel}
          aria-label="Stay on my trail"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>

        <span className="splash__eyebrow">Onboarding complete</span>

        <h1 className="splash__title" id="splash-title">
          Congratulations{name ? `, ${name}` : ''}.
        </h1>

        <p className="splash__lede">
          You’ve finished every step of your onboarding. The paperwork is in, the
          accounts are open, the introductions are made — the scaffolding comes
          down and what’s left is the work itself.
        </p>
        <p className="splash__lede splash__lede--quiet">
          Thank you for the care you took getting here. We’re glad you’re with us.
        </p>

        <a className="splash__cta" href={ANDHUB_URL} ref={linkRef} onClick={() => (goneRef.current = true)}>
          Your real journey starts here
          <span className="splash__cta-arrow" aria-hidden="true">→</span>
        </a>

        {/* aria-live off: a number that changes every second would be read
            out ten times. The sentence around it says what is happening
            once, and the link above is the way to act on it. */}
        <p className="splash__count" aria-hidden="true">
          Taking you to AndHub in <strong className="splash__count-num">{left}</strong>
          {left === 1 ? ' second' : ' seconds'}
        </p>
        <span className="splash__track" aria-hidden="true">
          <span className="splash__track-fill" style={{ animationDuration: `${COUNTDOWN_S}s` }} />
        </span>
      </div>
    </div>
  );
}
