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

/** Icon purely by keyword match on the title — same idea as
 *  StartHere's knowledge-card icons, just a different keyword set. */
function iconFor(title: string) {
  const t = title.toLowerCase();
  if (t.includes('handbook')) return '📘';
  if (t.includes('meal') || t.includes('reimbursement')) return '🍽️';
  if (t.includes('travel')) return '✈️';
  if (t.includes('insurance') || t.includes('health')) return '🩺';
  return '📄';
}

export default function Documents() {
  const authedFetch = useAuthedFetch();
  const { accessToken } = useAuth();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<DocumentRow[]>('/documents')
      .then(setDocs)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDownload(doc: DocumentRow) {
    setDownloadingId(doc.id);
    try {
      await downloadFile(`/documents/${doc.id}/download`, accessToken, `${doc.title}.pdf`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleReadOnline(doc: DocumentRow) {
    setOpeningId(doc.id);
    try {
      await openFileInline(`/documents/${doc.id}/download`, accessToken);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setOpeningId(null);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="documents-page">
      <h1>Documents</h1>
      <p className="muted">Company policies available to every department.</p>
      <Reveal>
        <div className="doc-grid">
          {docs.map((doc, i) => (
            <div className="doc-card card-hover" key={doc.id} style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="doc-card-top">
                <span className="doc-icon">{iconFor(doc.title)}</span>
                <div className="doc-info">
                  <strong>{doc.title}</strong>
                  <span className="muted">PDF</span>
                </div>
              </div>
              <div className="doc-actions">
                <button
                  type="button"
                  disabled={openingId === doc.id}
                  onClick={() => handleReadOnline(doc)}
                >
                  {openingId === doc.id ? 'Opening…' : 'Read online'}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={downloadingId === doc.id}
                  onClick={() => handleDownload(doc)}
                >
                  {downloadingId === doc.id ? 'Downloading…' : 'Download'}
                </button>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="muted">No documents yet.</p>}
        </div>
      </Reveal>
    </div>
  );
}
