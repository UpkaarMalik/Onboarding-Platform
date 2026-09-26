import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandLogo';

/** Where onboarding ends and the day job begins. */
export const ANDHUB_URL = 'https://andhub.andpayments.com/home';
/** Seconds on screen before it takes them there by itself. */
const COUNTDOWN_S = 10;

/**
 * The send-off: a full-screen greeting card raised when the mark reaches the
 * end of a finished trail, which congratulates the person and then hands them
 * over to AndHub.
 *
 * It arrives in an envelope. The flap opens, the card rises out of the
 * pocket, and the envelope drops away — which is the whole reason the card
 * is drawn as stationery rather than as a dialog. The envelope is three
 * panels and a flap, all CSS: back, the card, then the front panel painted
 * OVER it, which is what makes the card look like it is coming out of
 * something rather than sliding across it.
 *
 * It is drawn as a printed card, following the attached reference: a ruled
 * frame inset from the paper edge, a crest at the top, the word itself in
 * script, a divider with a dot in it, three short lines, a rose-coloured
 * line in script again, and a botanical branch down one side. The reference
 * says "Thank you"; this says congratulations, because the person finishing
 * is the one being addressed.
 *
 * Where the reference puts a small heart above the word and another below
 * the message, this puts the AndBoard mark above the word and nothing
 * below. A greeting card is signed by whoever sent it, and this one is from
 * the company rather than from a person — the mark says that, and says it
 * once.
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
      <div className="splash__stage">
        {/* The envelope, in TWO layers with the card between them — that is
            the whole trick, and it has to be two sibling elements rather
            than one. The envelope is animated and transformed, so it forms
            its own stacking context: a z-index on a panel INSIDE it can only
            order it against its siblings in there, never against the card
            outside. Written as one element, the entire envelope painted
            behind the card and the card just slid over the top of it.

            Purely decorative and inert: it is gone within two seconds and
            nothing in it is focusable or readable, so a screen reader is
            told about none of it. */}
        <div className="splash__envelope splash__envelope--back" aria-hidden="true">
          <span className="splash__env-back" />
          <span className="splash__env-flap" />
        </div>

        <div className="splash__card">
        {/* The ruled frame, inset from the paper edge. A pseudo-element
            rather than a border on the card, because the card's own edge is
            the paper and this line sits inside it. */}
        <span className="splash__frame" aria-hidden="true" />
        <Branch />

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

        <div className="splash__inner">
          {/* The sender's mark, where the reference has its heart. */}
          <BrandMark className="splash__mark" />

          <h1 className="splash__script" id="splash-title">
            Congratulations
            {name && <span className="splash__script-name">{name}</span>}
          </h1>

          {/* The reference's divider: a rule broken by a single dot. */}
          <span className="splash__rule" aria-hidden="true">
            <i />
          </span>

          {/* The reference's cadence — "For your kindness, / your support,
              and / your thoughtfulness." — with the line breaks authored
              here because the shape of the block is part of the design.
              Addressed to the person rather than listing system state: it
              used to read "Every document signed, every account open", which
              is an inventory of what the database now contains. What they
              actually did is file things, set things up, and meet people. */}
          <p className="splash__note">
            For the forms you filed,
            <br />
            the tools you set up,
            <br />
            and the people you met.
          </p>

          <p className="splash__flourish">We’re so glad you’re here.</p>

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

        {/* The pocket, after the card in the DOM so it paints over it. */}
        <div className="splash__envelope splash__envelope--front" aria-hidden="true">
          <span className="splash__env-front" />
        </div>
      </div>
    </div>
  );
}

/** The botanical branch down the right edge.
 *
 *  Drawn rather than shipped as an image: at one accent colour and a dozen
 *  leaves it is a few hundred bytes of markup, it stays crisp at any size,
 *  and the leaf tint follows the card's own palette instead of being baked
 *  into a PNG. Leaves alternate down a single curved stem, shrinking toward
 *  the tip, which is what makes it read as a sprig rather than a pattern. */
function Branch() {
  const leaves: Array<[number, number, number, number]> = [
    // x, y (on the stem), rotation, scale
    [134, 356, -66, 1.5],
    [126, 330, 68, 1.42],
    [117, 296, -64, 1.34],
    [110, 262, 66, 1.24],
    [104, 226, -62, 1.14],
    [100, 190, 64, 1.03],
    [98, 154, -60, 0.92],
    [98, 120, 62, 0.8],
    [102, 88, -57, 0.68],
    [106, 58, 59, 0.56],
    [110, 32, 6, 0.48],
  ];
  return (
    /* The clip is what lets the branch run off the paper without the card
       growing a scrollbar. The card keeps `overflow: auto` as its last
       resort for genuinely over-long content; an absolutely positioned
       decoration hanging past its edge would otherwise be counted as
       content, and the card scrolled on a full-height screen with nothing
       actually cut off. The reference's leaves are cut by the paper edge
       too, so clipping is also the right look. */
    <span className="splash__branch-clip" aria-hidden="true">
      <svg className="splash__branch" viewBox="0 0 200 400">
        <path
          className="splash__stem"
          d="M148 400C138 372 128 340 120 306 110 264 102 222 99 180 96 138 100 94 110 36"
          fill="none"
        />
        {leaves.map(([x, y, r, s], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
            <path
              className={`splash__leaf${i % 2 ? ' splash__leaf--pale' : ''}`}
              d="M0 0C15-13 17-33 0-48-17-33-15-13 0 0Z"
            />
            <path className="splash__leaf-rib" d="M0 0 0-46" fill="none" />
          </g>
        ))}
      </svg>
    </span>
  );
}
