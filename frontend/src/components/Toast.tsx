import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  /** Picks the icon, the accent and how it is announced. Defaults to info. */
  tone?: ToastTone;
  /** One line, sentence case, says what happened. */
  title: string;
  /** Optional second line: the detail, or what to do next. */
  message?: string;
  /** Milliseconds on screen. 0 keeps it up until it is dismissed. */
  duration?: number;
}

interface ToastRow extends ToastInput {
  id: number;
  tone: ToastTone;
  duration: number;
}

/** Long enough to read two lines, short enough not to sit over the page. An
 *  error gets longer: it is the one you are most likely to want to re-read,
 *  and the one whose message is doing real work. */
const DEFAULT_MS = 4500;
const ERROR_MS = 7000;
/** Older ones fall off the top. Four toasts is already a column tall enough
 *  to cover a card; a fifth would be covering the thing it is talking about. */
const MAX_STACK = 3;

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/**
 * Bottom-corner toasts.
 *
 * Separate from the notification bell on purpose: the bell is a record of
 * things that happened while you were not looking and it keeps them. A toast
 * is the acknowledgement of something you just did — it has no list, no
 * unread count and no history, and it goes away by itself.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRow[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((rows) => rows.filter((r) => r.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const tone = input.tone ?? 'info';
    const row: ToastRow = {
      ...input,
      tone,
      id: nextId.current++,
      duration: input.duration ?? (tone === 'error' ? ERROR_MS : DEFAULT_MS),
    };
    setToasts((rows) => [...rows, row].slice(-MAX_STACK));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/**
 * Raises a toast. Safe to call from anywhere under <ToastProvider>; outside
 * it this throws rather than silently swallowing the message, because a
 * confirmation that does not appear is worse than one that was never written.
 */
export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <ToastProvider>');
  return push;
}

function ToastCard({ toast, onDismiss }: { toast: ToastRow; onDismiss: () => void }) {
  /** Ticks down only while the pointer is elsewhere: reading a toast should
   *  not be a race against it. Kept in a ref so hovering does not re-render
   *  the card, and restarted from what was left rather than from the top. */
  const left = useRef(toast.duration);
  const startedAt = useRef(Date.now());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (toast.duration === 0 || paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(onDismiss, left.current);
    return () => {
      window.clearTimeout(id);
      left.current -= Date.now() - startedAt.current;
    };
  }, [toast.duration, paused, onDismiss]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      /* Errors interrupt; a confirmation waits its turn. */
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="toast__icon" aria-hidden="true">
        <ToneIcon tone={toast.tone} />
      </span>
      <div className="toast__body">
        <strong className="toast__title">{toast.title}</strong>
        {toast.message && <p className="toast__msg">{toast.message}</p>}
      </div>
      <button className="toast__close" type="button" onClick={onDismiss} aria-label="Dismiss">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {toast.duration > 0 && (
        /* The bar is the timer made visible — without it a toast that
           vanishes mid-sentence reads as a glitch rather than as a clock
           running out. It pauses with the timer. */
        <span
          className="toast__bar"
          style={{
            animationDuration: `${toast.duration}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  );
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  const common = {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (tone === 'success') return <svg {...common}><path d="M5 10.5l3.2 3.2L15 6.5" /></svg>;
  if (tone === 'error') return <svg {...common}><path d="M6 6l8 8M14 6l-8 8" /></svg>;
  if (tone === 'warning')
    return (
      <svg {...common}>
        <path d="M10 5.5v5" />
        <path d="M10 14.2v.1" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M10 9.2V14" />
      <path d="M10 6.1v.1" />
    </svg>
  );
}

/**
 * Turns a thrown value into the message line of an error toast. Anything the
 * API named is used as-is — the server's own wording is more specific than
 * anything this layer could invent — and only a genuinely unnamed failure
 * falls back.
 */
export function toastError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
