import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { declaredHeaders, declaredCspDirectives } from "../../../scripts/next-security-headers.mjs";

/**
 * SEC-004 — the member app declares the security headers.
 *
 * This reads `next.config.ts` as source. The `node --test` harness has no HTTP
 * server and no TypeScript loader, so it cannot observe a live response; what it
 * can catch is the realistic regression — a header quietly removed, or the two
 * Next.js apps drifting apart — which is why the cross-app check below is the
 * point of this file rather than a copy of the value assertions.
 *
 * Live-response verification (`next build && next start` + curl against the real
 * headers) is NOT VERIFIED in this harness.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(here, "..", "..", "..");

const headers = declaredHeaders(readFileSync(join(appRoot, "next.config.ts"), "utf8"));
const webCsp = declaredCspDirectives(readFileSync(join(appRoot, "next.config.ts"), "utf8"));

test("member app sends the full security header set", () => {
  assert.deepEqual([...headers.keys()].sort(), [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]);
});

test("member app pins the values that protect the documents", () => {
  assert.equal(headers.get("X-Content-Type-Options"), '"nosniff"');
  assert.equal(headers.get("X-Frame-Options"), '"DENY"');
  assert.equal(headers.get("Referrer-Policy"), '"strict-origin-when-cross-origin"');
  assert.match(headers.get("Strict-Transport-Security"), /max-age=31536000/);
  // `preload` is an operational promise, not something a config file should make.
  assert.doesNotMatch(headers.get("Strict-Transport-Security"), /preload/);
});

test("member app ships a CSP that cannot break script, style or image loading", () => {
  assert.deepEqual(webCsp, [
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ]);

  // The negative assertions are the contract. A full `default-src` policy here
  // would need a per-request nonce for Next.js' inline hydration script; without
  // one it degrades to `'unsafe-inline'`, which is worse than not claiming a CSP
  // at all — it hides the fact that nothing is actually restricted.
  const policy = webCsp.join("; ");
  assert.doesNotMatch(policy, /default-src/);
  assert.doesNotMatch(policy, /unsafe-inline/);
  assert.doesNotMatch(policy, /unsafe-eval/);
});

test("web and admin send the same security headers", () => {
  const adminSource = readFileSync(join(repoRoot, "apps", "admin", "next.config.ts"), "utf8");

  // Sibling hostnames, one policy. If this fails, fix the app that drifted —
  // do not relax the assertion.
  assert.deepEqual(
    [...declaredHeaders(adminSource).entries()].sort(),
    [...headers.entries()].sort(),
  );
  assert.deepEqual(declaredCspDirectives(adminSource), webCsp);
});
