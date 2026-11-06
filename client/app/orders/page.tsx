import type { Metadata } from "next";
import { Suspense } from "react";
import { RequireAuth } from "@/components/auth/RouteGuard";
import { OrdersHistory } from "@/components/orders/OrdersHistory";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Your orders",
  description: "View your order history and track order status.",
};

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner label="Loading orders" />
        </div>
      }
    >
      <RequireAuth>
        <OrdersHistory />
      </RequireAuth>
    </Suspense>
  );
}
