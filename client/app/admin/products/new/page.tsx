import type { Metadata } from "next";
import { ProductCreate } from "@/components/admin/ProductCreate";

export const metadata: Metadata = {
  title: "New product — Admin",
};

export default function AdminProductNewPage() {
  return <ProductCreate />;
}
