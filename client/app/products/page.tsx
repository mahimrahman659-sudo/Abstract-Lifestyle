import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsView } from "@/components/catalog/ProductsView";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Shop all products",
  description:
    "Browse clothing and everyday lifestyle products: tees, hoodies, bags, bottles and more.",
  openGraph: {
    title: "Shop all products",
    description:
      "Browse clothing and everyday lifestyle products: tees, hoodies, bags, bottles and more.",
    url: "/products",
  },
};

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10">
          <Skeleton className="mb-6 h-8 w-48" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[4/5] w-full rounded-2xl" />
            ))}
          </div>
        </div>
      }
    >
      <ProductsView />
    </Suspense>
  );
}
