import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProductGallery } from "@/components/catalog/ProductGallery";
import { PurchasePanel } from "@/components/catalog/PurchasePanel";
import { fetchProductDetail } from "@/lib/api/server";

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
    return { title: "Product not found — Abstract Lifestyle" };
  }

  return {
    title: `${detail.product.name} — Abstract Lifestyle`,
    description: detail.product.description.slice(0, 160),
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
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
