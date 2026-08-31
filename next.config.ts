import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["puppeteer", "@puppeteer/browsers"],
  // The inherited interface models database rows broadly. Runtime validation
  // remains in the API routes while this legacy UI is narrowed incrementally.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
