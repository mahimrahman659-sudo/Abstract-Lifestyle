'use client';

import { useState } from 'react';

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  announcement = 'Copied to clipboard',
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  announcement?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the value stays selectable by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-tile focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {copied ? copiedLabel : label}
      <span aria-live="polite" className="sr-only">
        {copied ? announcement : ''}
      </span>
    </button>
  );
}
