import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { Spinner } from "@/components/ui/Spinner";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an Abstract Lifestyle account to check out and track orders.",
};

export default function RegisterPage() {
  return (
    <div className="px-4 py-12 sm:py-16">
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner label="Loading registration" />
          </div>
        }
      >
        <RegisterForm />
      </Suspense>
    </div>
  );
}
