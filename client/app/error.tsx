'use client';

import Link from 'next/link';
import { ErrorState } from '@/components/ui/ErrorState';

/** Route-level error boundary — user-safe copy only, no stack traces. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <ErrorState
        title="Something went wrong"
        description="An unexpected error occurred while loading this page. Please try again."
        onRetry={reset}
      />
      <p className="mt-6 text-center">
        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Back to the homepage
        </Link>
      </p>
    </div>
  );
}
