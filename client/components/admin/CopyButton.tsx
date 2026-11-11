'use client';

import { useState } from 'react';

/**
 * Copies text to the clipboard and shows a short confirmation. Used by the
 * admin order view to copy the delivery address for calls / courier forms.
 */
export function CopyButton({ value, label = 'Copy address' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the address stays selectable by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-tile focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {copied ? 'Copied' : label}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Address copied to clipboard' : ''}
      </span>
    </button>
  );
}
