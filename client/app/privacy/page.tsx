import type { Metadata } from "next";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy policy for Abstract Lifestyle.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy policy</h1>
      <Notice tone="info" className="mt-4">
        Placeholder content — edit this page in <code>app/privacy/page.tsx</code>.
      </Notice>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          We collect only what is needed to fulfil orders: your account details, shipping address
          and order history. Authentication uses an httpOnly cookie.
        </p>
        <p>
          Replace this placeholder with your complete privacy policy, data-retention rules and
          contact details for data requests.
        </p>
      </div>
    </div>
  );
}
