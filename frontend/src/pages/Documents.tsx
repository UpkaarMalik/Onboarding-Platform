import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { API_BASE_URL, ApiError, downloadFile, openFileInline } from '../api/client';
import Reveal from '../components/Reveal';
import { BrandMark, BrandWord } from '../components/BrandLogo';
import artLeave from '../assets/policy-leave.png';
import artStealth from '../assets/policy-stealth.png';
import artHealth from '../assets/policy-health.png';
import artMeal from '../assets/policy-meal.png';
import artHandbook from '../assets/policy-handbook.png';
import artTravel from '../assets/policy-travel.png';
import { useToast, toastError } from '../components/Toast';

interface DocumentRow {
  id: string;
  title: string;
  department_id: string | null;
  category: Category | null;
  is_available: boolean;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Category helpers                                                   */
/* ------------------------------------------------------------------ */
type Category = 'health' | 'travel' | 'general';

/** The stored category wins; the title-based guess is only the fallback for
 *  rows uploaded before the category column existed (which are all NULL). */
function categoryFor(doc: { title: string; category?: Category | null }): Category {
  if (doc.category) return doc.category;
  const t = doc.title.toLowerCase();
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
  if (t.includes('stealth'))
    return 'What can and cannot be said publicly about unreleased work, and who to ask when you are unsure.';
  if (t.includes('leave') || t.includes('holiday'))
    return 'Leave types and balances, how to apply, approvals, carry-forward and the holiday calendar.';
  if (t.includes('safety') || t.includes('security'))
    return 'Workplace safety protocols, IT security guidelines, and emergency procedures.';
  return 'Company policy document covering important guidelines and procedures.';
}

/**
 * The picture on the right of each card.
 *
 * Matched on the title the same way descriptionFor and metaFor are, so a
 * policy HR renames slightly keeps its art, and one we have no picture for
 * simply renders without — the card's layout does not depend on it.
 *
 * Order matters below: 'travel' is tested before the generic cases because
 * "Domestic Travel Policy" would otherwise fall through to nothing.
 */
function artFor(title: string): { src: string; alt: string } | null {
  const t = title.toLowerCase();
  if (t.includes('insurance') || t.includes('health'))
    return { src: artHealth, alt: '' };
  if (t.includes('travel')) return { src: artTravel, alt: '' };
  if (t.includes('meal') || t.includes('reimbursement'))
    return { src: artMeal, alt: '' };
  if (t.includes('handbook')) return { src: artHandbook, alt: '' };
  if (t.includes('stealth')) return { src: artStealth, alt: '' };
  if (t.includes('leave') || t.includes('holiday'))
    return { src: artLeave, alt: '' };
  return null;
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
  if (t.includes('stealth'))
    return { label: 'Applies to', value: 'Everyone, from day one' };
  if (t.includes('leave'))
    return { label: 'Annual Balance', value: '12 CL · 8 SL · 15 EL' };
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
  'leave policy': [
    { heading: '1. Leave Year', text: 'The leave year runs 1 April to 31 March. Balances are credited at the start of it, or pro-rated from your joining date if you join part way through.' },
    { heading: '2. Casual Leave', text: '12 days a year, credited monthly at 1 per month. For short, planned absences. Apply at least 2 working days ahead where you can; CL cannot be carried into the next leave year.' },
    { heading: '3. Sick Leave', text: '8 days a year. No notice needed — tell your manager as early in the day as you can. A medical certificate is required for 3 or more consecutive days.' },
    { heading: '4. Earned Leave', text: '15 days a year, credited quarterly. For longer breaks: apply 2 weeks ahead for 3+ days. Up to 30 days carry forward, and anything above that is encashed at basic pay in March.' },
    { heading: '5. Applying & Approval', text: 'Raise every leave on the HR portal, including sick days applied for after the fact. Your reporting manager approves. Anything over 5 consecutive days also needs department head sign-off.' },
    { heading: '6. Public Holidays', text: '10 fixed holidays plus 2 floaters you choose yourself. The calendar is published each December. Floaters do not carry forward.' },
    { heading: '7. Special Leave', text: 'Maternity: 26 weeks. Paternity: 10 days, taken within 6 months of the birth. Bereavement: 5 days for immediate family. Marriage: 5 days, once during your employment.' },
    { heading: '8. Unpaid Leave', text: 'Beyond your balance, leave is unpaid and needs HR approval in advance. Extended unpaid leave pauses earned-leave accrual for that period.' },
  ],
  'stealth mode policy': [
    { heading: '1. What This Covers', text: 'Anything we are building that has not been announced: unreleased products and features, pilots, pricing work, client names not already public, and internal metrics. If it is not on our website or in a press release, treat it as unreleased.' },
    { heading: '2. Why We Work This Way', text: 'In payments, an unannounced feature is a competitive position and often a client confidence. Early disclosure can cost a launch, a partnership, or a regulatory conversation that was not ready to be had.' },
    { heading: '3. Outside the Company', text: 'Do not post, present, demo or describe unreleased work publicly — including conference talks, podcasts, personal blogs and social media. Screenshots of internal tools count, dashboards and test data included.' },
    { heading: '4. Your Own Profiles', text: 'Naming AND Payments as your employer and your role is entirely fine and encouraged. Describing what you are building, which clients you work with, or what is shipping next is not.' },
    { heading: '5. Friends, Family & Candidates', text: 'The same line applies in private. When referring a candidate, describe the team and the stack, not the roadmap — they can hear the rest once they have signed.' },
    { heading: '6. AI Tools & Third Parties', text: 'Do not paste production code, client data or unreleased plans into tools the company has not approved. Approved tools are listed on the IT portal; ask IT before using a new one for work.' },
    { heading: '7. When Something Goes Public', text: 'Launches are announced by Marketing with a date. Once it is out, share it freely — and please do. Before then, "I can\u2019t talk about that yet" is a complete and perfectly professional answer.' },
    { heading: '8. If You Are Unsure', text: 'Ask before you post, not after. Your manager, Marketing or legal@andpayments.com will give you a straight answer, usually within the day. Nobody has ever been in trouble for asking.' },
  ],
};

/** The date on the letterhead. Long-form month, because a policy's
 *  effective date is read once and not scanned — "04 Feb 2026" is a table
 *  cell, "4 February 2026" is a document. */
function formatDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

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
  const [params, setParams] = useSearchParams();

  /* The policy panel (HR only). One panel, two modes: 'new' posts a new
     document, 'edit' patches the one in editDoc. They share every field and
     the whole form, so a change to the scope picker or the file control
     cannot end up applying to only one of them. */
  const [panelMode, setPanelMode] = useState<'new' | 'edit' | null>(null);
  const [editDoc, setEditDoc] = useState<DocumentRow | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editTitle, setEditTitle] = useState('');
  /** '' is company-wide, matching the API's own three-valued departmentId. */
  const [editBranch, setEditBranch] = useState('');
  const [editCategory, setEditCategory] = useState<Category>('general');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Modal state */
  const [modalDoc, setModalDoc] = useState<DocumentRow | null>(null);

  const isAdmin = user?.role === 'superadmin_hr';
  const toast = useToast();

  /* Fetch documents */
  useEffect(() => {
    authedFetch<DocumentRow[]>('/documents')
      .then(setDocs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The branch list, for the edit panel's scope picker. Admins only: the
     endpoint is open to any signed-in user, but nobody else has a panel to
     put it in and it would be a request made for nothing. */
  useEffect(() => {
    if (!isAdmin) return;
    authedFetch<Department[]>('/departments').then(setDepartments).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  /**
   * Deep link from a policy card on the "Read the docs" task:
   * /documents?policy=Employee%20Handbook opens that policy straight away.
   *
   * Waits on `docs`, because the title means nothing until they have loaded —
   * the effect re-runs when they arrive. Matched loosely, the same way
   * policySectionsFor matches, so the card and the document row do not have to
   * agree on punctuation. The param is then dropped with replace, so closing
   * the modal and pressing Back does not reopen it, and a title matching
   * nothing simply leaves them on the list.
   */
  useEffect(() => {
    const wanted = params.get('policy');
    if (!wanted || docs.length === 0) return;
    const key = wanted.trim().toLowerCase();
    const match =
      docs.find((d) => d.title.toLowerCase() === key) ??
      docs.find((d) => d.title.toLowerCase().includes(key) || key.includes(d.title.toLowerCase()));
    if (match) setModalDoc(match);
    const next = new URLSearchParams(params);
    next.delete('policy');
    setParams(next, { replace: true });
  }, [params, docs, setParams]);

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

  function startEdit(doc: DocumentRow) {
    setPanelMode('edit');
    setEditDoc(doc);
    setEditTitle(doc.title);
    // The Active-for dropdown doubles as the availability control: an
    // unavailable policy shows 'Unavailable' selected regardless of its
    // department, because that is its salient state.
    setEditBranch(doc.is_available === false ? '__unavailable__' : (doc.department_id ?? ''));
    setEditCategory(categoryFor(doc));
    setEditFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function startCreate() {
    setPanelMode('new');
    setEditDoc(null);
    setEditTitle('');
    setEditBranch('');
    setEditCategory('general');
    setEditFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function closePanel() {
    setPanelMode(null);
    setEditDoc(null);
  }

  /**
   * Save the edit.
   *
   * Raw fetch rather than authedFetch, because that helper JSON-encodes its
   * body and sets a JSON Content-Type — which is exactly what a multipart
   * upload must not have. Same pattern, and the same CSRF double-submit, as
   * DocumentChecklist's upload.
   *
   * Only changed fields are sent. The API treats an omitted departmentId as
   * "leave the scope alone" and an empty one as "company-wide", so sending
   * the field unconditionally would be harmless here but sending a stale one
   * would not be — building the body from what actually differs keeps a
   * title-only edit from touching who can see the policy.
   */
  async function saveEdit() {
    const creating = panelMode === 'new';
    if (!creating && !editDoc) return;

    const title = editTitle.trim();
    if (!title) {
      toast({ tone: 'error', title: 'Give the policy a name' });
      return;
    }
    // Only on create. An edit without a file keeps the one already attached,
    // which is the common case; a new policy has nothing to fall back on and
    // the API rejects it with a 400 rather than storing a row pointing at
    // no document.
    if (creating && !editFile) {
      toast({
        tone: 'error',
        title: 'Choose a PDF',
        message: 'A new policy needs a document attached.',
      });
      return;
    }

    const form = new FormData();
    if (creating) {
      form.append('title', title);
      form.append('category', editCategory);
      const unavailable = editBranch === '__unavailable__';
      form.append('isAvailable', unavailable ? 'false' : 'true');
      // Appended ONLY when a real department is chosen. The create DTO
      // validates this with @IsUUID, so an empty string (company-wide) or
      // the unavailable sentinel would fail outright — both are expressed by
      // leaving the field out.
      if (editBranch && !unavailable) form.append('departmentId', editBranch);
      if (editFile) form.append('file', editFile);
    } else if (editDoc) {
      // Only what changed, so a title-only edit cannot touch who can see it.
      if (title !== editDoc.title) form.append('title', title);
      // The dropdown carries scope AND availability. Going unavailable leaves
      // the department alone (so turning it back on restores the old scope);
      // any real selection sets the department and makes it available again.
      const unavailable = editBranch === '__unavailable__';
      const newDept = unavailable ? (editDoc.department_id ?? '') : editBranch;
      if (newDept !== (editDoc.department_id ?? '')) form.append('departmentId', newDept);
      const nowAvailable = !unavailable;
      if (nowAvailable !== editDoc.is_available) form.append('isAvailable', String(nowAvailable));
      if (editCategory !== categoryFor(editDoc)) form.append('category', editCategory);
      if (editFile) form.append('file', editFile);
    }

    setSavingEdit(true);
    try {
      const csrf =
        document.cookie
          .split('; ')
          .find((c) => c.startsWith('csrf_token='))
          ?.slice('csrf_token='.length) ?? '';
      const res = await fetch(
        creating ? `${API_BASE_URL}/documents` : `${API_BASE_URL}/documents/${editDoc!.id}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
          body: form,
          credentials: 'include',
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Could not save' }));
        throw new Error(body.message ?? 'Could not save');
      }
      const saved: DocumentRow = await res.json();
      setDocs((prev) =>
        creating
          ? // Newest first, matching the order the API lists them in — so the
            // policy someone just uploaded is the one at the top, not one they
            // have to go looking for.
            [saved, ...prev]
          : prev.map((d) => (d.id === saved.id ? { ...d, ...saved } : d)),
      );
      closePanel();
      toast({ tone: 'success', title: creating ? 'Policy uploaded' : 'Policy updated' });
    } catch (err) {
      toast({
        tone: 'error',
        title: creating ? "Couldn't upload the policy" : "Couldn't update the policy",
        message: toastError(err, 'Something went wrong. Try again in a moment.'),
      });
    } finally {
      setSavingEdit(false);
    }
  }

  async function deletePolicy() {
    if (!editDoc) return;
    // A real confirm: delete removes the policy for everyone, and there is no
    // undo in the UI. Native rather than a second custom modal — one blocking
    // question does not earn its own component.
    if (!window.confirm(`Delete "${editDoc.title}"? This removes it for everyone.`)) return;

    setDeleting(true);
    try {
      const csrf =
        document.cookie
          .split('; ')
          .find((c) => c.startsWith('csrf_token='))
          ?.slice('csrf_token='.length) ?? '';
      const res = await fetch(`${API_BASE_URL}/documents/${editDoc.id}`, {
        method: 'DELETE',
        headers: csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Could not delete' }));
        throw new Error(body.message ?? 'Could not delete');
      }
      const removedId = editDoc.id;
      setDocs((prev) => prev.filter((d) => d.id !== removedId));
      closePanel();
      toast({ tone: 'success', title: 'Policy deleted' });
    } catch (err) {
      toast({
        tone: 'error',
        title: "Couldn't delete the policy",
        message: toastError(err, 'Something went wrong. Try again in a moment.'),
      });
    } finally {
      setDeleting(false);
    }
  }

  /* Filtering */
  const filtered = docs.filter((d) => {
    if (activeTab !== 'all' && categoryFor(d) !== activeTab) return false;
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  /* Category counts */
  const counts: Record<string, number> = { all: docs.length, health: 0, travel: 0, general: 0 };
  docs.forEach((d) => { counts[categoryFor(d)]++; });

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
            <button className="dp-upload-btn" onClick={startCreate}>
              <span className="dp-upload-plus">+</span> Upload New Policy
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
            const art = artFor(doc.title);
            return (
              <article
                className={`dp-card${art ? ' dp-card--art' : ''}`}
                key={doc.id}
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {/* The art sits in its own square column to the right of
                    everything else, so the text and the buttons keep a
                    straight left edge and only lose width. Decorative, so
                    alt is empty and it is out of the reading order — the
                    title and description already say what the policy is. */}
                {art && (
                  <div className="dp-card-art" aria-hidden="true">
                    <img src={art.src} alt={art.alt} loading="lazy" />
                  </div>
                )}

                {/* Everything but the art in one wrapper, so the card is a
                    two-column grid of exactly two items. Without it the
                    children are five separate grid items and the art can
                    only span the explicit grid — which has one row — so
                    the description and buttons ran underneath the picture
                    instead of beside it. */}
                <div className="dp-card-main">
                {/* HR's edit button, against the CARD's top-right corner
                    rather than the text column's. Inside .dp-card-main it
                    landed between the title and the picture, which reads as
                    floating in the middle of the card. */}
                {isAdmin && (
                  <button
                    className="dp-card-edit-btn"
                    aria-label={`Edit ${doc.title}`}
                    onClick={() => startEdit(doc)}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                )}

                {/* Top row: icon + title */}
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

                {/* Footer: the policy's live state. Unavailable is HR-only —
                    employees never receive an unavailable row — so this line
                    reads 'Active' for everyone but HR looking at one they have
                    taken down. */}
                <div className={`dp-card-footer${doc.is_available === false ? ' dp-card-footer--off' : ''}`}>
                  <span className="dp-card-status-dot" />
                  {doc.is_available === false
                    ? 'Unavailable'
                    : doc.department_id
                      ? 'Active (1 dept)'
                      : 'Active (All depts)'}
                </div>
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

      {/* ---- Policy panel (HR only) ----
           Upload and edit are the same form in two modes. Behind the same
           role check as the buttons that open it, and behind the same one
           the API enforces on POST and PATCH /documents. Showing this to an
           employee would be showing them a form that can only ever 403. */}
      {isAdmin && panelMode && (
        <div className="dp-modal-overlay" onClick={() => !savingEdit && closePanel()}>
          <div className="dp-modal dp-edit" onClick={(e) => e.stopPropagation()}>
            <div className="dp-modal-header">
              <h2 className="dp-modal-title">
                {panelMode === 'new' ? 'Upload a policy' : 'Edit policy'}
              </h2>
              <button
                className="modal-close"
                onClick={closePanel}
                disabled={savingEdit}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form
              className="dp-edit-body"
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
            >
              <label className="dp-edit-field">
                <span>Policy name</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Remote Work Policy"
                  autoFocus
                />
              </label>

              <label className="dp-edit-field">
                <span>Active for</span>
                <select value={editBranch} onChange={(e) => setEditBranch(e.target.value)}>
                  {/* Empty value, not a sentinel string: it is what the API
                      reads as company-wide, so nothing has to translate it. */}
                  <option value="">Everyone — company-wide</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                  {/* Not a branch but a state: chosen here because availability
                      and scope are the one thing HR sets about who sees a
                      policy. Its own sentinel value, split out on save. */}
                  <option value="__unavailable__">Unavailable — hidden from staff</option>
                </select>
                <span className="dp-edit-hint">
                  {editBranch === '__unavailable__'
                    ? 'Hidden from everyone but HR. Nothing is deleted — set a branch here to bring it back.'
                    : 'A branch policy is only visible to people in that department. Company-wide is visible to everyone.'}
                </span>
              </label>

              <label className="dp-edit-field">
                <span>Type</span>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as Category)}
                >
                  <option value="health">Health &amp; Wellness</option>
                  <option value="travel">Travel &amp; Expenses</option>
                  <option value="general">General</option>
                </select>
                <span className="dp-edit-hint">
                  Sets which tab the policy appears under. Pick the one people would look in.
                </span>
              </label>

              <div className="dp-edit-field">
                <span>Policy PDF</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  hidden
                  onChange={(e) => setEditFile(e.target.files?.[0] ?? null)}
                />
                <div className="dp-edit-file">
                  <button
                    type="button"
                    className="dp-btn dp-btn--read"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose file
                  </button>
                  <span className="dp-edit-filename">
                    {editFile
                      ? editFile.name
                      : panelMode === 'new'
                        ? 'No file chosen yet'
                        : 'Keeping the current file'}
                  </span>
                  {editFile && (
                    <button
                      type="button"
                      className="dp-edit-clear"
                      onClick={() => {
                        setEditFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      Undo
                    </button>
                  )}
                </div>
                <span className="dp-edit-hint">
                  {panelMode === 'new'
                    ? 'Required. The policy is listed as soon as you save, so upload the document you want people reading.'
                    : 'Optional. Leave it alone to change only the name or the branch — most edits are not a new document.'}
                </span>
              </div>

              <div className="dp-edit-actions">
                {/* Delete lives on the left, apart from Cancel and Save, so
                    the destructive action is not sitting where the eye lands
                    for 'the safe button'. Edit mode only — there is nothing
                    to delete while creating. */}
                {panelMode === 'edit' && (
                  <button
                    type="button"
                    className="dp-edit-delete"
                    onClick={() => void deletePolicy()}
                    disabled={savingEdit || deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete policy'}
                  </button>
                )}
                <span className="dp-edit-actions-spacer" />
                <button type="button" onClick={closePanel} disabled={savingEdit || deleting}>
                  Cancel
                </button>
                <button type="submit" className="dp-btn dp-btn--read" disabled={savingEdit || deleting}>
                  {savingEdit
                    ? panelMode === 'new'
                      ? 'Uploading…'
                      : 'Saving…'
                    : panelMode === 'new'
                      ? 'Upload policy'
                      : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- Policy Detail Modal ----
           Dressed as a real document rather than as a dialog with text in
           it: a letterhead with the AndBoard logotype, the title set in the
           heading serif, a meta strip, then the clauses. The highlighter
           that used to sit up here is gone — it painted a yellow block on a
           section and kept nothing: the marks lived in component state, so
           they were lost the moment the modal closed. A highlight you
           cannot come back to is a control that looks like a feature. */}
      {modalDoc && (
        <div className="dp-modal-overlay" onClick={() => setModalDoc(null)}>
          <div className="dp-modal dp-doc" onClick={(e) => e.stopPropagation()}>
            {/* The app's own ✕, not this page's private one: .modal-close is
                what every other modal closes with, down to the quarter turn
                on hover. .dp-doc-close only puts it in the corner. */}
            <button
              className="modal-close dp-doc-close"
              onClick={() => setModalDoc(null)}
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>

            <div className="dp-modal-body dp-doc-body">
              <header className="dp-doc-head">
                <span className="dp-doc-brand">
                  <BrandMark className="dp-doc-mark" />
                  <BrandWord className="dp-doc-word" brandClassName="dp-doc-word-accent" />
                </span>
                <span className="dp-doc-issuer">AND Payments · People &amp; Culture</span>

                <h2 className="dp-doc-title">{modalDoc.title}</h2>

                <dl className="dp-doc-meta">
                  <div>
                    <dt>Applies to</dt>
                    <dd>{modalDoc.department_id ? 'Your department' : 'Everyone'}</dd>
                  </div>
                  <div>
                    <dt>Effective</dt>
                    <dd>{formatDocDate(modalDoc.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Clauses</dt>
                    <dd>{modalSections.length || '—'}</dd>
                  </div>
                </dl>
              </header>

              {modalSections.map((section, idx) => (
                <div key={`${modalDoc.title}-${idx}`} className="dp-modal-section dp-doc-section">
                  <h4 className="dp-modal-section-heading">{section.heading}</h4>
                  <p className="dp-modal-section-text">{section.text}</p>
                </div>
              ))}

              {modalSections.length > 0 && (
                <footer className="dp-doc-foot">
                  <span className="dp-doc-foot-rule" aria-hidden="true" />
                  <p>
                    <strong>AndBoard</strong> · Internal policy document. Shared with you as an
                    employee of AND Payments — please do not circulate outside the company.
                  </p>
                </footer>
              )}
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
