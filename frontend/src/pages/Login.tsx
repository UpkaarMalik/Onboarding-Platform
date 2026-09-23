import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import PasswordField from '../components/PasswordField';
import illustration from '../assets/login-illustration.png';

interface AuthenticatedResult {
  status: 'authenticated';
  // No accessToken/refreshToken here anymore — the server sets both as
  // HttpOnly cookies before this body is even parsed. `user` is the
  // one thing the frontend needs from the login response.
  user: any;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
}

type PasswordLoginResult =
  | AuthenticatedResult
  | { status: 'password_reset_required'; preAuthToken: string };

/** The reset endpoint deliberately returns no tokens — the user signs in
 *  again with the password they just chose. See
 *  AuthService.completePasswordReset. */
interface PasswordResetComplete {
  status: 'password_reset_complete';
  joineeId: string;
}

type Mode = 'otp' | 'password';

type PasswordStep = { name: 'credentials' } | { name: 'reset'; preAuthToken: string };

type FieldName = 'joineeId' | 'password' | 'newPassword' | null;

/** Minimum the backend will accept — CompletePasswordResetDto uses
 *  @Length(8, 100). Checked here too so the user is told before a round
 *  trip, and in the same place as every other message. */
const MIN_PASSWORD_LENGTH = 8;

/** Mirrors generate_joinee_id() in migration 0015 — `JN-<year>-<seq>`.
 *  Checked here so a partly-typed ID never reaches the server and never
 *  shows a caution the person hasn't earned yet. */
const JOINEE_ID_PATTERN = /^JN-\d{4}-\d{3,}$/;
// OTP-LOGIN-DISABLED
// type OtpStep = { name: 'phone' } | { name: 'verify'; preAuthToken: string };

const QUOTES = [
  { text: 'Banking is necessary, banks are not.', author: 'Bill Gates' },
  { text: 'The future of finance is digital.', author: 'Christine Lagarde' },
  { text: 'Innovation is the calling card of the future.', author: 'Anna Eshoo' },
  { text: 'Fintech is reshaping finance as we know it.', author: 'Sallie Krawcheck' },
  { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
];

const QUOTE_MS = 5600;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The rotating quote. Unchanged in mechanism from the previous design —
 * a soft band inside a gradient that is clipped to the glyphs, so the
 * light crosses letters continuously rather than a word at a time. Only
 * the palette changed: the crest is ink rather than white, because the
 * band now travels over a cream background instead of a navy one.
 */
function LoginQuote() {
  const still = prefersReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % QUOTES.length), QUOTE_MS);
    return () => clearInterval(id);
  }, [still]);

  const quote = QUOTES[idx];

  // Keyed on the quote so React remounts rather than swapping the text
  // in place — that restarts the CSS animation, giving every quote its
  // own pass of the light.
  return (
    <figure className="login-quote" key={quote.author}>
      <blockquote className="login-quote__text">
        <span className="login-quote__mark">“</span>
        {quote.text}
        <span className="login-quote__mark">”</span>
      </blockquote>
      <figcaption className="login-quote__by">
        <span className="login-quote__rule" />
        <cite>{quote.author}</cite>
      </figcaption>
    </figure>
  );
}

/**
 * The hand-drawn furniture around the card: squiggles, outlined circles,
 * dotted panels and the seated figure. Decorative only, so it is hidden
 * from assistive tech and dropped entirely once there is no room for it
 * beside the card.
 */
function LoginScatter() {
  return (
    <div className="login-scatter" aria-hidden="true">
      <span className="login-hr" />

      <svg className="login-doodle login-doodle--squiggleL" width="252" height="70" viewBox="0 0 252 70" fill="none" strokeLinecap="round">
        <path className="login-draw" d="M4 44c18-30 32-30 40-6s18 28 30 6 18-32 30-10 18 26 32 4 18-22 34-6 18 16 34 2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="220" />
      </svg>

      <span className="login-ring login-ring--a" />
      <span className="login-dot" />
      <span className="login-ring login-ring--b" />

      <div className="login-note login-note--left">
        <span className="login-note__line" style={{ width: 90 }} />
        <span className="login-note__line login-note__line--short" style={{ width: 62 }} />
      </div>

      {/* Fills the space the left-hand slab used to hold. Two strokes,
          spaced clear of each other — three crowded into the same box. */}
      <svg className="login-doodle login-doodle--scribbleL" width="196" height="92" viewBox="0 0 196 92" fill="none" strokeLinecap="round">
        <path className="login-draw" d="M4 38c12-22 22-22 30-4s14 20 26 2 14-24 26-6 14 18 28 2 14-16 30-4 12 10 30 3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="220" />
      </svg>

      <div className="login-tile">
        <svg width="58" height="72" viewBox="0 0 58 72" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path className="login-draw" d="M11 65C15 41 25 22 47 9" strokeDasharray="220" />
          <path d="M35 7h13v13" />
        </svg>
      </div>

      <div className="login-note login-note--right">
        <span className="login-note__line" style={{ width: 68 }} />
        <span className="login-note__line login-note__line--short" style={{ width: 46 }} />
      </div>

      <span className="login-ring login-ring--c" />
      <span className="login-ring login-ring--d" />

      <svg className="login-doodle login-doodle--spark" width="34" height="34" viewBox="0 0 34 34" fill="none" strokeWidth="1.6" strokeLinecap="round">
        <path d="M17 3v9M17 22v9M3 17h9M22 17h9" />
      </svg>

      <div className="login-note login-note--up">
        <span className="login-note__line" style={{ width: 58 }} />
        <span className="login-note__line login-note__line--short" style={{ width: 38 }} />
      </div>

      <svg className="login-doodle login-doodle--loop" width="74" height="74" viewBox="0 0 74 74" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {/* A line that winds inward into a spiral. */}
        <path className="login-draw" d="M37 8c16 0 27 12 27 26S52 62 36 62 10 50 10 36s9-20 20-20 17 8 17 17-6 15-13 15-11-5-11-11 4-9 9-9" strokeDasharray="220" />
      </svg>

      <svg className="login-doodle login-doodle--scribbleR" width="104" height="44" viewBox="0 0 104 44" fill="none" strokeLinecap="round">
        <path className="login-draw" d="M3 26c10-18 17-16 21-2s11 16 19 2 11-18 19-4 11 12 20 1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="220" />
      </svg>

      <img className="login-figure" src={illustration} alt="" />
      {/* One two-storey façade. The wall carries its windows as
          positioned background layers; the raised parapet, the string
          course between the storeys and the door are elements, because
          they sit in front of the wall rather than on it. */}
      <div className="login-panel login-panel--peach">
        <span className="login-bldg">
          <span className="login-bldg__top" />
          <span className="login-bldg__band" />
          <span className="login-bldg__door" />
        </span>
      </div>
    </div>
  );
}

/**
 * Joinee ID + password is the only login method.
 *
 * It ends in a real session unless the password on file is still the
 * HR-issued temp one, in which case there is one extra "set a new
 * password" step before the user signs in again.
 *
 * OTP-LOGIN-DISABLED — mobile + OTP used to be a second, entirely
 * independent method alongside this one (request a code, verify it,
 * done; no password anywhere). It is commented out rather than deleted
 * throughout, so grep for `OTP-LOGIN-DISABLED` to find every piece and
 * uncomment to bring it back. The backend endpoints it called are
 * disabled the same way — see AuthController and AuthService.
 */
export default function Login() {
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();

  // OTP-LOGIN-DISABLED — was 'otp'. With the OTP tab gone this is the
  // only reachable mode, but the state is kept so restoring the tab is
  // a matter of uncommenting rather than rewiring.
  const [mode] = useState<Mode>('password');
  const [error, setError] = useState<string | null>(null);
  /** Which input the current error is about, so it can be marked invalid
   *  and pointed at. Null for errors that belong to the form as a whole
   *  (a rejected credential pair, a server that didn't answer). */
  const [invalidField, setInvalidField] = useState<FieldName>(null);
  const [busy, setBusy] = useState(false);
  /**
   * When the rate limiter's window reopens, as an epoch millisecond, or
   * null when nothing is blocked.
   *
   * Held as an absolute instant rather than a countdown so a backgrounded
   * tab — where browsers throttle timers to once a minute — comes back
   * with the right number instead of one frozen where it left off.
   */
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const locked = lockedUntil !== null;

  const [passwordStep, setPasswordStep] = useState<PasswordStep>({ name: 'credentials' });
  const [joineeId, setJoineeId] = useState('');
  /** Live check on the Joinee ID field. 'malformed' is decided here
   *  without asking the server — a half-typed ID isn't a wrong ID, so
   *  it shows nothing rather than a caution. */
  const [idCheck, setIdCheck] = useState<
    'idle' | 'typing' | 'checking' | 'found' | 'missing' | 'unavailable'
  >('idle');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // OTP-LOGIN-DISABLED
  // const [otpStep, setOtpStep] = useState<OtpStep>({ name: 'phone' });
  // const [phoneNumber, setPhoneNumber] = useState('');
  // const [code, setCode] = useState('');
  // const [resent, setResent] = useState(false);

  // Set after a successful first-time reset, to explain why the user is
  // looking at the sign-in form again instead of the home page.
  const [resetComplete, setResetComplete] = useState(false);

  /** Counts the block down to zero and then releases the button. Runs
   *  off the wall clock on every tick, so a late or coalesced interval
   *  corrects itself rather than accumulating drift. */
  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left > 0) {
        setSecondsLeft(left);
      } else {
        setLockedUntil(null);
        setSecondsLeft(0);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  /** Clears whatever the last attempt complained about. Wired to every
   *  input's onChange: an error that outlives the thing it was about
   *  reads as the form still being broken after it has been fixed.
   *
   *  A rate-limit message is the exception — it is about the browser,
   *  not about what is typed in the boxes, and it is the only thing on
   *  screen explaining why the button is dead. Editing a field does not
   *  make it untrue, so it stays until the block expires. */
  function clearError() {
    if (locked) return;
    if (error || invalidField) {
      setError(null);
      setInvalidField(null);
    }
  }

  function fail(message: string, field: FieldName = null) {
    setError(message);
    setInvalidField(field);
  }

  /**
   * A 429 from the login limiter, turned into a dead submit button for
   * as long as the server says. Falls back to the full 30s window when
   * Retry-After is missing — a block that is guessed slightly long is
   * a wasted wait, whereas one guessed short sends the user straight
   * back into another 429.
   */
  function noteRateLimit(err: unknown) {
    if (err instanceof ApiError && err.statusCode === 429) {
      setLockedUntil(Date.now() + (err.retryAfter ?? 30) * 1000);
    }
  }

  /**
   * One place that turns anything thrown by the fetch layer into a
   * message worth reading.
   *
   * ApiError always carries the server's own wording — "Invalid
   * credentials", "This account has been disabled", or a joined list of
   * validation failures. Anything else means the request never landed,
   * which is a different problem and deserves to say so rather than
   * being flattened into "Something went wrong".
   */
  function describe(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    return 'Could not reach the server. Check your connection and try again.';
  }

  function finishAuthenticated(result: AuthenticatedResult) {
    // The three session cookies (access, refresh, csrf) are already on
    // the browser at this point — the server put them in Set-Cookie on
    // the login response. All the client has to do is remember who is
    // signed in and route into the app.
    setAuthenticatedUser(result.user);
    navigate('/');
  }

  // --- OTP-LOGIN-DISABLED: mobile number + OTP -----------------------
  //
  // async function submitPhone(e: FormEvent) { … }
  // async function submitOtpVerify(e: FormEvent) { … }
  // async function resendOtp() { … }
  //
  // The full bodies live in git history — see the commit that restyled
  // this page. They called /auth/login/otp/{request,verify,resend} and
  // handed a password_reset_required result to the reset step below.

  // Debounced existence check behind the field's marker. 400ms is long
  // enough that typing a 11-character ID makes one request rather than
  // eleven, and short enough to feel immediate once you stop.
  useEffect(() => {
    const id = joineeId.trim().toUpperCase();
    if (!id) {
      setIdCheck('idle');
      return;
    }
    if (!JOINEE_ID_PATTERN.test(id)) {
      setIdCheck('typing');
      return;
    }
    setIdCheck('checking');
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiFetch<{ exists: boolean }>(
        `/auth/joinee-id/${encodeURIComponent(id)}/exists`,
        { signal: controller.signal },
      )
        .then((res) => setIdCheck(res.exists ? 'found' : 'missing'))
        .catch((err) => {
          // An aborted request is this effect superseding itself, not a
          // failure — leaving it as 'checking' lets the newer one land.
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Anything else (offline, rate limited, server down) must not
          // masquerade as "this ID doesn't exist".
          setIdCheck('unavailable');
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [joineeId]);

  // --- Joinee ID + password (the only live method) ---

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    // The button is disabled, but Enter in a text field submits the
    // form regardless of what the button looks like.
    if (locked) return;
    // Trimmed because a Joinee ID is almost always pasted out of an
    // email or a chat message, and a trailing space turns a correct
    // credential into "Invalid credentials" with nothing to show for it.
    const id = joineeId.trim();
    if (!id) return fail('Enter your Joinee ID.', 'joineeId');
    if (!password) return fail('Enter your password.', 'password');

    clearError();
    setResetComplete(false);
    setBusy(true);
    try {
      const result = await apiFetch<PasswordLoginResult>('/auth/login/password', {
        method: 'POST',
        body: { joineeId: id, password },
      });
      if (result.status === 'authenticated') {
        finishAuthenticated(result);
      } else {
        setPasswordStep({ name: 'reset', preAuthToken: result.preAuthToken });
      }
    } catch (err) {
      // The server answers a bad Joinee ID and a bad password with the
      // same 'Invalid credentials', deliberately — saying which half was
      // wrong would confirm that an ID exists. So neither field is
      // singled out here; the message stands for the pair.
      noteRateLimit(err);
      fail(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    if (passwordStep.name !== 'reset') return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return fail(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        'newPassword',
      );
    }

    clearError();
    setBusy(true);
    try {
      const result = await apiFetch<PasswordResetComplete>(
        '/auth/login/password/complete-reset',
        { method: 'POST', bearerToken: passwordStep.preAuthToken, body: { newPassword } },
      );
      // No tokens come back on purpose: back to the sign-in form, with
      // the Joinee ID prefilled so only the new password has to be typed.
      setJoineeId(result.joineeId);
      setPassword('');
      setNewPassword('');
      setResetComplete(true);
      setPasswordStep({ name: 'credentials' });
    } catch (err) {
      noteRateLimit(err);
      // The pre-auth token is not a session and nothing refreshes it —
      // this path is deliberately refresh-exempt, because there is no
      // session to refresh until this very form succeeds. So a 401 here
      // means the token ran out (JWT_PREAUTH_EXPIRES_IN) and the only
      // way forward is to sign in again.
      //
      // Before this, that printed the server's "Invalid or expired
      // token" against the New password field — blaming the one thing
      // that was not wrong, on a form with no way back to sign-in, so a
      // first-day joinee who took too long was stuck until they thought
      // to reload. This is the only screen in the app that can reach
      // that state: HR never sees it, because only joinees are created
      // with must_reset_password.
      if (err instanceof ApiError && err.statusCode === 401) {
        setPasswordStep({ name: 'credentials' });
        setNewPassword('');
        setPassword('');
        // Joinee ID is deliberately kept, so only the password is retyped.
        fail('That took too long — sign in again to finish setting your password.');
        return;
      }
      fail(describe(err), 'newPassword');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-stage">
      <div className="login-wash" aria-hidden="true" />
      <span className="login-orb login-orb--amber" aria-hidden="true" />
      <span className="login-orb login-orb--olive" aria-hidden="true" />

      <LoginScatter />

      <header className="login-head">
        <div className="login-logo">
          {/* Brand mark traced from the AndBoard boomerang. The disc
              belongs to the mark, so it lives in the artwork rather than
              being a CSS circle behind it — the boomerang deliberately
              overhangs it on the left and lower right. */}
          <svg className="login-logo__mark" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            {/* The disc sits down-right of the boomerang's centre so the
                notch between the wing and the tail closes inside the navy.
                At its old position the notch ran past the disc's lower-right
                edge and the last few units of it showed the page through.
                The group scale keeps the enlarged footprint in the viewBox. */}
            <g transform="scale(0.93)">
            <circle cx="79" cy="59" r="48" fill="#14304f" />
            <path
              d="M84.05 25.7 L87.01 25.62 L92.6 26.07 L95.22 26.55 L97.66 27.42 L100.53 29.28 L102.61 31.24 L104.45 33.47 L106.27 36.44 L108.02 39.93 L109.94 44.82 L111.23 49.01 L112.44 53.54 L113.99 60.87 L115.02 66.63 L116.96 80.25 L117.81 85.31 L117.77 85.89 L117.44 85.77 L108.66 77.16 L104.16 72.98 L99.19 68.63 L93.92 64.37 L87.19 59.71 L82.4 57.04 L79.45 54.46 L77.59 53.08 L75.67 51.97 L74.45 51.45 L70.61 50.93 L61.88 50.93 L56.3 51.28 L48.62 51.97 L38.49 53.14 L12.84 56.53 L3.94 57.56 L2.71 57.5 L1.49 57.15 L0.66 56.71 L0.1 55.99 L0 55.46 L0.1 54.77 L0.5 54.13 L0.97 53.72 L8.3 49.28 L13.88 46.25 L21.04 42.76 L26.8 40.2 L32.73 37.76 L39.72 35.16 L51.41 31.42 L55.77 30.22 L62.93 28.51 L70.08 27.11 L74.62 26.45 L79.16 25.97 Z M90.06 68.4 L90.5 68.63 L94.6 72.34 L99.46 77.11 L112.84 91.34 L113.72 91.73 L115.29 91.69 L116.68 91.24 L118.24 90.22 L118.41 90.2 L118.58 90.41 L119.52 96.48 L120 101.02 L120 106.43 L119.42 109.74 L119.01 110.77 L117.56 112.48 L116.16 113.53 L113.89 114.46 L111.62 114.8 L110.75 114.73 L109 114.3 L107.61 113.68 L106.56 112.89 L105.73 111.84 L103.88 106.95 L95.1 80.95 L91.98 72.92 L90.06 68.73 Z"
              fill="#ef9b3c"
            />
            </g>
          </svg>
          <span className="login-logo__word">
            And<span className="login-logo__word--brand">Board</span>
          </span>
        </div>
        <p className="login-head__line">Onboarding for the AndPayments team</p>
        <span className="login-head__rule" />
      </header>

      {/* Payment rail: money in on the left, a checklist clears it in the
          middle, the right end confirms. Drawn in the artboard's line-art
          language rather than the navy/glass version it had on the old
          dark panel. One shared CSS cycle drives every step, so it needs
          no re-renders. The viewBox starts negative because the "Payment
          sent" caption is centred under the coin at x=30 and is wider. */}
      <svg className="login-rail" viewBox="-33 -26 490 138" fill="none" aria-hidden="true">
        <path className="login-rail__wire" d="M58 36 H170" />
        <path className="login-rail__wire login-rail__wire--in" d="M58 36 H170" />
        <path className="login-rail__wire" d="M246 36 H356" />
        <path className="login-rail__wire login-rail__wire--out" d="M246 36 H356" />

        <g className="login-rail__coin">
          <circle cx="30" cy="36" r="25" className="login-rail__halo" />
          <circle cx="30" cy="36" r="19" className="login-rail__ring" />
          <text x="30" y="43" textAnchor="middle" className="login-rail__rupee">₹</text>
        </g>
        <text x="30" y="100" textAnchor="middle" className="login-rail__cap login-rail__cap--send">
          Payment sent
        </text>

        <circle className="login-rail__spark login-rail__spark--in" cx="58" cy="36" r="4" />

        {/* A phone taking the payment: the settlement bar fills and the
            box beside it ticks, and only once the money has landed. The
            tick is the arrival clearing, not a step on its own clock. */}
        <g className="login-rail__hub">
          <rect x="172" y="-22" width="72" height="106" rx="14" className="login-rail__device" />
          <rect x="177.5" y="-16.5" width="61" height="95" rx="9" className="login-rail__screen" />
          <rect x="196" y="-22" width="24" height="6" rx="3" className="login-rail__notch" />
          <rect x="243.6" y="4" width="2.2" height="16" rx="1.1" className="login-rail__side" />
          <path d="M192 74 H224" className="login-rail__home" />
          {/* The screen is blank until the money lands — the rows and the
              box are the arriving payment being drawn up, so they can't
              already be sitting there waiting for it. Group opacity, so
              each child keeps its own. */}
          <g className="login-rail__form">
            <path d="M184 10 H208" className="login-rail__ui" />
            <path d="M184 62 H226" className="login-rail__ui" />
            <path d="M184 36 H213" className="login-rail__rule" />
            <path d="M184 36 H213" className="login-rail__rule login-rail__rule--draw" />
            <rect x="217" y="29" width="14" height="14" rx="3.5" className="login-rail__box" />
            <path d="M220.2 36.4l3.3 3.3 4.6-6" className="login-rail__check" />
          </g>
        </g>
        <circle className="login-rail__spark login-rail__spark--out" cx="246" cy="36" r="4" />

        <g className="login-rail__tick">
          <circle cx="384" cy="36" r="25" className="login-rail__halo login-rail__halo--ok" />
          <circle cx="384" cy="36" r="19" className="login-rail__ring login-rail__ring--target" />
          <path d="M374 36l7 7 13-14" className="login-rail__mark login-rail__mark--idle" />
          <path d="M374 36l7 7 13-14" className="login-rail__mark" />
        </g>
        <text x="384" y="100" textAnchor="middle" className="login-rail__cap login-rail__cap--ok">
          Payment approved
        </text>
      </svg>

      <main className="login-main">
        {/* The wrapper carries the glow; it can't live on the card
            itself, whose backdrop-filter makes a stacking context that
            a blurred pseudo-element can't escape behind. */}
        <div className="login-cardwrap">
        <div className="login-card">
          <h1 className="login-title">Sign in</h1>
          <svg className="login-underline" width="138" height="14" viewBox="0 0 138 14" fill="none" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path className="login-draw" d="M4 9c22-6 44-7 66-3s44 5 64-2" strokeDasharray="220" />
          </svg>
          {/* The reset step brings its own line, and two competing
              instructions read as a mistake. */}
          {passwordStep.name === 'credentials' && (
            <p className="login-lede">Enter your details to pick up where your onboarding left off.</p>
          )}

          {/* role="alert" so the message is announced the moment it
              appears — a failed sign-in is exactly the case where the
              person may not be looking at this corner of the screen. */}
          {error && (
            <p className="login-alert login-alert--error" id="auth-error" role="alert">
              {error}
            </p>
          )}

          {resetComplete && (
            <p className="login-alert login-alert--ok">
              Password set. Sign in with your Joinee ID and your new password to continue.
            </p>
          )}

          {/* noValidate hands every check to submitPassword. The inputs keep
              `required` for semantics, but the browser's own bubble is
              suppressed: it styles differently in every engine, vanishes on
              its own, and isn't announced — so an empty field and a rejected
              password would report themselves two entirely different ways.
              One code path, one place on screen, one voice. */}
          {mode === 'password' && passwordStep.name === 'credentials' && (
            <form className="login-form" onSubmit={submitPassword} noValidate>
              <div className="login-field">
                <div className={`login-input${invalidField === 'joineeId' ? ' is-invalid' : ''}`}>
                  <svg className="login-input__icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M2.5 16.5c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    id="joinee-id"
                    /* See PasswordField: the placeholder is not an
                       accessible name. */
                    aria-label="Joinee ID"
                    value={joineeId}
                    onChange={(e) => {
                      setJoineeId(e.target.value);
                      clearError();
                    }}
                    placeholder="Enter your Joinee ID"
                    autoComplete="username"
                    aria-invalid={invalidField === 'joineeId' || undefined}
                    aria-describedby={
                      idCheck === 'missing' || idCheck === 'unavailable'
                        ? 'joinee-id-note'
                        : error
                          ? 'auth-error'
                          : undefined
                    }
                    required
                  />
                  {/* The marker: an empty ring while there's nothing to
                      say, a tick once the ID is known, a caution when
                      it isn't. */}
                  <span
                    className={`login-mark login-mark--${idCheck}`}
                    aria-hidden="true"
                  >
                    {idCheck === 'found' && (
                      <svg viewBox="0 0 18 18" fill="none">
                        <path
                          d="M4.5 9.4l3 3 6-7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    {(idCheck === 'missing' || idCheck === 'unavailable') && (
                      <svg viewBox="0 0 18 18" fill="none">
                        <path
                          d="M9 5v4.6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <circle cx="9" cy="13" r="1.1" fill="currentColor" />
                      </svg>
                    )}
                  </span>
                </div>
                {/* Always in the flow, empty most of the time: rendering
                    it conditionally grew the page past the viewport and
                    shunted everything below the card down a line the
                    moment the message appeared.
                    role="status" not "alert" — this is a running
                    commentary on what's being typed, and an assertive
                    live region would interrupt the screen reader on
                    every keystroke. */}
                <p className="login-note-line" id="joinee-id-note" role="status">
                  {idCheck === 'missing' && 'Not a registered Joinee ID — check it with your HR.'}
                  {idCheck === 'unavailable' && "Couldn't check this ID just now — you can still sign in."}
                </p>
              </div>

              <PasswordField
                id="login-password"
                label="Password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  clearError();
                }}
                placeholder="Enter your password"
                autoComplete="current-password"
                invalid={invalidField === 'password'}
                required
              />

              <button
                className={`login-submit${locked ? ' login-submit--locked' : ''}`}
                disabled={busy || locked}
                type="submit"
              >
                {/* The sheen sweeps to say the button is live. It would
                    read as activity on a button that is refusing to do
                    anything, so a blocked button does not get one. */}
                {!locked && <span className="login-submit__sheen" aria-hidden="true" />}
                <span>
                  {locked ? `Try again in ${secondsLeft}s` : busy ? 'Signing in…' : 'Sign in'}
                </span>
              </button>
            </form>
          )}

          {mode === 'password' && passwordStep.name === 'reset' && (
            <form className="login-form" onSubmit={submitPasswordReset} noValidate>
              <p className="login-step-hint">Choose a new password to continue.</p>
              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  clearError();
                }}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                invalid={invalidField === 'newPassword'}
                autoFocus
                required
              />
              <button
                className={`login-submit${locked ? ' login-submit--locked' : ''}`}
                disabled={busy || locked}
                type="submit"
              >
                {!locked && <span className="login-submit__sheen" aria-hidden="true" />}
                <span>
                  {locked ? `Try again in ${secondsLeft}s` : busy ? 'Saving…' : 'Set password'}
                </span>
              </button>
            </form>
          )}

          <p className="login-footnote">New joinee? Contact your HR administrator for access.</p>
        </div>
        </div>

        <LoginQuote />
      </main>
    </div>
  );
}
