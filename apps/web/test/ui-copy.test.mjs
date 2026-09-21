import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { apiReportReasons, scanUiCopy } from "../../../scripts/ui-copy-scan.mjs";

/**
 * PC-3.4 — the member-facing UI is Chinese.
 *
 * This is the guard rail, not a style preference. The scanner reads only the
 * positions a member can see (JSX text and text-rendering props) and ignores
 * identifiers, class names, API paths and comments. Platform brand names, URLs
 * and the TalkFirst tagline are allowed through — see `BASE_ALLOWED` in
 * `scripts/ui-copy-scan.mjs` for the full carve-out list.
 *
 * When this fails, translate the string. Do not add an allowance to make it
 * pass; the allowance list is the one thing that makes the test mean anything.
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(here, "..", "..", "..");

test("member app has no untranslated English UI copy", () => {
  const findings = scanUiCopy({ root: join(appRoot, "src") });

  assert.deepEqual(
    findings.map((finding) => `${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`),
    [],
  );
});

test("the report reasons match the endpoint that validates them", () => {
  // `Report.reason` is a free-form column, so the endpoint's allow-list is the
  // only definition of the option set. A copy that drifts would offer a reason
  // the API rejects with `403 INVALID_REASON`.
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
