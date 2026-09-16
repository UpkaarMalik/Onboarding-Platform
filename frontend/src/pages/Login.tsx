import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import PasswordField from '../components/PasswordField';
import ParticleNetwork from '../components/ParticleNetwork';

interface AuthenticatedResult {
  status: 'authenticated';
  accessToken: string;
  refreshToken: string;
  user: any;
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
type OtpStep = { name: 'phone' } | { name: 'verify'; preAuthToken: string };

/**
 * Two entirely independent, complete login methods — not two steps of
 * one flow. Mobile + OTP never touches a password at all: request a
 * code, verify it, done. Joinee ID + password ends in a real session
 * unless the password on file is still the HR-issued temp one (then
 * there's one extra "set a new password" step). See
 * AuthService.requestMobileOtp / loginWithPassword on the backend —
 * this mirrors that split exactly, tab for tab.
 */
export default function Login() {
  const navigate = useNavigate();
  const { setAuthenticated } = useAuth();

  const [mode, setMode] = useState<Mode>('otp');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [passwordStep, setPasswordStep] = useState<PasswordStep>({ name: 'credentials' });
  const [joineeId, setJoineeId] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [otpStep, setOtpStep] = useState<OtpStep>({ name: 'phone' });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);

  // Set after a successful first-time reset, to explain why the user is
  // looking at the sign-in form again instead of the home page.
  const [resetComplete, setResetComplete] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResetComplete(false);
    setPasswordStep({ name: 'credentials' });
    setOtpStep({ name: 'phone' });
  }

  function finishAuthenticated(result: AuthenticatedResult) {
    setAuthenticated(result.accessToken, result.refreshToken, result.user);
    navigate('/');
  }

  // --- Method 1: mobile number + OTP ---

  async function submitPhone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<{ preAuthToken: string }>('/auth/login/otp/request', {
        method: 'POST',
        body: { phoneNumber: `91${phoneNumber}` },
      });
      setOtpStep({ name: 'verify', preAuthToken: result.preAuthToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtpVerify(e: FormEvent) {
    e.preventDefault();
    if (otpStep.name !== 'verify') return;
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<PasswordLoginResult>('/auth/login/otp/verify', {
        method: 'POST',
        token: otpStep.preAuthToken,
        body: { code },
      });
      if (result.status === 'authenticated') {
        finishAuthenticated(result);
        return;
      }
      // First login by OTP still has to set a real password before it
      // gets a session. Verifying the code is what authorized the reset,
      // so this hands over to the same reset form the password tab uses.
      setMode('password');
      setPasswordStep({ name: 'reset', preAuthToken: result.preAuthToken });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    if (otpStep.name !== 'verify') return;
    setError(null);
    setResent(false);
    setBusy(true);
    try {
      await apiFetch('/auth/login/otp/resend', { method: 'POST', token: otpStep.preAuthToken });
      setResent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  // --- Method 2: Joinee ID + password ---

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<PasswordLoginResult>('/auth/login/password', {
        method: 'POST',
        body: { joineeId, password },
      });
      if (result.status === 'authenticated') {
        finishAuthenticated(result);
      } else {
        setPasswordStep({ name: 'reset', preAuthToken: result.preAuthToken });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset(e: FormEvent) {
    e.preventDefault();
    if (passwordStep.name !== 'reset') return;
    setError(null);
    setBusy(true);
    try {
      const result = await apiFetch<PasswordResetComplete>(
        '/auth/login/password/complete-reset',
        { method: 'POST', token: passwordStep.preAuthToken, body: { newPassword } },
      );
      // No tokens come back on purpose: back to the sign-in form, with
      // the Joinee ID prefilled so only the new password has to be typed.
      setJoineeId(result.joineeId);
      setPassword('');
      setNewPassword('');
      setResetComplete(true);
      setPasswordStep({ name: 'credentials' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
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

          {error && <p className="error-text">{error}</p>}

          {resetComplete && (
            <p className="success-text">
              Password set. Sign in with your Joinee ID and your new password to continue.
            </p>
          )}

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

          {mode === 'password' && passwordStep.name === 'credentials' && (
            <form onSubmit={submitPassword}>
              <label htmlFor="joinee-id">Joinee ID</label>
              <div className="input-icon-group">
                <span className="material-symbols-outlined">badge</span>
                <input
                  id="joinee-id"
                  value={joineeId}
                  onChange={(e) => setJoineeId(e.target.value)}
                  placeholder="JN-2026-001"
                  autoComplete="username"
                  required
                />
              </div>
              <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
              <button className="btn-primary auth-submit" disabled={busy} type="submit">
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {mode === 'password' && passwordStep.name === 'reset' && (
            <form onSubmit={submitPasswordReset}>
              <p className="auth-step-hint">Choose a new password to continue.</p>
              <PasswordField
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                minLength={8}
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
