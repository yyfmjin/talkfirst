import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // See apps/web/next.config.ts — standalone output is opt-in via env var so
  // that local builds and the Playwright webServer keep their current layout.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "../../" : undefined,
};

export default nextConfig;
