import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductsView } from "@/components/catalog/ProductsView";
import { Skeleton } from "@/components/ui/Skeleton";
import { PRODUCT_GRID_CLASS, PRODUCT_GRID_ITEM_CLASS } from "@/lib/catalog/grid";

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
          <div className={PRODUCT_GRID_CLASS}>
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className={`${PRODUCT_GRID_ITEM_CLASS} aspect-[4/5] rounded-2xl`} />
            ))}
          </div>
        </div>
      }
    >
      <ProductsView />
    </Suspense>
  );
}
