import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { declaredHeaders, declaredCspDirectives } from "../../../scripts/next-security-headers.mjs";

/**
 * SEC-004 — the admin console declares the security headers.
 *
 * Source-level, like the member app's suite: the `node --test` harness cannot
 * observe a live response. Live-response verification (`next build && next
 * start` + curl) is NOT VERIFIED here.
 *
 * The admin CSP is deliberately the same narrow policy as the member app's —
 * both run Next.js with inline hydration scripts, so both would need a nonce
 * middleware before a `default-src` policy would mean anything.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(here, "..", "..", "..");

const source = readFileSync(join(appRoot, "next.config.ts"), "utf8");
const headers = declaredHeaders(source);
const csp = declaredCspDirectives(source);

test("admin console sends the full security header set", () => {
  assert.deepEqual([...headers.keys()].sort(), [
    "Content-Security-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]);
});

test("admin console pins the values that protect the dashboard", () => {
  assert.equal(headers.get("X-Content-Type-Options"), '"nosniff"');
  assert.equal(headers.get("X-Frame-Options"), '"DENY"');
  assert.equal(headers.get("Permissions-Policy"), '"camera=(), microphone=(), geolocation=()"');
  assert.equal(headers.get("Referrer-Policy"), '"strict-origin-when-cross-origin"');
  assert.match(headers.get("Strict-Transport-Security"), /max-age=31536000/);
  assert.doesNotMatch(headers.get("Strict-Transport-Security"), /preload/);
});

test("admin console ships the same narrow CSP as the member app", () => {
  const webSource = readFileSync(join(repoRoot, "apps", "web", "next.config.ts"), "utf8");

  assert.deepEqual(csp, declaredCspDirectives(webSource));
  assert.deepEqual(csp, [
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ]);

  const policy = csp.join("; ");
  assert.doesNotMatch(policy, /default-src/);
  assert.doesNotMatch(policy, /unsafe-inline/);
  assert.doesNotMatch(policy, /unsafe-eval/);
});
