import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

/** Derive the allowed image host from API_URL (falls back to the dev API). */
const apiImageSource = (() => {
  try {
    const parsed = new URL(apiUrl);
    return {
      protocol: parsed.protocol.replace(":", "") as "http" | "https",
      hostname: parsed.hostname,
      ...(parsed.port ? { port: parsed.port } : {}),
    };
  } catch {
    return { protocol: "http" as const, hostname: "localhost", port: "4000" };
  }
})();

/**
 * Cloudinary host for product images. The path is restricted to the configured
 * cloud name (read from client/host env — the cloud name is public, it appears
 * in every image URL; the API secret never leaves the server).
 */
const cloudinaryCloudName =
  process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";

const cloudinaryImageSource = {
  protocol: "https" as const,
  hostname: "res.cloudinary.com",
  pathname: cloudinaryCloudName
    ? `/${cloudinaryCloudName}/image/upload/**`
    : "/image/upload/**",
};

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        ...apiImageSource,
        pathname: "/uploads/**",
      },
      cloudinaryImageSource,
    ],
  },
  // Proxy /api/* to the Express server (same-origin; required for httpOnly cookie auth).
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        // Product images served by the Express static handler.
        source: "/uploads/:path*",
        destination: `${apiUrl}/uploads/:path*`,
      },
    ];
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
