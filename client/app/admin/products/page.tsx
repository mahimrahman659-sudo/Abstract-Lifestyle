import type { Metadata } from "next";
import { ProductsManager } from "@/components/admin/ProductsManager";

export const metadata: Metadata = {
  title: "Products — Admin",
};

export default function AdminProductsPage() {
  return <ProductsManager />;
}
