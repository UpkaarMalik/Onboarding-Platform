import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import PasswordField from '../components/PasswordField';
import ParticleNetwork from '../components/ParticleNetwork';

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
// OTP-LOGIN-DISABLED
// type OtpStep = { name: 'phone' } | { name: 'verify'; preAuthToken: string };

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
  const [mode, setMode] = useState<Mode>('password');
  const [error, setError] = useState<string | null>(null);
  /** Which input the current error is about, so it can be marked invalid
   *  and pointed at. Null for errors that belong to the form as a whole
   *  (a rejected credential pair, a server that didn't answer). */
  const [invalidField, setInvalidField] = useState<FieldName>(null);
  const [busy, setBusy] = useState(false);

  const [passwordStep, setPasswordStep] = useState<PasswordStep>({ name: 'credentials' });
  const [joineeId, setJoineeId] = useState('');
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

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResetComplete(false);
    setPasswordStep({ name: 'credentials' });
    // OTP-LOGIN-DISABLED
    // setOtpStep({ name: 'phone' });
  }

  /** Clears whatever the last attempt complained about. Wired to every
   *  input's onChange: an error that outlives the thing it was about
   *  reads as the form still being broken after it has been fixed. */
  function clearError() {
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
  // async function submitPhone(e: FormEvent) {
  //   e.preventDefault();
  //   setError(null);
  //   setBusy(true);
  //   try {
  //     const result = await apiFetch<{ preAuthToken: string }>('/auth/login/otp/request', {
  //       method: 'POST',
  //       body: { phoneNumber: `91${phoneNumber}` },
  //     });
  //     setOtpStep({ name: 'verify', preAuthToken: result.preAuthToken });
  //   } catch (err) {
  //     setError(err instanceof ApiError ? err.message : 'Something went wrong');
  //   } finally {
  //     setBusy(false);
  //   }
  // }
  //
  // async function submitOtpVerify(e: FormEvent) {
  //   e.preventDefault();
  //   if (otpStep.name !== 'verify') return;
  //   setError(null);
  //   setBusy(true);
  //   try {
  //     const result = await apiFetch<PasswordLoginResult>('/auth/login/otp/verify', {
  //       method: 'POST',
  //       bearerToken: otpStep.preAuthToken,
  //       body: { code },
  //     });
  //     if (result.status === 'authenticated') {
  //       finishAuthenticated(result);
  //       return;
  //     }
  //     // First login by OTP still has to set a real password before it
  //     // gets a session. Verifying the code is what authorized the reset,
  //     // so this hands over to the same reset form the password tab uses.
  //     setMode('password');
  //     setPasswordStep({ name: 'reset', preAuthToken: result.preAuthToken });
  //   } catch (err) {
  //     setError(err instanceof ApiError ? err.message : 'Something went wrong');
  //   } finally {
  //     setBusy(false);
  //   }
  // }
  //
  // async function resendOtp() {
  //   if (otpStep.name !== 'verify') return;
  //   setError(null);
  //   setResent(false);
  //   setBusy(true);
  //   try {
  //     await apiFetch('/auth/login/otp/resend', { method: 'POST', bearerToken: otpStep.preAuthToken });
  //     setResent(true);
  //   } catch (err) {
  //     setError(err instanceof ApiError ? err.message : 'Something went wrong');
  //   } finally {
  //     setBusy(false);
  //   }
  // }

  // --- Joinee ID + password (the only live method) ---

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
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
      fail(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset(e: FormEvent) {
    e.preventDefault();
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
      fail(describe(err), 'newPassword');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page auth-page--split">
      <ParticleNetwork />
      <div className="auth-illustration">
        <svg className="auth-illustration__svg" viewBox="0 0 600 500" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="gradientPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2a4b7c" />
              <stop offset="50%" stopColor="#e88f30" />
              <stop offset="100%" stopColor="#4caf50" />
            </linearGradient>
            <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#1a1611" floodOpacity="0.12" />
            </filter>
          </defs>

          <path
            className="marching-ants"
            d="M 50 350 C 150 400, 200 150, 300 250 C 400 350, 450 100, 550 150"
            fill="none"
            stroke="url(#gradientPrimary)"
            strokeLinecap="round"
            strokeWidth="12"
          />
          <path
            d="M 50 350 C 150 400, 200 150, 300 250 C 400 350, 450 100, 550 150"
            fill="none"
            opacity="0.3"
            stroke="#1a1611"
            strokeLinecap="round"
            strokeWidth="16"
          />

          <g className="float-bob" style={{ animationDelay: '0.2s' }}>
            <rect fill="#ffffff" filter="url(#drop-shadow)" height="100" rx="6" stroke="#2a4b7c" strokeWidth="3" width="80" x="120" y="80" />
            <rect fill="#e88f30" height="40" width="15" x="135" y="120" />
            <rect fill="#4caf50" height="60" width="15" x="155" y="100" />
            <rect fill="#2a4b7c" height="30" width="15" x="175" y="130" />
            <path d="M 130 110 L 160 85 L 185 105" fill="none" stroke="#1a1611" strokeWidth="2" />
          </g>

          <g className="float-bob" style={{ animationDelay: '1.2s' }}>
            <path d="M 60 280 C 80 270, 110 280, 130 290 L 150 310 L 100 330 Z" fill="#d99b78" stroke="#1a1611" strokeWidth="2" />
            <path d="M 60 280 L 40 310 L 80 340" fill="#2a4b7c" stroke="#1a1611" strokeWidth="2" />
            <g className="pulse-shimmer" style={{ animationDelay: '0.5s' }}>
              <circle cx="120" cy="250" fill="#ffffff" filter="url(#drop-shadow)" r="30" stroke="#2a4b7c" strokeWidth="4" />
              <circle cx="120" cy="250" fill="#2a4b7c" r="22" />
              <text fill="#ffffff" fontFamily="Manrope" fontSize="26" fontWeight="700" textAnchor="middle" x="120" y="259">
                ₹
              </text>
            </g>
          </g>

          <g className="float-bob" style={{ animationDelay: '0.8s' }}>
            <path
              d="M 250 180 L 290 160 L 330 180 V 230 C 330 270, 290 310, 290 310 C 290 310, 250 270, 250 230 V 180 Z"
              fill="#2a4b7c"
              filter="url(#drop-shadow)"
              stroke="#1a1611"
              strokeWidth="3"
            />
            <path
              d="M 265 190 L 290 175 L 315 190 V 225 C 315 250, 290 280, 290 280 C 290 280, 265 250, 265 225 V 190 Z"
              fill="#e88f30"
            />
            <path d="M 278 235 l 8 8 l 16 -18" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          <g className="slide-in-up float-bob" style={{ animationDelay: '1.5s' }}>
            <rect
              fill="#ffffff"
              filter="url(#drop-shadow)"
              height="140"
              rx="12"
              stroke="#2a4b7c"
              strokeWidth="3"
              transform="rotate(-15 450 350)"
              width="90"
              x="420"
              y="280"
            />
            <rect fill="#fff8ec" height="45" rx="4" transform="rotate(-15 450 350)" width="70" x="430" y="295" />
            <g transform="rotate(-15 450 350)">
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="430" y="355" />
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="455" y="355" />
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="480" y="355" />
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="430" y="375" />
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="455" y="375" />
              <rect fill="#ece3d3" height="8" rx="2" width="15" x="480" y="375" />
            </g>
            <rect fill="url(#gradientPrimary)" height="25" rx="4" transform="rotate(-30 430 260)" width="45" x="410" y="250" />
          </g>
        </svg>
        <div className="auth-illustration__caption">
          <h2>Secure &amp; Seamless</h2>
          <p>Everything you need for day one — company access, documents and your team, in one place.</p>
        </div>
      </div>

      <div className="auth-panel">
        <div className="auth-brand">
          <h1>Welcome to ANDPayments</h1>
          <p>Log in to manage your workspace</p>
        </div>

        <div className="auth-card liquid-card">
          {/* OTP-LOGIN-DISABLED — the whole tab bar goes with it: with one
              login method there is nothing to switch between. Uncomment
              to bring both tabs back.

          <div className="auth-underline-tabs">
            <button
              type="button"
              className={mode === 'otp' ? 'active' : ''}
              disabled={busy}
              onClick={() => switchMode('otp')}
            >
              Mobile &amp; OTP Login
            </button>
            <button
              type="button"
              className={mode === 'password' ? 'active' : ''}
              disabled={busy}
              onClick={() => switchMode('password')}
            >
              Joinee ID &amp; Password
            </button>
          </div>
          */}

          {/* role="alert" so the message is announced the moment it
              appears — a failed sign-in is exactly the case where the
              person may not be looking at this corner of the screen. */}
          {error && (
            <p className="error-text" id="auth-error" role="alert">
              {error}
            </p>
          )}

          {resetComplete && (
            <p className="success-text">
              Password set. Sign in with your Joinee ID and your new password to continue.
            </p>
          )}

          {/* OTP-LOGIN-DISABLED — both OTP forms below, phone entry then
              code entry. Uncomment together with the handlers and state.

          {mode === 'otp' && otpStep.name === 'phone' && (
            <form onSubmit={submitPhone}>
              <label htmlFor="mobile-number">Mobile Number</label>
              <div className="input-icon-group phone-input-group">
                <span className="material-symbols-outlined">call</span>
                <span className="phone-prefix">+91</span>
                <span className="phone-divider">|</span>
                <input
                  id="mobile-number"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  placeholder="Enter your registered mobile number"
                  autoComplete="tel"
                  maxLength={10}
                  required
                />
              </div>
              <button className="btn-primary auth-submit" disabled={busy} type="submit">
                {busy ? 'Sending…' : 'GET OTP'}
              </button>
            </form>
          )}

          {mode === 'otp' && otpStep.name === 'verify' && (
            <form onSubmit={submitOtpVerify}>
              <p className="auth-step-hint">Enter the 6-digit code we texted to your registered mobile number.</p>
              <label htmlFor="otp-code">Verification code</label>
              <div className="input-icon-group">
                <span className="material-symbols-outlined">shield_lock</span>
                <input
                  id="otp-code"
                  value={code}
                  // Strip anything that isn't a digit, at the source. `pattern`
                  // and `inputMode` only steer the mobile keyboard and the
                  // final submit check — they don't stop a paste of "12 34 56"
                  // or a stray letter from ending up in the field. Trimming
                  // here means the value shown to the user always matches what
                  // will be sent, so a bad character can't get past the
                  // keystroke that made it. 6 max because that is the length
                  // the backend generates and expects.
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  required
                  // Grabs focus the moment this input mounts. The verify step
                  // is only rendered while `otpStep.name === 'verify'`, so the
                  // input first appears the instant the phone-number form
                  // hands off — the user just clicked "GET OTP" and is about
                  // to type, so putting the cursor here saves them the extra
                  // click that they'd otherwise have to make.
                  autoFocus
                />
              </div>
              <button className="btn-primary auth-submit" disabled={busy} type="submit">
                {busy ? 'Verifying…' : 'Verify'}
              </button>
              <button type="button" disabled={busy} onClick={resendOtp}>
                Resend code
              </button>
              {resent && <p className="field-hint">A new code was sent.</p>}
            </form>
          )}
          */}

          {/* noValidate hands every check to submitPassword. The inputs keep
              `required` for semantics, but the browser's own bubble is
              suppressed: it styles differently in every engine, vanishes on
              its own, and isn't announced — so an empty field and a rejected
              password would report themselves two entirely different ways.
              One code path, one place on screen, one voice. */}
          {mode === 'password' && passwordStep.name === 'credentials' && (
            <form onSubmit={submitPassword} noValidate>
              <label htmlFor="joinee-id">Joinee ID</label>
              <div className="input-icon-group">
                <span className="material-symbols-outlined">badge</span>
                <input
                  id="joinee-id"
                  value={joineeId}
                  onChange={(e) => {
                    setJoineeId(e.target.value);
                    clearError();
                  }}
                  placeholder="JN-2026-001"
                  autoComplete="username"
                  aria-invalid={invalidField === 'joineeId' || undefined}
                  aria-describedby={error ? 'auth-error' : undefined}
                  required
                />
              </div>
              <PasswordField
                label="Password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  clearError();
                }}
                autoComplete="current-password"
                invalid={invalidField === 'password'}
                required
              />
              <button className="btn-primary auth-submit" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {mode === 'password' && passwordStep.name === 'reset' && (
            <form onSubmit={submitPasswordReset} noValidate>
              <p className="auth-step-hint">Choose a new password to continue.</p>
              <PasswordField
                label="New password"
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  clearError();
                }}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                invalid={invalidField === 'newPassword'}
                required
              />
              <button className="btn-primary auth-submit" disabled={busy} type="submit">
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
