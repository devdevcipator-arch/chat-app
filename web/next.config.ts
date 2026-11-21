import type { NextConfig } from "next";

/** One day fresh, then served stale for a week while revalidating. */
const PUBLIC_ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Chat media and avatars are already-compressed R2 objects rendered with
  // plain <img> (next/image would only re-proxy them). These settings apply
  // if next/image is used for anything else.
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  // /_next/static is already immutable; this covers files served from /public.
  async headers() {
    return [
      {
        source: "/:file*.:ext(svg|png|jpg|jpeg|gif|webp|ico|woff2)",
        headers: [{ key: "Cache-Control", value: PUBLIC_ASSET_CACHE }],
      },
    ];
  },
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
