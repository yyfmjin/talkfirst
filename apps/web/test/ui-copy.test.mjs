import { existsSync, readFileSync } from "node:fs";
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
  const findings = scanUiCopy({
    root: join(appRoot, "src"),
    /*
     * 词典是唯一允许装英文的地方 —— 英文站点的文案就从那里来。这条检查管的是
     * 「页面/组件里不许出现没翻译的英文」，所以只把词典排除在外；其余 88 个源文件
     * 仍然一个字都不许漏译。
     */
    ignore: ["lib/i18n/dictionary.ts"],
  });

  assert.deepEqual(
    findings.map((finding) => `${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`),
    [],
  );
});

test("the English legal routes exist and the documents say which text governs", () => {
  /*
   * 四份法律文本是**工程师起草的初稿**（`docs/LEGAL-TEXTS.md`），里面还有管辖与责任
   * 两处法律判断。所以英文页必须写明「以中文原文为准」—— 少了这句，两边的措辞差异
   * 会被当成两份各自有效的文本。这条用例就是那个句子的钉子：谁把
   * `legal.translationNote` 从页面上拿掉，这里就红。
   */
  for (const document of ["terms", "rules", "privacy"]) {
    const chinese = readFileSync(
      join(appRoot, "src", "app", "legal", document, "page.tsx"),
      "utf8",
    );
    assert.match(
      chinese,
      /legal\.translationNote/,
      `${document}: the page must state that the Chinese text governs`,
    );
  }

  /* 四份法律页的英文路由。`/legal` 本身是同意闸门，不是正文。 */
  for (const route of ["legal", "legal/terms", "legal/rules", "legal/privacy"]) {
    assert.ok(
      existsSync(join(appRoot, "src", "app", "en", route, "page.tsx")),
      `/en/${route} must exist`,
    );
  }
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
  const block = source.match(/REPORT_REASON_LABELS: Record<string, MsgKey> = \{([\s\S]*?)\n\};/);
  assert.ok(block, "REPORT_REASON_LABELS must be a literal map");

  /*
   * 文案 2026-10-19 搬进了词典（模块级常量表拿不到当前语言，存中文会让英文界面显示中文）。
   * 这个测试的**意图不变**：每个原因都要有中文。所以它现在查两件事——
   * 原因能映射到一个词条键，且那个键在 zh 词典里确实有中文。
   */
  const dictionary = readFileSync(join(appRoot, "src/lib/i18n/dictionary.ts"), "utf8");
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const reason of apiReportReasons(repoRoot)) {
    const entry = block[1].match(new RegExp(`"?${escape(reason)}"?:\\s*"([^"]+)"`));
    assert.ok(entry, `${reason} must map to a dictionary key`);
    const key = entry[1];
    assert.match(
      dictionary,
      new RegExp(`"${escape(key)}":\\s*"[\\u4e00-\\u9fff]`),
      `${reason} → ${key} needs a Chinese label in the dictionary`,
    );
  }
});
