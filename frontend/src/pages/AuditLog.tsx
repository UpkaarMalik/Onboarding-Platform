import { useState } from 'react';

interface LogEntry {
  tag: string;
  cat: string;
  text: string;
  time: string;
  dot: string;
}

const TAG_STYLES: Record<string, { color: string; bg: string }> = {
  JOINEE: { color: '#8b5e1a', bg: '#fef7ec' },
  POLICY: { color: '#1a7a3a', bg: '#edfcf2' },
  SYSTEM: { color: '#555', bg: '#f5f4f2' },
  BENEFIT: { color: '#6b21a8', bg: '#f3e8ff' },
};

const ALL_LOGS: LogEntry[] = [
  { tag: 'JOINEE', cat: 'joinee', text: 'Sid Pandey created joinee Arjun Kapoor (JN-2024-001)', time: '10 Sep · 11:42', dot: '#e8930c' },
  { tag: 'SYSTEM', cat: 'system', text: 'Onboarding invite email sent to arjun@gmail.com', time: '10 Sep · 11:42', dot: '#6b7a8d' },
  { tag: 'POLICY', cat: 'policy', text: 'Group Health Insurance policy viewed by Arjun Kapoor', time: '10 Sep · 11:38', dot: '#2e7d32' },
  { tag: 'JOINEE', cat: 'joinee', text: 'Ujjwal (JN-2026-001) status changed from Pending → In Progress', time: '10 Sep · 10:55', dot: '#e8930c' },
  { tag: 'BENEFIT', cat: 'benefit', text: 'Laptop asset ASSET-2026-APL-9842 assigned to Ravi Kumar', time: '10 Sep · 10:30', dot: '#6b21a8' },
  { tag: 'SYSTEM', cat: 'system', text: 'Bulk document reminder sent to 3 joinees with pending uploads', time: '10 Sep · 09:00', dot: '#6b7a8d' },
  { tag: 'POLICY', cat: 'policy', text: 'Domestic Travel Policy downloaded by Sneha Patel', time: '09 Sep · 17:22', dot: '#2e7d32' },
  { tag: 'JOINEE', cat: 'joinee', text: 'Atul (JN-2026-002) completed task: Laptop & dev environment handover', time: '09 Sep · 16:05', dot: '#e8930c' },
  { tag: 'BENEFIT', cat: 'benefit', text: 'Health Insurance deactivated for Hendrix by Sid Pandey', time: '09 Sep · 14:48', dot: '#c0392b' },
  { tag: 'SYSTEM', cat: 'system', text: 'Daily onboarding digest generated — 2 overdue, 4 on track', time: '09 Sep · 08:00', dot: '#6b7a8d' },
  { tag: 'JOINEE', cat: 'joinee', text: 'Himanshu uploaded Aadhaar Card and PAN Card documents', time: '08 Sep · 15:30', dot: '#e8930c' },
  { tag: 'POLICY', cat: 'policy', text: 'Employee Handbook v3.4 uploaded by Sid Pandey', time: '08 Sep · 11:15', dot: '#2e7d32' },
  { tag: 'BENEFIT', cat: 'benefit', text: 'Meal Card balance recharged — ₹2,200 loaded for Sep cycle', time: '01 Sep · 00:01', dot: '#6b21a8' },
  { tag: 'JOINEE', cat: 'joinee', text: 'Ravi Kumar (JN-2024-003) onboarding marked Completed', time: '30 Aug · 18:00', dot: '#1a7a3a' },
  { tag: 'SYSTEM', cat: 'system', text: 'Quarterly access review triggered — 5 accounts audited', time: '28 Aug · 09:00', dot: '#6b7a8d' },
];

export default function AuditLog() {
  const [filter, setFilter] = useState('all');
  const logs = filter === 'all' ? ALL_LOGS : ALL_LOGS.filter(l => l.cat === filter);

  return (
    <div style={{ padding: '28px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#e8930c', letterSpacing: '0.8px' }}>SYSTEM LOGS</span>
          <h1 style={{ margin: '6px 0 0', fontSize: 24, fontWeight: 800 }}>Audit Log</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#999' }}>{logs.length} entries</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              border: '1px solid #e8e4dc', borderRadius: 8, padding: '7px 30px 7px 10px',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', outline: 'none',
              background: '#fff', cursor: 'pointer', WebkitAppearance: 'none', appearance: 'none' as never,
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
            }}
          >
            <option value="all">All</option>
            <option value="joinee">Joinee</option>
            <option value="policy">Policy</option>
            <option value="system">System</option>
            <option value="benefit">Benefit</option>
          </select>
        </div>
      </div>

      <div style={{ margin: '16px 0 32px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {logs.map((log, i) => {
          const ts = TAG_STYLES[log.tag] || TAG_STYLES.SYSTEM;
          return (
            <div
              key={i}
              style={{
                background: '#fff', border: '1px solid #e8e4dc', borderRadius: 10,
                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                transition: 'border-color 0.1s ease',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#e8930c')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#e8e4dc')}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: log.dot, flexShrink: 0 }} />
              <span style={{
                fontSize: 11, fontWeight: 600, color: ts.color, background: ts.bg,
                borderRadius: 4, padding: '2px 8px', flexShrink: 0, minWidth: 52,
                textAlign: 'center', letterSpacing: '0.3px',
              }}>
                {log.tag}
              </span>
              <span style={{ fontSize: 13, color: '#1a1a1a', flex: 1 }}>{log.text}</span>
              <span style={{
                fontSize: 11, color: '#b3aca1',
                fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
              }}>
                {log.time}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
