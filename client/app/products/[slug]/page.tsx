import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { PurchasePanel } from "@/components/catalog/PurchasePanel";
import { fetchProductDetail } from "@/lib/api/server";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

// Product data (price/stock) is request-time; allow this route to block
// prerendering instead of streaming a static shell (Next 16 cacheComponents).
export const instant = false;

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await fetchProductDetail(slug).catch(() => null);

  if (!detail) {
    return { title: "Product not found" };
  }

  const { product } = detail;
  const image = product.images[0] ?? detail.variants.find((variant) => variant.images[0])?.images[0];

  return {
    title: product.name,
    description: product.description.slice(0, 160),
    alternates: { canonical: absoluteUrl(`/products/${product.slug}`) },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: product.name,
      description: product.description.slice(0, 160),
      url: absoluteUrl(`/products/${product.slug}`),
      ...(image ? { images: [{ url: absoluteUrl(image), alt: product.name }] } : {}),
    },
  };
}


export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;

  // Product data (price/stock) is live — opt into request-time rendering.
  await connection();

  const detail = await fetchProductDetail(slug);

  if (!detail) {
    notFound();
  }

  const { product, variants, sizeGuideKey } = detail;

  const variantPrices = variants.map((variant) => variant.price);
  const lowPrice = variantPrices.length > 0 ? Math.min(...variantPrices) : product.basePrice;
  const highPrice = variantPrices.length > 0 ? Math.max(...variantPrices) : product.basePrice;
  const anyInStock = variants.some((variant) => variant.inStock);
  const images = Array.from(
    new Set([...product.images, ...variants.flatMap((variant) => variant.images)]),
  )
    .slice(0, 4)
    .map((image) => absoluteUrl(image));

  // Server data only — built from the same response the page renders.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    ...(images.length > 0 ? { image: images } : {}),
    sku: variants[0]?.sku,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BDT",
      lowPrice: (lowPrice / 100).toFixed(2),
      highPrice: (highPrice / 100).toFixed(2),
      offerCount: variants.length,
      availability: anyInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: absoluteUrl(`/products/${product.slug}`),
    },
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/products"
              className="hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            >
              Products
            </Link>
          </li>
          {product.category ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/products?category=${product.category.slug}`}
                  className="hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {product.category.name}
                </Link>
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <ProductGallery images={product.images} name={product.name} />

        <div className="flex flex-col gap-4">
          {product.category ? (
            <p className="text-xs uppercase tracking-[0.2em] text-muted">
              {product.category.name}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {product.name}
          </h1>
          <p className="text-sm leading-relaxed text-muted">{product.description}</p>

          <PurchasePanel
            productName={product.name}
            basePrice={product.basePrice}
            variants={variants}
            sizeGuideKey={sizeGuideKey}
          />
        </div>
      </div>
    </div>
  );
}
