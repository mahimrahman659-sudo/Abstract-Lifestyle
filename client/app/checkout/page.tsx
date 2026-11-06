import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/RouteGuard";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Choose your shipping address and place a Cash on Delivery order.",
};

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Checkout</h1>
      <div className="mt-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Spinner label="Loading checkout" />
            </div>
          }
        >
          <RequireAuth>
            <CheckoutClient />
          </RequireAuth>
        </Suspense>
      </div>
    </div>
  );
}
