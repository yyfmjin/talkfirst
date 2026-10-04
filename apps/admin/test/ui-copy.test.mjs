import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { apiReportReasons, scanUiCopy } from "../../../scripts/ui-copy-scan.mjs";

/**
 * PC-3.4 — the admin console is Chinese too.
 *
 * The console is an operator surface, not member content, so it is held to the
 * same rule: no untranslated system copy. Status and reason *values* stay the
 * raw enums on the wire, but what an operator reads is Chinese.
 *
 * See `scripts/ui-copy-scan.mjs` for what is exempt.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(here, "..", "..", "..");

/**
 * The exemptions, and why: the login screen's operator note names the guard it
 * explains — `/admin/me` is the route that rejects a non-admin and `isAdmin` is
 * the column that has to be set, so both are code an operator has to type. The
 * Phase O2 operations console adds `HTTP` (a protocol name with no Chinese form
 * an operator would recognise) and `ops:read` (the permission it is gated on).
 *
 * The post-O2 console adds three more groups. All of them are values rather than
 * copy: the rule is that an operator must be able to read or type the exact
 * string, so translating it would make the screen wrong.
 *   - the HTTP request-header names on an access-log detail row;
 *   - the Discover category `slug`, and the example slugs `minecraft`, `steam`
 *     and `language-exchange` — these are matched verbatim against members'
 *     profile interest slugs, so the console has to show the literal value;
 *   - `travel, backpacking`, the example keyword list in the category form.
 *
 * Bare `admin` is deliberately absent: it is too common a substring and would
 * stop `admin@example.com` from being recognised as an e-mail address.
 */
const ALLOWED = [
  "/admin/me",
  "isAdmin",
  "HTTP",
  "ops:read",
  "Content-Type",
  "Referer",
  "Origin",
  "Accept-Language",
  "slug",
  "minecraft",
  "steam",
  "language-exchange",
  "travel, backpacking",
];

test("admin console has no untranslated English UI copy", () => {
  const findings = scanUiCopy({ root: join(appRoot, "src"), allowed: ALLOWED });

  assert.deepEqual(
    findings.map((finding) => `${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`),
    [],
  );
});

test("the report reasons match the endpoint that validates them", () => {
  const source = readFileSync(join(appRoot, "src/lib/report-reasons.ts"), "utf8");
  const block = source.match(/REPORT_REASONS = \[([\s\S]*?)\]/);
  assert.ok(block, "REPORT_REASONS must be a literal list in src/lib/report-reasons.ts");
  const declared = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(declared, apiReportReasons(repoRoot));
});

test("every report reason has a Chinese label", () => {
  const source = readFileSync(join(appRoot, "src/lib/report-reasons.ts"), "utf8");
  const block = source.match(/REPORT_REASON_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(block, "REPORT_REASON_LABELS must be a literal map");

  for (const reason of apiReportReasons(repoRoot)) {
    assert.match(
      block[1],
      new RegExp(`"?${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?:\\s*"[\\u4e00-\\u9fff]`),
      `${reason} needs a Chinese label`,
    );
  }
});
