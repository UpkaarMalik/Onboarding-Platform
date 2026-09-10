import { useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { ApiError } from '../api/client';

/**
 * SuperAdmin/HR visibility into private notes: content only, never
 * who wrote it — GET /notes/admin/all never selects user_id at all,
 * so there's nothing here to deanonymize even by accident. This is a
 * separate capability from the notes a person manages on their own
 * Start Here page, which stays exactly as owner-only as before.
 */
export default function AdminNotes() {
  const authedFetch = useAuthedFetch();
  const [notes, setNotes] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<{ data: any[]; total: number }>('/notes/admin/all?limit=50')
      .then((res) => {
        setNotes(res.data);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="admin-notes-page">
      <h1>Private notes</h1>
      <p className="muted">
        Content only — {total} note{total === 1 ? '' : 's'} across every employee. Who wrote each one
        stays private, same as it always has.
      </p>
      {error && <p className="error-text">{error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && (
        <ul className="notes-list">
          {notes.map((n) => (
            <li key={n.id}>
              {n.content}
              <div className="task-meta">{new Date(n.created_at).toLocaleString()}</div>
            </li>
          ))}
          {notes.length === 0 && <p className="muted">No notes yet.</p>}
        </ul>
      )}
    </div>
  );
}
