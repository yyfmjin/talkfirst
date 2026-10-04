#!/usr/bin/env node
/**
 * Cross-checks the contracts that a type-checker and a bundler can BOTH pass while
 * the app is still broken.
 *
 * ## Why this exists
 *
 * `tsc` proves types. `next build` proves it compiles. Neither proves that the
 * class `bg-brand-500` is actually in the Tailwind theme, that a `data-testid` the
 * Playwright suite clicks still exists, or that a component the page imports is
 * really re-exported. Those three failures are exactly the ones a design-system
 * migration produces, and they surface as "the colour is grey" or "the test can't
 * find the button" — after the E2E run has already spent three minutes.
 *
 * This script is `node:`-only (no dependencies, no build step), so it runs in
 * about a second and can run before anything else.
 *
 * ## What it checks
 *
 *   1. **Colour/radius/shadow/type classes resolve to a theme key.** Every
 *      `bg-*`, `text-*`, `border-*`, `divide-*`, `rounded-*`, `shadow-*` utility
 *      used in `src/` has to exist in the theme (tokens + Tailwind defaults).
 *      Catches a typo like `bg-brand-550`, which Tailwind silently drops.
 *   2. **Every `@/components/tf` import is really exported** from `tf/index.ts`.
 *   3. **Every `data-testid` the E2E suite reads still exists in `src/`.**
 *      This is the highest-value check in the file: it is the one thing that
 *      breaks a UI refactor without breaking the build.
 *   4. **No stale `fixed inset-0` overlay** escaped the phone shell.
 *   5. **Every `page.tsx` still exports a default** (a broken export is a 500).
 *
 * ## Usage
 *
 *     node scripts/static-contract-check.mjs
 *
 * Exit code 0 = clean, 1 = findings. Run it before `test:e2e`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root, derived from THIS FILE's location, not `process.cwd()`.
 *
 * `apps/web` and `apps/admin` invoke these checkers from their own package
 * scripts (`node ../../scripts/…`), and npm runs a workspace script with the
 * workspace directory as its cwd. With `process.cwd()` every path below resolved
 * to `apps/web/apps/web/src`, so this checker reported `tf/index.ts is missing`
 * against a file that exists — a failure manufactured entirely by how it was
 * called. Anchoring to `import.meta.url` makes the result the same from the repo
 * root, from a workspace, or from anywhere else.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = path.join(ROOT, "apps/web");
const SRC = path.join(WEB, "src");
const E2E = path.join(WEB, "test");

const findings = [];
const add = (file, kind, message) => findings.push({ file, kind, message });

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `.next` and `node_modules` are not source.
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, filter, out);
    } else if (filter(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");
const read = (file) => fs.readFileSync(file, "utf8");

/**
 * Blank out comments, keeping string literals and line structure intact.
 *
 * Why this exists: the checker scans quoted class strings, and a class name that
 * appears only in a COMMENT was reported as a live finding. Four of the seventeen
 * remaining findings were exactly that — e.g. `register/success/page.tsx` has a
 * docblock explaining that it *removed* `shadow-indigo-200`, and the checker
 * reported the file as still using it. Documenting a fix is not a defect.
 *
 * This is the same trap as `smoke.test.mjs`'s `doesNotMatch(/"use client"/)`,
 * where prose tripped a source-level assertion.
 *
 * String literals are deliberately PRESERVED: `className="text-ink"` is exactly
 * what we are looking for, and strings are where every class lives.
 */
function stripComments(source) {
  const out = source.split("");
  const n = source.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  let i = 0;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    // Skip over string literals so a `//` inside a URL is not read as a comment.
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        if (source[j] === "\n") break;
        j += 1;
      }
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/* -------------------------------------------------------------------------- */
/* 1. Theme keys — parse tokens.ts and tailwind.config.ts as text              */
/* -------------------------------------------------------------------------- */

/**
 * Collect the utility NAMES the theme can produce, by scanning the two files that
 * define it. Deliberately textual rather than importing the config: this script
 * must run even while the TS is mid-edit.
 *
 * Parsing note — a first draft matched object keys by their exact indentation
 * (`/^\s{8}(\w+):/m`). That silently returned NOTHING for `fontSize`, whose keys
 * sit at a different depth, and an empty theme set turns every legitimate
 * `rounded-card` into a false finding. So blocks are extracted by balancing
 * braces and keys are then read regardless of indentation.
 *
 * TWO separators are required, and getting that wrong is silent again: colour
 * scales in `tokens.ts` are `export const brand = {`, while the theme blocks in
 * `tailwind.config.ts` are `borderRadius: {`. Matching only `:` made every scale
 * come back empty, which disables the colour check instead of failing it.
 */
function extractBlock(source, key) {
  const start = source.search(new RegExp(`\\b${key}\\s*[:=]\\s*\\{`));
  if (start === -1) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * Top-level keys of an object literal, ignoring nested objects.
 *
 * The previous version returned EVERY `word:` anywhere in the block, including
 * keys of nested objects, functions, and type annotations.
 */
function keysOf(block) {
  return [...block.matchAll(/["']?([\w-]+)["']?\s*:/g)]
    .filter((m) => {
      const before = block.slice(0, m.index);
      const opens = (before.match(/\{/g) ?? []).length;
      const closes = (before.match(/\}/g) ?? []).length;
      return opens === closes;
    })
    .map((m) => m[1]);
}

/**
 * A block of SEMANTIC tokens (`surface`, `content`, `border`), as opposed to a
 * numeric scale.
 *
 * These are named by role, not by step, so `surface-sunken` and `content-muted`
 * are real utilities. They were previously never registered: the old code only
 * accepted a key literally named `DEFAULT` or a purely numeric key, so every
 * one of these was reported as an unknown colour — about 150 findings.
 */
const SEMANTIC_BLOCK = /^[a-z][a-z0-9]*$/;

function themeNames() {
  const tokensPath = path.join(SRC, "design/tokens.ts");
  const configPath = path.join(WEB, "tailwind.config.ts");
  const colours = new Set();
  const radii = new Set();
  const shadows = new Set();
  const fontSizes = new Set();
  /** Block names that turned out to be semantic roles rather than scales. */
  const semanticBlocks = new Set();

  const tokens = fs.existsSync(tokensPath) ? read(tokensPath) : "";
  const config = fs.existsSync(configPath) ? read(configPath) : "";

  // Tailwind's own defaults, which the project still relies on. Missing one of
  // these would flag a perfectly valid class, so the list is generous.
  for (const r of ["none", "sm", "md", "lg", "xl", "2xl", "3xl", "full"]) radii.add(r);
  for (const s of ["none", "sm", "md", "lg", "xl", "2xl", "inner"]) shadows.add(s);

  /* Colour SCALES in tokens.ts: `brand: { 50: …, 500: … }` / `{ DEFAULT: … }`.
     Top-level `export const name = { … }` declarations are the scales. */
  const blockNames = [];
  for (const m of tokens.matchAll(/export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*\{/g)) {
    const name = m[1];
    const block = extractBlock(tokens.slice(m.index), name);
    const keys = keysOf(block);
    if (keys.length === 0) continue;
    blockNames.push(name);

    const isScale = keys.every((k) => k === "DEFAULT" || /^\d+$/.test(k));
    if (isScale) {
      for (const key of keys) {
        if (key === "DEFAULT") colours.add(name);
        else colours.add(`${name}-${key}`);
      }
    }
  }

  /**
   * The semantic blocks are found the same way, then registered by their real
   * keys: `surface` + `sunken` -> `surface-sunken`, `content` + `muted` ->
   * `content-muted`, and a `DEFAULT` key registers the bare block name.
   *
   * Guarded rather than hardcoded so that adding a role to tokens.ts does not
   * require editing this script — which is the whole point of a config check.
   */
  for (const name of blockNames) {
    const block = extractBlock(tokens, name);
    const keys = keysOf(block);
    const isScale = keys.every((k) => k === "DEFAULT" || /^\d+$/.test(k));
    if (isScale || !SEMANTIC_BLOCK.test(name)) continue;
    semanticBlocks.add(name);
    for (const key of keys) {
      if (key === "DEFAULT") colours.add(name);
      else colours.add(`${name}-${key}`);
    }
  }

  /* borderRadius / boxShadow / fontSize additions declared in the config. */
  const radiiUsedInConfig = keysOf(extractBlock(config, "borderRadius"));
  const shadowsInConfig = keysOf(extractBlock(config, "boxShadow"));
  const sizesInConfig = keysOf(extractBlock(config, "fontSize"));
  // `control: radius.control` — the KEY is what Tailwind uses; the value is a
  // reference. So the key list is exactly what we need.
  radiiUsedInConfig.forEach((r) => radii.add(r));
  shadowsInConfig.forEach((s) => shadows.add(s));
  sizesInConfig.forEach((f) => fontSizes.add(f));

  return { colours, radii, shadows, fontSizes, semanticBlocks };
}

/* -------------------------------------------------------------------------- */
/* 2. Utility classes used in src                                              */
/* -------------------------------------------------------------------------- */

const files = walk(SRC, (name) => /\.tsx?$/.test(name));

const theme = themeNames();

/* -------------------------------------------------------------------------- */
/* Parser sanity                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assert that the token parser found the semantic roles it is supposed to.
 *
 * The first version of `themeNames()` silently failed to register every
 * role-named token (`surface-sunken`, `content-muted`, `border-brand`, …) and
 * reported ~150 valid utilities as unknown colours. Silence was the problem: the
 * parser looked like it had worked. This turns that failure into a loud one.
 *
 * Declared HERE, immediately after `theme` and before the call below. An earlier
 * version put this block after the call, which is a temporal-dead-zone
 * ReferenceError at startup — the checker crashed instead of checking.
 */
const REQUIRED_TOKENS = [
  "surface", "surface-canvas", "surface-sunken", "surface-scrim",
  "content", "content-muted", "content-subtle", "content-inverse", "content-brand",
  "border", "border-strong", "border-brand",
  "brand-500", "danger-50",
];

function checkTokenParsing() {
  const missing = REQUIRED_TOKENS.filter((name) => !theme.colours.has(name));
  if (missing.length === 0) return 0;
  console.log("");
  console.log("!! TOKEN PARSER INCOMPLETE — this script is wrong, not your code");
  console.log(`!! parsed ${theme.colours.size} colour names; missing:`);
  for (const name of missing) console.log(`!!   ${name}`);
  console.log("!! These utilities exist; the parser failed to collect them.");
  return 1;
}

// Loud, before any file is inspected: if the parser did not collect the tokens we
// know exist, every finding after this point is untrustworthy.
const parserProblems = checkTokenParsing();
/** Tailwind's own colour words — always available, not from our tokens. */
const BUILTIN_COLOURS = new Set([
  "transparent", "current", "inherit", "white", "black",
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow",
  "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
  "purple", "fuchsia", "pink", "rose",
]);

/**
 * The Phase A legacy aliases, declared in `tailwind.config.ts` as SCALARS
 * (`ink: legacy.ink`, `line: legacy.line`) rather than as scales, so the
 * tokens.ts parser cannot see them.
 *
 * They are valid utilities — `text-ink/80` and `border-line` are in use and
 * resolve correctly — so they must not be reported as unknown colours. The plan
 * is to delete them once their last caller is migrated; until then this list is
 * what stops the checker from flagging correct code.
 */
const LEGACY_TOKENS = new Set(["ink", "muted", "cloud", "line"]);

/**
 * `bg`/`text`/`border`/`ring`/… are shared prefixes: the same namespace also
 * carries non-colour values, and those must not be looked up as colour names.
 * `outline-none` is the concrete case — `outline-` IS in the colour list below
 * because `outline-brand-500` is valid, so `none` has to be exempted separately.
 */
const NON_COLOUR_VALUES = new Set([
  "none", "auto", "hidden", "visible", "collapse", "separate", "inherit", "initial", "unset",
  "0", "1", "2", "4", "8", "x", "y", "t", "b", "l", "r", "px", "reverse", "solid", "dashed",
  "dotted", "double", "wavy", "clip", "ellipsis", "center", "left", "right", "justify", "start",
  "end", "balance", "pretty", "wrap", "nowrap", "truncate", "inner", "outer", "revert",
  /*
   * Layout/shape utilities that share a colour prefix.
   *   - `bg-gradient-to-{br,tr,...}` — the `bg-` namespace, but not a colour.
   *     Real class in Tailwind v3 (it became `bg-linear-to-*` in v4).
   *   - `ring-inset` / `ring-offset-*` — `ring` is both a colour and a width/offset
   *     namespace.
   *   - `border-collapse` style values are already above.
   */
  "gradient-to-t", "gradient-to-tr", "gradient-to-r", "gradient-to-br", "gradient-to-b",
  "gradient-to-bl", "gradient-to-l", "gradient-to-tl",
  "inset",
]);

/** `bg-red-500` -> base `red`, rest `500`. Splits colour utils from size utils. */
function checkColourUtility(cls) {
  const match = cls.match(/^(?:bg|text|border|divide|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|accent|caret)-(.+)$/);
  if (!match) return null;
  let rest = match[1];
  if (rest.startsWith("[")) return null; // arbitrary value: Tailwind emits it verbatim
  /*
   * `ring-offset-*` names the colour the ring is offset AGAINST, and the config
   * declares `ringOffsetColor` from the same palette, so it IS colour-like — but
   * `ring-offset-surface` reads as a utility we do not track. Checked against the
   * project palette by the caller instead of guessed here.
   */
  if (/^ring-offset-/.test(cls)) return null;
  // Numeric/alpha suffix: `bg-brand-500/60`, `bg-white/95`.
  const slash = rest.indexOf("/");
  if (slash !== -1) {
    const opacity = rest.slice(slash + 1);
    rest = rest.slice(0, slash);
    if (!/^\d+$/.test(opacity) && opacity !== "full") return null;
  }
  if (NON_COLOUR_VALUES.has(rest)) return null;
  const base = rest.split("-")[0];
  if (BUILTIN_COLOURS.has(base)) return null;
  // `text-ink/80` -> rest `ink`, `border-line` -> rest `line`: both are real.
  if (LEGACY_TOKENS.has(base)) return null;
  // A bare numeric tail means a width/size utility (`border-2`, `ring-1`).
  if (/^\d+$/.test(rest)) return null;
  return rest;
}

/**
 * `shadow-{size}` takes precedence over `shadow-{colour}` in this project: the
 * config declares `card`/`raised`/`overlay`/`brand`/`phone`, and `brand` is ALSO
 * a colour scale, so without this set `shadow-brand` would be read as a colour
 * and `shadow-card` would be reported as an unknown colour. Both wrong.
 */
const SHADOW_NAMES = new Set(["card", "raised", "overlay", "phone"]);


/* -------------------------------------------------------------------------- */
/* Self-test                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `checkColourUtility` is the parser most likely to lie, and this script has
 * never been executed. These cases are the exact traps found while writing it:
 * a `shadow-*` read as a colour, `outline-none` read as a colour, and every
 * non-colour utility that shares a prefix with the colour families.
 *
 * `null` means "must not be reported as an unknown colour"; a string means "must
 * be reported, and that string is the colour name".
 */
const COLOUR_SELF_TESTS = [
  // --- must resolve (declared in tailwind.config.ts) ---
  ["bg-brand-500", "brand-500"],
  ["text-content-muted", "content-muted"],
  ["border-border", "border"],
  ["bg-surface-canvas", "surface-canvas"],
  // --- builtins and non-colour values must not be reported ---
  ["bg-white", null],
  ["bg-transparent", null],
  ["text-current", null],
  ["bg-inherit", null],
  ["outline-none", null],
  ["border-2", null],
  ["ring-1", null],
  ["divide-x", null],
  ["rounded-control", null], // `rounded-*` is not in the colour prefix list
  // --- arbitrary values are emitted verbatim by Tailwind ---
  ["bg-[#EFF6FF]", null],
  ["text-[11px]", null],
  // --- opacity suffixes are valid ---
  ["bg-brand-500/60", "brand-500"],
  ["bg-white/95", null],
  ["bg-danger-50/40", "danger-50"],
  // --- the actual detections ---
  ["bg-brand-550", "brand-550"],
  /*
   * `text-ink` is NOT reported. `ink`/`muted`/`cloud`/`line` are the Phase A
   * legacy aliases, still declared in tailwind.config.ts and still used by
   * `phone-status-bar.tsx` and `ui.tsx`. They resolve correctly, so flagging them
   * was a false positive. The earlier expectation here (`"ink"`) was written
   * before LEGACY_TOKENS existed and had to change with it — a self-test that is
   * not updated alongside the code it guards becomes a false alarm.
   */
  ["text-ink", null],
  ["border-nope-100", "nope-100"],
  /*
   * NOT tested here: `shadow-brand` / `shadow-card`.
   *
   * `checkColourUtility` DOES read them as colours (it has no shadow knowledge),
   * and that is by design — its CALLER intercepts every `shadow-*` class first
   * (see the `shadow` match above the call) and `continue`s, so this function is
   * never reached with one. Asserting `null` here would be asserting a guarantee
   * this function does not provide. The shadow guard has its own check below.
   */
];

/** `shadow-*` handling, which lives in the caller rather than the helper. */
function checkShadowGuard() {
  const cases = [
    ["shadow-card", false], // SHADOW_NAMES
    ["shadow-raised", false],
    ["shadow-overlay", false],
    ["shadow-phone", false],
    ["shadow-brand", false], // ALSO a colour scale — must not be read as a colour
    ["shadow-none", false], // Tailwind default, allowlisted in themeNames()
    ["shadow-inner", false], // Tailwind default, allowlisted in themeNames()
    /*
     * Tailwind BUILT-IN shadow colours. Valid utilities that this config does not
     * and need not declare. `ui.tsx` uses `shadow-indigo-200`; flagging it as a
     * missing boxShadow key was wrong.
     */
    ["shadow-indigo-200", false],
    ["shadow-red-500", false],
    ["shadow-bogus", true], // not a size, not a config key, not a Tailwind colour
    ["shadow-nonsense-200", true], // a shade on a word that is not a palette
  ];
  checkShadowGuard.caseCount = cases.length;
  let failed = 0;
  for (const [cls, shouldReport] of cases) {
    const rest = cls.replace(/^shadow-/, "");
    const builtin = BUILTIN_COLOURS.has(rest.split("-")[0]) || LEGACY_TOKENS.has(rest.split("-")[0]);
    const reported = !SHADOW_NAMES.has(rest) && !theme.shadows.has(rest) && !builtin;
    if (reported === shouldReport) {
      console.log(`  ok   ${cls} -> ${reported ? "reported" : "accepted"}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${cls} -> ${reported ? "reported" : "accepted"}, expected ${shouldReport ? "reported" : "accepted"}`);
    }
  }
  return failed;
}

function runColourSelfTests() {
  let failed = 0;
  for (const [cls, expected] of COLOUR_SELF_TESTS) {
    const actual = checkColourUtility(cls);
    const ok = actual === expected;
    if (ok) {
      console.log(`  ok   ${cls} -> ${actual === null ? "not a colour" : actual}`);
    } else {
      failed += 1;
      console.log(
        `  FAIL ${cls} -> got ${actual === null ? "null" : `"${actual}"`}, expected ${expected === null ? "null" : `"${expected}"`}`,
      );
    }
  }
  failed += checkShadowGuard();
  // Counted from the source of truth, not hardcoded: a literal here silently
  // drifts the moment a case is added or removed (`+ 8` was already wrong once).
  const shadowCaseCount = checkShadowGuard.caseCount;
  const total = COLOUR_SELF_TESTS.length + shadowCaseCount;
  console.log(`\nself-test: ${total - failed}/${total} passed`);

  /**
   * ALSO verify the token parser here. `checkTokenParsing()` runs in the main
   * flow, but `--self-test` exits before reaching it, so for several runs the
   * parser's own correctness was never checked by the step meant to check it.
   * That is how ~150 false colour findings survived a "passing" self-test.
   */
  const parserIssues = checkTokenParsing();

  if (failed > 0 || parserIssues > 0) {
    console.error(
      "\nTHE CHECKER IS WRONG, not your code. Fix scripts/static-contract-check.mjs before trusting its output.",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--self-test")) runColourSelfTests();


/**
 * A minimum number of parsed colours below which the parser is assumed to be
 * broken rather than the source. Guessing wrong in that direction produces a wall
 * of false findings, which is worse than not checking — so the script says so and
 * skips the check instead of blaming the code.
 */
const MIN_EXPECTED_COLOURS = 30;

for (const file of files) {
  // Comments are stripped first: a class named only in prose is not a live use.
  const source = stripComments(read(file));
  // Class strings only: inside className="..." / cn(...) / template literals.
  const classes = new Set();
  for (const m of source.matchAll(/["'`]([^"'`\n]*?)["'`]/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token.includes("-") && /^[a-z][a-z0-9:/[\]()#.,%-]*$/i.test(token)) classes.add(token);
    }
  }

  for (const cls of classes) {
    // Skip variants: `sm:h-11`, `hover:bg-x`, `focus-visible:ring-2`.
    const bare = cls.includes(":") ? cls.slice(cls.lastIndexOf(":") + 1) : cls;
    if (!bare || bare.includes("[")) continue;

    const radius = bare.match(/^rounded-(.+)$/);
    if (radius && !/^(t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee)-/.test(radius[1]) && !theme.radii.has(radius[1])) {
      add(rel(file), "theme", `unknown radius "${bare}" — not a borderRadius key in tailwind.config.ts`);
      continue;
    }

    const shadow = bare.match(/^shadow-(.+)$/);
    if (shadow) {
      const rest = shadow[1];
      if (!SHADOW_NAMES.has(rest) && !theme.shadows.has(rest)) {
        /**
         * `shadow-{colour}` and `shadow-{colour}-{shade}` are Tailwind BUILT-INS
         * (`shadow-indigo-200`, `shadow-red-500`). They are valid utilities that
         * this config neither declares nor needs to, so reporting them as "not a
         * boxShadow key in tailwind.config.ts" was both a false positive and a
         * misleading message.
         *
         * The project's own rule is "borders before shadows" and the design
         * language forbids a second brand hue, so such a shadow is a smell worth
         * noticing — but it is not a missing theme key, and the checker should not
         * say it is.
         */
        const base = rest.split("-")[0];
        const isBuiltinShadowColour =
          BUILTIN_COLOURS.has(base) || LEGACY_TOKENS.has(base);
        if (!isBuiltinShadowColour) {
          add(rel(file), "theme", `unknown shadow "${bare}" — not a boxShadow key in tailwind.config.ts, and not a Tailwind shadow colour either`);
        }
      }
      continue; // never treat `shadow-*` as a colour utility
    }

    if (!theme.colours.size) continue; // parser bailed; see MIN_EXPECTED_COLOURS

    /**
     * `text-*` is TWO namespaces: colour AND font size.
     *
     * `tailwind.config.ts` declares `fontSize` keys — display, title, heading,
     * body, ui, caption, overline — so `text-caption` is a size, not a colour.
     * Without this the checker reported ~200 false "unknown colour utility"
     * findings across every migrated file. Checked against `theme.fontSizes`,
     * which `themeNames()` already collects from the config.
     */
    const sizeMatch = bare.match(/^text-(.+)$/);
    if (sizeMatch && theme.fontSizes.has(sizeMatch[1])) continue;

    const colour = checkColourUtility(bare);
    if (colour && !theme.colours.has(colour)) {
      add(rel(file), "theme", `unknown colour utility "${bare}" — not a key in design/tokens.ts`);
    }
  }
}

if (theme.colours.size > 0 && theme.colours.size < MIN_EXPECTED_COLOURS) {
  console.log(
    `note: only ${theme.colours.size} theme colours parsed (expected >= ${MIN_EXPECTED_COLOURS}); ` +
      `colour-utility checking is skipped rather than guessing. Check scripts/static-contract-check.mjs.`,
  );
  theme.colours.clear();
}

/* -------------------------------------------------------------------------- */
/* 3. tf/* exports vs imports                                                   */
/* -------------------------------------------------------------------------- */

const indexPath = path.join(SRC, "components/tf/index.ts");
if (!fs.existsSync(indexPath)) {
  add("apps/web/src/components/tf/index.ts", "barrel", "tf/index.ts is missing");
} else {
  const barrel = read(indexPath);
  const exported = new Set();
  // Same per-statement discipline as the transformer below: a brace group that
  // contains no quote character cannot have jumped past an earlier import.
  for (const m of barrel.matchAll(/export\s*\{([^"']*?)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
  }

  /**
   * A real ES named import is at most two identifiers separated by `as`:
   * `TFButton`, `type TFButtonProps`, `TFChip as Chip`.
   *
   * This guard exists because the regex below is necessarily loose (`[\\s\\S]*?`
   * between braces), so when it matches across several `import` statements the
   * comma-split produces fragments like
   * `Wordmark } from "@/components/brand"; import { TFButton`.
   * Those were reported as "names index.ts does not export" — around 40 false
   * findings. Validating the shape is what separates a name from a parsing
   * artefact.
   */
  const isImportName = (name) => /^[A-Za-z_$][\w$]*$/.test(name);

  /**
   * Matched PER IMPORT STATEMENT, not with a free `[\s\S]*?`.
   *
   * The loose form matched from the first `import {` in a file to a later
   * `} from "@/components/tf"`, swallowing every import in between; the
   * comma-split then surfaced `useEffect` as a "name tf does not export" — 76
   * findings, all false.
   *
   * The capture is deliberately NOT lazy. `([^"']*?)` may match the empty string,
   * which lets `from` bind to the wrong position and re-opens the same hole. A
   * GREEDY capture up to the LAST `}` before `from "…tf"` stays inside the one
   * statement, and identifier validation below discards anything else.
   */
  const tfImportRe =
    /import\s*\{([^"']*)\}\s*from\s*["']@\/components\/tf["']/g;
  const nameRe = /\b([A-Za-z_$][\w$]*)\b/g;

  for (const file of files) {
    const source = read(file);
    if (!/@\/components\/tf["']/.test(source)) continue;
    for (const m of source.matchAll(tfImportRe)) {
      for (const nameMatch of (m[1] ?? "").matchAll(nameRe)) {
        const raw = nameMatch[0];
        if (raw === "as" || raw === "type" || !isImportName(raw)) continue;
        if (!exported.has(raw)) {
          add(rel(file), "import", `imports "${raw}" from @/components/tf, which index.ts does not export`);
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 4. data-testid contract                                                      */
/* -------------------------------------------------------------------------- */

/**
 * testids the E2E suite looks up.
 *
 * Four shapes are in use, not one — an earlier draft only matched `getByTestId`
 * and therefore reported `chat-input`, `discover-bubble-field`,
 * `moment-media-error` and `moment-report-reason` as missing even though the app
 * renders all four:
 *
 *   page.getByTestId("x")
 *   page.locator('[data-testid="x"]')
 *   page.locator("[data-testid=x]")
 *   document.querySelector('[data-testid="x"]')
 */
function testIdsIn(dir) {
  const ids = new Map(); // id -> Set(spec files)
  const patterns = [
    /getByTestId\(\s*["'`]([^"'`]+)["'`]/g,
    /\[data-testid=["']([^"'\]\s]+)["']\]/g,
    /\[data-testid=([A-Za-z0-9_-]+)\]/g,
  ];
  for (const file of walk(dir, (n) => /\.(spec|test)\.(ts|mjs)$/.test(n))) {
    const source = read(file);
    for (const re of patterns) {
      for (const m of source.matchAll(re)) {
        if (!ids.has(m[1])) ids.set(m[1], new Set());
        ids.get(m[1]).add(rel(file));
      }
    }
  }
  return ids;
}

const required = testIdsIn(E2E);
const sourceText = files.map(read).join("\n");

/**
 * Testids rendered by the API's own HTML rather than by this app.
 *
 * The scan covers `apps/web/src` and `apps/admin/src`, so a `data-testid` that the
 * API emits into a full page is invisible to it — not missing, just not in the
 * trees being searched. Listed rather than pattern-matched, so the exemption stays
 * a deliberate statement about ONE control.
 *
 * `local-authorize-submit` is the development-only stand-in OIDC provider's consent
 * button (`apps/api/src/auth/oauth/local-dev-provider.ts`). The E2E suite drives it
 * through a real browser, which is the whole point of that provider: clicking it is
 * what exercises our callback rather than only its inputs.
 */
const SERVER_RENDERED_TESTIDS = new Set(["local-authorize-submit"]);

for (const [id, specs] of required) {
  if (SERVER_RENDERED_TESTIDS.has(id)) continue;
  // A testid may also be produced by a template literal (`comment-${id}`), so an
  // exact miss is only a finding when no prefix of it appears either.
  if (sourceText.includes(`"${id}"`) || sourceText.includes(`'${id}'`) || sourceText.includes("`" + id)) continue;
  const stem = id.split("-").slice(0, -1).join("-");
  if (stem && sourceText.includes(stem)) continue;
  add([...specs][0], "testid", `E2E looks up data-testid="${id}" but nothing in src/ renders it`);
}

/* -------------------------------------------------------------------------- */
/* 5. Overlays must not escape the phone shell                                  */
/* -------------------------------------------------------------------------- */

for (const file of files) {
  const source = read(file);
  if (/className="[^"]*\bfixed inset-0\b/.test(source) && !/phone-shell|tab-bar/.test(file)) {
    add(rel(file), "overlay", "uses `fixed inset-0`; overlays must be `absolute` to stay inside PhoneShell");
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Every page exports a default                                              */
/* -------------------------------------------------------------------------- */

for (const file of walk(path.join(SRC, "app"), (n) => n === "page.tsx")) {
  const source = read(file);
  if (!/export\s+default\s/.test(source)) {
    add(rel(file), "route", "page.tsx has no default export — Next.js will 500 on this route");
  }
}

/* -------------------------------------------------------------------------- */
/* Report                                                                       */
/* -------------------------------------------------------------------------- */

if (findings.length === 0 && parserProblems === 0) {
  console.log(
    `OK — ${files.length} source files, ${theme.colours.size} theme colours, ` +
      `${required.size} E2E testids all satisfied.`,
  );
  process.exit(0);
}

if (findings.length === 0 && parserProblems > 0) {
  console.error(
    `\n${parserProblems} parser problem(s). No source findings were reported, but that is NOT ` +
      `a pass: the token parser did not collect tokens this project actually uses, so ` +
      `colour-utility checking was unreliable. Fix scripts/static-contract-check.mjs.`,
  );
  process.exit(1);
}

const byKind = new Map();
for (const f of findings) {
  if (!byKind.has(f.kind)) byKind.set(f.kind, []);
  byKind.get(f.kind).push(f);
}

for (const [kind, list] of byKind) {
  console.log(`\n### ${kind} (${list.length})`);
  for (const f of list) console.log(`  ${f.file}\n      ${f.message}`);
}

console.error(`\n${findings.length} finding(s).`);
process.exit(1);
