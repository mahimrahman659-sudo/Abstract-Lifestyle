import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:py-14">
      <section className="rounded-3xl border border-line bg-surface px-6 py-16 text-center sm:py-24">
        <p className="text-sm uppercase tracking-[0.25em] text-muted">Abstract Lifestyle</p>
        <h1 className="mx-auto mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Clothing and everyday essentials, designed simply.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted">
          Thoughtful basics for daily life — from wardrobe staples to the small things you
          carry every day.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/products"
            className="inline-flex h-12 items-center rounded-full bg-accent px-6 text-base font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Browse products
          </Link>
          <Link
            href="/products?category=clothing"
            className="inline-flex h-12 items-center rounded-full border border-line bg-surface px-6 text-base font-medium text-ink transition-colors hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Shop clothing
          </Link>
        </div>
      </section>
    </div>
  );
}
