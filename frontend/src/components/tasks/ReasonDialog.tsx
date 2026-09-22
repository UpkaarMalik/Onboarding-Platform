import { useState, type FormEvent } from 'react';
import Modal from '../Modal';

/**
 * The one small form behind every "say why" action in the app.
 *
 * Three call sites, three shapes, one component: blocking a task wants a
 * required reason and an optional date, resolving a blocker wants an optional
 * note, rejecting a document wants a required reason. They differ by two
 * booleans and their wording, which is not enough difference to justify three
 * near-identical forms that would drift apart the first time one of them
 * gained a field.
 *
 * It exists at all because two of those three were a `window.prompt`. A prompt
 * cannot be styled, cannot show what it is about, cannot offer a date field,
 * and on some browsers can be suppressed entirely — at which point the action
 * silently does nothing.
 */
export default function ReasonDialog({
  title,
  subtitle,
  label,
  placeholder,
  required = true,
  withDate = false,
  confirmLabel,
  busy = false,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  label: string;
  placeholder?: string;
  /** False for a note nobody has to write — resolving a blocker. */
  required?: boolean;
  /** Adds the optional "expected by" date. Only blocking uses it. */
  withDate?: boolean;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (values: { reason: string; expectedAt?: string }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [expectedAt, setExpectedAt] = useState('');

  const canSubmit = !busy && (!required || reason.trim().length > 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      reason: reason.trim(),
      // Empty string is not a date. Omitted rather than sent as '' so the
      // API's IsDateString sees an absent field, not an invalid one.
      ...(withDate && expectedAt ? { expectedAt } : {}),
    });
  }

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {/* Submits the form by id rather than sitting inside it: Modal
              renders its actions in a footer outside the body, so a plain
              submit button there would not be associated with the form. */}
          <button type="submit" form="reason-dialog-form" className="btn-primary" disabled={!canSubmit}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      <form id="reason-dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">
            {label}
            {!required && <span className="field-hint"> (optional)</span>}
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            maxLength={500}
            // The field the dialog exists for. Focused so the keyboard is
            // already where it needs to be.
            autoFocus
            required={required}
          />
        </label>

        {withDate && (
          <label className="field">
            <span className="field-label">
              Expected by<span className="field-hint"> (optional)</span>
            </span>
            <input
              type="date"
              value={expectedAt}
              onChange={(e) => setExpectedAt(e.target.value)}
            />
            <span className="field-hint">
              Leave empty if nobody would be guessing honestly.
            </span>
          </label>
        )}

        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}
