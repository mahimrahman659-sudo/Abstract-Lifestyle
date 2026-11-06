import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminOrderDetail } from "@/components/admin/AdminOrderDetail";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Order",
};

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner label="Loading order" />
        </div>
      }
    >
      <AdminOrderDetail orderId={id} />
    </Suspense>
  );
}
