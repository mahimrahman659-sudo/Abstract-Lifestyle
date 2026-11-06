"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ProductError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <ErrorState
        title="Could not load this product"
        description={error.message}
        onRetry={reset}
      />
    </div>
  );
}
