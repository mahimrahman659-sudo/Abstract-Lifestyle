import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Admin — Abstract Lifestyle",
  description: "Manage products, variants, categories and orders.",
};

// Admin data is request-time (the shell reads the path; pages fetch live data) —
// allow this segment to block prerendering (Next 16 cacheComponents).
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
