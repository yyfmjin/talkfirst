import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle so the Docker runtime stage does not
  // need the full node_modules tree. Opt-in via env var: local `next build`
  // and the Playwright webServer keep their current layout.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "../../" : undefined,
};

export default nextConfig;
