import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, openFileInline } from '../api/client';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import {
  formatDate,
  onboardingStatusLabel,
  onboardingStatusTone,
} from '../lib/format';

interface Department {
  id: string;
  name: string;
}

interface DocumentType {
  id: string;
  code: string;
  label: string;
  is_default_required: boolean;
  is_sensitive: boolean;
}

interface OverviewRow {
  id: string;
  user_id: string;
  status: string;
  start_date: string;
  employee_name: string;
  joinee_id: string | null;
  personal_email: string | null;
  department_name: string;
  department_id: string;
  template_name: string;
  required_task_count: number;
  required_task_completed_count: number;
}

interface EmployeeProfile {
  user: {
    id: string;
    full_name: string;
    joinee_id: string;
    phone_number: string;
    personal_email: string | null;
    company_email: string | null;
    status: string;
    must_reset_password: boolean;
    department_name: string | null;
  };
  onboarding: {
    id: string;
    status: string;
    start_date: string;
    manager_name: string | null;
    buddy_name: string | null;
    template_name: string;
  } | null;
  documents: {
    requirement_id: string;
    status: string;
    label: string;
    upload_id: string | null;
    original_filename: string | null;
    mime_type: string | null;
    uploaded_at: string | null;
    review_status: string | null;
    review_note: string | null;
  }[];
  tasks: {
    pending: any[];
    completed: any[];
    requiredTotal: number;
    requiredCompleted: number;
  };
}

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}

const AVATAR_COLORS = ['#2f8f5b', '#7c3aed', '#c94a3c', '#2f8f5b', '#8b6914', '#3f7cb0', '#e8930c', '#b91c8a'];
const PAGE_LIMIT = 100;

const REQUIRED_DOC_CODES = ['aadhaar_card', 'pan_card', 'passport_photo'];

export default function HrOverview() {
  const authedFetch = useAuthedFetch();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateJoinee, setShowCreateJoinee] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [joinerCredentials, setJoinerCredentials] = useState<{
    loginId: string;
    temporaryPassword: string;
  } | null>(null);
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, depts] = await Promise.all([
        authedFetch<{ data: OverviewRow[]; total: number }>(`/onboardings?limit=${PAGE_LIMIT}`),
        authedFetch<Department[]>('/departments'),
      ]);
      setRows(list.data);
      setTotal(list.total);
      setDepartments(depts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the overview');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'completed').length;
    const closed = rows.filter((r) => r.status === 'cancelled').length;
    const inProgress = rows.length - completed - closed
      - rows.filter((r) => r.status === 'pre_onboarding').length;
    const avg = rows.length
      ? Math.round(
          rows.reduce(
            (sum, r) =>
              sum + (r.required_task_count ? r.required_task_completed_count / r.required_task_count : 0),
            0,
          ) / rows.length * 100,
        )
      : 0;
    return { total: rows.length, inProgress, completed, avg };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = rows;

    if (activeStatFilter) {
      if (activeStatFilter === 'total') result = rows;
      else if (activeStatFilter === 'progress')
        result = rows.filter((r) => !['completed', 'cancelled', 'pre_onboarding'].includes(r.status));
      else if (activeStatFilter === 'completed')
        result = rows.filter((r) => r.status === 'completed');
    }

    return result.filter((r) => {
      if (department && r.department_name !== department) return false;
      if (statusFilter && onboardingStatusTone(r.status) !== statusFilter) return false;
      if (!q) return true;
      return (
        r.employee_name?.toLowerCase().includes(q) ||
        (r.joinee_id ?? '').toLowerCase().includes(q) ||
        (r.personal_email ?? '').toLowerCase().includes(q) ||
        (r.department_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, department, statusFilter, activeStatFilter]);

  function toggleStat(key: string) {
    setActiveStatFilter((prev) => (prev === key ? null : key));
  }

  const [clockTime, setClockTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClockTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="overview">
      <Reveal>
        <header className="overview-head">
          <div className="overview-head-text">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <span className="overview-eyebrow">
                  <span className="overview-eyebrow-dot" />
                  Admin dashboard
                </span>
                <h1 className="overview-title" style={{ margin: 0 }}>
                  Onboarding <em>Overview</em>
                </h1>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  color: 'var(--color-text)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-muted)" strokeWidth="1.3">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{clockTime.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span style={{ color: 'var(--color-muted)' }}>•</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{clockTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</span>
                </div>
                <button type="button" className="btn-solid" style={{ fontSize: 14, padding: '10px 24px', whiteSpace: 'nowrap', borderRadius: 12 }} onClick={() => setShowCreateJoinee(true)}>
                  + Create New Joinee
                </button>
              </div>
            </div>
            <p className="overview-lede">
              Track and manage all joinees' onboarding progress from one place.
            </p>
          </div>
        </header>
      </Reveal>

      {error && <p className="error-text">{error}</p>}

      <Reveal delay={0.06}>
        <div className="stat-row">
          <div className={`stat-card stat-card--neutral${activeStatFilter === 'total' ? ' is-active' : ''}`} onClick={() => toggleStat('total')}>
            <span className="stat-card-value">{stats.total}</span>
            <span className="stat-card-text"><strong>Total Joinees</strong><small>This quarter</small></span>
          </div>
          <div className={`stat-card stat-card--progress${activeStatFilter === 'progress' ? ' is-active' : ''}`} onClick={() => toggleStat('progress')}>
            <span className="stat-card-value">{stats.inProgress}</span>
            <span className="stat-card-text"><strong>In Progress</strong><small>Active</small></span>
          </div>
          <div className={`stat-card stat-card--done${activeStatFilter === 'completed' ? ' is-active' : ''}`} onClick={() => toggleStat('completed')}>
            <span className="stat-card-value">{stats.completed}</span>
            <span className="stat-card-text"><strong>Completed</strong><small>Fully onboarded</small></span>
          </div>
          <div className="stat-card stat-card--accent" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <span className="stat-card-value">{stats.avg}%</span>
              <span className="stat-card-text"><strong>Avg. Completion</strong><small>Across all</small></span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCreateJoinee(true); }}
              style={{
                alignSelf: 'flex-end',
                background: 'linear-gradient(135deg, #f59e0b, #d97706 50%, #b45309)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '6px 14px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px -2px rgba(245,158,11,0.4)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'none'; }}
            >
              + Create Employee
            </button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="overview-controls-card">
          <label className="search-field">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, or department..."
              aria-label="Search joinees"
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ×
              </button>
            )}
          </label>

          <div className="overview-filters-row">
            <div className="overview-filters">
              <CustomSelect
                value={department}
                onChange={setDepartment}
                placeholder="All Departments"
                options={[
                  { value: '', label: 'All Departments' },
                  ...departments.map((d) => ({ value: d.name, label: d.name })),
                ]}
              />
              <CustomSelect
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'progress', label: 'In progress' },
                  { value: 'done', label: 'Completed' },
                ]}
              />
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <div className="roster">
          <div className="roster-head" role="row">
            <span>Joinee</span>
            <span>ID</span>
            <span>Department</span>
            <span>Joining date</span>
            <span>Progress</span>
            <span>Status</span>
            <span>Actions</span>
          </div>

          {loading ? (
            [0, 1, 2, 3].map((i) => (
              <div className="roster-row is-skeleton" key={i} style={{ ['--row' as string]: i }}>
                <span className="skeleton-line" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="roster-empty">
              <p>
                {rows.length === 0
                  ? 'No onboardings yet. Create your first joinee to get started.'
                  : 'No joinees match those filters.'}
              </p>
            </div>
          ) : (
            filtered.map((r, i) => (
              <RosterRow
                key={r.id}
                row={r}
                index={i}
                onView={() => setProfileUserId(r.user_id)}
                onClose={() => {/* cancel onboarding - future */}}
              />
            ))
          )}
        </div>

        {total > rows.length && (
          <p className="roster-foot muted">
            Showing the first {rows.length} of {total} onboardings.
          </p>
        )}
      </Reveal>

      {profileUserId && (
        <EmployeeProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onChanged={load}
        />
      )}

      {showCreateJoinee && (
        <CreateJoineeWizard
          departments={departments}
          onClose={() => setShowCreateJoinee(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowCreateJoinee(false);
            void load();
          }}
        />
      )}

      {joinerCredentials && (
        <Modal title="Account created" onClose={() => setJoinerCredentials(null)}>
          <p>
            Shown once — deliver these to the joinee directly. Use Copy rather than retyping.
          </p>
          <p className="credential-row">
            <strong>Login:</strong> <code>{joinerCredentials.loginId}</code>
            <CopyButton text={joinerCredentials.loginId} />
          </p>
          <p className="credential-row">
            <strong>Password:</strong> <code>{joinerCredentials.temporaryPassword}</code>
            <CopyButton text={joinerCredentials.temporaryPassword} />
          </p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setJoinerCredentials(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RosterRow({
  row,
  index,
  onView,
  onClose,
}: {
  row: OverviewRow;
  index: number;
  onView: () => void;
  onClose: () => void;
}) {
  const pct = row.required_task_count
    ? Math.round((row.required_task_completed_count / row.required_task_count) * 100)
    : 0;
  const tone = onboardingStatusTone(row.status);
  const name = row.employee_name?.trim() ?? '';
  const parts = name.split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name[0] ?? '?').toUpperCase();
  const colorIdx = index % AVATAR_COLORS.length;

  return (
    <div className="roster-row" style={{ ['--row' as string]: index }}>
      <span className="roster-joinee">
        <span className={`roster-avatar avatar-${colorIdx}`} aria-hidden="true">
          {initials}
        </span>
        <span className="roster-joinee-text">
          <strong>{row.employee_name}</strong>
          <small>{row.personal_email ?? row.template_name}</small>
        </span>
      </span>

      <span>
        {row.joinee_id ? (
          <code className="id-pill">{row.joinee_id}</code>
        ) : (
          <span className="muted">—</span>
        )}
      </span>

      <span>
        <span className="dept-pill">{row.department_name}</span>
      </span>

      <span className="roster-date">{formatDate(row.start_date)}</span>

      <span className="roster-progress">
        <span className="roster-progress-track">
          <span
            className={`roster-progress-fill is-${tone}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <small>
          {row.required_task_completed_count}/{row.required_task_count}
        </small>
      </span>

      <span>
        <span className={`state-pill state-pill--${tone}`}>{onboardingStatusLabel(row.status)}</span>
      </span>

      <span className="roster-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onView}>View</button>
        <button type="button" className="btn-close-row" onClick={onClose}>Close</button>
      </span>
    </div>
  );
}

function StatCard({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  sub: string;
  tone: 'neutral' | 'progress' | 'done' | 'accent';
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-text">
        <strong>{label}</strong>
        <small>{sub}</small>
      </span>
    </div>
  );
}

/* ============================================================
   Create New Joinee — 3-step wizard
   ============================================================ */

function CreateJoineeWizard({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [managerName, setManagerName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Step 2 fields
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // Step 3
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<DocumentType[]>('/joinee-documents/types')
      .then((types) => {
        setDocTypes(types);
        const defaults = new Set(
          types.filter((t) =>
            t.is_default_required ||
            REQUIRED_DOC_CODES.includes(t.code)
          ).map((t) => t.id),
        );
        setSelectedDocs(defaults);
      })
      .catch(() => setDocTypes([]));
  }, [authedFetch]);

  function toggleDoc(id: string) {
    setSelectedDocs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function canProceedStep1() {
    return fullName.trim() && personalEmail.trim() && departmentId && startDate && phoneNumber.length === 10;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const userRes = await authedFetch<{
        user: { id: string };
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/auth/users', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          personalEmail,
          role: 'employee',
          departmentId,
        },
      });
      await authedFetch('/onboardings', {
        method: 'POST',
        body: {
          userId: userRes.user.id,
          startDate,
          managerName: managerName || undefined,
          buddyName: buddyName || undefined,
          requiredDocumentTypeIds: selectedDocs.size ? [...selectedDocs] : undefined,
        },
      });
      onCreated({
        loginId: userRes.credentials.joineeId,
        temporaryPassword: userRes.credentials.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const deptName = departments.find((d) => d.id === departmentId)?.name ?? '—';


  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--xl" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
        {/* Header */}
        <div className="modal-head" style={{ borderBottom: '2px solid var(--color-amber-line)', padding: '1rem 1.5rem 0.7rem' }}>
          <div className="modal-head-text">
            <span className="overview-eyebrow" style={{ marginTop: 0, marginBottom: 6 }}>
              <span className="overview-eyebrow-dot" />
              Admin · Onboarding
            </span>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              Create New <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--color-accent)' }}>Joinee</span>
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--color-muted)' }}>
              Fill in the details below. An onboarding package and login credentials will be sent to the joinee's personal email.
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '14px 24px 12px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
          <StepDot num={1} label="Details" active={step === 1} done={step > 1} />
          <div style={{ width: 60, height: 2, background: step > 1 ? 'var(--color-success)' : 'var(--color-border)' }} />
          <StepDot num={2} label="Documents" active={step === 2} done={step > 2} />
          <div style={{ width: 60, height: 2, background: step > 2 ? 'var(--color-success)' : 'var(--color-border)' }} />
          <StepDot num={3} label="Confirm" active={step === 3} done={false} />
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '1rem 1.5rem' }}>
          {error && <p className="error-text">{error}</p>}

          {step === 1 && (
            <div style={{ background: 'var(--color-surface-alt)', border: '1px solid var(--color-border)', borderRadius: 16, padding: '22px 24px 20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                <label style={labelStyle}>
                  Full Name *
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Arjun Kapoor" required style={inputStyle} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={labelStyle}>
                    Personal Email *
                    <input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder="e.g. arjun@gmail.com" required style={inputStyle} />
                  </label>
                  <span className="field-hint" style={{ fontSize: 12, color: 'var(--color-muted)' }}>Credentials will be sent to this address</span>
                </div>
                <label style={labelStyle}>
                  Mobile Number *
                  <div className="phone-input-group">
                    <span className="phone-prefix">+91</span>
                    <span className="phone-divider">|</span>
                    <input
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      inputMode="numeric"
                      placeholder="9876543210"
                      maxLength={10}
                    />
                  </div>
                </label>
                <div style={labelStyle}>
                  Department *
                  <CustomSelect
                    value={departmentId}
                    onChange={setDepartmentId}
                    placeholder="Select a department"
                    options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    style={inputStyle}
                  />
                </div>
                <label style={labelStyle}>
                  Date of Joining *
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Manager Name
                  <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="Select manager" style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Buddy Name
                  <input value={buddyName} onChange={(e) => setBuddyName(e.target.value)} placeholder="Select buddy (optional)" style={inputStyle} />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ margin: '0 0 16px', color: 'var(--color-muted)', fontSize: 14 }}>Select which documents the joinee needs to upload:</p>
              <div className="doc-picker__grid">
                {docTypes.map((type) => (
                  <label key={type.id} className={`doc-picker__item${selectedDocs.has(type.id) ? ' is-selected' : ''}`}>
                    <input type="checkbox" checked={selectedDocs.has(type.id)} onChange={() => toggleDoc(type.id)} />
                    {type.label}
                  </label>
                ))}
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--color-accent-dark)', fontWeight: 600 }}>
                {selectedDocs.size} document{selectedDocs.size === 1 ? '' : 's'} selected
              </p>
            </div>
          )}

          {step === 3 && (
            <div>
              <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Joinee details</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', marginBottom: 20 }}>
                <ConfirmField label="Full Name" value={fullName} />
                <ConfirmField label="Personal Email" value={personalEmail} />
                <ConfirmField label="Department" value={deptName} />
                <ConfirmField label="Joining Date" value={startDate} />
                <ConfirmField label="Manager" value={managerName || 'Not assigned'} />
                <ConfirmField label="Buddy" value={buddyName || 'Not assigned'} />
              </div>

              <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Required documents ({selectedDocs.size})
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
                {docTypes.filter((t) => selectedDocs.has(t.id)).map((t) => (
                  <span key={t.id} className="dept-pill">{t.label}</span>
                ))}
                {selectedDocs.size === 0 && <span className="muted">None selected</span>}
              </div>

            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="modal-actions" style={{ display: 'flex', justifyContent: step === 1 ? 'flex-end' : 'space-between', padding: '0.7rem 1.5rem 0.9rem' }}>
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="btn-solid"
              disabled={step === 1 && !canProceedStep1()}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              className="btn-solid"
              disabled={busy}
              onClick={submit}
            >
              {busy ? 'Creating…' : 'Create & Send Invite →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 14,
  fontFamily: 'inherit',
};

function StepDot({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: done ? 'var(--color-success)' : active ? 'var(--color-accent)' : 'var(--color-border)',
        color: done || active ? '#fff' : 'var(--color-muted)',
        transition: 'all 0.2s ease',
      }}>
        {done ? '✓' : num}
      </div>
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-muted)' }}>
        {label}
      </span>
    </div>
  );
}

function ConfirmField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--color-surface-alt)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value || '—'}</div>
    </div>
  );
}

/* ============================================================
   Employee Profile Modal (inline, not redirecting)
   ============================================================ */

function EmployeeProfileModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<EmployeeProfile>(`/employee-profile/${userId}`)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load profile'));
    authedFetch<CredentialSummary>(`/auth/users/${userId}/credentials`)
      .then(setCredentials)
      .catch(() => setCredentials(null));
  }, [authedFetch, userId]);

  useEffect(load, [load]);

  async function review(uploadId: string, decision: 'approved' | 'rejected') {
    setReviewing(uploadId);
    try {
      const note = decision === 'rejected'
        ? window.prompt('Why is this being rejected?')
        : undefined;
      if (decision === 'rejected' && !note) return;
      await authedFetch(`/joinee-documents/uploads/${uploadId}/review`, {
        method: 'POST',
        body: { decision, ...(note ? { note } : {}) },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setReviewing(null);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await authedFetch<{
        credentials: { loginId: string; temporaryPassword: string };
      }>(`/auth/users/${userId}/regenerate-credentials`, { method: 'POST' });
      setCredentials({
        joineeId: res.credentials.loginId,
        temporaryPassword: res.credentials.temporaryPassword,
        awaitingFirstReset: true,
        hasLoggedIn: false,
        canRegenerate: true,
        note: 'New temporary password — shown once.',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate');
    } finally {
      setRegenerating(false);
    }
  }

  if (!profile) {
    return (
      <Modal title="Employee profile" onClose={onClose}>
        {error ? <p className="error-text">{error}</p> : <p className="muted">Loading…</p>}
      </Modal>
    );
  }

  const { user, onboarding, documents, tasks } = profile;

  return (
    <Modal title={user.full_name} onClose={onClose} wide>
      {error && <p className="error-text">{error}</p>}

      <section className="profile-section">
        <h3>Details</h3>
        <dl className="profile-grid">
          <div><dt>Joinee ID</dt><dd><code>{user.joinee_id}</code></dd></div>
          <div><dt>Mobile</dt><dd>{user.phone_number}</dd></div>
          <div><dt>Personal email</dt><dd>{user.personal_email ?? <span className="muted">Not recorded</span>}</dd></div>
          <div><dt>Department</dt><dd>{user.department_name ?? <span className="muted">None</span>}</dd></div>
          <div><dt>Date of joining</dt><dd>{formatDate(onboarding?.start_date) ?? <span className="muted">Not onboarded</span>}</dd></div>
          <div><dt>Account</dt><dd><span className={`status-pill status-${user.status}`}>{user.status}</span></dd></div>
        </dl>
      </section>

      {onboarding && (
        <section className="profile-section">
          <h3>Manager &amp; buddy</h3>
          <dl className="profile-grid">
            <div><dt>Manager</dt><dd>{onboarding.manager_name ?? <span className="muted">Not assigned</span>}</dd></div>
            <div><dt>Buddy</dt><dd>{onboarding.buddy_name ?? <span className="muted">Not assigned</span>}</dd></div>
          </dl>
        </section>
      )}

      <section className="profile-section">
        <h3>Documents ({documents.length})</h3>
        {documents.length === 0 ? (
          <p className="muted">No documents requested.</p>
        ) : (
          <ul className="doc-list">
            {documents.map((doc) => (
              <li key={doc.requirement_id} className="doc-list__item">
                <div className="doc-list__head">
                  <strong>{doc.label}</strong>
                  <span className={`status-pill status-${doc.status}`}>{doc.status.replace(/_/g, ' ')}</span>
                </div>
                {doc.upload_id && (
                  <>
                    <span className="field-hint">{doc.original_filename} · uploaded {formatDate(doc.uploaded_at)}</span>
                    <div className="doc-list__actions">
                      <button type="button" onClick={() =>
                        openFileInline(`/joinee-documents/uploads/${doc.upload_id}/file`, accessToken)
                          .catch(() => setError('Could not open document'))
                      }>Preview</button>
                      {doc.review_status === 'pending_review' && (
                        <>
                          <button type="button" disabled={reviewing === doc.upload_id} onClick={() => review(doc.upload_id!, 'approved')}>Approve</button>
                          <button type="button" className="btn-danger" disabled={reviewing === doc.upload_id} onClick={() => review(doc.upload_id!, 'rejected')}>Reject</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-section">
        <h3>Tasks — {tasks.requiredCompleted}/{tasks.requiredTotal} required done</h3>
        <h4 className="muted">Pending ({tasks.pending.length})</h4>
        <ul className="task-list">
          {tasks.pending.map((t: any) => (
            <li key={t.id}>{t.title}<span className={`status-pill status-${t.status}`}>{t.status}</span></li>
          ))}
          {tasks.pending.length === 0 && <li className="muted">Nothing outstanding.</li>}
        </ul>
      </section>

      {credentials && (
        <section className="profile-section profile-section--creds">
          <h3>Login credentials</h3>
          <div className="cred-row">
            <div className="cred-field">
              <span className="cred-label">Joinee ID</span>
              <span className="cred-value"><code>{credentials.joineeId}</code><CopyButton text={credentials.joineeId} /></span>
            </div>
            <div className="cred-field">
              <span className="cred-label">Temporary password</span>
              <span className="cred-value">
                {credentials.temporaryPassword ? (
                  <><code className="cred-secret">{credentials.temporaryPassword}</code><CopyButton text={credentials.temporaryPassword} /></>
                ) : (
                  <span className="cred-hidden">Not retrievable</span>
                )}
              </span>
            </div>
          </div>
          <div className="cred-actions">
            <button type="button" disabled={regenerating} onClick={regenerate}>
              {regenerating ? 'Issuing…' : 'Issue a new temporary password'}
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* */ }
  }
  return <button type="button" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function handleToggle() {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 240);
    }
    setOpen(!open);
  }

  return (
    <div className={`custom-select${open ? ' is-open' : ''}${dropUp ? ' drop-up' : ''}`} ref={ref} style={style}>
      <button type="button" className="custom-select__trigger" onClick={handleToggle}>
        <span className={selected ? '' : 'custom-select__placeholder'}>
          {selected ? selected.label : placeholder ?? 'Select…'}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 4.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul className="custom-select__menu">
          {options.map((opt) => (
            <li
              key={opt.value}
              className={`custom-select__option${opt.value === value ? ' is-active' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
              {opt.value === value && <span className="custom-select__check">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
