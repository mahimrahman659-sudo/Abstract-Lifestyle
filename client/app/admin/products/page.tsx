import type { Metadata } from "next";
import { ProductsManager } from "@/components/admin/ProductsManager";

export const metadata: Metadata = {
  title: "Products",
};

export default function AdminProductsPage() {
  return <ProductsManager />;
}
