/**
 * What a section shows when its data did not load.
 *
 * The rule this exists to enforce: a failed fetch must never be rendered as
 * a zero. "0 joiners" and "we could not reach the server" look identical on
 * a dashboard made of big numbers, and only one of them is something the
 * reader should act on. Every caller swaps this in for the numbers rather
 * than showing it beside them.
 *
 * Retry re-runs the same loader rather than reloading the page, so the rest
 * of the dashboard — which may have loaded perfectly well — is not thrown
 * away to recover one section.
 */
export default function LoadError({
  message,
  onRetry,
  busy = false,
}: {
  message: string;
  onRetry: () => void;
  /** True while the retry is in flight, so the button cannot be queued up. */
  busy?: boolean;
}) {
  return (
    // role="alert" so it is announced when it replaces the numbers; a screen
    // reader user gets no other signal that the figures went away.
    <p className="load-error" role="alert">
      <span className="load-error-icon" aria-hidden="true">!</span>
      <span className="load-error-text">{message}</span>
      <button type="button" className="load-error-retry" onClick={onRetry} disabled={busy}>
        {busy ? 'Retrying…' : 'Retry'}
      </button>
    </p>
  );
}
