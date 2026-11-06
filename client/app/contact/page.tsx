import type { Metadata } from "next";
import { Notice } from "@/components/ui/Notice";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Abstract Lifestyle — questions about orders, shipping or products.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Contact us</h1>
      <Notice tone="info" className="mt-4">
        Placeholder content — edit this page in <code>app/contact/page.tsx</code>.
      </Notice>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>Questions about an order, shipping or a product? We are happy to help.</p>
        <p>
          Email: <span className="font-medium text-ink">hello@example.com</span> (placeholder)
          <br />
          Hours: Saturday–Thursday, 10:00–18:00 (placeholder)
        </p>
        <p>Replace this with your real support email, phone and hours.</p>
      </div>
    </div>
  );
}
