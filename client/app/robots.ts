import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

const DISALLOWED = ["/admin", "/checkout", "/cart", "/orders", "/login", "/register"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
