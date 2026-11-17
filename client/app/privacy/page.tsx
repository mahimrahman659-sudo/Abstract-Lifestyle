import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Privacy policy for Abstract Lifestyle.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Privacy policy</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          We collect only what is needed to fulfil orders: your account details, shipping address
          and order history.
        </p>
        <p>
          Account details and saved addresses can be managed from your account page.
        </p>
      </div>
    </div>
  );
}
