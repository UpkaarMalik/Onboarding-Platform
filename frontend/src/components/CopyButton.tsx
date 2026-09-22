import { useState } from 'react';

/** Copy-to-clipboard for a credential. Shared: the profile, the
 *  'account created' dialog and the roster's credential panel all show
 *  values that are easy to mistype and must not be retyped by hand. */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. an insecure/non-HTTPS
      // context) — fail silently rather than block on it; the value
      // is still shown in plain text right next to this button.
    }
  }

  return (
    <button type="button" onClick={copy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
