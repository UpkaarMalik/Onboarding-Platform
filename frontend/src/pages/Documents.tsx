import { useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, downloadFile, openFileInline } from '../api/client';
import Reveal from '../components/Reveal';

interface DocumentRow {
  id: string;
  title: string;
  department_id: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Category helpers                                                   */
/* ------------------------------------------------------------------ */
type Category = 'health' | 'travel' | 'general';

function categoryFor(title: string): Category {
  const t = title.toLowerCase();
  if (t.includes('health') || t.includes('insurance')) return 'health';
  if (t.includes('travel') || t.includes('meal') || t.includes('reimbursement') || t.includes('expense'))
    return 'travel';
  return 'general';
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All Policies',
  health: 'Health & Wellness',
  travel: 'Travel & Expenses',
  general: 'General',
};

/* ------------------------------------------------------------------ */
/*  Icon + color helpers                                               */
/* ------------------------------------------------------------------ */
interface IconMeta {
  iconBg: string;
  iconBorder: string;
  icon: React.ReactNode;
}

function iconMetaFor(title: string): IconMeta {
  const t = title.toLowerCase();
  if (t.includes('insurance') || t.includes('health'))
    return {
      iconBg: '#fdecea',
      iconBorder: '#f5c6c0',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            stroke="#c0392b"
            strokeWidth="1.5"
            fill="#fdecea"
          />
        </svg>
      ),
    };
  if (t.includes('travel'))
    return {
      iconBg: '#e8f5e9',
      iconBorder: '#b5e2c4',
      icon: (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M3 11l16-8-8 16-2-6z" stroke="#2e7d32" strokeWidth="1.5" fill="#e8f5e9" />
        </svg>
      ),
    };
  if (t.includes('meal') || t.includes('reimbursement') || t.includes('expense'))
    return {
      iconBg: '#e8f5e9',
      iconBorder: '#b5e2c4',
      icon: (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="7" stroke="#2e7d32" strokeWidth="1.5" fill="#e8f5e9" />
          <text x="11" y="15" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2e7d32">
            $
          </text>
        </svg>
      ),
    };
  // general / handbook / fallback
  return {
    iconBg: '#f3e8ff',
    iconBorder: '#d8b4fe',
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="4" y="3" width="14" height="16" rx="2" stroke="#6b21a8" strokeWidth="1.5" fill="#f3e8ff" />
        <path d="M8 7h6M8 11h6" stroke="#6b21a8" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  Description / meta derived from title                              */
/* ------------------------------------------------------------------ */
function descriptionFor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('insurance') || t.includes('health'))
    return 'Complete healthcare and hospitalization coverage details for employees & dependents.';
  if (t.includes('travel'))
    return 'Guidelines on travel bookings, allowances, stay tiers, and flight booking windows.';
  if (t.includes('meal') || t.includes('reimbursement'))
    return 'Per-diem food meal allowances during customer visits, late shifts, and travels.';
  if (t.includes('handbook'))
    return 'Code of conduct, working norms, leave policies, and organizational hierarchy rules.';
  if (t.includes('leave') || t.includes('holiday'))
    return 'Company leave calendar, holiday list, and time-off request guidelines.';
  if (t.includes('safety') || t.includes('security'))
    return 'Workplace safety protocols, IT security guidelines, and emergency procedures.';
  return 'Company policy document covering important guidelines and procedures.';
}

function metaFor(title: string): { label: string; value: string } {
  const t = title.toLowerCase();
  if (t.includes('insurance') || t.includes('health'))
    return { label: 'Coverage', value: '₹10,00,000 Sum' };
  if (t.includes('travel'))
    return { label: 'Tier Level', value: 'Metro / Non-metro' };
  if (t.includes('meal') || t.includes('reimbursement'))
    return { label: 'Allowance', value: 'Monthly Sodexo / Zeta' };
  if (t.includes('handbook'))
    return { label: 'Version', value: 'v3.4 (2025 rev)' };
  return { label: 'Type', value: 'Policy Document' };
}

/* ------------------------------------------------------------------ */
/*  Policy content for the detail modal                                */
/* ------------------------------------------------------------------ */
interface PolicySection {
  heading: string;
  text: string;
}

const POLICY_CONTENT: Record<string, PolicySection[]> = {
  'group health insurance': [
    { heading: '1. Eligibility', text: 'All permanent employees and their dependents (spouse, up to 2 children, parents) are covered from the date of joining.' },
    { heading: '2. Sum Insured', text: 'Base cover of ₹10,00,000 per family per year. Optional top-up of ₹5,00,000 available at employee cost.' },
    { heading: '3. Coverage', text: 'Hospitalization (room rent up to ₹8,000/day), pre & post hospitalization (30/60 days), daycare procedures, ambulance charges up to ₹3,000.' },
    { heading: '4. Exclusions', text: 'Pre-existing diseases covered after 2-year waiting period. Cosmetic procedures, dental (unless due to accident), and self-inflicted injuries are excluded.' },
    { heading: '5. Claims Process', text: 'Cashless: Use network hospital list on insurer portal. Reimbursement: Submit bills within 15 days of discharge to HR with discharge summary and prescriptions.' },
    { heading: '6. Maternity', text: 'Covered up to ₹75,000 for normal delivery and ₹1,00,000 for C-section after 9 months of continuous employment.' },
  ],
  'domestic travel policy': [
    { heading: '1. Booking Process', text: 'All travel must be pre-approved by reporting manager via the Travel portal. Book flights and hotels through the approved travel desk only.' },
    { heading: '2. Flight Booking', text: 'Economy class for all employees. Book at least 7 days in advance. Same-day bookings require VP approval. Preferred airlines: IndiGo, Air India.' },
    { heading: '3. Hotel Allowance', text: 'Metro cities: up to ₹5,000/night. Non-metro: up to ₹3,500/night. Actuals reimbursed with GST invoice. No 5-star hotels without Director approval.' },
    { heading: '4. Daily Allowance', text: 'Metro: ₹1,200/day. Non-metro: ₹800/day. Covers meals and local transport. No receipts needed for DA; claimed per diem on Travel portal.' },
    { heading: '5. Local Transport', text: 'Cab via company Ola Business account. Auto/metro reimbursed at actuals with receipt. Personal vehicle: ₹9/km for car, ₹5/km for two-wheeler.' },
    { heading: '6. Cancellation', text: 'Cancel at least 24 hours before departure. No-show charges borne by employee unless medical emergency (with proof).' },
  ],
  'meal reimbursement policy': [
    { heading: '1. Eligibility', text: 'All full-time employees are eligible. Interns and contractors receive a fixed monthly meal stipend of ₹2,000.' },
    { heading: '2. Sodexo/Zeta Card', text: 'Monthly meal benefit of ₹2,200 loaded to Sodexo/Zeta card by the 1st of each month. Tax-exempt up to ₹50/meal as per IT rules.' },
    { heading: '3. Client Visit Meals', text: 'Meals during client visits reimbursed at actuals up to ₹500/meal. Submit itemized bill (not just card slip) within 7 days.' },
    { heading: '4. Late Shift Meals', text: 'Employees working past 8:30 PM can claim ₹350 for dinner. Order via Swiggy Corporate or submit receipt. Manager approval auto-applied if punch-out after 8:30 PM.' },
    { heading: '5. Team Outings', text: 'Team lunch/dinner budget: ₹750/person/quarter. Must be pre-approved by department head. Alcohol not reimbursable.' },
    { heading: '6. Travel Meals', text: 'Covered under Domestic Travel Policy daily allowance. Do not double-claim meal reimbursement and travel DA for the same day.' },
  ],
  'employee handbook': [
    { heading: '1. Working Hours', text: 'Standard: 9:30 AM – 6:30 PM, Mon–Fri. Flexible timing allowed (core hours 11 AM–4 PM). WFH: up to 2 days/week with manager approval.' },
    { heading: '2. Leave Policy', text: 'Casual Leave: 12/year. Sick Leave: 8/year (medical certificate for 3+ days). Earned Leave: 15/year (encashable up to 30 days). Public Holidays: 10 fixed + 2 floaters.' },
    { heading: '3. Code of Conduct', text: 'Maintain professional behavior. Zero tolerance for harassment, discrimination, or substance abuse. Violations subject to disciplinary action up to termination.' },
    { heading: '4. Dress Code', text: 'Business casual Mon–Thu. Casual Fridays. No flip-flops, shorts, or sleeveless tops. Client-facing days: formal attire.' },
    { heading: '5. IT & Security', text: 'Use only company-approved devices and software. Do not share credentials. Lock screen when away. Report lost devices within 2 hours to IT.' },
    { heading: '6. Reporting Structure', text: 'Every employee reports to a designated manager. Skip-level meetings quarterly. Grievances can be raised anonymously via the Ethics Hotline.' },
  ],
};

function policySectionsFor(title: string): PolicySection[] {
  const key = title.toLowerCase();
  if (POLICY_CONTENT[key]) return POLICY_CONTENT[key];
  for (const [k, v] of Object.entries(POLICY_CONTENT)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return [];
}

/* ================================================================== */
/*  Component                                                          */
/* ================================================================== */
export default function Documents() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | Category>('all');

  /* Modal state */
  const [modalDoc, setModalDoc] = useState<DocumentRow | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlighted, setHighlighted] = useState<Record<string, boolean>>({});

  const isAdmin = user?.role === 'superadmin_hr';

  /* Fetch documents */
  useEffect(() => {
    authedFetch<DocumentRow[]>('/documents')
      .then(setDocs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Download handler */
  async function handleDownload(doc: DocumentRow) {
    setDownloadingId(doc.id);
    try {
      await downloadFile(`/documents/${doc.id}/download`, `${doc.title}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setDownloadingId(null);
    }
  }

  /* Read online (fallback for docs without modal content) */
  async function handleReadOnline(doc: DocumentRow) {
    const sections = policySectionsFor(doc.title);
    if (sections.length > 0) {
      setModalDoc(doc);
      setHighlightMode(false);
      setHighlighted({});
      return;
    }
    setOpeningId(doc.id);
    try {
      await openFileInline(`/documents/${doc.id}/download`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setOpeningId(null);
    }
  }

  /* Filtering */
  const filtered = docs.filter((d) => {
    if (activeTab !== 'all' && categoryFor(d.title) !== activeTab) return false;
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  /* Category counts */
  const counts: Record<string, number> = { all: docs.length, health: 0, travel: 0, general: 0 };
  docs.forEach((d) => { counts[categoryFor(d.title)]++; });

  /* Highlight toggle in modal */
  function toggleSection(key: string) {
    if (!highlightMode) return;
    setHighlighted((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  }

  const modalSections = modalDoc ? policySectionsFor(modalDoc.title) : [];

  return (
    <div className="dp-page">
      {/* ---- Header ---- */}
      <section className="dp-header">
        <div className="dp-header-left">
          <div className="dp-icon-box">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="3" width="16" height="18" rx="2" stroke="#e8930c" strokeWidth="1.5" />
              <path d="M8 7h8M8 11h8M8 15h4" stroke="#e8930c" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="dp-title-row">
              <h1 className="dp-title">Company Policies</h1>
              {isAdmin && <span className="dp-admin-badge">ADMIN VIEW</span>}
            </div>
            <p className="dp-subtitle">
              Company policies and compliance handbooks available to every department.
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="dp-header-actions">
            <button className="dp-upload-btn">
              <span className="dp-upload-plus">+</span> Upload New Policy
            </button>
            <button className="dp-settings-btn" aria-label="Settings">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}
      </section>

      {error && <p className="error-text">{error}</p>}

      {/* ---- Filter tabs + Search ---- */}
      <div className="dp-toolbar">
        <div className="dp-tab-group">
          {(['all', 'health', 'travel', 'general'] as const).map((tab) => (
            <button
              key={tab}
              className={`dp-tab ${activeTab === tab ? 'dp-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {CATEGORY_LABELS[tab]} ({counts[tab]})
            </button>
          ))}
        </div>
        <div className="dp-search-wrap">
          <svg className="dp-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="#999" strokeWidth="1.3" />
            <path d="M11 11l3 3" stroke="#999" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            className="dp-search-input"
            type="text"
            placeholder="Search policies & guides..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ---- Cards grid ---- */}
      {loading && <p className="dp-loading">Loading...</p>}

      <Reveal>
        <div className="dp-grid">
          {filtered.map((doc, i) => {
            const im = iconMetaFor(doc.title);
            const desc = descriptionFor(doc.title);
            const meta = metaFor(doc.title);
            return (
              <article
                className="dp-card"
                key={doc.id}
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {/* Top row: icon + title + edit */}
                <div className="dp-card-top">
                  <div className="dp-card-icon-row">
                    <div
                      className="dp-card-icon"
                      style={{ background: im.iconBg, borderColor: im.iconBorder }}
                    >
                      {im.icon}
                    </div>
                    <div className="dp-card-title-block">
                      <h2 className="dp-card-title">{doc.title}</h2>
                      <span className="dp-card-format">PDF</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <button className="dp-card-edit-btn" aria-label="Edit policy">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M9.5 3.5l3 3" stroke="#e8930c" strokeWidth="1.3" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Description */}
                <p className="dp-card-desc">{desc}</p>

                {/* Meta row */}
                <div className="dp-card-meta">
                  <span className="dp-card-meta-label">{meta.label}</span>
                  <span className="dp-card-meta-value">{meta.value}</span>
                </div>

                {/* Buttons */}
                <div className="dp-card-actions">
                  <button
                    className="dp-btn dp-btn--read"
                    disabled={openingId === doc.id}
                    onClick={() => handleReadOnline(doc)}
                  >
                    {openingId === doc.id ? 'Opening...' : 'Read'}{' '}
                    <span className="dp-btn-arrow">&rarr;</span>
                  </button>
                  <button
                    className="dp-btn dp-btn--download"
                    disabled={downloadingId === doc.id}
                    onClick={() => handleDownload(doc)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 2v7M4 7l3 3 3-3M3 11h8" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {downloadingId === doc.id ? 'Downloading...' : 'Download'}
                  </button>
                </div>

                {/* Footer */}
                <div className="dp-card-footer">
                  <span className="dp-card-status-dot" />
                  Active (All depts)
                </div>
              </article>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="dp-empty">
              <div className="dp-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="3" width="16" height="18" rx="2" stroke="#a8a29e" strokeWidth="1.5" />
                  <path d="M8 7h8M8 11h8M8 15h4" stroke="#a8a29e" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <p>{search ? 'No documents match your search.' : 'No documents yet.'}</p>
            </div>
          )}
        </div>
      </Reveal>

      {/* ---- Bottom section (admin) ---- */}
      {isAdmin && (
        <Reveal>
          <div className="dp-dept-section">
            <div className="dp-dept-left">
              <div className="dp-dept-icon">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="3" y="3" width="16" height="16" rx="2" stroke="#e8930c" strokeWidth="1.3" />
                  <path d="M3 9h16M9 9v10" stroke="#e8930c" strokeWidth="1.3" />
                </svg>
              </div>
              <div>
                <div className="dp-dept-title">Department-Specific Handbooks & Access Controls</div>
                <div className="dp-dept-subtitle">
                  Configure department visibility, upload revisions, and manage joinee access permissions.
                </div>
              </div>
            </div>
            <span className="dp-dept-link">
              Manage permissions <span>&rsaquo;</span>
            </span>
          </div>
        </Reveal>
      )}

      {/* ---- Policy Detail Modal ---- */}
      {modalDoc && (
        <div className="dp-modal-overlay" onClick={() => { setModalDoc(null); setHighlightMode(false); }}>
          <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dp-modal-header">
              <h2 className="dp-modal-title">{modalDoc.title}</h2>
              <div className="dp-modal-controls">
                <button
                  className={`dp-highlight-btn ${highlightMode ? 'dp-highlight-btn--on' : ''}`}
                  onClick={() => setHighlightMode((prev) => !prev)}
                  aria-label="Toggle highlight mode"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 15h4l7-7-4-4-7 7v4z" stroke="#e8930c" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M10 4l4 4" stroke="#e8930c" strokeWidth="1.3" />
                    <rect x="2" y="15" width="14" height="2" rx="1" fill="#ffe066" opacity="0.7" />
                  </svg>
                </button>
                {highlightMode && (
                  <span className="dp-highlight-label">Highlighting ON</span>
                )}
                <button
                  className="dp-modal-close"
                  onClick={() => { setModalDoc(null); setHighlightMode(false); }}
                  aria-label="Close"
                >
                  &times;
                </button>
              </div>
            </div>
            <div className="dp-modal-body">
              {modalSections.map((section, idx) => {
                const key = `${modalDoc.title}-${idx}`;
                const isHl = !!highlighted[key];
                return (
                  <div
                    key={key}
                    className={`dp-modal-section ${highlightMode ? 'dp-modal-section--clickable' : ''} ${isHl ? 'dp-modal-section--highlighted' : ''}`}
                    onClick={() => toggleSection(key)}
                  >
                    <h4 className="dp-modal-section-heading">{section.heading}</h4>
                    <p className="dp-modal-section-text">{section.text}</p>
                  </div>
                );
              })}
              {modalSections.length === 0 && (
                <div className="dp-modal-fallback">
                  <p>Detailed sections are not available for this document.</p>
                  <button
                    className="dp-btn dp-btn--read"
                    onClick={async () => {
                      setOpeningId(modalDoc.id);
                      try {
                        await openFileInline(`/documents/${modalDoc.id}/download`);
                      } catch (err) {
                        alert(err instanceof ApiError ? err.message : 'Something went wrong');
                      } finally {
                        setOpeningId(null);
                      }
                    }}
                  >
                    {openingId === modalDoc.id ? 'Opening...' : 'Open PDF'} <span className="dp-btn-arrow">&rarr;</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
