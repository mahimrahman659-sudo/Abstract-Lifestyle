'use client';

import Link from 'next/link';

/** Last-resort boundary (replaces the root layout) — user-safe copy only. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-[#faf9f7] px-4 text-center font-sans text-[#1c1917]">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-sm text-[#6b6560]">
          The store hit an unexpected error. Please reload the page or come back in a moment.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center rounded-full bg-[#14625c] px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14625c]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-full border border-[#e8e4df] px-5 text-sm font-medium text-[#1c1917] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14625c]"
          >
            Go to the homepage
          </Link>
        </div>
      </body>
    </html>
  );
}
