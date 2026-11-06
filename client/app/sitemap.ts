import type { MetadataRoute } from "next";
import { fetchCategorySlugsForSitemap } from "@/lib/api/server";
import { absoluteUrl } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/products"), lastModified: now, changeFrequency: "daily", priority: 0.9 },
  ];

  // Safe fallback: when the API is down this returns an empty list and the
  // static entries above are still served.
  const slugs = await fetchCategorySlugsForSitemap();
  for (const slug of slugs) {
    entries.push({
      url: absoluteUrl(`/products?category=${encodeURIComponent(slug)}`),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  return entries;
}
