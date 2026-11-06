import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountPanel } from "@/components/auth/AccountPanel";
import { RequireAuth } from "@/components/auth/RouteGuard";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "My account",
  description: "Your Abstract Lifestyle account details and saved addresses.",
};

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner label="Loading your account" />
          </div>
        }
      >
        <RequireAuth>
          <AccountPanel />
        </RequireAuth>
      </Suspense>
    </div>
  );
}
