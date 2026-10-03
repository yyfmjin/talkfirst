#!/usr/bin/env node
/**
 * PC-3.4 — the shared "no stray English in the UI" scanner.
 *
 * The member app and the admin console both assert against this, so the two
 * suites cannot disagree about what counts as untranslated copy.
 *
 * It scans **user-visible positions only**: JSX text nodes and string literals
 * passed to props that render text. Identifiers, class names, API paths and
 * comments are not copy and are not scanned.
 *
 * What is deliberately allowed through (PC-3.4's carve-outs):
 *   - the TalkFirst brand, including its English tagline;
 *   - third-party platform names (Instagram, Telegram, …);
 *   - URLs, e-mail addresses and file formats;
 *   - upstream enum values an operator cross-checks against the API
 *     (`SUPER_ADMIN`, `ANALYST`, …).
 *
 * Everything else is a finding. On a finding, translate it — do not widen the
 * allow-list to make the test pass.
 *
 * Run directly for a report:
 *   node scripts/ui-copy-scan.mjs
 */
import fs from "node:fs";
import path from "node:path";

/** Props whose string value is rendered to a user. */
const TEXT_PROPS = [
  "label",
  "title",
  "subtitle",
  "placeholder",
  "aria-label",
  "alt",
  "message",
  "description",
  "emptyText",
  "emptyLabel",
  "emptyState",
  "confirmLabel",
  "cancelLabel",
  "helper",
  "hint",
  "cta",
  "ctaLabel",
  "tooltip",
  "text",
  "summary",
  "confirmText",
  "successMessage",
  "errorMessage",
  "actionLabel",
  "body",
  "heading",
];

/** Always allowed: brand, platforms, and the enum values described above. */
export const BASE_ALLOWED = [
  // Brand. "Talk First. Connect Later." is the product's own English tagline.
  "TalkFirst",
  "Talk First. Connect Later.",
  // Third-party platforms: brand names, never translated.
  "Instagram",
  "TikTok",
  "Telegram",
  "WhatsApp",
  "Discord",
  "YouTube",
  "Steam",
  "WeChat",
  "Facebook",
  "Google",
  "Apple",
  // The same names as `SocialPlatform` enum values, which every picker shows.
  "INSTAGRAM",
  "TIKTOK",
  "TELEGRAM",
  "WHATSAPP",
  "DISCORD",
  "YOUTUBE",
  "STEAM",
  "WECHAT",
  "QQ",
  "FACEBOOK",
  "TALKFIRST",
  // Upstream permission/role enum values, shown raw on purpose.
  "SUPER_ADMIN",
  "MODERATOR",
  "ANALYST",
  "ADMIN",
  "ADMIN_USER",
  /**
   * Technical identifiers that have no Chinese form, added with the privacy
   * policy's Google sign-in section.
   *
   * `openid` / `email` / `profile` are the OAuth SCOPE NAMES this app requests,
   * and naming them is the point: the policy has to say which Google permissions
   * are asked for, and Google reports them verbatim. `sub` is the id_token claim
   * the account is keyed on; `User-Agent` is an HTTP header name.
   *
   * Narrow on purpose — adding these four says nothing about letting other Latin
   * words through, which is why the four are listed rather than, say, `profile*`.
   */
  "openid",
  "sub",
  "User-Agent",
  // Non-copy formats.
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "mp4",
  "webm",
  "mov",
  "pdf",
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Blanks comments without moving any line, so reported lines stay accurate. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/** Removes tokens that are allowed, so what remains can be judged. */
function residue(text, allowed) {
  let rest = text;
  for (const token of allowed) {
    rest = rest.split(token).join(" ");
  }
  // URLs, e-mail addresses, bare file extensions.
  rest = rest
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+\.\S+/g, " ")
    .replace(/\.(jpg|jpeg|png|webp|gif|mp4|webm|mov|pdf)\b/gi, " ");
  return rest.replace(/[^A-Za-z]/g, "");
}

/** True when the residue still holds a run of Latin letters (>=3). */
function hasStrayEnglish(text, allowed) {
  return /[A-Za-z]{3,}/.test(residue(text, allowed));
}

/** JSX text nodes are prose; this rejects the code that looks like one. */
function looksLikeProse(text) {
  if (/[(){};=]|&&|\|\||=>|<>|::|\$|\breturn\b|\bconst\b|\bimport\b/.test(text)) return false;
  return /[A-Za-z\u4e00-\u9fff]/.test(text);
}

function singleLineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * @returns {{file: string, line: number, kind: string, text: string}[]}
 */
export function scanUiCopy({ root, allowed = BASE_ALLOWED, ignore = [] } = {}) {
  const allowList = [...BASE_ALLOWED, ...allowed];
  const findings = [];

  for (const file of walk(root)) {
    if (ignore.some((pattern) => file.includes(pattern))) continue;
    const source = stripComments(fs.readFileSync(file, "utf8"));

    // 1) JSX text nodes, including ones that span several lines.
    for (const match of source.matchAll(/>([^<>{}]*)</gs)) {
      // `=> Promise<T>` and `Record<string, T>` close a type, not a tag.
      const previous = source[match.index - 1];
      if (previous === "=" || previous === "<") continue;
      // Self-closing tags: `<Icon size={16} />` — the `/>` ending is not a
      // text-node boundary. When `>` is preceded by `/`, skip it.
      if (previous === "/") continue;
      const text = match[1].replace(/\s+/g, " ").trim();
      if (!text || !looksLikeProse(text)) continue;
      if (!hasStrayEnglish(text, allowList)) continue;
      findings.push({ file, line: singleLineOf(source, match.index), kind: "jsx-text", text });
    }

    // 2) String literals passed to text-rendering props.
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      for (const prop of TEXT_PROPS) {
        const pattern = new RegExp(`\\b${prop}\\s*[=:]\\s*"([^"]+)"`, "g");
        for (const match of line.matchAll(pattern)) {
          const text = match[1].trim();
          if (!text) continue;
          // A single lowercase word is a value/key, never copy.
          if (/^[a-z0-9-]+$/.test(text)) continue;
          if (!hasStrayEnglish(text, allowList)) continue;
          findings.push({ file, line: index + 1, kind: `prop:${prop}`, text });
        }
      }
    });
  }

  const seen = new Set();
  return findings
    .filter((finding) => {
      const key = `${finding.file}:${finding.line}:${finding.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Extracts the report-reason allow-list from its one authority. */
export function apiReportReasons(repoRoot) {
  const controller = fs.readFileSync(
    path.join(repoRoot, "apps/api/src/social/social-safety.controller.ts"),
    "utf8",
  );
  const block = controller.match(/const allowed = \[([\s\S]*?)\]/);
  if (!block) {
    throw new Error("could not read the report reason allow-list from social-safety.controller.ts");
  }
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * The admin console's exemptions, and why.
 *
 * From the login screen: `/admin/me` is the route that rejects a non-admin and
 * `isAdmin` is the column that has to be set — both are code an operator types.
 *
 * From the Phase O2 operations console: `HTTP` is a protocol name with no
 * Chinese form an operator would recognise; `ops:read` is the permission the nav
 * entry is gated on, shown when explaining a refusal.
 *
 * Deliberately NOT listed: bare `admin` or `/admin`. Those are far too common a
 * substring — widening to them made an e-mail placeholder (`admin@example.com`)
 * stop being recognised, silently disabling a real check. Narrow terms only.
 * `apps/admin/test/ui-copy.test.mjs` passes the same list.
 */
const ADMIN_ALLOWED = ["/admin/me", "isAdmin", "HTTP", "ops:read"];

if (process.argv[1] && process.argv[1].endsWith("ui-copy-scan.mjs")) {
  const findings = scanUiCopy({ root: "apps/web/src" }).concat(
    scanUiCopy({ root: "apps/admin/src", allowed: ADMIN_ALLOWED }),
  );
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}\t[${finding.kind}]\t${finding.text}`);
  }
  console.error(`\n${findings.length} finding(s)`);
  process.exit(findings.length > 0 ? 1 : 0);
}
