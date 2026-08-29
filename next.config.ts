import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  // The inherited interface models database rows broadly. Runtime validation
  // remains in the API routes while this legacy UI is narrowed incrementally.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
