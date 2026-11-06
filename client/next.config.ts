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

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        ...apiImageSource,
        pathname: "/uploads/**",
      },
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
