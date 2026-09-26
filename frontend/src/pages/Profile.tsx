import { useCallback, useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { ApiError } from '../api/client';
import { useToast, toastError } from '../components/Toast';
import { formatPhone, formatDate } from '../lib/format';

/**
 * The signed-in person's own profile.
 *
 * This page is why the Profile item in the user menu existed as a
 * disabled button for so long: there was nowhere for it to go, and no
 * endpoint behind it either — every employee-profile route was HR-only,
 * so the only thing an employee could read about themselves was the
 * handful of fields on their access token.
 *
 * Reads GET /employee-profile/me, which returns the same record HR sees
 * for that person. What can be EDITED here is deliberately narrower than
 * HR's form: phone and personal email only. Department, joining date and
 * account status are HR's to set, so they are shown as plain facts with
 * a line saying who to ask.
 */

interface ProfileUser {
  id: string;
  full_name: string;
  joinee_id: string;
  phone_number: string | null;
  personal_email: string | null;
  company_email: string | null;
  role: string;
  status: string;
  department_name: string | null;
  created_at: string;
}

interface ProfileOnboarding {
  status: string;
  start_date: string | null;
  manager_name: string | null;
  buddy_name: string | null;
}

interface ProfileResponse {
  user: ProfileUser;
  onboarding: ProfileOnboarding | null;
  tasks: { requiredTotal: number; requiredCompleted: number };
}

const ROLE_LABEL: Record<string, string> = {
  superadmin_hr: 'HR · SuperAdmin',
  task_owner: 'Task owner',
  employee: 'Employee',
};

export default function Profile() {
  const authedFetch = useAuthedFetch();
  const toast = useToast();

  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authedFetch<ProfileResponse>('/employee-profile/me');
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Opens the form on the values as they currently are, so cancelling
   *  leaves nothing half-typed behind. */
  function startEditing() {
    if (!data) return;
    // The API stores 91XXXXXXXXXX and wants it back the same way; the
    // field shows the ten digits so nobody has to know that.
    const digits = data.user.phone_number ?? '';
    setPhone(digits.startsWith('91') ? digits.slice(2) : digits);
    setPersonalEmail(data.user.personal_email ?? '');
    setEditing(true);
  }

  async function save() {
    if (!data) return;
    const trimmedPhone = phone.trim();
    if (!/^\d{10}$/.test(trimmedPhone)) {
      toast({
        tone: 'error',
        title: 'Check the phone number',
        message: 'It needs to be 10 digits, without the country code.',
      });
      return;
    }
    const trimmedEmail = personalEmail.trim();
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      toast({
        tone: 'error',
        title: 'Check the personal email',
        message: "That doesn't look like an email address.",
      });
      return;
    }

    setSaving(true);
    try {
      await authedFetch('/employee-profile/me', {
        method: 'PATCH',
        body: {
          phoneNumber: `91${trimmedPhone}`,
          // Cleared rather than blanked: the column is nullable and an
          // empty string is not the same as "not given".
          personalEmail: trimmedEmail || null,
        },
      });
      setEditing(false);
      await load();
      toast({ tone: 'success', title: 'Profile updated' });
    } catch (err) {
      toast({
        tone: 'error',
        title: "Couldn't save your profile",
        message: toastError(err, 'Something went wrong. Try again in a moment.'),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <ProfileSkeleton />;
  if (error && !data) return <p className="error-text">{error}</p>;
  if (!data) return null;

  const { user, onboarding, tasks } = data;
  const initials = user.full_name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const pct =
    tasks.requiredTotal === 0
      ? 0
      : Math.round((tasks.requiredCompleted / tasks.requiredTotal) * 100);

  return (
    /* profile-me, not profile-page: that class is HR's drawer, whose own
       rules further down index.css would otherwise lay this page out. */
    <div className="profile-me">
      <header className="profile-hero">
        <span className="profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="profile-hero-text">
          <h1>{user.full_name}</h1>
          {/* The separator is its own element rather than a "·" glued to the
              front of the department name. Written inline it inherited the
              department's own spacing, so the dot sat hard against the word
              and a long way from the id it was meant to divide. */}
          <p className="profile-hero-meta">
            <span className="profile-chip">{ROLE_LABEL[user.role] ?? user.role}</span>
            <span className="muted">{user.joinee_id}</span>
            {user.department_name && (
              <>
                <span className="profile-meta-dot" aria-hidden="true">
                  ·
                </span>
                <span className="muted">{user.department_name}</span>
              </>
            )}
          </p>
        </div>
        {!editing && (
          <button type="button" className="btn-solid btn-sm" onClick={startEditing}>
            Edit details
          </button>
        )}
      </header>

      {onboarding && tasks.requiredTotal > 0 && (
        <section className="profile-card profile-progress">
          <div className="profile-progress-head">
            <h2>Your onboarding</h2>
            <span className="profile-progress-count">
              {tasks.requiredCompleted}
              <span className="muted">/{tasks.requiredTotal} steps</span>
            </span>
          </div>
          <span className="profile-track">
            <span className="profile-track-fill" style={{ width: `${pct}%` }} />
          </span>
          <p className="muted profile-progress-note">
            {pct === 100
              ? 'Every required step is behind you.'
              : `${pct}% complete — your trail is on the Home tab.`}
          </p>
        </section>
      )}

      <section className="profile-card">
        <h2>Your details</h2>

        {editing ? (
          <form
            className="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="profile-field">
              <span>Mobile number</span>
              <span className="profile-phone-input">
                <span className="profile-phone-prefix">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  maxLength={10}
                  /* Digits only, filtered on the way in rather than
                     validated on the way out — the field cannot hold a
                     value the API would reject. */
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="9876543210"
                  autoFocus
                />
              </span>
            </label>

            <label className="profile-field">
              <span>Personal email</span>
              <input
                type="email"
                value={personalEmail}
                onChange={(e) => setPersonalEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <div className="profile-form-actions">
              <button type="button" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn-solid" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        ) : (
          <dl className="profile-grid">
            <Row label="Mobile" value={formatPhone(user.phone_number)} />
            <Row label="Personal email" value={user.personal_email} />
            <Row label="Company email" value={user.company_email} />
            <Row label="Joinee ID" value={user.joinee_id} />
          </dl>
        )}
      </section>

      <section className="profile-card">
        <h2>Set by HR</h2>
        <dl className="profile-grid">
          <Row label="Department" value={user.department_name} />
          <Row label="Joining date" value={onboarding?.start_date ? formatDate(onboarding.start_date) : null} />
          <Row label="Reporting manager" value={onboarding?.manager_name} />
          <Row label="Onboarding buddy" value={onboarding?.buddy_name} />
        </dl>
        <p className="field-hint profile-hr-note">
          These are maintained by HR. Ask them if something here is wrong.
        </p>
      </section>
    </div>
  );
}

/** One label/value pair, with a consistent placeholder rather than a
 *  blank cell — an empty row reads as a rendering fault. */
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value ? undefined : 'muted'}>{value || 'Not set'}</dd>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="profile-me">
      <div className="profile-hero">
        <span className="skeleton-line" style={{ width: 72, height: 72, borderRadius: '50%' }} />
        <div className="profile-hero-text">
          <span className="skeleton-line" style={{ width: '14rem', height: '1.8rem' }} />
          <span className="skeleton-line" style={{ width: '9rem' }} />
        </div>
      </div>
      <div className="profile-card">
        <span className="skeleton-line" style={{ width: '8rem' }} />
        <span className="skeleton-line" style={{ width: '100%' }} />
        <span className="skeleton-line" style={{ width: '80%' }} />
      </div>
    </div>
  );
}
