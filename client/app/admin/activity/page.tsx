import type { Metadata } from "next";
import { ActivityOverview } from "@/components/admin/ActivityOverview";

export const metadata: Metadata = {
  title: "Activity",
};

export default function AdminActivityPage() {
  return <ActivityOverview />;
}
