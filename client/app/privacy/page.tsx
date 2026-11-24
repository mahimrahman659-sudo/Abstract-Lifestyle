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

        <h2 className="pt-4 text-base font-semibold text-ink">Store activity (when enabled)</h2>
        <p>
          To understand how the store is used and to improve it, we can record store activity such
          as pages and products viewed, searches, filters, cart actions and checkouts. This is
          first-party only: we do not use advertising networks, do not sell activity data and do
          not share it with third parties for marketing.
        </p>
        <p>
          Activity records are linked to your account when you are signed in, and to a random
          browser identifier when you are not. We never store raw IP addresses, browser
          user-agent strings, passwords, one-time codes or payment transaction references in
          activity records. Your order and payment history stay in your order records, which remain
          the source of truth for purchases and refunds.
        </p>
        <p>
          Store activity is retained for 90 days and then deleted automatically. Browsing
          analytics are collected only with your consent; essential records related to orders and
          account security are kept as part of operating the service. You can ask us to delete
          your stored activity at any time using the contact page, and we will remove it.
        </p>
        <p>
          This behavioural activity monitoring is currently disabled. It will only be switched on
          after this notice and the applicable consent controls are in place.
        </p>
      </div>
    </div>
  );
}
