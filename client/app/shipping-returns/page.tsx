import type { Metadata } from "next";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description: "Shipping and returns policy for Abstract Lifestyle orders.",
};

export default function ShippingReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Shipping &amp; Returns</h1>
      <Notice tone="info" className="mt-4">
        Placeholder content — edit this page in <code>app/shipping-returns/page.tsx</code>.
      </Notice>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
        <section aria-labelledby="shipping-heading">
          <h2 id="shipping-heading" className="text-base font-semibold text-ink">
            Shipping
          </h2>
          <p className="mt-2">
            Orders are delivered by courier with Cash on Delivery. Delivery times and any flat
            shipping fee are shown at checkout — replace this text with your real carrier and
            timelines.
          </p>
        </section>
        <section aria-labelledby="returns-heading">
          <h2 id="returns-heading" className="text-base font-semibold text-ink">
            Returns
          </h2>
          <p className="mt-2">
            Tell customers how to return or exchange an item, the condition required and the time
            window. Replace this placeholder with your actual policy.
          </p>
        </section>
      </div>
    </div>
  );
}
