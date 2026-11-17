import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description: "About Abstract Lifestyle — clothing and everyday essentials, designed simply.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">About Abstract Lifestyle</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          Abstract Lifestyle is a small store for clothing and everyday lifestyle products:
          wardrobe basics, bags, bottles and the small things you use daily.
        </p>
        <p>
          We keep the catalog focused and the details honest — real stock counts, clear prices in
          BDT, and Cash on Delivery at checkout.
        </p>
      </div>
    </div>
  );
}
