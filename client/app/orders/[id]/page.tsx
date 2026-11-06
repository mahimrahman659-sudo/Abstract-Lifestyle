import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/RouteGuard";
import { OrderDetailClient } from "@/components/orders/OrderDetailClient";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Order details — Abstract Lifestyle",
  description: "Order summary, shipping address and status.",
};

// Order data is request-time (ownership + live status) — allow this route to
// block prerendering (Next 16 cacheComponents).
export const instant = false;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner label="Loading order" />
          </div>
        }
      >
        <RequireAuth>
          <OrderDetailClient orderId={id} />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
