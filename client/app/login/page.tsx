import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Abstract Lifestyle account to check out and track orders.",
};

export default function LoginPage() {
  return (
    <div className="px-4 py-12 sm:py-16">
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner label="Loading sign in" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
