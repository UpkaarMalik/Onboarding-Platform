import { useEffect, useState, useRef, type FormEvent } from 'react';
import { format } from 'date-fns';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { isToday, isYesterday, formatMonthDay } from '../lib/format';
import Reveal from '../components/Reveal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DiaryEntry {
  id: string;
  entry_date: string;
  content: string;
}

interface SectionDrafts {
  workedOn: string;
  gotStuck: string;
  resolved: string;
  standup: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function formatPageDate(dateStr: string): string {
  return format(new Date(dateStr + 'T00:00:00'), 'dd / MM / yyyy');
}

function formatNavLabel(dateStr: string): string {
  if (isToday(dateStr)) return 'Today';
  if (isYesterday(dateStr)) return 'Yesterday';
  return formatMonthDay(dateStr);
}

function formatDiaryRef(dateStr: string): string {
  return format(new Date(dateStr + 'T00:00:00'), 'MM-dd');
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/* ------------------------------------------------------------------ */
/*  Section serialization                                              */
/* ------------------------------------------------------------------ */

const SECTION_MARKERS = {
  workedOn: '## What I Worked On',
  gotStuck: '## Where I Got Stuck',
  resolved: '## How I Resolved It',
  standup: '## Standup Notes',
};

function parseSections(content: string): SectionDrafts {
  const result: SectionDrafts = { workedOn: '', gotStuck: '', resolved: '', standup: '' };
  if (!content.trim()) return result;

  const hasMarkers = content.includes(SECTION_MARKERS.workedOn);
  if (!hasMarkers) {
    // Legacy single-block format: put everything in workedOn
    result.workedOn = content;
    return result;
  }

  const lines = content.split('\n');
  let currentKey: keyof SectionDrafts | null = null;
  const buckets: Record<keyof SectionDrafts, string[]> = {
    workedOn: [],
    gotStuck: [],
    resolved: [],
    standup: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === SECTION_MARKERS.workedOn) {
      currentKey = 'workedOn';
      continue;
    }
    if (trimmed === SECTION_MARKERS.gotStuck) {
      currentKey = 'gotStuck';
      continue;
    }
    if (trimmed === SECTION_MARKERS.resolved) {
      currentKey = 'resolved';
      continue;
    }
    if (trimmed === SECTION_MARKERS.standup) {
      currentKey = 'standup';
      continue;
    }
    if (currentKey) buckets[currentKey].push(line);
  }

  result.workedOn = buckets.workedOn.join('\n').trim();
  result.gotStuck = buckets.gotStuck.join('\n').trim();
  result.resolved = buckets.resolved.join('\n').trim();
  result.standup = buckets.standup.join('\n').trim();
  return result;
}

function serializeSections(s: SectionDrafts): string {
  const parts: string[] = [];
  parts.push(`${SECTION_MARKERS.workedOn}\n${s.workedOn.trim()}`);
  parts.push(`${SECTION_MARKERS.gotStuck}\n${s.gotStuck.trim()}`);
  parts.push(`${SECTION_MARKERS.resolved}\n${s.resolved.trim()}`);
  if (s.standup.trim()) {
    parts.push(`${SECTION_MARKERS.standup}\n${s.standup.trim()}`);
  }
  return parts.join('\n\n');
}

function allSectionText(s: SectionDrafts): string {
  return [s.workedOn, s.gotStuck, s.resolved, s.standup].filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SPIRAL_COUNT = 24;
const spiralIndices = Array.from({ length: SPIRAL_COUNT }, (_, i) => i);

const SECTION_DEFS: {
  key: 'workedOn' | 'gotStuck' | 'resolved';
  heading: string;
  tag: string;
  placeholder: string;
}[] = [
  {
    key: 'workedOn',
    heading: '§ 01. WHAT I WORKED ON',
    tag: 'Tasks & Progress',
    placeholder: 'What tasks did you work on today? Summarize your progress...',
  },
  {
    key: 'gotStuck',
    heading: '§ 02. WHERE I GOT STUCK (BLOCKERS & BUGS)',
    tag: 'Blockers & Issues',
    placeholder: 'Any blockers, bugs, or things that slowed you down?',
  },
  {
    key: 'resolved',
    heading: '§ 03. HOW I RESOLVED IT / NEXT STEPS',
    tag: 'Solutions & Next Steps',
    placeholder: 'How did you solve issues? What are your next steps?',
  },
];

/* ------------------------------------------------------------------ */
/*  Auto-resize textarea helper                                        */
/* ------------------------------------------------------------------ */

function autoResizeTextarea(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ------------------------------------------------------------------ */
/*  Spinner & Checkmark                                                */
/* ------------------------------------------------------------------ */

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: 'diary-spin 0.7s linear infinite' }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Checkmark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkLog() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();

  /* --- Data state --- */
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* --- Diary editing (sections replace the old single draft) --- */
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [sections, setSections] = useState<SectionDrafts>({
    workedOn: '',
    gotStuck: '',
    resolved: '',
    standup: '',
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  /* --- Display mode --- */
  const [mode, setMode] = useState<'pen' | 'normal'>('pen');

  /* --- Load Google Fonts (Patrick Hand, Caveat, Inter) --- */
  useEffect(() => {
    const id = 'diary-google-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.href =
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Patrick+Hand&family=Caveat:wght@400;600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }, []);

  /* --- Derived values --- */
  const draft = serializeSections(sections);
  const fullText = allSectionText(sections);
  const words = wordCount(fullText);
  const chars = fullText.trim().length;
  const isPen = mode === 'pen';
  const fontFamily = isPen ? "'Patrick Hand', cursive" : "'Inter', sans-serif";
  const fontSize = isPen ? '18px' : '14px';
  const isToday = selectedDate === todayISO();

  /* --- Date navigation (prev/next through available dates) --- */
  const allDates = (() => {
    const today = todayISO();
    const dates = new Set<string>([today]);
    diary.forEach((d) => dates.add(d.entry_date));
    return Array.from(dates).sort((a, b) => (a > b ? -1 : 1)); // newest first
  })();

  const currentDateIndex = allDates.indexOf(selectedDate);
  const canGoNewer = currentDateIndex > 0;
  const canGoOlder = currentDateIndex < allDates.length - 1;

  function goNewer() {
    if (canGoNewer) setSelectedDate(allDates[currentDateIndex - 1]);
  }
  function goOlder() {
    if (canGoOlder) setSelectedDate(allDates[currentDateIndex + 1]);
  }

  /* --- Entry status label --- */
  const entryExists = diary.some((d) => d.entry_date === selectedDate);
  const statusLabel = isToday ? 'In-Progress' : entryExists ? 'Completed' : 'No Entry';

  /* --- Data loading --- */
  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const diaryRes = await authedFetch<DiaryEntry[]>('/diary');
      setDiary(diaryRes);

      const entry = diaryRes.find((d) => d.entry_date === selectedDate);
      setSections(parseSections(entry?.content ?? ''));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* When selectedDate changes, load the matching entry content */
  useEffect(() => {
    const entry = diary.find((d) => d.entry_date === selectedDate);
    setSections(parseSections(entry?.content ?? ''));
  }, [selectedDate, diary]);

  /* --- Save diary --- */
  async function saveDiary(e?: FormEvent) {
    e?.preventDefault();
    const content = serializeSections(sections);
    if (!content.trim() || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await authedFetch('/diary', { method: 'POST', body: { content } });
      const diaryRes = await authedFetch<DiaryEntry[]>('/diary');
      setDiary(diaryRes);
      setSaveState('saved');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState('idle'), 2000);
    } catch (err) {
      setSaveState('idle');
      alert(err instanceof ApiError ? err.message : 'Could not save entry');
    }
  }

  /* --- Export to clipboard --- */
  function handleExport() {
    const content = serializeSections(sections);
    const dateStr = formatPageDate(selectedDate);
    const text = `Work Diary - ${dateStr}\n${'='.repeat(40)}\n\n${content}`;
    navigator.clipboard.writeText(text).then(
      () => alert('Diary entry copied to clipboard!'),
      () => alert('Could not copy to clipboard'),
    );
  }

  /* --- Update a single section --- */
  function updateSection(key: keyof SectionDrafts, value: string) {
    setSections((prev) => ({ ...prev, [key]: value }));
  }

  /* --- Render --- */
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'calc(100vh - 80px)',
          color: '#8a8579',
          fontSize: 15,
          fontFamily: "'Inter', sans-serif",
        }}
      >
        Loading your work diary...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 'calc(100vh - 80px)',
        }}
      >
        <p className="error-text">{error}</p>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes diary-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes diary-fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ---- Layout ---- */
        .diary-wrapper {
          display: flex;
          gap: 0;
          min-height: calc(100vh - 80px);
        }

        /* ---- Main Area ---- */
        .diary-main-area {
          flex: 1;
          display: flex;
          justify-content: center;
          padding: 24px 20px;
          background: #f7f2ea;
          background-image: radial-gradient(circle, rgba(232,147,12,0.25) 1.2px, transparent 1.2px);
          background-size: 20px 20px;
          min-height: 0;
        }
        .diary-container {
          width: 100%;
          max-width: 780px;
          position: relative;
        }

        /* ---- Top Bar ---- */
        .diary-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px 12px;
        }
        .diary-ref {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: #999;
          letter-spacing: 1px;
        }
        .diary-dot {
          width: 6px;
          height: 6px;
          background: #34c759;
          border-radius: 50%;
          display: inline-block;
        }
        .diary-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .diary-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s;
        }
        .diary-mode-btn:hover {
          opacity: 0.9;
        }
        .diary-separator {
          color: #ddd;
          margin: 0 4px;
          user-select: none;
        }
        .diary-nav-btn {
          background: #fff;
          border: 1px solid #ddd;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          color: #777;
          transition: border-color 0.15s, color 0.15s;
          font-family: inherit;
        }
        .diary-nav-btn:hover:not(:disabled) {
          border-color: var(--color-accent, #e88f30);
          color: var(--color-accent, #e88f30);
        }
        .diary-nav-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .diary-nav-label {
          font-size: 12px;
          font-weight: 600;
          color: #777;
          min-width: 72px;
          text-align: center;
        }

        /* ---- Notebook ---- */
        .diary-notebook {
          display: flex;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 40px rgba(0,0,0,0.1);
          min-height: 700px;
        }

        /* ---- Spiral Binding ---- */
        .diary-spiral {
          width: 48px;
          background: #c8c3ba;
          flex-shrink: 0;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 0;
          gap: 0;
          box-shadow: inset -2px 0 4px rgba(0,0,0,0.1);
        }
        .diary-coil {
          width: 36px;
          height: 24px;
          position: relative;
          margin: 1px 0;
        }
        .diary-coil-ring {
          position: absolute;
          left: 2px;
          top: 1px;
          width: 32px;
          height: 20px;
          border: 3px solid #888;
          border-radius: 12px;
          background: transparent;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.4);
        }
        .diary-coil-highlight {
          position: absolute;
          left: 8px;
          top: 3px;
          width: 20px;
          height: 6px;
          background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(200,200,200,0.2) 100%);
          border-radius: 6px;
        }

        /* ---- Page ---- */
        .diary-page {
          flex: 1;
          background: #faf8f2;
          position: relative;
          overflow: hidden;
        }
        .diary-ruled-lines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            to bottom,
            transparent,
            transparent 31px,
            #c8d0c8 31px,
            #c8d0c8 32px
          );
          background-position: 0 0;
        }
        .diary-margin-line {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 60px;
          width: 1.5px;
          background: #e8a0a0;
          opacity: 0.5;
          pointer-events: none;
        }
        .diary-page-content {
          position: relative;
          z-index: 1;
          padding: 24px 36px 24px 76px;
          animation: diary-fadeIn 0.3s ease;
        }

        /* ---- Date Header ---- */
        .diary-date-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        .diary-date-label {
          font-size: 11px;
          font-weight: 700;
          color: #999;
          letter-spacing: 1px;
        }
        .diary-date-value {
          font-size: 18px;
          font-weight: 700;
          border-bottom: 2px solid #1a1a1a;
          padding: 2px 12px;
        }
        .diary-status-badge {
          font-size: 11px;
          font-weight: 600;
          color: #1a7a3a;
          background: #edfcf2;
          border: 1px solid #b5e2c4;
          border-radius: 6px;
          padding: 3px 10px;
        }

        /* ---- Sections ---- */
        .diary-section {
          margin-bottom: 24px;
        }
        .diary-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .diary-section-heading {
          font-size: 12px;
          font-weight: 700;
          color: #1a7a3a;
          letter-spacing: 0.5px;
        }
        .diary-section-tag {
          font-size: 11px;
          font-style: italic;
          color: var(--color-accent, #e88f30);
        }
        .diary-section-body {
          margin: 0;
          line-height: 32px;
          color: #2a2a2a;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .diary-section-textarea {
          display: block;
          width: 100%;
          box-sizing: border-box;
          min-height: 64px;
          padding: 0;
          border: none;
          outline: none;
          resize: none;
          overflow: hidden;
          line-height: 32px;
          color: #2a2a2a;
          background: transparent;
        }
        .diary-section-textarea::placeholder {
          color: #b5b0a5;
        }

        /* ---- Standup Notes ---- */
        .diary-standup {
          margin-top: 16px;
          border-top: 1px dashed #d8e0d8;
          padding-top: 16px;
        }
        .diary-standup-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .diary-standup-label {
          font-size: 12px;
          color: #999;
        }
        .diary-standup-sublabel {
          font-size: 11px;
          color: #bbb;
        }
        .diary-standup-text {
          margin: 0;
          font-family: 'Caveat', cursive;
          font-size: 18px;
          line-height: 32px;
          color: #777;
          font-style: italic;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .diary-standup-textarea {
          display: block;
          width: 100%;
          box-sizing: border-box;
          min-height: 48px;
          padding: 0;
          border: none;
          outline: none;
          resize: none;
          overflow: hidden;
          font-family: 'Caveat', cursive;
          font-size: 18px;
          line-height: 32px;
          color: #777;
          font-style: italic;
          background: transparent;
        }
        .diary-standup-textarea::placeholder {
          color: #bbb;
        }

        /* ---- Footer ---- */
        .diary-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 8px 0;
        }
        .diary-footer-stats {
          font-size: 12px;
          color: #999;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .diary-footer-buttons {
          display: flex;
          gap: 8px;
        }
        .diary-export-btn {
          background: #fff;
          border: 1px solid #ddd;
          padding: 8px 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          color: #555;
          transition: border-color 0.15s, color 0.15s;
        }
        .diary-export-btn:hover {
          border-color: var(--color-accent, #e88f30);
          color: var(--color-accent, #e88f30);
        }
        .diary-save-btn {
          background: var(--color-accent, #e88f30);
          color: #fff;
          border: none;
          padding: 8px 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 0.15s;
        }
        .diary-save-btn:hover:not(:disabled) {
          background: #d4790a;
        }
        .diary-save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>

      <div className="diary-wrapper">
        {/* ---- Diary Notebook ---- */}
        <div className="diary-main-area">
          <Reveal delay={0.1}>
            <div className="diary-container">
              {/* Top bar: ref number, pen/normal mode toggle, date nav */}
              <div className="diary-topbar">
                <div className="diary-ref">
                  DIARY REF. NO. {formatDiaryRef(selectedDate)}
                  <span className="diary-dot" />
                </div>
                <div className="diary-controls">
                  <button
                    className="diary-mode-btn"
                    onClick={() => setMode('pen')}
                    style={{
                      background: isPen ? '#1e2a3a' : '#fff',
                      color: isPen ? '#fff' : '#555',
                      border: `1px solid ${isPen ? '#1e2a3a' : '#ddd'}`,
                    }}
                  >
                    &#9998; Pen
                  </button>
                  <button
                    className="diary-mode-btn"
                    onClick={() => setMode('normal')}
                    style={{
                      background: !isPen ? '#1e2a3a' : '#fff',
                      color: !isPen ? '#fff' : '#555',
                      border: `1px solid ${!isPen ? '#1e2a3a' : '#ddd'}`,
                    }}
                  >
                    &#128221; Normal
                  </button>
                  <span className="diary-separator">|</span>
                  <button
                    className="diary-nav-btn"
                    onClick={goNewer}
                    disabled={!canGoNewer}
                  >
                    &#8249;
                  </button>
                  <span className="diary-nav-label">
                    {formatNavLabel(selectedDate)}
                  </span>
                  <button
                    className="diary-nav-btn"
                    onClick={goOlder}
                    disabled={!canGoOlder}
                  >
                    &#8250;
                  </button>
                  <span className="diary-separator">|</span>
                </div>
              </div>

              {/* Notebook body */}
              <div className="diary-notebook">
                {/* Steel spiral binding */}
                <div className="diary-spiral">
                  {spiralIndices.map((i) => (
                    <div key={i} className="diary-coil">
                      <div className="diary-coil-ring" />
                      <div className="diary-coil-highlight" />
                    </div>
                  ))}
                </div>

                {/* Page area */}
                <div className="diary-page">
                  {/* Ruled lines overlay */}
                  <div className="diary-ruled-lines" />
                  {/* Red margin line */}
                  <div className="diary-margin-line" />

                  {/* Content */}
                  <div className="diary-page-content" key={selectedDate}>
                    {/* Date header */}
                    <div className="diary-date-header">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span className="diary-date-label">DATE:</span>
                        <span
                          className="diary-date-value"
                          style={{ fontFamily }}
                        >
                          {formatPageDate(selectedDate)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span className="diary-status-badge">
                          {statusLabel}
                        </span>
                      </div>
                    </div>

                    {/* 3 Sections */}
                    {SECTION_DEFS.map((sec) => (
                      <div key={sec.key} className="diary-section">
                        <div className="diary-section-header">
                          <span className="diary-section-heading">
                            {sec.heading}
                          </span>
                          <span className="diary-section-tag">{sec.tag}</span>
                        </div>
                        {isToday ? (
                          <textarea
                            className="diary-section-textarea"
                            style={{ fontFamily, fontSize }}
                            value={sections[sec.key]}
                            onChange={(e) => {
                              updateSection(sec.key, e.target.value);
                              autoResizeTextarea(e.target);
                            }}
                            ref={(el) => autoResizeTextarea(el)}
                            placeholder={sec.placeholder}
                          />
                        ) : (
                          <p
                            className="diary-section-body"
                            style={{ fontFamily, fontSize }}
                          >
                            {sections[sec.key] || (
                              <span
                                style={{
                                  color: '#b5b0a5',
                                  fontStyle: 'italic',
                                }}
                              >
                                —
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    ))}

                    {/* Standup Notes */}
                    {(isToday || sections.standup) && (
                      <div className="diary-standup">
                        <div className="diary-standup-header">
                          <span className="diary-standup-label">
                            &#9998; Standup Notes for Tomorrow
                          </span>
                          <span className="diary-standup-sublabel">
                            Pencil lead: 2B Graphite
                          </span>
                        </div>
                        {isToday ? (
                          <textarea
                            className="diary-standup-textarea"
                            value={sections.standup}
                            onChange={(e) => {
                              updateSection('standup', e.target.value);
                              autoResizeTextarea(e.target);
                            }}
                            ref={(el) => autoResizeTextarea(el)}
                            placeholder="Reminders for tomorrow's standup..."
                          />
                        ) : (
                          <p className="diary-standup-text">
                            {sections.standup}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="diary-footer">
                <div className="diary-footer-stats">
                  {words} words &middot; {chars} characters &middot;&nbsp;
                  <span className="diary-dot" />
                  &nbsp;
                  {isPen
                    ? 'Pen mode (Patrick Hand)'
                    : 'Normal mode (Inter)'}
                </div>
                <div className="diary-footer-buttons">
                  <button
                    className="diary-export-btn"
                    onClick={handleExport}
                  >
                    Export
                  </button>
                  {isToday && (
                    <button
                      className="diary-save-btn"
                      disabled={
                        saveState === 'saving' || !draft.trim()
                      }
                      onClick={() => saveDiary()}
                    >
                      {saveState === 'saving' && (
                        <>
                          <Spinner size={14} /> Saving...
                        </>
                      )}
                      {saveState === 'saved' && (
                        <>
                          <Checkmark size={14} /> Saved
                        </>
                      )}
                      {saveState === 'idle' && (
                        <>&#10003; Save Log</>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </>
  );
}
