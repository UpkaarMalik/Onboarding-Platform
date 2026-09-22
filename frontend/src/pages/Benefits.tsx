import { useCallback, useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { describeError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import Reveal from '../components/Reveal';
import LoadError from '../components/LoadError';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface Entitlement {
  id: string;
  name: string;
  category: 'device' | 'insurance' | 'perks';
  description: string;
  scope: 'company_wide' | 'department';
  department_id: string | null;
  department_name: string | null;
  total_quantity: number | null;
  available_quantity: number | null;
  claimed: boolean;
  status: string;
}

interface Department {
  id: string;
  name: string;
}


/* ------------------------------------------------------------------ */
/*  SVG Icons                                                          */
/* ------------------------------------------------------------------ */
const DeviceIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="4" width="18" height="12" rx="2" stroke="#e8930c" strokeWidth="1.5" />
    <path d="M2 20h20" stroke="#e8930c" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const InsuranceIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 21s-7-4-7-9.5V5l7-3 7 3v6.5c0 5.5-7 9.5-7 9.5z" stroke="#e8930c" strokeWidth="1.5" fill="#fef7ec" />
  </svg>
);

const PerksIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="#e8930c" strokeWidth="1.5" strokeLinejoin="round" fill="#fef7ec" />
  </svg>
);

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M4 8l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CATEGORY_META: Record<string, { label: string; subtitle: string; icon: React.ReactNode }> = {
  device:    { label: 'Devices',   subtitle: 'Standard Issue Hardware',   icon: <DeviceIcon /> },
  insurance: { label: 'Insurance', subtitle: 'Full Coverage Protection',  icon: <InsuranceIcon /> },
  perks:     { label: 'Perks',     subtitle: 'Wellness, Food & Commute', icon: <PerksIcon /> },
};

/* ------------------------------------------------------------------ */
/*  Inline styles                                                      */
/* ------------------------------------------------------------------ */
const S = {
  page: { maxWidth: 960, margin: '0 auto', padding: '0.5rem 0 2rem' } as React.CSSProperties,

  breadcrumb: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as React.CSSProperties,
  breadcrumbTag: {
    fontSize: 11, fontWeight: 700, color: '#e8930c', border: '1.5px solid #e8930c',
    borderRadius: 6, padding: '3px 10px', letterSpacing: 0.5,
  } as React.CSSProperties,
  breadcrumbSep: { color: '#ccc' } as React.CSSProperties,
  breadcrumbText: { fontSize: 13, color: '#999' } as React.CSSProperties,

  headerRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 24, flexWrap: 'wrap' as const, gap: 12,
  } as React.CSSProperties,
  titleRow: { display: 'flex', alignItems: 'center', gap: 12 } as React.CSSProperties,
  title: { margin: 0, fontSize: 32, fontWeight: 800 } as React.CSSProperties,
  adminBadge: {
    fontSize: 11, fontWeight: 700, color: '#e8930c', border: '1.5px solid #e8930c',
    borderRadius: 6, padding: '3px 10px', letterSpacing: 0.5,
  } as React.CSSProperties,
  headerSub: { margin: '6px 0 0', color: '#777', fontSize: 14 } as React.CSSProperties,
  addBtn: {
    background: '#e8930c', color: '#fff', border: 'none', padding: '14px 28px',
    borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
    transition: 'all 0.2s ease', flexShrink: 0,
  } as React.CSSProperties,

  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0,
    background: '#fff', border: '1px solid #e8e4dc', borderRadius: 16,
    overflow: 'hidden', marginBottom: 24,
  } as React.CSSProperties,
  statCell: (last: boolean): React.CSSProperties => ({
    padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 14,
    borderRight: last ? 'none' : '1px solid #f2efe8',
  }),
  statIcon: (bg: string): React.CSSProperties => ({
    width: 44, height: 44, background: bg, borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  }),
  statLabel: { fontSize: 11, fontWeight: 600, color: '#999', letterSpacing: 0.5 } as React.CSSProperties,
  statValue: (color?: string): React.CSSProperties => ({
    fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
    color: color || 'inherit',
  }),
  greenDot: { width: 8, height: 8, background: '#34c759', borderRadius: '50%', display: 'inline-block' } as React.CSSProperties,

  tabContainer: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20, flexWrap: 'wrap' as const, gap: 12,
  } as React.CSSProperties,
  tabPillWrap: { display: 'flex', gap: 0, background: '#f0ebe3', borderRadius: 12, padding: 4 } as React.CSSProperties,
  tabPill: (active: boolean): React.CSSProperties => ({
    background: active ? '#fff' : 'transparent', border: 'none', padding: '10px 20px',
    fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#1a1a1a' : '#777',
    borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
  }),

  cardGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 16, marginBottom: 32,
  } as React.CSSProperties,

  benefitCard: (claimed: boolean): React.CSSProperties => ({
    background: '#fff', border: `1.5px solid ${claimed ? '#b5e2c4' : '#e8e4dc'}`,
    borderRadius: 16, padding: '20px 22px', cursor: 'pointer',
    transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column', gap: 12,
  }),
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } as React.CSSProperties,
  cardIconBox: (cat: string): React.CSSProperties => ({
    width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
    background: cat === 'device' ? '#fef7ec' : cat === 'insurance' ? '#eef6ff' : '#f5f0ff',
    border: `1.5px solid ${cat === 'device' ? '#f5d4a0' : cat === 'insurance' ? '#b3d4f7' : '#d4c4f0'}`,
  }),
  cardName: { fontSize: 15, fontWeight: 700, lineHeight: 1.3 } as React.CSSProperties,
  cardDesc: { fontSize: 12, color: '#777', lineHeight: 1.4 } as React.CSSProperties,
  cardFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderTop: '1px solid #f2efe8', paddingTop: 12, marginTop: 'auto',
  } as React.CSSProperties,
  badge: (bg: string, color: string, border: string): React.CSSProperties => ({
    fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
    borderRadius: 6, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4,
  }),
  quantityText: { fontSize: 11, color: '#999' } as React.CSSProperties,

  footer: {
    background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14, padding: '16px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap' as const, gap: 8,
  } as React.CSSProperties,
  footerText: { fontSize: 13, color: '#777' } as React.CSSProperties,
  footerLink: { color: '#e8930c', fontWeight: 600, textDecoration: 'none' } as React.CSSProperties,
  footerRight: { fontSize: 12, color: '#bbb' } as React.CSSProperties,

  overlay: {
    position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex',
    alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)',
    animation: 'benefitsFadeIn 0.2s ease',
  } as React.CSSProperties,
  modal: {
    background: '#fff', borderRadius: 20, width: 560, maxWidth: '90vw',
    maxHeight: '80vh', overflowY: 'auto' as const,
    boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
    animation: 'benefitsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  } as React.CSSProperties,
  modalHeader: {
    padding: '24px 28px', borderBottom: '1px solid #f2efe8',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  } as React.CSSProperties,
  modalTitle: { margin: 0, fontSize: 20, fontWeight: 800 } as React.CSSProperties,
  modalSub: { fontSize: 12, color: '#999', marginTop: 2 } as React.CSSProperties,
  closeBtn: {
    background: '#f5f4f2', border: 'none', width: 36, height: 36, borderRadius: '50%',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, color: '#555', flexShrink: 0,
  } as React.CSSProperties,
  modalBody: { padding: '20px 28px' } as React.CSSProperties,
  modalFooter: {
    padding: '16px 28px', borderTop: '1px solid #f2efe8',
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  } as React.CSSProperties,

  specRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 0', borderBottom: '1px solid #f5f3ee',
  } as React.CSSProperties,
  specLabel: { fontSize: 13, color: '#999' } as React.CSSProperties,
  specValue: { fontSize: 13, fontWeight: 600, color: '#1a1a1a', textAlign: 'right' as const, maxWidth: '60%' } as React.CSSProperties,

  noteBox: {
    marginTop: 16, background: '#fef7ec', border: '1px solid #f5d4a0',
    borderRadius: 12, padding: '12px 16px', fontSize: 12, color: '#8b5e1a', lineHeight: 1.5,
  } as React.CSSProperties,

  formGroup: { marginBottom: 16 } as React.CSSProperties,
  formLabel: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#333' } as React.CSSProperties,
  formInput: {
    width: '100%', padding: '10px 14px', border: '1.5px solid #e0dcd4', borderRadius: 10,
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s ease',
  } as React.CSSProperties,
  formSelect: {
    width: '100%', padding: '10px 14px', border: '1.5px solid #e0dcd4', borderRadius: 10,
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const,
    background: '#fff', cursor: 'pointer',
  } as React.CSSProperties,
  formTextarea: {
    width: '100%', padding: '10px 14px', border: '1.5px solid #e0dcd4', borderRadius: 10,
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const,
    resize: 'vertical' as const, minHeight: 80,
  } as React.CSSProperties,

  btnSolid: {
    background: '#e8930c', color: '#fff', border: 'none', padding: '10px 24px',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
  btnOutline: {
    background: '#f5f4f2', color: '#333', border: '1px solid #ddd', padding: '10px 24px',
    borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
  claimBtn: (claimed: boolean): React.CSSProperties => ({
    background: claimed ? '#edfcf2' : '#e8930c',
    color: claimed ? '#1a7a3a' : '#fff',
    border: claimed ? '1px solid #b5e2c4' : 'none',
    padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: claimed ? 'default' : 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 6,
  }),

  toast: (ok: boolean): React.CSSProperties => ({
    position: 'fixed', top: 24, right: 24, zIndex: 200,
    background: ok ? '#edfcf2' : '#fdecea', color: ok ? '#1a7a3a' : '#c0392b',
    border: `1px solid ${ok ? '#b5e2c4' : '#f5c6c0'}`, borderRadius: 14,
    padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
    animation: 'benefitsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)', maxWidth: 400,
  }),
  toastTitle: { fontSize: 13, fontWeight: 700 } as React.CSSProperties,
  toastMsg: { fontSize: 11, opacity: 0.8, marginTop: 1 } as React.CSSProperties,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function Benefits() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const isHR = user?.role === 'superadmin_hr';

  const [items, setItems] = useState<Entitlement[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<Entitlement | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState<{ title: string; msg: string; ok: boolean } | null>(null);

  /* Form state for Add Entitlement */
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'device' | 'insurance' | 'perks'>('device');
  const [formScope, setFormScope] = useState<string>('company_wide');
  const [formDesc, setFormDesc] = useState('');
  const [formQty, setFormQty] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  useEffect(() => {
    const id = 'benefits-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes benefitsFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes benefitsSlideUp { from { opacity: 0; transform: translateY(30px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    `;
    document.head.appendChild(style);
  }, []);

  const loadEntitlements = useCallback(async () => {
    try {
      const data = await authedFetch<{ data: Entitlement[] }>('/entitlements?limit=50');
      setItems(data.data);
      setLoadError(null);
    } catch (err) {
      // Was silent, which rendered the empty state — a sentence about the
      // company having no benefits — whenever the request merely failed.
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  const loadDepartments = useCallback(async () => {
    try {
      const data = await authedFetch<Department[]>('/departments');
      setDepartments(data);
    } catch (err) {
      // HR-only, and only fills a filter — a failure hides no benefit, so
      // it shares the same line rather than replacing the list.
      setLoadError(describeError(err));
    }
  }, [authedFetch]);

  const retryLoad = useCallback(async () => {
    setRetrying(true);
    await loadEntitlements();
    setRetrying(false);
  }, [loadEntitlements]);

  useEffect(() => {
    void loadEntitlements();
    if (isHR) void loadDepartments();
  }, [loadEntitlements, loadDepartments, isHR]);

  const grouped = items.reduce<Record<string, Entitlement[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  const claimedCount = items.filter((e) => e.claimed).length;
  const categoryKeys = ['device', 'insurance', 'perks'].filter((k) => grouped[k]?.length);
  const openCatItems = openCat ? grouped[openCat] ?? [] : [];

  const showToast = (title: string, msg: string, ok: boolean) => {
    setToast({ title, msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  async function handleClaim(entitlement: Entitlement) {
    if (entitlement.claimed || claiming) return;
    setClaiming(true);
    try {
      await authedFetch(`/entitlements/${entitlement.id}/claim`, { method: 'POST' });
      showToast(`${entitlement.name} Claimed`, 'Entitlement has been assigned to you.', true);
      setSelectedItem(null);
      await loadEntitlements();
    } catch {
      showToast('Claim Failed', 'Could not claim this entitlement. It may already be claimed or unavailable.', false);
    } finally {
      setClaiming(false);
    }
  }

  async function handleAddEntitlement(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setFormSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        category: formCategory,
        description: formDesc.trim(),
        scope: formScope === 'company_wide' ? 'company_wide' : 'department',
      };
      if (formScope !== 'company_wide') body.departmentId = formScope;
      if (formQty) body.totalQuantity = parseInt(formQty, 10);

      await authedFetch('/entitlements', { method: 'POST', body });
      showToast('Entitlement Created', `"${formName.trim()}" has been added.`, true);
      setShowAddModal(false);
      resetForm();
      await loadEntitlements();
    } catch {
      showToast('Creation Failed', 'Could not create entitlement. Please check the form and try again.', false);
    } finally {
      setFormSubmitting(false);
    }
  }

  function resetForm() {
    setFormName('');
    setFormCategory('device');
    setFormScope('company_wide');
    setFormDesc('');
    setFormQty('');
  }

  if (loading) return <BenefitsSkeleton />;

  return (
    <div style={S.page}>
      {/* ---------- Breadcrumb ---------- */}
      <Reveal>
        <div style={S.breadcrumb}>
          <span style={S.breadcrumbTag}>EMPLOYEE PORTAL</span>
          <span style={S.breadcrumbSep}>&rsaquo;</span>
          <span style={S.breadcrumbText}>Benefits &amp; Entitlements</span>
        </div>

        {/* ---------- Header ---------- */}
        <div style={S.headerRow}>
          <div>
            <div style={S.titleRow}>
              <h1 style={S.title}>Benefits</h1>
              {isHR && <span style={S.adminBadge}>HR ADMIN</span>}
            </div>
            <p style={S.headerSub}>
              {isHR
                ? 'Manage and assign employee entitlements across all categories.'
                : 'View and claim your available entitlements.'}
            </p>
          </div>
          {isHR && (
            <button
              type="button"
              style={S.addBtn}
              onClick={() => { resetForm(); setShowAddModal(true); }}
            >
              <PlusIcon /> Add Entitlement
            </button>
          )}
        </div>
      </Reveal>

      {/* ---------- Stats ---------- */}
      <Reveal delay={0.06}>
        <div style={S.statsGrid}>
          <div style={S.statCell(false)}>
            <div style={S.statIcon('#fef7ec')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16z" stroke="#e8930c" strokeWidth="1.3" />
                <path d="M7 10l2 2 4-4" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>CLAIMED</div>
              <div style={S.statValue()}>
                {claimedCount} / {items.length} <span style={S.greenDot} />
              </div>
            </div>
          </div>
          <div style={S.statCell(false)}>
            <div style={S.statIcon('#fef7ec')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="5" y="3" width="10" height="14" rx="1.5" stroke="#e8930c" strokeWidth="1.3" />
                <path d="M8 7h4M8 10h4" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>CATEGORIES</div>
              <div style={S.statValue()}>{categoryKeys.length} Categories</div>
            </div>
          </div>
          <div style={S.statCell(true)}>
            <div style={S.statIcon('#edfcf2')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="#1a7a3a" strokeWidth="1.3" />
                <circle cx="10" cy="10" r="3" stroke="#1a7a3a" strokeWidth="1.3" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>AVAILABLE</div>
              <div style={S.statValue('#1a7a3a')}>
                {items.filter((e) => !e.claimed).length} unclaimed
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ---------- Category Cards ---------- */}
      <Reveal delay={0.12}>
        <div style={S.cardGrid}>
          {categoryKeys.map((cat) => {
            const meta = CATEGORY_META[cat];
            const catItems = grouped[cat];
            const allClaimed = catItems.every((e) => e.claimed);
            return (
              <div
                key={cat}
                style={{
                  background: '#fff', border: '1px solid #e8e4dc', borderRadius: 16,
                  padding: '28px 24px', display: 'flex', flexDirection: 'column' as const,
                  alignItems: 'center', textAlign: 'center' as const, gap: 14,
                  cursor: 'pointer', transition: 'all 0.2s ease',
                }}
                onClick={() => { setOpenCat(cat); setSelectedItem(null); }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 8px 28px rgba(232,147,12,0.12)';
                  e.currentTarget.style.borderColor = '#e8930c';
                  e.currentTarget.style.transform = 'translateY(-3px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '';
                  e.currentTarget.style.borderColor = '#e8e4dc';
                  e.currentTarget.style.transform = '';
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: '#fef7ec', border: '1.5px solid #f5d4a0',
                }}>
                  {meta?.icon}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{meta?.label || cat}</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{meta?.subtitle}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, color: '#777',
                    background: '#f5f4f2', borderRadius: 6, padding: '3px 10px',
                  }}>
                    {catItems.length} item{catItems.length !== 1 ? 's' : ''}
                  </span>
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 11, fontWeight: 600,
                    color: allClaimed ? '#1a7a3a' : '#e8930c',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                      background: allClaimed ? '#34c759' : '#e8930c',
                    }} />
                    {allClaimed ? 'All Claimed' : 'Available'}
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#e8930c' }}>
                  View Details &rarr;
                </span>
              </div>
            );
          })}
        </div>
      </Reveal>

      {/* Order matters: an error must win over the empty state, or a failed
          fetch still tells the reader the company offers no benefits. */}
      {loadError && !loading && (
        <div style={{ padding: '24px 0' }}>
          <LoadError message={loadError} busy={retrying} onRetry={() => void retryLoad()} />
        </div>
      )}

      {items.length === 0 && !loading && !loadError && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#999' }}>
          <p style={{ fontSize: 16 }}>No entitlements available yet.</p>
          {isHR && <p style={{ fontSize: 13 }}>Use "+ Add Entitlement" to create one.</p>}
        </div>
      )}

      {/* ---------- Category Modal ---------- */}
      {openCat && !selectedItem && (
        <div
          style={S.overlay}
          onClick={() => setOpenCat(null)}
        >
          <div style={{ ...S.modal, width: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <h2 style={S.modalTitle}>{CATEGORY_META[openCat]?.label} Entitlements</h2>
                <div style={S.modalSub}>{CATEGORY_META[openCat]?.subtitle}</div>
              </div>
              <button type="button" style={S.closeBtn} onClick={() => setOpenCat(null)}>
                &#10005;
              </button>
            </div>

            <div style={S.modalBody}>
              {openCatItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    background: '#faf9f7', border: '1px solid #e8e4dc', borderRadius: 14,
                    padding: 16, marginBottom: 12, cursor: 'pointer', transition: 'all 0.15s ease',
                  }}
                  onClick={() => setSelectedItem(item)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#e8930c';
                    e.currentTarget.style.background = '#fef7ec';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#e8e4dc';
                    e.currentTarget.style.background = '#faf9f7';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 8, height: 8, background: '#e8930c', borderRadius: '50%', flexShrink: 0 }} />
                      <span style={{ fontSize: 14, fontWeight: 700 }}>{item.name}</span>
                      {item.claimed ? (
                        <span style={S.badge('#edfcf2', '#1a7a3a', '#b5e2c4')}>
                          <CheckIcon /> Claimed
                        </span>
                      ) : (
                        <span style={S.badge('#fef7ec', '#e8930c', '#f5d4a0')}>Available</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.scope === 'department' && item.department_name && (
                        <span style={S.badge('#f5f4f2', '#777', '#e0dcd4')}>{item.department_name}</span>
                      )}
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M6 4l4 4-4 4" stroke="#ccc" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#777', margin: '6px 0 0 18px' }}>{item.description}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0ece5' }}>
                    {item.total_quantity !== null ? (
                      <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace' }}>
                        {item.available_quantity}/{item.total_quantity} available
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace' }}>Unlimited</span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e8930c' }}>View Details &rarr;</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ ...S.modalFooter, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#1a7a3a' }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 14A6 6 0 108 2a6 6 0 000 12z" fill="#edfcf2" stroke="#1a7a3a" strokeWidth="1" />
                  <path d="M5.5 8l2 2 3-3" stroke="#1a7a3a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Direct sync with HR Operations system
              </div>
              <button type="button" style={S.btnOutline} onClick={() => setOpenCat(null)}>
                Done &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Footer ---------- */}
      <div style={S.footer}>
        <div style={S.footerText}>
          Need entitlement assistance? Contact HR Ops at{' '}
          <a href="mailto:people@andpayments.com" style={S.footerLink}>
            people@andpayments.com
          </a>
        </div>
        <div style={S.footerRight}>&copy; 2026 AndPayments Inc.</div>
      </div>

      {/* ---------- Detail Modal ---------- */}
      {selectedItem && (
        <div style={{ ...S.overlay, zIndex: 110 }} onClick={() => { setSelectedItem(null); setOpenCat(null); }}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={S.modalTitle}>{selectedItem.name}</h2>
                  {selectedItem.claimed ? (
                    <span style={S.badge('#edfcf2', '#1a7a3a', '#b5e2c4')}>Claimed</span>
                  ) : (
                    <span style={S.badge('#fef7ec', '#e8930c', '#f5d4a0')}>Available</span>
                  )}
                </div>
                <div style={S.modalSub}>
                  {CATEGORY_META[selectedItem.category]?.label} Entitlement
                  {selectedItem.department_name && ` · ${selectedItem.department_name}`}
                </div>
              </div>
              <button type="button" style={S.closeBtn} onClick={() => { setSelectedItem(null); setOpenCat(null); }}>
                &#10005;
              </button>
            </div>

            <div style={S.modalBody}>
              <div style={S.specRow}>
                <span style={S.specLabel}>Category</span>
                <span style={S.specValue}>{CATEGORY_META[selectedItem.category]?.label}</span>
              </div>
              <div style={S.specRow}>
                <span style={S.specLabel}>Scope</span>
                <span style={S.specValue}>
                  {selectedItem.scope === 'company_wide' ? 'All Departments' : selectedItem.department_name}
                </span>
              </div>
              {selectedItem.description && (
                <div style={S.specRow}>
                  <span style={S.specLabel}>Description</span>
                  <span style={S.specValue}>{selectedItem.description}</span>
                </div>
              )}
              {selectedItem.total_quantity !== null && (
                <>
                  <div style={S.specRow}>
                    <span style={S.specLabel}>Total Quantity</span>
                    <span style={S.specValue}>{selectedItem.total_quantity}</span>
                  </div>
                  <div style={S.specRow}>
                    <span style={S.specLabel}>Available</span>
                    <span style={{ ...S.specValue, color: (selectedItem.available_quantity ?? 0) > 0 ? '#1a7a3a' : '#c0392b' }}>
                      {selectedItem.available_quantity}
                    </span>
                  </div>
                </>
              )}
              <div style={S.specRow}>
                <span style={S.specLabel}>Status</span>
                <span style={{ ...S.specValue, color: selectedItem.claimed ? '#1a7a3a' : '#e8930c' }}>
                  {selectedItem.claimed ? 'Claimed' : 'Not Claimed'}
                </span>
              </div>

              <div style={S.noteBox}>
                {selectedItem.category === 'device'
                  ? 'Contact it-helpdesk@andpayments.com or visit 4th Floor IT Kiosk for hardware issues.'
                  : selectedItem.category === 'insurance'
                    ? '24/7 Emergency Helpline: 1800-425-2255. Pre-existing diseases covered from Day 1.'
                    : 'For any perk-related queries, reach out to people@andpayments.com.'}
              </div>
            </div>

            <div style={S.modalFooter}>
              {openCat ? (
                <button
                  type="button"
                  style={{
                    background: '#fff', border: '1px solid #ddd', padding: '8px 16px',
                    borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                  onClick={() => setSelectedItem(null)}
                >
                  &larr; Back to category
                </button>
              ) : (
                <button type="button" style={S.btnOutline} onClick={() => setSelectedItem(null)}>
                  Close
                </button>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                {!selectedItem.claimed && (
                  <button
                    type="button"
                    style={S.claimBtn(false)}
                    disabled={claiming}
                    onClick={() => handleClaim(selectedItem)}
                  >
                    {claiming ? 'Claiming...' : 'Claim Entitlement'}
                  </button>
                )}
                {selectedItem.claimed && (
                  <button type="button" style={S.claimBtn(true)} disabled>
                    <CheckIcon /> Already Claimed
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Add Entitlement Modal (HR only) ---------- */}
      {showAddModal && isHR && (
        <div style={S.overlay} onClick={() => setShowAddModal(false)}>
          <div style={{ ...S.modal, width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <div>
                <h2 style={S.modalTitle}>Add Entitlement</h2>
                <div style={S.modalSub}>Create a new benefit for employees</div>
              </div>
              <button type="button" style={S.closeBtn} onClick={() => setShowAddModal(false)}>
                &#10005;
              </button>
            </div>

            <form onSubmit={handleAddEntitlement}>
              <div style={S.modalBody}>
                <div style={S.formGroup}>
                  <label style={S.formLabel}>Name *</label>
                  <input
                    style={S.formInput}
                    type="text"
                    placeholder="e.g. MacBook Pro 16&quot; M3 Max"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                  />
                </div>

                <div style={S.formGroup}>
                  <label style={S.formLabel}>Category *</label>
                  <select
                    style={S.formSelect}
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as 'device' | 'insurance' | 'perks')}
                  >
                    <option value="device">Device</option>
                    <option value="insurance">Insurance</option>
                    <option value="perks">Perks</option>
                  </select>
                </div>

                <div style={S.formGroup}>
                  <label style={S.formLabel}>Department Scope *</label>
                  <select
                    style={S.formSelect}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                  >
                    <option value="company_wide">All Departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div style={S.formGroup}>
                  <label style={S.formLabel}>Description</label>
                  <textarea
                    style={S.formTextarea}
                    placeholder="Brief description of this entitlement..."
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                  />
                </div>

                <div style={S.formGroup}>
                  <label style={S.formLabel}>Total Quantity</label>
                  <input
                    style={S.formInput}
                    type="number"
                    min="0"
                    placeholder="Leave blank for unlimited"
                    value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                  />
                </div>
              </div>

              <div style={S.modalFooter}>
                <button type="button" style={S.btnOutline} onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" style={S.btnSolid} disabled={formSubmitting || !formName.trim()}>
                  {formSubmitting ? 'Creating...' : 'Create Entitlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------- Toast ---------- */}
      {toast && (
        <div style={S.toast(toast.ok)}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: toast.ok ? '#d4edda' : '#f8d7da', flexShrink: 0,
          }}>
            <CheckIcon />
          </div>
          <div>
            <div style={S.toastTitle}>{toast.title}</div>
            <div style={S.toastMsg}>{toast.msg}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function BenefitsSkeleton() {
  return (
    <div style={S.page}>
      <div style={{ marginBottom: 24 }}>
        <span className="skeleton-line" style={{ width: '9rem' }} />
        <span className="skeleton-line" style={{ width: '18rem', height: '2.2rem' }} />
        <span className="skeleton-line" style={{ width: '26rem' }} />
      </div>
      <div style={S.cardGrid}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...S.benefitCard(false), cursor: 'default' }}>
            <span className="skeleton-line" style={{ width: '60%', height: '1.1rem' }} />
            <span className="skeleton-line" style={{ width: '80%' }} />
            <span className="skeleton-line" style={{ width: '40%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
