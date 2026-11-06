"use client";

import { ErrorState } from "@/components/ui/ErrorState";

export default function ProductError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <ErrorState
        title="Could not load this product"
        description="Something went wrong while loading the product. Please try again."
        onRetry={reset}
      />
    </div>
  );
}

