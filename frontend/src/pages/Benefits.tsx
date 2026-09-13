import { useCallback, useEffect, useState } from 'react';
import Reveal from '../components/Reveal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface BenefitItemSpec {
  label: string;
  value: string;
  /** Optional value color override (e.g. green for "Enrolled") */
  vc?: string;
}

interface BenefitItem {
  key: string;
  name: string;
  desc: string;
  detail: string;
  badge: string;
  tagId: string;
  /* Detail modal fields */
  title: string;
  subtitle: string;
  note: string;
  details: BenefitItemSpec[];
}

interface BenefitCategory {
  key: string;
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  items: BenefitItem[];
}

/* ------------------------------------------------------------------ */
/*  SVG Icons for each category                                        */
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

/* ------------------------------------------------------------------ */
/*  Demo data                                                          */
/* ------------------------------------------------------------------ */
const CATEGORIES: BenefitCategory[] = [
  {
    key: 'device',
    name: 'Device',
    subtitle: 'Standard Issue Hardware',
    icon: <DeviceIcon />,
    items: [
      {
        key: 'laptop', name: 'Laptop', desc: 'Workstation asset for daily operations',
        detail: 'Apple MacBook Pro 16" M3 Max / 36GB / 1TB SSD', badge: 'Specs & Tag', tagId: 'ASSET-2026-APL-9842',
        title: 'Laptop Workstation', subtitle: 'Hardware Asset · IT Entitlement',
        note: 'IT Support: Contact it-helpdesk@andpayments.com or visit 4th Floor IT Kiosk for hardware accessories or warranty repair.',
        details: [
          { label: 'Asset Tag', value: 'ASSET-2026-APL-9842' },
          { label: 'Serial Number', value: 'C02G80X0MD6R' },
          { label: 'Model', value: 'Apple MacBook Pro 16" (Space Black)' },
          { label: 'Processor', value: 'Apple M3 Max (14-core CPU, 30-core GPU)' },
          { label: 'Memory & Storage', value: '36GB Unified / 1TB NVMe SSD' },
          { label: 'Assigned Date', value: 'January 15, 2026' },
          { label: 'MDM Compliance', value: 'Jamf Pro Enrolled', vc: '#1a7a3a' },
        ],
      },
      {
        key: 'desktop', name: 'Desktop Monitor', desc: 'External display for workstation setup',
        detail: 'Dell UltraSharp 27" 4K USB-C Hub Monitor U2723QE', badge: 'Specs & Tag', tagId: 'ASSET-2026-DIS-1104',
        title: 'Desktop Monitor', subtitle: 'Hardware Asset · Display Entitlement',
        note: 'For display issues or calibration, contact it-helpdesk@andpayments.com.',
        details: [
          { label: 'Asset Tag', value: 'ASSET-2026-DIS-1104' },
          { label: 'Model', value: 'Dell UltraSharp U2723QE 27" 4K' },
          { label: 'Resolution', value: '3840 x 2160 (4K UHD)' },
          { label: 'Connectivity', value: 'USB-C Hub (90W PD), HDMI 2.0, DP 1.4' },
          { label: 'Assigned Date', value: 'January 15, 2026' },
          { label: 'Warranty', value: 'Dell Premium Support until Jan 2029', vc: '#1a7a3a' },
        ],
      },
    ],
  },
  {
    key: 'insurance',
    name: 'Insurance',
    subtitle: 'Full Coverage Protection',
    icon: <InsuranceIcon />,
    items: [
      {
        key: 'health_insurance', name: 'Health Insurance', desc: 'Company-sponsored group health insurance',
        detail: 'Comprehensive medical + dental + OPD for employee & family', badge: 'Policy #882190', tagId: 'TPA-STAR-882190',
        title: 'Health Insurance', subtitle: 'Group Medical Coverage · Policy #882190',
        note: '24/7 Emergency Helpline: 1800-425-2255. Pre-existing diseases covered from Day 1.',
        details: [
          { label: 'Sum Insured', value: '₹10,00,000' },
          { label: 'Provider', value: 'Star Health / Care' },
          { label: 'TPA Desk ID', value: 'TPA-STAR-882190' },
          { label: 'Policy Type', value: 'Comprehensive Group Floater Plan' },
          { label: 'Covered Members', value: 'Self + Spouse + 2 Children' },
          { label: 'OPD & Dental', value: '₹25,000 / year included', vc: '#1a7a3a' },
        ],
      },
      {
        key: 'house_insurance', name: 'House Insurance', desc: 'Standard house insurance sponsored by company',
        detail: 'Coverage against property damage, fire, natural incidents', badge: 'Standard Plan', tagId: 'HDFC-ERGO-HS-4491',
        title: 'House Insurance', subtitle: 'Corporate Home & Property Protection',
        note: 'Relocating? Address updates reflect within 48 hours. Auto-renews on Dec 31, 2026.',
        details: [
          { label: 'Policy Number', value: 'HO-99412-AND' },
          { label: 'Insurer', value: 'HDFC ERGO General' },
          { label: 'Coverage Limit', value: '₹50,00,000 (Structure + Contents)' },
          { label: 'Included Hazards', value: 'Fire, Burglary, Electrical, Storm' },
          { label: 'Registered Address', value: 'Flat 402, Prestige Palms, Indiranagar, Bengaluru' },
          { label: 'Renewal Date', value: 'Auto-renews Dec 31, 2026' },
        ],
      },
    ],
  },
  {
    key: 'perks',
    name: 'Perks',
    subtitle: 'Wellness, Food & Commute',
    icon: <PerksIcon />,
    items: [
      {
        key: 'gym_membership', name: 'Gym Membership', desc: 'Cult.fit Elite · Multi-center',
        detail: 'Unlimited multi-city access with cultpass ELITE Corporate', badge: 'Cult.fit Access', tagId: 'CULT-PRO-8821',
        title: 'Gym Membership', subtitle: 'Fitness & Corporate Wellness',
        note: 'Linked to corporate email: atul@andpayments.com',
        details: [
          { label: 'Partner Program', value: 'cultpass ELITE / Corporate' },
          { label: 'Access Code', value: 'CULT-PRO-8821' },
          { label: 'Gym & Fitness', value: 'Unlimited Multi-City Access' },
          { label: 'Valid Through', value: 'December 31, 2026', vc: '#1a7a3a' },
          { label: 'Formats', value: 'Gym, Swimming, Yoga, Boxing' },
          { label: 'Primary Center', value: 'Cult Indiranagar (450m from office)' },
        ],
      },
      {
        key: 'meal_card', name: 'Meal Card', desc: '$450 / month allowance',
        detail: 'Tax-exempt food voucher on Zeta / Sodexo wallet', badge: 'Zeta / Sodexo', tagId: 'ZETA-FOOD-5532',
        title: 'Meal Card & Cafeteria', subtitle: 'Tax-Exempt Food Voucher & Wallet',
        note: 'Card damaged or lost? Request instant replacement via HR portal.',
        details: [
          { label: 'Monthly Allowance', value: '$450 / mo (100% Tax Free)', vc: '#1a7a3a' },
          { label: 'Provider', value: 'Zeta / Sodexo · RuPay Platinum' },
          { label: 'Card Number', value: '•••• 4921 (Exp: 09/29)' },
          { label: 'Recharge Cycle', value: '1st of each calendar month' },
          { label: 'Current Balance', value: '$384.50', vc: '#1a7a3a' },
          { label: 'Merchants', value: 'Campus Cafe, Swiggy, Zomato, Zepto, Blinkit' },
          { label: 'Online Transactions', value: 'Enabled', vc: '#1a7a3a' },
        ],
      },
      {
        key: 'parking', name: 'Parking', desc: 'Slot #B2-104 · Tower B',
        detail: 'RFID tag spot with direct elevator access', badge: 'Basement B2', tagId: 'PARK-B2-SLOT-42',
        title: 'Campus Parking Slot', subtitle: 'Reserved Vehicle Parking · RFID Access',
        note: 'Changed car or registration plate? Update vehicle info in the HR portal.',
        details: [
          { label: 'Designated Bay', value: 'Slot #B2-104 · Basement Level 2' },
          { label: 'Registered Plate', value: 'KA 01 MG 4420 (Sedan)' },
          { label: 'Campus Building', value: 'Tower B, Primary HQ Campus' },
          { label: 'RFID Access', value: 'Active (Auto-Sync)', vc: '#1a7a3a' },
          { label: 'EV Charging', value: '7.4kW Type-2 AC at Bay 104' },
          { label: 'Elevator', value: 'Core Lift Bank 3 (Direct to 4F/6F)' },
        ],
      },
    ],
  },
];

const TOTAL_ITEMS = 7;

type TabKey = 'all' | 'device' | 'insurance' | 'perks';
const TABS: { id: TabKey; label: string }[] = [
  { id: 'all', label: 'All Categories (3)' },
  { id: 'device', label: 'Devices (2)' },
  { id: 'insurance', label: 'Insurance (2)' },
  { id: 'perks', label: 'Perks (3)' },
];

/* ------------------------------------------------------------------ */
/*  Inline style objects                                               */
/* ------------------------------------------------------------------ */
const S = {
  page: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '0.5rem 0 2rem',
  } as React.CSSProperties,

  /* Breadcrumb */
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  breadcrumbTag: {
    fontSize: 11,
    fontWeight: 700,
    color: '#e8930c',
    border: '1.5px solid #e8930c',
    borderRadius: 6,
    padding: '3px 10px',
    letterSpacing: 0.5,
  } as React.CSSProperties,
  breadcrumbSep: { color: '#ccc' } as React.CSSProperties,
  breadcrumbText: { fontSize: 13, color: '#999' } as React.CSSProperties,

  /* Header row */
  headerRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
    flexWrap: 'wrap' as const,
    gap: 12,
  } as React.CSSProperties,
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,
  title: {
    margin: 0,
    fontSize: 32,
    fontWeight: 800,
  } as React.CSSProperties,
  adminBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#e8930c',
    border: '1.5px solid #e8930c',
    borderRadius: 6,
    padding: '3px 10px',
    letterSpacing: 0.5,
  } as React.CSSProperties,
  headerSub: {
    margin: '6px 0 0',
    color: '#777',
    fontSize: 14,
  } as React.CSSProperties,
  addBtn: {
    background: '#e8930c',
    color: '#fff',
    border: 'none',
    padding: '14px 28px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.2s ease',
    flexShrink: 0,
  } as React.CSSProperties,

  /* Stats grid */
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 0,
    background: '#fff',
    border: '1px solid #e8e4dc',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
  } as React.CSSProperties,
  statCell: (borderRight: boolean, borderBottom: boolean): React.CSSProperties => ({
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    borderRight: borderRight ? '1px solid #f2efe8' : 'none',
    borderBottom: borderBottom ? '1px solid #f2efe8' : 'none',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  }),
  statIcon: (bg: string): React.CSSProperties => ({
    width: 44,
    height: 44,
    background: bg,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }),
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#999',
    letterSpacing: 0.5,
  } as React.CSSProperties,
  statValue: (color?: string): React.CSSProperties => ({
    fontSize: 16,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: color || 'inherit',
  }),
  greenDot: {
    width: 8,
    height: 8,
    background: '#34c759',
    borderRadius: '50%',
    display: 'inline-block',
  } as React.CSSProperties,

  /* Tab filter pills */
  tabContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    flexWrap: 'wrap' as const,
    gap: 12,
  } as React.CSSProperties,
  tabPillWrap: {
    display: 'flex',
    gap: 0,
    background: '#f0ebe3',
    borderRadius: 12,
    padding: 4,
  } as React.CSSProperties,
  tabPill: (active: boolean): React.CSSProperties => ({
    background: active ? '#fff' : 'transparent',
    border: 'none',
    padding: '10px 20px',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? '#1a1a1a' : '#777',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s ease',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
  }),
  tabStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#777',
  } as React.CSSProperties,

  /* Category cards */
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 20,
    marginBottom: 32,
  } as React.CSSProperties,
  card: {
    background: '#fff',
    border: '1px solid #e8e4dc',
    borderRadius: 16,
    padding: '28px 24px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    textAlign: 'center' as const,
    gap: 14,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  } as React.CSSProperties,
  cardIconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fef7ec',
    border: '1.5px solid #f5d4a0',
  } as React.CSSProperties,
  cardName: {
    fontSize: 18,
    fontWeight: 700,
  } as React.CSSProperties,
  cardSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  } as React.CSSProperties,
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  cardCount: {
    fontSize: 12,
    fontWeight: 600,
    color: '#777',
    background: '#f5f4f2',
    borderRadius: 6,
    padding: '3px 10px',
  } as React.CSSProperties,
  cardActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    color: '#1a7a3a',
  } as React.CSSProperties,
  cardSmallDot: {
    width: 7,
    height: 7,
    background: '#34c759',
    borderRadius: '50%',
    display: 'inline-block',
  } as React.CSSProperties,
  cardLink: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e8930c',
  } as React.CSSProperties,

  /* Footer */
  footer: {
    background: '#fff',
    border: '1px solid #e8e4dc',
    borderRadius: 14,
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 8,
  } as React.CSSProperties,
  footerText: {
    fontSize: 13,
    color: '#777',
  } as React.CSSProperties,
  footerLink: {
    color: '#e8930c',
    fontWeight: 600,
    textDecoration: 'none',
  } as React.CSSProperties,
  footerRight: {
    fontSize: 12,
    color: '#bbb',
  } as React.CSSProperties,

  /* Overlay */
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
    animation: 'benefitsFadeIn 0.2s ease',
  } as React.CSSProperties,

  /* Category modal */
  catModal: {
    background: '#fff',
    borderRadius: 20,
    width: 640,
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
    animation: 'benefitsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  } as React.CSSProperties,
  modalHeader: {
    padding: '24px 28px',
    borderBottom: '1px solid #f2efe8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  modalTitle: {
    margin: 0,
    fontSize: 20,
    fontWeight: 800,
  } as React.CSSProperties,
  modalSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  } as React.CSSProperties,
  closeBtn: {
    background: '#f5f4f2',
    border: 'none',
    width: 36,
    height: 36,
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#555',
    flexShrink: 0,
  } as React.CSSProperties,
  catModalBody: {
    padding: '20px 28px',
  } as React.CSSProperties,
  catItemCard: {
    background: '#faf9f7',
    border: '1px solid #e8e4dc',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  catItemRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  catItemLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,
  orangeDot: {
    width: 8,
    height: 8,
    background: '#e8930c',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  } as React.CSSProperties,
  catItemName: {
    fontSize: 14,
    fontWeight: 700,
  } as React.CSSProperties,
  activeBadge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#1a7a3a',
    background: '#edfcf2',
    border: '1px solid #b5e2c4',
    borderRadius: 4,
    padding: '2px 8px',
  } as React.CSSProperties,
  deactivatedBadge: {
    fontSize: 10,
    fontWeight: 600,
    color: '#c0392b',
    background: '#fdecea',
    border: '1px solid #f5c6c0',
    borderRadius: 4,
    padding: '2px 8px',
  } as React.CSSProperties,
  catItemRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  } as React.CSSProperties,
  grayBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#777',
    background: '#f5f4f2',
    borderRadius: 4,
    padding: '2px 8px',
  } as React.CSSProperties,
  catItemDesc: {
    fontSize: 12,
    color: '#777',
    margin: '6px 0 0 18px',
  } as React.CSSProperties,
  catItemDetail: {
    fontSize: 11,
    color: '#999',
    margin: '4px 0 0 18px',
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: 8,
    padding: '6px 10px',
  } as React.CSSProperties,
  catItemFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px solid #f0ece5',
  } as React.CSSProperties,
  tagId: {
    fontSize: 10,
    color: '#bbb',
    fontFamily: 'monospace',
  } as React.CSSProperties,
  viewSpecs: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e8930c',
  } as React.CSSProperties,
  catModalFooter: {
    padding: '16px 28px',
    borderTop: '1px solid #f2efe8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  syncNote: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#1a7a3a',
  } as React.CSSProperties,
  doneBtn: {
    background: '#f5f4f2',
    border: '1px solid #ddd',
    padding: '8px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  /* Item detail modal */
  itemModal: {
    background: '#fff',
    borderRadius: 20,
    width: 560,
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
    animation: 'benefitsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
  } as React.CSSProperties,
  itemTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  itemModalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
  } as React.CSSProperties,
  itemModalBody: {
    padding: '20px 28px',
  } as React.CSSProperties,
  specRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #f5f3ee',
  } as React.CSSProperties,
  specLabel: {
    fontSize: 13,
    color: '#999',
  } as React.CSSProperties,
  specValue: (color?: string): React.CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    color: color || '#1a1a1a',
    textAlign: 'right',
    maxWidth: '60%',
  }),
  noteBox: {
    marginTop: 16,
    background: '#fef7ec',
    border: '1px solid #f5d4a0',
    borderRadius: 12,
    padding: '12px 16px',
    fontSize: 12,
    color: '#8b5e1a',
    lineHeight: 1.5,
  } as React.CSSProperties,
  itemModalFooter: {
    padding: '16px 28px',
    borderTop: '1px solid #f2efe8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  backBtn: {
    background: '#fff',
    border: '1px solid #ddd',
    padding: '8px 16px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,
  rightBtns: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,
  toggleBtn: (isDeactivated: boolean): React.CSSProperties => ({
    background: isDeactivated ? '#edfcf2' : '#fdecea',
    color: isDeactivated ? '#1a7a3a' : '#c0392b',
    border: `1px solid ${isDeactivated ? '#b5e2c4' : '#f5c6c0'}`,
    padding: '8px 18px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  }),
  closeModalBtn: {
    background: '#f5f4f2',
    border: '1px solid #ddd',
    padding: '8px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,

  /* Toast */
  toast: (isActive: boolean): React.CSSProperties => ({
    position: 'fixed',
    top: 24,
    right: 24,
    zIndex: 200,
    background: isActive ? '#edfcf2' : '#fdecea',
    color: isActive ? '#1a7a3a' : '#c0392b',
    border: `1px solid ${isActive ? '#b5e2c4' : '#f5c6c0'}`,
    borderRadius: 14,
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
    animation: 'benefitsSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    maxWidth: 400,
  }),
  toastIcon: (isActive: boolean): React.CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isActive ? '#d4edda' : '#f8d7da',
    flexShrink: 0,
  }),
  toastTitle: {
    fontSize: 13,
    fontWeight: 700,
  } as React.CSSProperties,
  toastMsg: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 1,
  } as React.CSSProperties,
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function Benefits() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [deactivated, setDeactivated] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ title: string; msg: string; isActive: boolean } | null>(null);

  /* Inject keyframe animations once */
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

  /* Derived */
  const activeCount = TOTAL_ITEMS - Object.keys(deactivated).length;
  const filteredCategories = activeTab === 'all' ? CATEGORIES : CATEGORIES.filter((c) => c.key === activeTab);

  const openCategory = openCat ? CATEGORIES.find((c) => c.key === openCat) : null;
  const openItemData = openItem
    ? CATEGORIES.flatMap((c) => c.items).find((it) => it.key === openItem)
    : null;

  /* Handlers */
  const handleToggle = useCallback(() => {
    if (!openItem || !openItemData) return;
    const wasDeactivated = !!deactivated[openItem];
    setDeactivated((prev) => {
      const next = { ...prev };
      if (wasDeactivated) delete next[openItem];
      else next[openItem] = true;
      return next;
    });
    const action = wasDeactivated ? 'Activated' : 'Deactivated';
    setToast({
      title: `${openItemData.title} ${action}`,
      msg: 'HR notification sent. Change synced with operations system.',
      isActive: wasDeactivated,
    });
    setTimeout(() => setToast(null), 3500);
  }, [openItem, openItemData, deactivated]);

  return (
    <div style={S.page}>
      {/* ---------- Breadcrumb ---------- */}
      <Reveal>
        <div style={S.breadcrumb}>
          <span style={S.breadcrumbTag}>HR OPERATIONS PORTAL</span>
          <span style={S.breadcrumbSep}>&rsaquo;</span>
          <span style={S.breadcrumbText}>Employee Entitlements</span>
        </div>

        {/* ---------- Header ---------- */}
        <div style={S.headerRow}>
          <div>
            <div style={S.titleRow}>
              <h1 style={S.title}>Benefits</h1>
              <span style={S.adminBadge}>ADMIN VIEW</span>
            </div>
            <p style={S.headerSub}>
              Manage and assign employee entitlements across all categories.
            </p>
          </div>
          <button type="button" style={S.addBtn}>
            <span style={{ fontSize: 18 }}>+</span> Add Entitlement
          </button>
        </div>
      </Reveal>

      {/* ---------- Stats Grid (2x2) ---------- */}
      <Reveal delay={0.06}>
        <div style={S.statsGrid}>
          {/* Active Status */}
          <div style={S.statCell(true, true)}>
            <div style={S.statIcon('#fef7ec')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16z" stroke="#e8930c" strokeWidth="1.3" />
                <path d="M7 10l2 2 4-4" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>ACTIVE STATUS</div>
              <div style={S.statValue()}>
                {activeCount} / {TOTAL_ITEMS} Assigned <span style={S.greenDot} />
              </div>
            </div>
          </div>
          {/* Categories */}
          <div style={S.statCell(false, true)}>
            <div style={S.statIcon('#fef7ec')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="5" y="3" width="10" height="14" rx="1.5" stroke="#e8930c" strokeWidth="1.3" />
                <path d="M8 7h4M8 10h4" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>CATEGORIES</div>
              <div style={S.statValue()}>3 Categories</div>
            </div>
          </div>
          {/* Renewal Cycle */}
          <div style={S.statCell(true, false)}>
            <div style={S.statIcon('#fef7ec')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="3" y="4" width="14" height="12" rx="1.5" stroke="#e8930c" strokeWidth="1.3" />
                <path d="M3 8h14M7 4v-2M13 4v-2" stroke="#e8930c" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>RENEWAL CYCLE</div>
              <div style={S.statValue()}>Annual (Dec 2026)</div>
            </div>
          </div>
          {/* Desk Support */}
          <div style={S.statCell(false, false)}>
            <div style={S.statIcon('#edfcf2')}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="#1a7a3a" strokeWidth="1.3" />
                <circle cx="10" cy="10" r="3" stroke="#1a7a3a" strokeWidth="1.3" />
              </svg>
            </div>
            <div>
              <div style={S.statLabel}>DESK SUPPORT</div>
              <div style={S.statValue('#1a7a3a')}>HR Desk Open</div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ---------- Filter Tabs ---------- */}
      <Reveal delay={0.12}>
        <div style={S.tabContainer}>
          <div style={S.tabPillWrap}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                style={S.tabPill(activeTab === tab.id)}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={S.tabStatus}>
            <span style={S.greenDot} />
            All 3 categories active &amp; verified
          </div>
        </div>
      </Reveal>

      {/* ---------- Category Cards ---------- */}
      <Reveal delay={0.18}>
        <div style={S.cardGrid}>
          {filteredCategories.map((cat) => (
            <div
              key={cat.key}
              style={S.card}
              onClick={() => { setOpenCat(cat.key); setOpenItem(null); }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.boxShadow = '0 8px 28px rgba(232,147,12,0.12)';
                el.style.borderColor = '#e8930c';
                el.style.transform = 'translateY(-3px)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.boxShadow = '';
                el.style.borderColor = '#e8e4dc';
                el.style.transform = '';
              }}
            >
              <div style={S.cardIconBox}>{cat.icon}</div>
              <div>
                <div style={S.cardName}>{cat.name}</div>
                <div style={S.cardSub}>{cat.subtitle}</div>
              </div>
              <div style={S.cardMeta}>
                <span style={S.cardCount}>{cat.items.length} item{cat.items.length !== 1 ? 's' : ''}</span>
                <span style={S.cardActive}>
                  <span style={S.cardSmallDot} />
                  All Active
                </span>
              </div>
              <span style={S.cardLink}>View Details &rarr;</span>
            </div>
          ))}
        </div>
      </Reveal>

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

      {/* ---------- Category Modal ---------- */}
      {openCat && !openItem && openCategory && (
        <div
          style={S.overlay}
          onClick={() => { setOpenCat(null); setOpenItem(null); }}
        >
          <div style={S.catModal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={S.modalHeader}>
              <div>
                <h2 style={S.modalTitle}>{openCategory.name} Entitlements</h2>
                <div style={S.modalSub}>{openCategory.subtitle}</div>
              </div>
              <button
                type="button"
                style={S.closeBtn}
                onClick={() => { setOpenCat(null); setOpenItem(null); }}
              >
                &#10005;
              </button>
            </div>

            {/* Item list */}
            <div style={S.catModalBody}>
              {openCategory.items.map((item) => {
                const isDeactivated = !!deactivated[item.key];
                return (
                  <div
                    key={item.key}
                    style={S.catItemCard}
                    onClick={() => setOpenItem(item.key)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#e8930c';
                      e.currentTarget.style.background = '#fef7ec';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#e8e4dc';
                      e.currentTarget.style.background = '#faf9f7';
                    }}
                  >
                    <div style={S.catItemRow}>
                      <div style={S.catItemLeft}>
                        <span style={S.orangeDot} />
                        <span style={S.catItemName}>{item.name}</span>
                        <span style={isDeactivated ? S.deactivatedBadge : S.activeBadge}>
                          {isDeactivated ? 'Deactivated' : 'Active'}
                        </span>
                      </div>
                      <div style={S.catItemRight}>
                        <span style={S.grayBadge}>{item.badge}</span>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M6 4l4 4-4 4" stroke="#ccc" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                    <div style={S.catItemDesc}>{item.desc}</div>
                    <div style={S.catItemDetail}>{item.detail}</div>
                    <div style={S.catItemFooter}>
                      <span style={S.tagId}>{item.tagId}</span>
                      <span style={S.viewSpecs}>View Full Specs &rarr;</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={S.catModalFooter}>
              <div style={S.syncNote}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 14A6 6 0 108 2a6 6 0 000 12z" fill="#edfcf2" stroke="#1a7a3a" strokeWidth="1" />
                  <path d="M5.5 8l2 2 3-3" stroke="#1a7a3a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Direct sync with HR Operations system
              </div>
              <button
                type="button"
                style={S.doneBtn}
                onClick={() => { setOpenCat(null); setOpenItem(null); }}
              >
                Done &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Item Detail Modal ---------- */}
      {openItem && openItemData && (
        <div
          style={{ ...S.overlay, zIndex: 110 }}
          onClick={() => { setOpenItem(null); setOpenCat(null); }}
        >
          <div style={S.itemModal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={S.modalHeader}>
              <div>
                <div style={S.itemTitleRow}>
                  <h2 style={S.itemModalTitle}>{openItemData.title}</h2>
                  <span style={deactivated[openItem] ? S.deactivatedBadge : S.activeBadge}>
                    {deactivated[openItem] ? 'Deactivated' : 'Active'}
                  </span>
                </div>
                <div style={S.modalSub}>{openItemData.subtitle}</div>
              </div>
              <button
                type="button"
                style={S.closeBtn}
                onClick={() => { setOpenItem(null); setOpenCat(null); }}
              >
                &#10005;
              </button>
            </div>

            {/* Spec rows */}
            <div style={S.itemModalBody}>
              {openItemData.details.map((row) => (
                <div key={row.label} style={S.specRow}>
                  <span style={S.specLabel}>{row.label}</span>
                  <span style={S.specValue(row.vc)}>{row.value}</span>
                </div>
              ))}
              {openItemData.note && (
                <div style={S.noteBox}>{openItemData.note}</div>
              )}
            </div>

            {/* Footer */}
            <div style={S.itemModalFooter}>
              <button
                type="button"
                style={S.backBtn}
                onClick={() => setOpenItem(null)}
              >
                &larr; Back to category
              </button>
              <div style={S.rightBtns}>
                <button
                  type="button"
                  style={S.toggleBtn(!!deactivated[openItem])}
                  onClick={handleToggle}
                >
                  {deactivated[openItem] ? 'Activate' : 'Deactivate'}
                </button>
                <button
                  type="button"
                  style={S.closeModalBtn}
                  onClick={() => { setOpenItem(null); setOpenCat(null); }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Toast Notification ---------- */}
      {toast && (
        <div style={S.toast(toast.isActive)}>
          <div style={S.toastIcon(toast.isActive)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 8l3 3 5-5"
                stroke={toast.isActive ? '#1a7a3a' : '#c0392b'}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
