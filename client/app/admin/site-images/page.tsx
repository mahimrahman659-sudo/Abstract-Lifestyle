import type { Metadata } from "next";
import { SiteImagesManager } from "@/components/admin/SiteImagesManager";

export const metadata: Metadata = {
  title: "Site Images",
};

export default function AdminSiteImagesPage() {
  return <SiteImagesManager />;
}