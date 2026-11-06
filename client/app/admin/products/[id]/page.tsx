import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductEdit } from "@/components/admin/ProductEdit";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Edit product — Admin",
};

export default async function AdminProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner label="Loading product" />
        </div>
      }
    >
      <ProductEdit productId={id} />
    </Suspense>
  );
}
