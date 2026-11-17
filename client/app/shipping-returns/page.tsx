import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description: "Shipping and returns policy for Abstract Lifestyle orders.",
};

export default function ShippingReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Shipping &amp; Returns</h1>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-muted">
        <section aria-labelledby="shipping-heading">
          <h2 id="shipping-heading" className="text-base font-semibold text-ink">
            Shipping
          </h2>
          <p className="mt-2">
            Orders use Cash on Delivery. The delivery fee is shown at checkout.
          </p>
        </section>
        <section aria-labelledby="returns-heading">
          <h2 id="returns-heading" className="text-base font-semibold text-ink">
            Returns
          </h2>
          <p className="mt-2">
            Return and exchange terms are not currently published.
          </p>
        </section>
      </div>
    </div>
  );
}
