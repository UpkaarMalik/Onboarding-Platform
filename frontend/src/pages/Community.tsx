import { useEffect, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import Reveal from '../components/Reveal';

/**
 * Community UI: posts, comments, voting (a Reddit-style vertical
 * up/down stack with the net score between the two arrows), and — for
 * SuperAdmin/HR only — removal of a post OR a single comment, each
 * with a reason. `is_mine`/`author_id`/`author_name` come back null
 * from the API for anyone but the actual author (enforced server-side
 * in the SQL itself, see CommunityService), so this UI just renders
 * "Anonymous" whenever those fields are absent — there's no author
 * identity to accidentally leak here even if this component tried to.
 */
export default function Community() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [newPost, setNewPost] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'questions'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [postDetail, setPostDetail] = useState<any | null>(null);
  const [commentBody, setCommentBody] = useState('');

  // `loading` starts true and is the only thing that gates the
  // post-list render below — without it, a slow or failed initial
  // fetch and a genuinely empty board look identical ("no posts yet"),
  // which makes a real bug indistinguishable from an empty community.
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

  return (
    <div className="community-page">
      <h1>Community</h1>
      {error && <p className="error-text">{error}</p>}

      <form onSubmit={submitPost} className="new-post-form">
        <textarea
          value={newPost}
          onChange={(e) => setNewPost(e.target.value)}
          placeholder={
            isQuestion
              ? "Ask anything — new-hire questions welcome, still posted anonymously…"
              : 'Share something with the team… (posts are anonymous)'
          }
        />
        <div className="new-post-actions">
          <label className="question-toggle">
            <input
              type="checkbox"
              checked={isQuestion}
              onChange={(e) => setIsQuestion(e.target.checked)}
            />
            ❓ This is a question (Ask Me Anything)
          </label>
          <button type="submit" className="btn-primary post-btn">
            {isQuestion ? 'Ask' : 'Post'}
          </button>
        </div>
      </form>

      <div className="filters">
        <button className={feedFilter === 'all' ? 'active' : ''} onClick={() => setFeedFilter('all')}>
          All posts
        </button>
        <button
          className={feedFilter === 'questions' ? 'active' : ''}
          onClick={() => setFeedFilter('questions')}
        >
          ❓ Ask Me Anything
        </button>
      </div>

      {loading && <p>Loading posts…</p>}

      <Reveal>
      <ul className="post-list">
        {!loading &&
          posts
            .filter((p) => feedFilter === 'all' || p.is_question)
            .map((p) => (
            <li key={p.id} className="post-card">
              <div className="vote-stack">
                <button
                  className={`vote-btn ${p.my_vote === 1 ? 'upvoted' : ''}`}
                  onClick={() => vote(p.id, 1)}
                  aria-label="Upvote"
                >
                  ▲
                </button>
                <span
                  className={`vote-score ${p.score > 0 ? 'positive' : p.score < 0 ? 'negative' : ''}`}
                >
                  {p.score}
                </span>
                <button
                  className={`vote-btn ${p.my_vote === -1 ? 'downvoted' : ''}`}
                  onClick={() => vote(p.id, -1)}
                  aria-label="Downvote"
                >
                  ▼
                </button>
              </div>

              <div className="post-main">
                {p.is_question && <span className="badge question-badge">❓ Question</span>}
                <div className="post-body">{p.body}</div>
                <div className="post-meta">
                  <span>{p.is_mine ? 'You' : 'Anonymous'}</span>
                  <span>{new Date(p.created_at).toLocaleString()}</span>
                </div>
                <div className="post-actions">
                  <button onClick={() => (expandedId === p.id ? closePost() : openPost(p.id))}>
                    💬 {p.comment_count} comment{p.comment_count === 1 ? '' : 's'}
                  </button>
                  {user?.role === 'superadmin_hr' && (
                    <button onClick={() => deletePost(p.id)} className="danger">
                      Remove
                    </button>
                  )}
                </div>

                {expandedId === p.id && postDetail && (
                  <div className="comment-thread">
                    <ul>
                      {postDetail.comments.map((c: any) => (
                        <li key={c.id}>
                          <span>
                            <strong>{c.is_mine ? 'You' : 'Anonymous'}:</strong> {c.body}
                          </span>
                          {user?.role === 'superadmin_hr' && (
                            <button
                              className="danger comment-remove"
                              onClick={() => deleteComment(p.id, c.id)}
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                      {postDetail.comments.length === 0 && <li className="muted">No comments yet.</li>}
                    </ul>
                    <form onSubmit={submitComment} className="comment-form">
                      <input
                        value={commentBody}
                        onChange={(e) => setCommentBody(e.target.value)}
                        placeholder="Add a comment…"
                      />
                      <button type="submit">Reply</button>
                    </form>
                  </div>
                )}
              </div>
            </li>
          ))}
      </ul>
      </Reveal>
      {!loading &&
        posts.filter((p) => feedFilter === 'all' || p.is_question).length === 0 && (
          <p className="muted">
            {feedFilter === 'questions' ? 'No questions yet — ask the first one.' : 'No posts yet — be the first.'}
          </p>
        )}
    </div>
  );
}
