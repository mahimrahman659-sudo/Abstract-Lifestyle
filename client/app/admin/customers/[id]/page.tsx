import type { Metadata } from "next";
import { CustomerTimeline } from "@/components/admin/CustomerTimeline";

export const metadata: Metadata = {
  title: "Customer timeline",
};

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerTimeline customerId={id} />;
}
