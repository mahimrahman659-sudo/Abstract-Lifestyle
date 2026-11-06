import type { Metadata } from "next";
import { CartPageClient } from "@/components/cart/CartPageClient";

export const metadata: Metadata = {
  title: "Your cart — Abstract Lifestyle",
  description: "Review the items in your cart and proceed to checkout.",
};

export default function CartPage() {
  return <CartPageClient />;
}
