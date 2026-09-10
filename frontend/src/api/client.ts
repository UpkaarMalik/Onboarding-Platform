/** Exported so multipart uploads can build their own fetch — apiFetch always
 *  JSON-encodes the body and sets a JSON Content-Type, which breaks FormData. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Matches the backend's Step 34 AllExceptionsFilter shape exactly:
 * {statusCode, code, message}. Every failed request throws one of
 * these — callers can rely on `.message` always being a clean,
 * user-facing string (never a raw stack trace), and `.statusCode` for
 * status-specific handling (e.g. treating 409 as "already done" rather
 * than a real error).
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  });

  // 204 No Content (e.g. DELETE /notes/:id, DELETE /community/posts/:id)
  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const rawMessage =
      typeof data === 'object' && data !== null && 'message' in data
        ? (data as { message: string | string[] }).message
        : String(data);
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    const code = typeof data === 'object' && data !== null && 'code' in data ? (data as any).code : 'UNKNOWN_ERROR';
    throw new ApiError(res.status, code, message || 'Something went wrong');
  }

  return data as T;
}

/** Documents are streamed through the app with auth required (see
 *  DocumentsController.download) — a plain `<a href>` can't attach a
 *  Bearer token, so this fetches the file as a blob and hands the
 *  browser a throwaway object URL to save it from. */
export async function downloadFile(path: string, token: string | null, suggestedName: string) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download this file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** "Read online" — same authed fetch as downloadFile, but hands the
 *  blob to a new tab instead of forcing a save, so the browser's own
 *  PDF viewer renders it inline. The object URL is only good for this
 *  tab's lifetime, so it's revoked on a delay rather than immediately
 *  — revoking before the new tab finishes loading the blob would
 *  leave it blank. */
export async function openFileInline(path: string, token: string | null) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, 'OPEN_FAILED', 'Could not open this file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
