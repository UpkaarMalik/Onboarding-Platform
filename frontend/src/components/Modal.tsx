import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Generic popup shell used whenever selecting a row/card should open a detail
 * view instead of navigating away — task details, an employee's profile, etc.
 *
 * `size` controls width: 'default' (420px) for a short form, 'wide' (760px) for
 * a multi-column checkbox grid, 'xl' (960px) for a task popup carrying a
 * document grid or a long subtask checklist, where the narrow width was what
 * made the content feel cramped.
 *
 * `busy` blocks dismissal. Without it, a backdrop click or Escape mid-upload
 * unmounts the child while its multipart request is still in flight, and the
 * user never finds out whether a 10 MB file landed.
 */
export default function Modal({
  title,
  onClose,
  children,
  actions,
  wide = false,
  size,
  busy = false,
  subtitle,
  icon,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  /** @deprecated prefer `size="wide"` — kept so existing call sites still work. */
  wide?: boolean;
  size?: 'default' | 'wide' | 'xl';
  busy?: boolean;
  subtitle?: ReactNode;
  icon?: ReactNode;
}) {
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const resolved = size ?? (wide ? 'wide' : 'default');

  useEffect(() => {
    // The docstring promised Escape-to-close for a long time before anything
    // implemented it.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal--${resolved}${resolved === 'wide' ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <div className="modal-head">
          {icon && <span className="modal-head-icon">{icon}</span>}
          <div className="modal-head-text">
            <h2 id={headingId}>{title}</h2>
            {subtitle && <p className="modal-head-sub">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Its own scroll container so a long document list doesn't scroll the
            title and the actions out of reach. */}
        <div className="modal-body">{children}</div>

        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
