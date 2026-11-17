import type { Metadata } from "next";
import { site } from '@/config/site';

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Abstract Lifestyle — questions about orders, shipping or products.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Contact us</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>Questions about an order, shipping or a product? We are happy to help.</p>
        {site.contact.email ? <p>Email: <a href={`mailto:${site.contact.email}`}>{site.contact.email}</a></p> : <p>Online support contact details are not currently available.</p>}
        {site.contact.hours ? <p>Hours: {site.contact.hours}</p> : null}
      </div>
    </div>
  );
}
