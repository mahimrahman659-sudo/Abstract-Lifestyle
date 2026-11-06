import type { Metadata } from "next";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = {
  title: "About",
  description: "About Abstract Lifestyle — clothing and everyday essentials, designed simply.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">About Abstract Lifestyle</h1>
      <Notice tone="info" className="mt-4">
        Placeholder content — edit this page in <code>app/about/page.tsx</code>.
      </Notice>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          Abstract Lifestyle is a small store for clothing and everyday lifestyle products:
          wardrobe basics, bags, bottles and the small things you use daily.
        </p>
        <p>
          We keep the catalog focused and the details honest — real stock counts, clear prices in
          BDT, and Cash on Delivery at checkout.
        </p>
        <p>Replace this copy with your brand story, values and shipping promises.</p>
      </div>
    </div>
  );
}
