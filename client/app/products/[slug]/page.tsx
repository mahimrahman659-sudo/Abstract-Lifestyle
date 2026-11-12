import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { NewArrivalBadge } from "@/components/catalog/NewArrivalBadge";
import { ProductCard, ProductImage } from "@/components/catalog/ProductCard";
import { ProductTabs } from "@/components/catalog/ProductTabs";
import { PurchasePanel } from "@/components/catalog/PurchasePanel";
import { BrandPanel } from "@/components/ui/BrandPanel";
import { ArrowRightIcon, BanknoteIcon, ExchangeIcon, ShieldIcon } from "@/components/ui/icons";
import { site } from "@/config/site";
import { fetchCategoryTree, fetchProductDetail, getNewBadgeCutoff, getRelatedProducts } from "@/lib/api/server";
import { isCreatedAfter } from "@/lib/catalog/new-badge";
import { PRODUCT_GRID_CLASS, PRODUCT_GRID_ITEM_CLASS } from "@/lib/catalog/grid";
import { absoluteUrl, SITE_NAME } from "@/lib/seo";
import type { CategoryTreeItem } from "@/lib/types";

/** Product-page trust items, in the same order as site.productPage.trust. */
const productTrustIcons = [BanknoteIcon, ExchangeIcon, ShieldIcon];

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

  // "New Arrival" flags: computed here from the cached server-side cutoff
  // snapshot and passed down as props — no component reads the clock during
  // render, so nothing can cause a hydration mismatch or force dynamic output.
  const newCutoff = await getNewBadgeCutoff();
  const isNew = isCreatedAfter(product.createdAt, newCutoff);

  // Related products: resolve the root category so sibling collections show up
  // (the helper itself is a plain "same category" query that never throws).
  const categoryTree = await fetchCategoryTree().catch(() => [] as CategoryTreeItem[]);
  const leafSlug = product.category?.slug ?? '';
  let relatedSlug = leafSlug;
  for (const root of categoryTree) {
    if (root.slug === leafSlug || root.children.some((child) => child.slug === leafSlug)) {
      relatedSlug = root.slug;
      break;
    }
  }
  const related = await getRelatedProducts(relatedSlug, product.slug);

  const uniqueSizes = Array.from(
    new Set(variants.map((variant) => variant.size).filter((size): size is string => size !== null)),
  );
  const uniqueColors = Array.from(
    new Set(variants.map((variant) => variant.color).filter((color): color is string => color !== null)),
  );
  // True-fact bullets for the Details tab (no invented claims).
  const highlights = [
    product.category ? `${product.category.name} collection` : null,
    uniqueSizes.length > 0 ? `Available in sizes ${uniqueSizes.join(', ')}` : null,
    uniqueColors.length > 0 ? `Colors: ${uniqueColors.join(', ')}` : null,
    'Cash on Delivery',
  ].filter((item): item is string => item !== null);

  const detailImage = product.images[1] ?? product.images[0] ?? null;

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
          <NewArrivalBadge isNew={isNew} />
          <h1 className="text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[38px]">
            {product.name}
          </h1>

          <PurchasePanel
            productName={product.name}
            basePrice={product.basePrice}
            compareAtPrice={product.compareAtPrice}
            discountPercent={product.discountPercent}
            variants={variants}
            sizeGuideKey={sizeGuideKey}
            description={product.description}
          />

          <ul className="grid grid-cols-1 gap-3 border-t border-line pt-5 sm:grid-cols-3">
            {site.productPage.trust.map((item, index) => {
              const Icon = productTrustIcons[index] ?? ShieldIcon;
              return (
                <li key={item.title} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-4 shrink-0 text-ink" />
                  <div>
                    <p className="text-[12px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">{item.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Details tabs + lifestyle image */}
      <section
        aria-label="Product details"
        className="mt-14 grid gap-10 border-t border-line pt-10 lg:grid-cols-2 lg:gap-14"
      >
        <ProductTabs
          description={product.description}
          highlights={highlights}
          sizeGuideKey={sizeGuideKey}
          shippingText={site.productPage.shippingAndReturns}
        />
        <div className="relative min-h-[260px] w-full overflow-hidden rounded-2xl border border-line bg-tile lg:min-h-[340px]">
          {detailImage ? (
            <ProductImage src={detailImage} name={product.name} />
          ) : (
            <BrandPanel label={`${product.name} — collection artwork`} caption="Abstract Lifestyle" />
          )}
        </div>
      </section>

      {related.length > 0 ? (
        <section aria-labelledby="related-products-heading" className="mt-14 border-t border-line pt-10">
          <div className="flex items-center justify-between gap-4">
            <h2 id="related-products-heading" className="text-xl font-semibold tracking-tight text-ink">
              {site.productPage.relatedTitle}
            </h2>
            <Link
              href="/products"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {site.productPage.relatedLinkLabel}
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
          <ul className={`mt-6 ${PRODUCT_GRID_CLASS}`}>
            {related.map((item) => (
              <li key={item.id} className={PRODUCT_GRID_ITEM_CLASS}>
                <ProductCard product={item} isNew={isCreatedAfter(item.createdAt, newCutoff)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
