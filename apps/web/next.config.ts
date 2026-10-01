import type { NextConfig } from "next";

/**
 * SEC-004 — security response headers.
 *
 * Deliberately not a `default-src` policy. Next.js ships its hydration payload
 * and (in dev) its styles as inline script/style, so an honest CSP would need a
 * nonce minted per request by a middleware — otherwise `script-src` falls back
 * to `'unsafe-inline'`, which buys nothing. Until that middleware exists, only
 * the directives that cannot break asset loading are sent:
 *
 *  - `frame-ancestors 'none'` — clickjacking, and stronger than `X-Frame-Options`
 *    for browsers that honour CSP.
 *  - `base-uri 'self'` — stops an injected `<base>` from re-pointing every
 *    relative URL on the page.
 *  - `object-src 'none'` — no plugin/embed surface is used.
 *  - `form-action 'self'` — the two `<form>`s in this app (login, register) post
 *    through `fetch`, and nothing submits off-origin.
 *
 * `X-Frame-Options` is kept alongside `frame-ancestors` for pre-CSP browsers,
 * and `Permissions-Policy` only *disables* features this app never uses —
 * `web-share` and `clipboard-write` are left unlisted so they keep their
 * default `self` allowlist and `navigator.share` / `clipboard.writeText` in the
 * moments pages keep working.
 */
const CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Sent always: browsers only process HSTS over HTTPS, so the plain-HTTP local
  // dev server is unaffected, while production (behind TLS at the edge) is
  // pinned. `preload` is left off — that is an operational decision.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle so the Docker runtime stage does not
  // need the full node_modules tree. Opt-in via env var: local `next build`
  // and the Playwright webServer keep their current layout.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "../../" : undefined,
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
