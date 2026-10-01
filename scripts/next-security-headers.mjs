#!/usr/bin/env node
/**
 * SEC-004 — the shared reader for the Next.js security-header config.
 *
 * Both Next.js apps (`apps/web`, `apps/admin`) declare their headers in a
 * `next.config.ts` literal, and both `node --test` suites assert against this
 * reader. Keeping the parsing in one place is what lets the web suite compare its
 * own policy with the admin app's: the two answer on sibling hostnames, so a
 * header that exists in one and not the other is a bug, not a preference.
 *
 * This is a *source* reader, not a response reader — the test harness has no
 * HTTP server and no TypeScript loader. It can therefore prove the headers are
 * declared and consistent, but not that a live response carries them.
 */
import assert from "node:assert/strict";

/** Parses `const SECURITY_HEADERS = [{ key: "…", value: … }, …];` into a Map. */
export function declaredHeaders(source) {
  const block = source.match(/const SECURITY_HEADERS = \[([\s\S]*?)\n\];/);
  assert.ok(block, "SECURITY_HEADERS must be a literal list in next.config.ts");

  // The value is either a quoted string (which may itself contain commas, e.g.
  // `Permissions-Policy`) or the name of a constant declared above the list.
  const entries = [
    ...block[1].matchAll(/\{\s*key:\s*"([^"]+)",\s*value:\s*("(?:[^"\\]|\\.)*"|[A-Za-z0-9_$.]+)\s*\}/g),
  ];
  assert.ok(entries.length > 0, "SECURITY_HEADERS must declare at least one header");

  return new Map(entries.map(([, key, value]) => [key, value]));
}

/** Parses `const CONTENT_SECURITY_POLICY = ["…", …].join("; ");` into a list. */
export function declaredCspDirectives(source) {
  const block = source.match(/const CONTENT_SECURITY_POLICY = \[([\s\S]*?)\]\.join\("; "\)/);
  assert.ok(block, "CONTENT_SECURITY_POLICY must be a joined literal list in next.config.ts");

  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}
