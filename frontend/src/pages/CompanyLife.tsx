import { useState, useEffect, useRef } from 'react';
import Reveal from '../components/Reveal';

/* ------------------------------------------------------------------ */
/*  Demo data — no backend endpoint for this page                      */
/* ------------------------------------------------------------------ */
interface EventItem {
  id: string;
  title: string;
  type: EventType;
  emoji: string;
  date: string;
  attendees: number | string;
  attendeeLabel: string;
  likes: number;
  photoCount: number;
  description: string;
  tag: string;
  image?: string;
}

type EventType = 'Cultural' | 'Sports' | 'Engineering' | 'Milestone' | 'Social';

const EVENTS: EventItem[] = [
  {
    id: '1',
    title: 'Independence Day Celebration 2024',
    type: 'Cultural',
    emoji: '\u{1F1EE}\u{1F1F3}',
    date: 'Aug 15, 2024',
    attendees: 110,
    attendeeLabel: 'ATTENDEES',
    likes: 34,
    photoCount: 42,
    description:
      'Festive tricolor decorations, desk rangoli, traditional attire group photo and cultural performances.',
    tag: 'cultural',
    image: '/gallery/independence-day.jpg',
  },
  {
    id: '2',
    title: 'Smash & Rally: Pickleball Tournament',
    type: 'Sports',
    emoji: '\u{1F3D3}',
    date: 'Jul 28, 2024',
    attendees: 64,
    attendeeLabel: 'PLAYERS',
    likes: 49,
    photoCount: 68,
    description:
      'High-energy court action, doubles championship trophy and post-match celebration.',
    tag: 'sports',
    image: '/gallery/pickleball.jpg',
  },
  {
    id: '3',
    title: 'Summer Hackathon & Demo Day',
    type: 'Engineering',
    emoji: '\u{26A1}',
    date: 'Jun 14, 2024',
    attendees: 14,
    attendeeLabel: 'TEAMS',
    likes: 58,
    photoCount: 35,
    description:
      'Late-night coding sprints, pizza party, demo presentations and innovation awards.',
    tag: 'engineering',
    image: '/gallery/hackathon.jpg',
  },
  {
    id: '4',
    title: "Founders' Day & Gala Night",
    type: 'Milestone',
    emoji: '\u{1F942}',
    date: 'May 02, 2024',
    attendees: 'All',
    attendeeLabel: 'HANDS',
    likes: 92,
    photoCount: 84,
    description:
      'Leadership awards, stage performances, cake-cutting and an evening of music.',
    tag: 'milestone',
    image: '/gallery/gala-night.jpg',
  },
  {
    id: '5',
    title: 'Monsoon Chai & Boardgames Mixer',
    type: 'Social',
    emoji: '\u{2615}',
    date: 'Jul 12, 2024',
    attendees: 45,
    attendeeLabel: 'JOINEES',
    likes: 31,
    photoCount: 22,
    description:
      'Cozy indoor vibes with artisan chai, board games and trivia rounds.',
    tag: 'social',
    image: '/gallery/chai-monsoon.jpg',
  },
];

const FILTER_OPTIONS: Array<{ label: string; value: EventType | 'all' }> = [
  { label: 'All Events', value: 'all' },
  { label: 'Cultural', value: 'Cultural' },
  { label: 'Sports', value: 'Sports' },
  { label: 'Engineering', value: 'Engineering' },
  { label: 'Milestone', value: 'Milestone' },
  { label: 'Social', value: 'Social' },
];

/* Per-type gradient for the visual banner (used as image placeholder) */
const BANNER_GRADIENTS: Record<EventType, string> = {
  Cultural: 'linear-gradient(135deg, #f6d394, #e8a44a 55%, #d4873a)',
  Sports: 'linear-gradient(135deg, #7edcd2, #3fb8ad 55%, #2a9d93)',
  Engineering: 'linear-gradient(135deg, #c8bfb4, #9e9488 55%, #7d7368)',
  Milestone: 'linear-gradient(135deg, #fce588, #f0c938 55%, #d4af37)',
  Social: 'linear-gradient(135deg, #b8c4d0, #8a9bae 55%, #6e829a)',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function CompanyLife() {
  const [activeFilter, setActiveFilter] = useState<EventType | 'all'>('all');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [showAddEvent, setShowAddEvent] = useState(false);

  /* Load Playfair Display font */
  useEffect(() => {
    const link = document.createElement('link');
    link.href =
      'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,600&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const filtered = EVENTS.filter((e) => {
    const matchesFilter = activeFilter === 'all' || e.type === activeFilter;
    const matchesSearch =
      !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  function toggleLike(id: string) {
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleGallery() {
    alert('Gallery coming soon — stay tuned!');
  }

  return (
    <>
      <style>{`
        @keyframes cl-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* Flip card mechanics */
        .cl-flip-card {
          perspective: 800px;
          height: 260px;
          cursor: pointer;
        }
        .cl-flip-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
          transform-style: preserve-3d;
        }
        .cl-flip-card:hover .cl-flip-inner {
          transform: rotateY(180deg);
        }
        .cl-flip-front,
        .cl-flip-back {
          position: absolute;
          width: 100%;
          height: 100%;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          border-radius: 16px;
          overflow: hidden;
        }
        .cl-flip-back {
          transform: rotateY(180deg);
        }

        /* Breadcrumb bar */
        .cl-breadcrumb-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 0;
          border-bottom: 1px solid var(--color-border);
          margin-bottom: 0;
        }
        .cl-breadcrumb-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cl-breadcrumb-logo {
          width: 32px;
          height: 32px;
          background: var(--color-accent);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cl-breadcrumb-name {
          font-weight: 700;
          font-size: 15px;
        }
        .cl-breadcrumb-sep {
          color: #999;
        }
        .cl-breadcrumb-path {
          font-size: 14px;
          color: #777;
        }

        /* Blinking badge */
        .cl-events-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1.5px solid var(--color-accent);
          border-radius: 20px;
          padding: 6px 16px;
          cursor: pointer;
          transition: background 0.2s ease;
        }
        .cl-events-badge:hover {
          background: var(--color-surface-alt);
        }
        .cl-events-badge-dot {
          width: 8px;
          height: 8px;
          background: var(--color-accent);
          border-radius: 50%;
          display: inline-block;
        }
        .cl-events-badge-text {
          font-size: 13px;
          font-weight: 600;
          color: var(--color-accent);
          animation: cl-blink 1.5s ease-in-out infinite;
        }

        /* Hero */
        .cl-hero-v2 {
          padding: 32px 0 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .cl-memories-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--color-surface-alt);
          border: 1px solid #f5d4a0;
          border-radius: 20px;
          padding: 6px 16px;
          margin-bottom: 16px;
        }
        .cl-memories-badge-dot {
          width: 8px;
          height: 8px;
          background: var(--color-accent);
          border-radius: 50%;
          display: inline-block;
        }
        .cl-memories-badge-text {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-accent);
          letter-spacing: 1px;
        }
        .cl-hero-title-v2 {
          margin: 0;
          font-size: 40px;
          font-weight: 800;
          line-height: 1.2;
        }
        .cl-hero-title-italic {
          font-family: 'Playfair Display', serif;
          font-style: italic;
          color: var(--color-accent);
          font-weight: 600;
        }
        .cl-hero-subtitle {
          margin: 12px 0 0;
          color: #777;
          font-size: 15px;
          line-height: 1.6;
          max-width: 560px;
        }

        /* Search bar */
        .cl-search-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 0 0;
        }
        .cl-search-container {
          position: relative;
          flex: 1;
          max-width: 400px;
        }
        .cl-search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
        }
        .cl-search-input {
          border: 1px solid var(--color-border);
          border-radius: 12px;
          padding: 10px 16px 10px 38px;
          font-size: 14px;
          width: 100%;
          font-family: inherit;
          outline: none;
          background: var(--color-surface);
          box-sizing: border-box;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .cl-search-input:focus {
          border-color: var(--color-accent);
          box-shadow: 0 0 0 3px rgba(232, 147, 12, 0.15);
        }

        /* Flip card front */
        .cl-flip-front-content {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--color-border);
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
          border-radius: 16px;
          overflow: hidden;
          position: relative;
        }
        .cl-flip-front-emoji {
          font-size: 4rem;
          filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
          z-index: 1;
        }
        .cl-flip-front-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 24px 20px 20px;
          background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
        }
        .cl-flip-front-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .cl-flip-front-category {
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          background: rgba(232, 147, 12, 0.9);
          border-radius: 4px;
          padding: 3px 8px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .cl-flip-front-date {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
        }
        .cl-flip-front-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
          line-height: 1.3;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        }
        .cl-flip-front-photos {
          position: absolute;
          top: 14px;
          right: 14px;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 8px;
          padding: 5px 10px;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .cl-flip-front-photos span:last-child {
          font-size: 13px;
          font-weight: 700;
          color: #fff;
        }

        /* Flip card back */
        .cl-flip-back-content {
          background: var(--color-surface);
          border: 2px solid var(--color-accent);
          display: flex;
          flex-direction: column;
          padding: 18px 16px 14px;
          box-sizing: border-box;
          height: 100%;
          border-radius: 16px;
        }
        .cl-flip-back-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .cl-flip-back-emoji {
          font-size: 26px;
        }
        .cl-flip-back-cat {
          font-size: 11px;
          font-weight: 700;
          color: var(--color-accent);
          background: var(--color-surface-alt);
          border: 1px solid #f5d4a0;
          border-radius: 4px;
          padding: 2px 8px;
          text-transform: uppercase;
        }
        .cl-flip-back-date {
          font-size: 12px;
          color: #999;
          margin-left: auto;
        }
        .cl-flip-back-title {
          margin: 0 0 6px;
          font-size: 16px;
          font-weight: 800;
          line-height: 1.25;
          color: var(--color-text);
        }
        .cl-flip-back-desc {
          margin: 0 0 10px;
          font-size: 13px;
          color: #777;
          line-height: 1.5;
          flex: 1;
          overflow: hidden;
        }

        /* Stats row */
        .cl-flip-stats {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .cl-flip-stat {
          flex: 1;
          background: #faf9f7;
          border: 1px solid #f0ece5;
          border-radius: 6px;
          padding: 6px 4px;
          text-align: center;
        }
        .cl-flip-stat-value {
          font-size: 16px;
          font-weight: 800;
        }
        .cl-flip-stat-value--accent {
          color: var(--color-accent);
        }
        .cl-flip-stat-value--danger {
          color: #e74c3c;
        }
        .cl-flip-stat-label {
          font-size: 10px;
          font-weight: 600;
          color: #999;
        }

        /* View gallery button */
        .cl-flip-gallery-btn {
          background: var(--color-accent);
          color: #fff;
          border: none;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          width: 100%;
          transition: background 0.15s ease;
        }
        .cl-flip-gallery-btn:hover {
          background: var(--color-accent-dark);
        }

        /* Placeholder host card */
        .cl-host-card {
          height: 260px;
          background: var(--color-surface);
          border: 2px dashed #ddd8d0;
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }
        .cl-host-card:hover {
          border-color: var(--color-accent);
          background: var(--color-surface-alt);
        }
        .cl-host-card-icon {
          width: 56px;
          height: 56px;
          background: #f5f4f2;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
        }
        .cl-host-card-icon span {
          font-size: 28px;
          color: #999;
        }
        .cl-host-card h3 {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 700;
        }
        .cl-host-card p {
          margin: 0;
          color: #999;
          font-size: 13px;
          line-height: 1.5;
          max-width: 240px;
        }

        /* Footer culture section */
        .cl-culture-footer {
          padding: 48px 0 40px;
          text-align: center;
        }
        .cl-culture-label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 2px;
          color: var(--color-accent);
          margin-bottom: 16px;
        }
        .cl-culture-quote {
          margin: 0 auto 24px;
          font-family: 'Playfair Display', serif;
          font-style: italic;
          font-size: 32px;
          color: var(--color-text);
          line-height: 1.4;
          max-width: 640px;
        }
        .cl-culture-contact {
          margin: 0 0 20px;
          font-size: 14px;
          color: #777;
        }
        .cl-culture-contact a {
          color: var(--color-accent);
          font-weight: 600;
          text-decoration: underline;
        }
        .cl-culture-copyright {
          margin: 0;
          font-size: 13px;
          color: #bbb;
        }

        /* Add Event Modal */
        .ae-overlay {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          animation: ae-fadeIn 0.2s ease;
        }
        @keyframes ae-fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .ae-modal {
          background: var(--color-surface);
          border-radius: 20px;
          width: 580px;
          max-height: calc(100vh - 4rem);
          overflow-y: auto;
          box-shadow: 0 24px 64px rgba(0,0,0,0.2);
          animation: ae-slideUp 0.3s cubic-bezier(0.4,0,0.2,1);
        }
        @keyframes ae-slideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .ae-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 24px 16px;
          border-bottom: 1px solid var(--color-border);
        }
        .ae-header h2 {
          margin: 0; font-size: 22px; font-weight: 800;
        }
        .ae-close {
          background: none; border: none; cursor: pointer;
          width: 32px; height: 32px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; color: var(--color-muted);
          transition: background 0.15s;
        }
        .ae-close:hover { background: var(--color-surface-alt); }
        .ae-body { padding: 20px 24px; }
        .ae-field { margin-bottom: 18px; }
        .ae-field label {
          display: block; font-size: 13px; font-weight: 700;
          margin-bottom: 6px; color: var(--color-text);
        }
        .ae-field input, .ae-field textarea, .ae-field select {
          width: 100%; padding: 11px 14px;
          border: 1px solid var(--color-border); border-radius: 10px;
          font-size: 14px; font-family: inherit;
          background: var(--color-surface); box-sizing: border-box;
          outline: none; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .ae-field input:focus, .ae-field textarea:focus, .ae-field select:focus {
          border-color: var(--color-accent);
          box-shadow: 0 0 0 3px rgba(232,147,12,0.12);
        }
        .ae-field textarea { resize: vertical; min-height: 80px; }
        .ae-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

        /* Cover photo upload */
        .ae-cover-zone {
          border: 2px dashed var(--color-border);
          border-radius: 14px;
          padding: 28px 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
        }
        .ae-cover-zone:hover {
          border-color: var(--color-accent);
          background: var(--color-surface-alt);
        }
        .ae-cover-zone.has-cover {
          padding: 0; border-style: solid;
        }
        .ae-cover-zone.has-cover img {
          width: 100%; height: 180px; object-fit: cover; display: block;
          border-radius: 12px;
        }
        .ae-cover-zone .ae-cover-overlay {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.4);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.2s; border-radius: 12px;
        }
        .ae-cover-zone:hover .ae-cover-overlay { opacity: 1; }
        .ae-cover-icon {
          width: 48px; height: 48px; background: rgba(232,147,12,0.15);
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          margin: 0 auto 10px;
        }

        /* Photo gallery upload */
        .ae-photos-grid {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
          margin-top: 8px;
        }
        .ae-photo-thumb {
          position: relative; border-radius: 10px; overflow: hidden;
          aspect-ratio: 1; background: var(--color-surface-alt);
        }
        .ae-photo-thumb img {
          width: 100%; height: 100%; object-fit: cover;
        }
        .ae-photo-thumb .ae-photo-remove {
          position: absolute; top: 4px; right: 4px;
          background: rgba(0,0,0,0.6); color: #fff;
          border: none; border-radius: 50%;
          width: 22px; height: 22px; font-size: 12px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.15s;
        }
        .ae-photo-thumb:hover .ae-photo-remove { opacity: 1; }
        .ae-photo-thumb .ae-star-badge {
          position: absolute; bottom: 4px; left: 4px;
          background: rgba(232,147,12,0.9); color: #fff;
          border: none; border-radius: 4px;
          padding: 2px 6px; font-size: 9px; font-weight: 700;
          cursor: pointer; opacity: 0; transition: opacity 0.15s;
        }
        .ae-photo-thumb:hover .ae-star-badge { opacity: 1; }
        .ae-photo-thumb .ae-star-badge.is-cover {
          opacity: 1; background: var(--color-accent);
        }
        .ae-add-photo-btn {
          aspect-ratio: 1; border: 2px dashed var(--color-border);
          border-radius: 10px; background: none; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px; color: var(--color-muted); font-size: 11px; font-weight: 600;
          font-family: inherit; transition: all 0.15s;
        }
        .ae-add-photo-btn:hover {
          border-color: var(--color-accent); color: var(--color-accent);
        }
        .ae-photo-count {
          font-size: 12px; color: var(--color-muted); margin-top: 6px;
        }

        .ae-footer {
          display: flex; justify-content: flex-end; gap: 12px;
          padding: 16px 24px 20px;
          border-top: 1px solid var(--color-border);
        }
        .ae-cancel {
          background: none; border: 1px solid var(--color-border);
          padding: 10px 24px; border-radius: 10px;
          font-size: 14px; font-weight: 600; cursor: pointer;
          font-family: inherit; transition: all 0.15s;
        }
        .ae-cancel:hover { background: var(--color-surface-alt); }
      `}</style>

      <div className="cl-page">
        {/* ---------- Breadcrumb bar ---------- */}
        <div className="cl-breadcrumb-bar">
          <div className="cl-breadcrumb-left">
            <div className="cl-breadcrumb-logo">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5" stroke="#fff" strokeWidth="1.2" />
                <path
                  d="M5.5 8.5c0 0 1 1.5 2.5 1.5s2.5-1.5 2.5-1.5M6 6.5h.01M10 6.5h.01"
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="cl-breadcrumb-name">AND</span>
            <span className="cl-breadcrumb-sep">/</span>
            <span className="cl-breadcrumb-path">Life &amp; Events</span>
          </div>
          <div className="cl-events-badge">
            <span className="cl-events-badge-dot" />
            <span className="cl-events-badge-text">Company Events</span>
          </div>
        </div>

        {/* ---------- Hero header ---------- */}
        <div className="cl-hero-v2">
          <div>
            <div className="cl-memories-badge">
              <span className="cl-memories-badge-dot" />
              <span className="cl-memories-badge-text">MEMORIES &amp; HAPPENINGS</span>
            </div>
            <h1 className="cl-hero-title-v2">
              Company Life &amp; <span className="cl-hero-title-italic">Events</span>
            </h1>
            <p className="cl-hero-subtitle">
              Explore moments, highlights, and photo stories across the AndPayments team.
              Relive past celebrations or submit photos from your recent team gathering.
            </p>
          </div>
          <button
            className="btn-primary cl-add-event-btn"
            style={{ marginTop: 48, whiteSpace: 'nowrap' }}
            onClick={() => setShowAddEvent(true)}
          >
            <span style={{ fontSize: 18 }}>+</span> Add Event
          </button>
        </div>

        {/* ---------- Filter pills ---------- */}
        <div className="cl-filters" style={{ paddingTop: 24 }}>
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              className={`cl-filter-pill${activeFilter === f.value ? ' active' : ''}`}
              onClick={() => setActiveFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ---------- Search ---------- */}
        <div className="cl-search-wrap">
          <div className="cl-search-container">
            <svg
              className="cl-search-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle cx="7" cy="7" r="5" stroke="#999" strokeWidth="1.3" />
              <path d="M11 11l3 3" stroke="#999" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="cl-search-input"
              placeholder="Search memories, tags..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* ---------- Flip card grid ---------- */}
        <Reveal>
          <div className="cl-grid" style={{ paddingTop: 24 }}>
            {filtered.map((ev, i) => {
              const liked = likedIds.has(ev.id);
              const displayLikes = ev.likes + (liked ? 1 : 0);
              return (
                <div
                  key={ev.id}
                  className="cl-flip-card"
                  style={{ animationDelay: `${i * 0.07}s` }}
                >
                  <div className="cl-flip-inner">
                    {/* FRONT */}
                    <div className="cl-flip-front">
                      <div
                        className="cl-flip-front-content"
                        style={{
                          background: ev.image
                            ? `url(${ev.image}) center/cover no-repeat`
                            : BANNER_GRADIENTS[ev.type],
                        }}
                      >
                        {!ev.image && <span className="cl-flip-front-emoji">{ev.emoji}</span>}
                        <div className="cl-flip-front-overlay">
                          <div className="cl-flip-front-meta">
                            <span className="cl-flip-front-category">{ev.type}</span>
                            <span className="cl-flip-front-date">{ev.date}</span>
                          </div>
                          <h3 className="cl-flip-front-title">{ev.title}</h3>
                        </div>
                        <div className="cl-flip-front-photos">
                          <span style={{ fontSize: 12 }}>📷</span>
                          <span>{ev.photoCount}</span>
                        </div>
                      </div>
                    </div>

                    {/* BACK */}
                    <div className="cl-flip-back">
                      <div className="cl-flip-back-content">
                        <div className="cl-flip-back-header">
                          <span className="cl-flip-back-emoji">{ev.emoji}</span>
                          <span className="cl-flip-back-cat">{ev.type}</span>
                          <span className="cl-flip-back-date">{ev.date}</span>
                        </div>
                        <h3 className="cl-flip-back-title">{ev.title}</h3>
                        <p className="cl-flip-back-desc">{ev.description}</p>
                        <div className="cl-flip-stats">
                          <div className="cl-flip-stat">
                            <div className="cl-flip-stat-value cl-flip-stat-value--accent">
                              {ev.photoCount}
                            </div>
                            <div className="cl-flip-stat-label">PHOTOS</div>
                          </div>
                          <div className="cl-flip-stat">
                            <div className="cl-flip-stat-value">{ev.attendees}</div>
                            <div className="cl-flip-stat-label">{ev.attendeeLabel}</div>
                          </div>
                          <div className="cl-flip-stat">
                            <div className="cl-flip-stat-value cl-flip-stat-value--danger">
                              {displayLikes}
                            </div>
                            <div className="cl-flip-stat-label">LIKES</div>
                          </div>
                        </div>
                        <button
                          className="cl-flip-gallery-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGallery();
                          }}
                        >
                          View Gallery &rarr;
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Placeholder "Host or Submit" card */}
            <div className="cl-host-card" onClick={() => setShowAddEvent(true)}>
              <div className="cl-host-card-icon">
                <span>+</span>
              </div>
              <h3>Host or Submit an Event</h3>
              <p>
                Took great photos during a team dinner or offsite? Share them with the
                entire AndPayments family.
              </p>
            </div>
          </div>
        </Reveal>

        {/* ---------- Culture & Belonging footer ---------- */}
        <div className="cl-culture-footer">
          <div className="cl-culture-label">◆ CULTURE &amp; BELONGING ◆</div>
          <p className="cl-culture-quote">
            &ldquo;Great products are built by teams who celebrate together.&rdquo;
          </p>
          <p className="cl-culture-contact">
            Got photos from a recent event? Contact People Ops at{' '}
            <a href="mailto:people@andpayments.com">people@andpayments.com</a>
          </p>
          <p className="cl-culture-copyright">
            &copy; 2024 AndPayments Technologies Inc. All rights reserved.
          </p>
        </div>
      </div>

      {showAddEvent && (
        <AddEventModal onClose={() => setShowAddEvent(false)} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Event Modal                                                     */
/* ------------------------------------------------------------------ */
function AddEventModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('Cultural');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [coverPhoto, setCoverPhoto] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [coverIndex, setCoverIndex] = useState<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCoverPhoto(url);
  }

  function handlePhotosUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const remaining = 100 - photos.length;
    const toAdd = Array.from(files).slice(0, remaining);
    const urls = toAdd.map((f) => URL.createObjectURL(f));
    setPhotos((prev) => [...prev, ...urls]);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    if (coverIndex === idx) setCoverIndex(null);
    else if (coverIndex !== null && idx < coverIndex) setCoverIndex(coverIndex - 1);
  }

  function suggestAsCover(idx: number) {
    setCoverIndex(idx);
    setCoverPhoto(photos[idx]);
  }

  function handleSubmit() {
    if (!title || !date) return;
    alert(`Event "${title}" created successfully! (Demo — no backend for events yet)`);
    onClose();
  }

  return (
    <div className="ae-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ae-modal">
        <div className="ae-header">
          <h2>
            Create <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--color-accent)' }}>Event</span>
          </h2>
          <button className="ae-close" onClick={onClose}>&times;</button>
        </div>

        <div className="ae-body">
          {/* Cover Photo */}
          <div className="ae-field">
            <label>Cover Photo</label>
            <div
              className={`ae-cover-zone${coverPhoto ? ' has-cover' : ''}`}
              onClick={() => coverInputRef.current?.click()}
            >
              {coverPhoto ? (
                <>
                  <img src={coverPhoto} alt="Cover" />
                  <div className="ae-cover-overlay">
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Change Cover</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="ae-cover-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Upload cover photo</div>
                  <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 4 }}>JPG, PNG — this will appear on the event card</div>
                </>
              )}
              <input ref={coverInputRef} type="file" accept="image/*" hidden onChange={handleCoverUpload} />
            </div>
          </div>

          {/* Title & Type */}
          <div className="ae-row">
            <div className="ae-field">
              <label>Event Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Diwali Party" />
            </div>
            <div className="ae-field">
              <label>Event Type *</label>
              <select value={type} onChange={(e) => setType(e.target.value as EventType)}>
                <option value="Cultural">Cultural</option>
                <option value="Sports">Sports</option>
                <option value="Engineering">Engineering</option>
                <option value="Milestone">Milestone</option>
                <option value="Social">Social</option>
              </select>
            </div>
          </div>

          {/* Date */}
          <div className="ae-field">
            <label>Event Date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {/* Description */}
          <div className="ae-field">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell people what happened at this event..." />
          </div>

          {/* Photo Gallery */}
          <div className="ae-field">
            <label>Event Photos <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(max 100)</span></label>
            <div className="ae-photos-grid">
              {photos.map((url, idx) => (
                <div key={idx} className="ae-photo-thumb">
                  <img src={url} alt={`Photo ${idx + 1}`} />
                  <button className="ae-photo-remove" onClick={() => removePhoto(idx)}>&times;</button>
                  <button
                    className={`ae-star-badge${coverIndex === idx ? ' is-cover' : ''}`}
                    onClick={() => suggestAsCover(idx)}
                  >
                    {coverIndex === idx ? '★ COVER' : '☆ Cover'}
                  </button>
                </div>
              ))}
              {photos.length < 100 && (
                <button className="ae-add-photo-btn" onClick={() => photosInputRef.current?.click()}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>
                  Add
                </button>
              )}
            </div>
            {photos.length > 0 && (
              <div className="ae-photo-count">{photos.length}/100 photos added{coverIndex !== null && ' · Cover photo selected'}</div>
            )}
            <input ref={photosInputRef} type="file" accept="image/*" multiple hidden onChange={handlePhotosUpload} />
          </div>
        </div>

        <div className="ae-footer">
          <button className="ae-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-solid" style={{ padding: '10px 28px', fontSize: 14 }} onClick={handleSubmit} disabled={!title || !date}>
            Create Event →
          </button>
        </div>
      </div>
    </div>
  );
}
