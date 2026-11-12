import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <EmptyState
        headingLevel="h1"
        title="Page not found"
        description="The page you are looking for does not exist or has been moved."
        action={
          <Link
            href="/products"
            className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Browse products
          </Link>
        }
      />
    </div>
  );
}
