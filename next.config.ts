import type { NextConfig } from "next";

// Static export: the whole frontend is plain files served by Cloudflare Workers static assets.
// Backend code (AI endpoints) lives in functions/ and is deployed as the Worker entry.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
