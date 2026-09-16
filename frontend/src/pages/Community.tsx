import { useEffect, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import Reveal from '../components/Reveal';

/* ------------------------------------------------------------------ */
/*  Poll option colors – cycled per option index                       */
/* ------------------------------------------------------------------ */
const POLL_BAR_COLORS = ['#e8930c', '#d4d0c8', '#a8d8c8', '#c8b8d4'];
const POLL_LETTER_BG  = ['#1a1a1a', '#555', '#3a7a6a', '#6a5a7a'];

export default function Community() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [newPost, setNewPost] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [isPoll, setIsPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [feedFilter, setFeedFilter] = useState<'all' | 'questions' | 'polls'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [postDetail, setPostDetail] = useState<any | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [pollVotes, setPollVotes] = useState<Record<string, string>>({});

  /* Load Playfair Display font */
  useEffect(() => {
    const id = 'playfair-display-font';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,600&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  /* ---- Data loading ---- */
  async function load() {
    setError(null);
    try {
      const res = await authedFetch<{ data: any[] }>('/community/posts?limit=50');
      setPosts(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Actions ---- */
  async function submitPost(e: FormEvent) {
    e.preventDefault();
    if (!newPost.trim()) return;
    try {
      await authedFetch('/community/posts', {
        method: 'POST',
        body: { body: newPost, isQuestion },
      });
      setNewPost('');
      setIsQuestion(false);
      setIsPoll(false);
      setPollOptions(['', '']);
      setShowCompose(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function vote(postId: string, value: 1 | -1) {
    try {
      await authedFetch(`/community/posts/${postId}/vote`, { method: 'POST', body: { value } });
      await load();
      if (expandedId === postId) await openPost(postId);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function openPost(postId: string) {
    setExpandedId(postId);
    try {
      const detail = await authedFetch(`/community/posts/${postId}`);
      setPostDetail(detail);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  function closePost() {
    setExpandedId(null);
    setPostDetail(null);
  }

  async function submitComment(e: FormEvent) {
    e.preventDefault();
    if (!expandedId || !commentBody.trim()) return;
    try {
      await authedFetch(`/community/posts/${expandedId}/comments`, {
        method: 'POST',
        body: { body: commentBody },
      });
      setCommentBody('');
      await openPost(expandedId);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function deletePost(postId: string) {
    const reason = window.prompt('Reason for removing this post?');
    if (!reason) return;
    try {
      await authedFetch(`/community/posts/${postId}`, { method: 'DELETE', body: { reason } });
      if (expandedId === postId) closePost();
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function deleteComment(postId: string, commentId: string) {
    const reason = window.prompt('Reason for removing this comment?');
    if (!reason) return;
    try {
      await authedFetch(`/community/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE',
        body: { reason },
      });
      await openPost(postId);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  function handlePollVote(postId: string, optionKey: string) {
    setPollVotes((prev) => {
      if (prev[postId] === optionKey) {
        const next = { ...prev };
        delete next[postId];
        return next;
      }
      return { ...prev, [postId]: optionKey };
    });
  }

  /* ---- Derived values ---- */
  const totalPosts = posts.length;
  const pollCount = posts.filter((p) => p.is_poll).length;

  const searched = searchQuery
    ? posts.filter(
        (p) =>
          (p.body || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.title || '').toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : posts;

  const filtered = searched.filter((p) => {
    if (feedFilter === 'questions') return p.is_question;
    if (feedFilter === 'polls') return p.is_poll;
    return true;
  });

  /* ---- Filter tab config ---- */
  const filterTabs: { id: 'all' | 'questions' | 'polls'; label: string; icon: string }[] = [
    { id: 'all', label: 'All posts', icon: '' },
    { id: 'questions', label: '❓ Ask Me Anything', icon: '' },
    { id: 'polls', label: '📊 Polls', icon: '' },
  ];

  /* ---- Render ---- */
  return (
    <div className="cv-page">
      {/* ================================================================
          HEADER
          ================================================================ */}
      <header className="cv-header" style={{ flexDirection: 'column', gap: '0.25rem' }}>
        {/* Badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#e8930c',
              letterSpacing: 0.5,
            }}
          >
            ACTIVE DISCUSSION DECK
          </span>
          <span style={{ color: '#ccc' }}>&middot;</span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              color: '#e8930c',
              letterSpacing: 0.5,
              animation: 'cvBlink 1.5s ease-in-out infinite',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: '#34c759',
                borderRadius: '50%',
                display: 'inline-block',
              }}
            />
            SAFE &amp; ANONYMOUS
          </span>
        </div>

        {/* Title */}
        <h1 className="cv-title" style={{ fontSize: '2.2rem' }}>
          Community{' '}
          <span
            style={{
              fontFamily: "'Playfair Display', serif",
              fontStyle: 'italic',
              color: '#e8930c',
              fontWeight: 600,
            }}
          >
            Voice
          </span>
        </h1>
        <p className="cv-subtitle" style={{ maxWidth: 480 }}>
          Exchange notes, questions, and insights anonymously with fellow explorers and teammates.
        </p>
      </header>

      {error && <p className="error-text">{error}</p>}

      {/* ================================================================
          STATS BAR
          ================================================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600 }}>
          <span
            style={{
              width: 8,
              height: 8,
              background: '#34c759',
              borderRadius: '50%',
              display: 'inline-block',
            }}
          />
          {totalPosts} Discussions
        </div>
        <span style={{ color: '#ddd' }}>&middot;</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#777' }}>
          <span style={{ fontSize: 14 }}>🔒</span> 100% Anonymous
        </div>
        <span style={{ color: '#ddd' }}>&middot;</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#777' }}>
          <span style={{ fontSize: 14 }}>📊</span> {pollCount} Active Poll{pollCount !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ================================================================
          COMPOSE BOX (teaser when closed)
          ================================================================ */}
      {!showCompose && (
        <div
          className="cv-quick-compose"
          onClick={() => setShowCompose(true)}
          style={{
            display: 'block',
            background: '#fff',
            border: '1px solid #e8e4dc',
            borderRadius: 16,
            padding: '16px 22px',
            cursor: 'pointer',
            transition: 'box-shadow 0.2s, border-color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(232,147,12,0.12)'; e.currentTarget.style.borderColor = '#e8930c50'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e8e4dc'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>✏️</span>
            <span style={{ fontSize: 13, color: '#999', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Share something with the team... (posts &amp; polls are 100% anonymous)
            </span>
            <span style={{ fontSize: 11, color: '#999', border: '1px solid #e0dbd3', borderRadius: 6, padding: '3px 10px', fontWeight: 500, flexShrink: 0 }}>Draft</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, gap: 8 }}>
            <span style={{ color: '#e8930c', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>AMA ready <span style={{ color: '#ccc', fontWeight: 400 }}>&middot;</span> <span style={{ color: '#999', fontWeight: 400 }}>Polls enabled</span></span>
            <span style={{ fontWeight: 600, color: '#e8930c', flexShrink: 0, whiteSpace: 'nowrap' }}>Composer &rarr;</span>
          </div>
        </div>
      )}

      {/* ---- Full compose card ---- */}
      {showCompose && (
        <form className="cv-compose-card" onSubmit={submitPost}>
          <textarea
            className="cv-compose-input"
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            placeholder={
              isQuestion
                ? 'Ask anything -- new-hire questions welcome...'
                : 'Share something with the team...'
            }
            rows={3}
          />
          {isPoll && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>
                Poll Options
              </p>
              {pollOptions.map((opt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      background: POLL_LETTER_BG[i % POLL_LETTER_BG.length],
                      color: '#fff',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    style={{
                      flex: 1,
                      border: '1px solid #e0dbd3',
                      borderRadius: 8,
                      padding: '6px 10px',
                      fontSize: 13,
                      fontFamily: 'inherit',
                    }}
                    value={opt}
                    onChange={(e) => {
                      const next = [...pollOptions];
                      next[i] = e.target.value;
                      setPollOptions(next);
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                {pollOptions.length < 6 ? (
                  <button
                    type="button"
                    onClick={() => setPollOptions([...pollOptions, ''])}
                    style={{
                      background: 'none',
                      border: '1px dashed #ddd',
                      borderRadius: 8,
                      padding: '4px 12px',
                      fontSize: 11,
                      color: '#999',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    + Add
                  </button>
                ) : <span />}
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions(pollOptions.slice(0, -1))}
                    style={{
                      background: 'none',
                      border: '1px dashed #ddd',
                      borderRadius: 8,
                      padding: '4px 12px',
                      fontSize: 11,
                      color: '#c94a3c',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    − Remove
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="cv-compose-footer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label className="cv-question-toggle">
                <input
                  type="checkbox"
                  checked={isQuestion}
                  onChange={(e) => {
                    setIsQuestion(e.target.checked);
                    if (e.target.checked) setIsPoll(false);
                  }}
                />
                <span className="cv-question-pill">?</span>
                AMA
              </label>
              <label className="cv-question-toggle">
                <input
                  type="checkbox"
                  checked={isPoll}
                  onChange={(e) => {
                    setIsPoll(e.target.checked);
                    if (e.target.checked) setIsQuestion(false);
                  }}
                />
                <span
                  className="cv-question-pill"
                  style={{ color: '#1a7a3a', background: '#edfcf2', borderColor: '#b5e2c4' }}
                >
                  P
                </span>
                Poll
              </label>
            </div>
            <div className="cv-compose-actions">
              <button
                type="button"
                className="cv-btn-secondary"
                onClick={() => setShowCompose(false)}
              >
                Cancel
              </button>
              <button type="submit" className="cv-btn-primary">
                {isQuestion ? 'Ask' : isPoll ? 'Create Poll' : 'Post'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ================================================================
          SEARCH + FILTER TABS
          ================================================================ */}
      <div style={{ marginBottom: '1rem' }}>
        {/* Search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '0 1 320px' }}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="7" cy="7" r="5" stroke="#999" strokeWidth="1.3" />
              <path d="M11 11l3 3" stroke="#999" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Filter discussions by keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: '1px solid #e0dbd3',
                borderRadius: 10,
                padding: '9px 14px 9px 34px',
                fontSize: 13,
                width: '100%',
                fontFamily: 'inherit',
                outline: 'none',
                background: '#fff',
                boxSizing: 'border-box' as const,
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
            Showing {filtered.length} post{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFeedFilter(tab.id)}
              style={{
                background: feedFilter === tab.id ? '#1e2a3a' : '#fff',
                color: feedFilter === tab.id ? '#fff' : '#555',
                border: feedFilter === tab.id ? 'none' : '1px solid #ddd8d0',
                padding: '7px 16px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================
          POST FEED
          ================================================================ */}
      {loading && <p className="cv-loading">Loading posts...</p>}

      <Reveal>
        <div className="cv-feed">
          {!loading &&
            filtered.map((p) => {
              /* Determine type badge */
              const isQ = p.is_question;
              const isP = p.is_poll;
              const typeBadge = isQ
                ? 'QUESTION'
                : isP
                  ? 'POLL'
                  : null;
              const typeBadgeStyle = isQ
                ? { color: '#e8930c', background: '#fef7ec', border: '1px solid #f5d4a0' }
                : isP
                  ? { color: '#1a7a3a', background: '#edfcf2', border: '1px solid #b5e2c4' }
                  : {};

              /* Poll options from backend (if available) */
              const pollOpts: any[] = p.poll_options || p.options || [];
              const myPollVote = pollVotes[p.id] || null;
              const pollTotal =
                pollOpts.reduce(
                  (s: number, o: any) =>
                    s + (o.votes || o.vote_count || 0) + (myPollVote === (o.key || o.id) ? 1 : 0),
                  0,
                ) || 1;

              return (
                <article
                  key={p.id}
                  className="cv-post-card"
                  style={{ flexDirection: 'column', padding: '20px 24px' }}
                >
                  {/* ---- Post header row ---- */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      {typeBadge && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 6,
                            padding: '3px 10px',
                            ...typeBadgeStyle,
                          }}
                        >
                          {isQ ? '? ' : ''}
                          {typeBadge}
                        </span>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700 }}>
                        {p.is_mine ? 'You' : 'Anonymous'}
                      </span>
                      {p.category && (
                        <span
                          style={{
                            fontSize: 11,
                            color: '#999',
                            background: '#f5f4f2',
                            borderRadius: 4,
                            padding: '2px 8px',
                          }}
                        >
                          {p.category}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>
                      {new Date(p.created_at).toLocaleString()}
                    </span>
                  </div>

                  {/* ---- Title (if present) ---- */}
                  {p.title && (
                    <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>{p.title}</h3>
                  )}

                  {/* ---- Body ---- */}
                  <p style={{ margin: 0, fontSize: 14, color: '#555', lineHeight: 1.6 }}>
                    {p.body}
                  </p>

                  {/* ---- Poll options (if this is a poll) ---- */}
                  {isP && pollOpts.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      {pollOpts.map((opt: any, oi: number) => {
                        const optKey = opt.key || opt.id || String(oi);
                        const baseVotes = opt.votes || opt.vote_count || 0;
                        const extra = myPollVote === optKey ? 1 : 0;
                        const totalVotes = baseVotes + extra;
                        const pct = Math.round((totalVotes / pollTotal) * 100);
                        const letter = String.fromCharCode(65 + oi);

                        return (
                          <div
                            key={optKey}
                            onClick={() => handlePollVote(p.id, optKey)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              marginBottom: 8,
                              position: 'relative',
                              background: '#faf9f7',
                              border: '1px solid #e8e4dc',
                              borderRadius: 10,
                              overflow: 'hidden',
                              height: 40,
                              cursor: 'pointer',
                            }}
                          >
                            {/* Percentage bar fill */}
                            <div
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: `${pct}%`,
                                background: POLL_BAR_COLORS[oi % POLL_BAR_COLORS.length],
                                borderRadius: 10,
                                transition: 'width 0.5s ease',
                              }}
                            />
                            {/* Content over bar */}
                            <div
                              style={{
                                position: 'relative',
                                zIndex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '0 14px',
                                width: '100%',
                                height: '100%',
                              }}
                            >
                              <span
                                style={{
                                  width: 22,
                                  height: 22,
                                  background: POLL_LETTER_BG[oi % POLL_LETTER_BG.length],
                                  color: '#fff',
                                  borderRadius: '50%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {letter}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: oi === 0 ? '#fff' : '#333',
                                }}
                              >
                                {opt.label || opt.text || opt.option}
                              </span>
                              <span
                                style={{
                                  marginLeft: 'auto',
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: oi === 0 && pct > 20 ? '#fff' : '#333',
                                }}
                              >
                                {pct}%
                              </span>
                              <span style={{ fontSize: 11, color: '#999' }}>
                                ({totalVotes} vote{totalVotes !== 1 ? 's' : ''})
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ---- Footer: likes, comments, remove ---- */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 14,
                      paddingTop: 12,
                      borderTop: '1px solid #f5f3ee',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    {/* Left: vote + meta */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <button
                        onClick={() => vote(p.id, 1)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 13,
                          color: p.my_vote === 1 ? '#e8930c' : '#777',
                          fontFamily: 'inherit',
                          padding: 0,
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {p.score}
                      </button>
                      <span style={{ fontSize: 12, color: '#bbb' }}>
                        {p.is_mine ? 'Author: You' : 'By Anonymous'}
                      </span>
                    </div>

                    {/* Right: comments + remove */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        onClick={() =>
                          expandedId === p.id ? closePost() : openPost(p.id)
                        }
                        style={{
                          fontSize: 12,
                          color: expandedId === p.id ? '#e8930c' : '#777',
                          border: '1px solid #e0dbd3',
                          borderRadius: 8,
                          padding: '4px 12px',
                          cursor: 'pointer',
                          background: expandedId === p.id ? '#fff5e9' : 'transparent',
                          fontFamily: 'inherit',
                          fontWeight: 500,
                        }}
                      >
                        {p.comment_count} comment{p.comment_count !== 1 ? 's' : ''}
                      </button>
                      {user?.role === 'superadmin_hr' && (
                        <button
                          onClick={() => deletePost(p.id)}
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#c0392b',
                            border: '1px solid #f5c6c0',
                            borderRadius: 8,
                            padding: '4px 12px',
                            cursor: 'pointer',
                            background: 'transparent',
                            fontFamily: 'inherit',
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ---- Expanded comments ---- */}
                  {expandedId === p.id && postDetail && (
                    <div className="cv-comments">
                      {postDetail.comments.map((c: any) => (
                        <div key={c.id} className="cv-comment">
                          <div className="cv-comment-avatar">
                            {c.is_mine ? 'Y' : 'A'}
                          </div>
                          <div className="cv-comment-content">
                            <span className="cv-comment-author">
                              {c.is_mine ? 'You' : 'Anonymous'}
                            </span>
                            <p className="cv-comment-text">{c.body}</p>
                          </div>
                          {user?.role === 'superadmin_hr' && (
                            <button
                              className="cv-action-btn cv-action-btn--danger cv-comment-remove"
                              onClick={() => deleteComment(p.id, c.id)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))}
                      {postDetail.comments.length === 0 && (
                        <p className="cv-no-comments">
                          No comments yet -- be the first to respond.
                        </p>
                      )}
                      <form onSubmit={submitComment} className="cv-comment-form">
                        <input
                          className="cv-comment-input"
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                          placeholder="Add a comment..."
                        />
                        <button type="submit" className="cv-btn-primary cv-btn-sm">
                          Reply
                        </button>
                      </form>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      </Reveal>

      {!loading && filtered.length === 0 && (
        <div className="cv-empty">
          <div className="cv-empty-icon">
            {feedFilter === 'polls' ? '' : feedFilter === 'questions' ? '?' : ''}
          </div>
          <p>
            {feedFilter === 'questions'
              ? 'No questions yet -- ask the first one!'
              : feedFilter === 'polls'
                ? 'No polls yet -- create the first one!'
                : 'No posts yet -- be the first to share.'}
          </p>
        </div>
      )}

      {/* ================================================================
          FOOTER QUOTE
          ================================================================ */}
      <div style={{ padding: '32px 0 40px', textAlign: 'center' }}>
        <p
          style={{
            margin: '0 0 8px',
            fontFamily: "'Playfair Display', serif",
            fontStyle: 'italic',
            fontSize: 18,
            color: '#1a1a1a',
          }}
        >
          &ldquo;Every great journey begins with the first question.&rdquo;
        </p>
        <p style={{ margin: 0, fontSize: 13, color: '#999' }}>
          Need navigation help along the way? Contact People Ops at{' '}
          <a
            href="mailto:people@andpayments.com"
            style={{ color: '#e8930c', fontWeight: 600, textDecoration: 'none' }}
          >
            people@andpayments.com
          </a>
        </p>
      </div>

      {/* Blink animation (injected once) */}
      <style>{`
        @keyframes cvBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
