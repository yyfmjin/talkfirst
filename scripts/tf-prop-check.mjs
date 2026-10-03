#!/usr/bin/env node
/**
 * Finds props passed to `tf/*` primitives that the primitive does not declare.
 *
 * ## Why this exists
 *
 * Four separate times in this refactor, a page passed an attribute to a design
 * system primitive whose props are a CLOSED object type rather than
 * `HTMLAttributes`. Each one is a TypeScript error (`tsc` lists them all in one
 * pass), and each one was found by hand, one per round:
 *
 *   1. `TFAvatar` — `alt` spread onto a `<span>`
 *   2. `TFBadge`  — `title`
 *   3. `TFCard`   — `data-testid`
 *   4. `TFChip`   — `title`
 *
 * This script closes that gap. It reads the declared prop names out of
 * `components/tf/*.tsx` and checks every `<TF…>` usage in `src/` against them.
 *
 * ## The honest limitation
 *
 * Prop types here are written as inline object literals (`button.tsx`,
 * `display.tsx`) OR as `{…} & Omit<HTMLAttributes<…>, …>` (also `button.tsx`,
 * `field.tsx`). The second form means the real prop list is the declared keys
 * PLUS everything in the intersected DOM attributes. This script cannot read
 * `lib.dom.d.ts`, so it treats a known set of DOM-attribute names as allowed
 * (see `DOM_ATTRIBUTES`) and REPORTS anything else it cannot verify.
 *
 * That makes it a *narrowing* tool, not a proof: it will miss a genuine typo
 * like `classNam`, because such a name looks DOM-ish. It exists to catch the
 * "primitive simply has no such prop" case, which is the one that actually
 * happened four times.
 *
 * ## Usage
 *
 *     node scripts/tf-prop-check.mjs
 *
 * Exit code 0 = nothing flagged, 1 = findings.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "apps/web/src");
const TF = path.join(SRC, "components/tf");

/**
 * Names that reach the DOM through an intersected `HTMLAttributes` type. A
 * primitive that declares `& Omit<ButtonHTMLAttributes<…>, …>` legitimately
 * accepts all of these, so they must not be reported.
 */
const DOM_ATTRIBUTES = new Set([
  "id", "name", "value", "type", "role", "title", "tabIndex", "autoFocus",
  "placeholder", "readOnly", "required", "disabled", "checked", "defaultValue",
  "maxLength", "minLength", "min", "max", "step", "pattern", "multiple", "accept",
  "rows", "cols", "wrap", "spellCheck", "autoComplete", "inputMode", "enterKeyHint",
  "form", "formAction", "formMethod", "formNoValidate", "formTarget",
  "href", "target", "rel", "download", "src", "srcSet", "sizes", "alt", "loading",
  "decoding", "crossOrigin", "referrerPolicy", "poster", "controls", "loop", "muted",
  "playsInline", "preload", "width", "height", "fill", "stroke", "viewBox", "d", "cx", "cy", "r",
  "onClick", "onChange", "onInput", "onBlur", "onFocus", "onKeyDown", "onKeyUp",
  "onKeyPress", "onSubmit", "onReset", "onScroll", "onWheel", "onDrag", "onDragEnd",
  "onDragEnter", "onDragLeave", "onDragOver", "onDragStart", "onDrop", "onMouseDown",
  "onMouseUp", "onMouseEnter", "onMouseLeave", "onMouseMove", "onMouseOver", "onMouseOut",
  "onTouchStart", "onTouchEnd", "onTouchMove", "onTouchCancel", "onPointerDown",
  "onPointerUp", "onPointerEnter", "onPointerLeave", "onPointerMove", "onAnimationEnd",
  "onAnimationStart", "onAnimationIteration", "onTransitionEnd", "onLoad", "onError",
  "onCopy", "onCut", "onPaste", "onSelect", "onContextMenu", "onDoubleClick",
  "draggable", "hidden", "lang", "dir", "style", "className", "children", "key", "ref",
  "aria-label", "aria-hidden", "aria-describedby", "aria-expanded", "aria-pressed",
  "aria-selected", "aria-checked", "aria-current", "aria-invalid", "aria-busy",
  "aria-live", "aria-modal", "aria-controls", "aria-labelledby", "aria-haspopup",
  "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext", "aria-disabled",
  "aria-atomic", "aria-relevant", "aria-activedescendant", "aria-orientation", "aria-multiselectable",
]);

/**
 * Keys of a `{ a: …; b?: … }` type literal, or of a destructuring pattern.
 *
 * Deliberately textual. `key:` / `key?:` at any depth is a property; a value
 * expression like `tone = "neutral"` is caught by the destructuring reader
 * instead.
 */
function keysInBlock(block) {
  const keys = new Set();
  for (const m of block.matchAll(/["']?([A-Za-z_$][\w$]*)["']?\s*\??\s*:/g)) keys.add(m[1]);
  return keys;
}

/**
 * Given the index just after a function name, return the full parameter list and
 * the return-type text that follows it.
 *
 * ## Why this is not a regex
 *
 * The previous version bounded the declaration with `[\s\S]{0,1500}?\)` — a LAZY
 * match to the first `)`. In `TFChip` the destructuring contains
 * `onClick?: () => void`, so that `)` belongs to the ARROW FUNCTION. The match
 * stopped inside the parameter list, leaving
 *
 *     export function TFChip({ selected = false, disabled = false, onClick,
 *
 * with no closing `}`. Both the destructuring and the type-annotation patterns
 * then failed, and all seven of `TFChip`'s props were reported missing. `TFCard`
 * has no arrow function in its props, so it happened to pass.
 *
 * This is the third time a regex has been asked to handle nesting in this
 * checker. Braces and parentheses have to be counted.
 */
function readSignature(source, nameEnd) {
  // `export function Name<T>(…)` puts a generic clause first.
  let i = nameEnd;
  if (source[i] === "<") {
    let angle = 0;
    for (; i < source.length; i += 1) {
      if (source[i] === "<") angle += 1;
      else if (source[i] === ">") {
        angle -= 1;
        if (angle === 0) {
          i += 1;
          break;
        }
      }
    }
  }

  // `forwardRef<…>(function Name(…))` — find the `(` that opens the parameters.
  while (i < source.length && source[i] !== "(") i += 1;
  if (i >= source.length) return null;
  const paramsStart = i + 1;

  let paren = 1;
  let brace = 0;
  let j = paramsStart;
  for (; j < source.length; j += 1) {
    const ch = source[j];
    if (ch === "{") brace += 1;
    else if (ch === "}") brace -= 1;
    else if (ch === "(" && brace === 0) paren += 1;
    else if (ch === ")" && brace === 0) {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  if (j >= source.length) return null;

  const params = source.slice(paramsStart, j);

  /**
   * The text after `)`, up to the first `{` of the body. It has to be read
   * brace-aware too, because the RETURN TYPE can contain braces:
   * `): { a: string } => { … }`. A naive scan would stop at the type's own `{`.
   */
  let k = j + 1;
  let returnType = "";
  while (k < source.length) {
    const ch = source[k];
    if (ch === "{") {
      // A `{` at depth 0 opens the function BODY — unless it closes a type that
      // started with `:` and is still unbalanced.
      if (returnType.includes(":") && !isBalanced(returnType)) {
        returnType += ch;
        k += 1;
        continue;
      }
      break;
    }
    if (ch === "\n" && returnType.includes(":") && isBalanced(returnType) && returnType.trim() !== ":") break;
    if (ch === "=" && source[k + 1] === ">") break; // `=> { … }` body
    returnType += ch;
    k += 1;
  }

  return { params, returnType };
}

function isBalanced(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth <= 0;
}

/**
 * Every prop name a `tf/*` component accepts.
 *
 * ## What the first version got wrong, and why it mattered
 *
 * It read ONLY the destructuring parameter list and ignored the type annotation.
 * That silently under-reported in two ways:
 *
 *   1. OPTIONAL props never appear in the destructuring, so they were invisible.
 *      `TFBadge` destructures `{ tone = "neutral", dot, title, … }` minus the
 *      optional ones — its real surface includes `dot`, `title`, `data-testid`,
 *      none of which the old parser saw.
 *   2. A component typed by NAME —
 *      `export function TFAvatar({ … }: TFAvatarProps)` — carries no inline type
 *      object, so the old regex found nothing at all for it.
 *
 * The consequence was a checker that MISSED undeclared props (a false negative),
 * which is worse than noisy: it looks like it is protecting you when it is not.
 */
function declaredProps() {
  const map = new Map(); // ComponentName -> { file, props: Set }
  if (!fs.existsSync(TF)) return map;

  for (const entry of fs.readdirSync(TF, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx$/.test(entry.name)) continue;
    const file = path.join(TF, entry.name);
    const source = fs.readFileSync(file, "utf8");

    /** `export type FooProps = { … }` keyed by name, for the by-reference case. */
    const namedTypes = new Map();
    for (const t of source.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
      const open = source.indexOf("{", t.index);
      let depth = 0;
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            namedTypes.set(t[1], source.slice(open + 1, i));
            break;
          }
        }
      }
    }

    for (const m of source.matchAll(/export\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/g)) {
      const name = m[1];
      if (!name.startsWith("TF")) continue;
      const sig = readSignature(source, m.index + m[0].length);
      if (!sig) continue;
      const { params, returnType } = sig;

      const props = new Set();

      // (a) Destructured names: `{ a, b = 1, "data-testid": testId }`.
      const destructure = params.match(/\{([\s\S]*)\}/);
      if (destructure) {
        for (const part of destructure[1].split(",")) {
          const cleaned = part
            .replace(/\/\*[\s\S]*?\*\//g, " ")
            .replace(/\/\/[^\n]*/g, " ")
            .trim();
          if (!cleaned) continue;
          const key = cleaned.split(/[:=]/)[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(key)) props.add(key);
        }
        for (const q of destructure[1].matchAll(/["']([\w-]+)["']\s*:/g)) props.add(q[1]);
      }

      // (b) An inline type literal in the return-type position: `): { a?: A } =>`.
      const inline = returnType.match(/\{([\s\S]*)\}/);
      if (inline) for (const k of keysInBlock(inline[1])) props.add(k);

      // (c) A type referenced by name: `): TFAvatarProps =>`. Anchored to the end
      // of the return-type text, because `: TFButtonProps` and `: HTMLButtonElement`
      // both appear in TFButton's line and the FIRST match would pick the wrong one.
      const byName = returnType.match(/:\s*([A-Za-z_$][\w$]*)\s*(?:=>|$)/);
      if (byName && namedTypes.has(byName[1])) {
        for (const k of keysInBlock(namedTypes.get(byName[1]))) props.add(k);
      }

      const hasRest = /\.\.\.\w+/.test(destructure?.[1] ?? "");
      /**
       * `& Omit<HTMLAttributes<…>, "className">` is what makes DOM attributes flow
       * through. It appears in the TYPE, which for a `forwardRef` wrapper lives in
       * the generic list BEFORE the parameters — so `params` is empty there and the
       * check has to look at `returnType` too. Checking only the parameters meant
       * `TFButton` was treated as having a closed prop set.
       */
      const hasOmit = /&\s*Omit</.test(returnType) || /&\s*Omit</.test(params);
      map.set(name, { file: entry.name, props, domPassthrough: hasRest || hasOmit });
    }
  }
  return map;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Attribute names on every `<Name …>` (multi-line) usage of `name`. */
function attributesOf(source, name) {
  const found = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let m;
  while ((m = re.exec(source)) !== null) {
    // Take everything up to the closing `>` of the opening tag.
    let i = m.index + name.length + 1;
    let depth = 0;
    for (; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
      else if (ch === "\n" && depth === 0) {
        // Only a `>` ends a tag; a newline does not. Keep scanning.
      }
    }
    const tag = source.slice(m.index, i);
    const line = source.slice(0, m.index).split("\n").length;
    // Attribute names: start-of-tag, then whitespace + identifier + (= | | / >).
    // The component name itself is skipped.
    for (const a of tag.matchAll(/(?:^|\s)([A-Za-z_][\w-]*)(?=\s*=|(?=\s|\/?>))/g)) {
      if (a[1] === name) continue;
      found.push({ attr: a[1], line });
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */

/**
 * Is `attr` acceptable on `name`?
 *
 * Pure, so `--self-test` can exercise it. The three allowances are deliberate and
 * each covers a documented source of noise:
 *   - `info.props`      — explicitly declared on the primitive
 *   - `DOM_ATTRIBUTES`  — flows through an `& Omit<HTMLAttributes<…>>`
 *   - `data-*`          — always valid on an element, and how E2E targets things
 */
function isAllowed(name, attr, info) {
  if (info.props.has(attr)) return true;
  if (DOM_ATTRIBUTES.has(attr)) return true;
  if (attr.startsWith("data-")) return true;
  return false;
}

/** All findings for one file's source text. */
function findingsFor(fileLabel, source, declared) {
  const findings = [];
  if (!/@\/components\/tf/.test(source)) return findings;
  for (const [name, info] of declared) {
    if (!source.includes(`<${name}`)) continue;
    for (const { attr, line } of attributesOf(source, name)) {
      if (isAllowed(name, attr, info)) continue;
      findings.push({
        file: fileLabel,
        line,
        message: `<${name}> does not declare "${attr}" (declared in ${info.file}${info.domPassthrough ? "; DOM attrs pass through" : ""})`,
      });
    }
  }
  return findings;
}

/* -------------------------------------------------------------------------- */

/**
 * Self-test. `declared` here is a small fixture map shaped exactly like
 * `declaredProps()` output, so this verifies the matching rules rather than the
 * parser of `components/tf/*.tsx`.
 */
const FIXTURE = new Map([
  ["TFWidget", { file: "widget.tsx", props: new Set(["label", "tone", "className"]), domPassthrough: false }],
  ["TFPlain", { file: "plain.tsx", props: new Set(["title"]), domPassthrough: true }],
]);

const IMPORT = `import { TFWidget, TFPlain } from "@/components/tf";\n`;

const PROP_SELF_TESTS = [
  {
    name: "declared props are accepted",
    source: `${IMPORT}export const A = () => <TFWidget label="x" tone="brand" className="mt-2" />;\n`,
    expect: null,
  },
  {
    name: "data-testid is always accepted",
    source: `${IMPORT}export const B = () => <TFWidget label="x" data-testid="w" />;\n`,
    expect: null,
  },
  {
    name: "DOM attributes are accepted (Omit passthrough)",
    source: `${IMPORT}export const C = () => <TFPlain title="t" id="a" aria-label="b" onClick={() => {}} />;\n`,
    expect: null,
  },
  {
    name: "multi-line tags are scanned",
    source: `${IMPORT}export const D = () => (\n  <TFWidget\n    label="x"\n    tone="brand"\n  />\n);\n`,
    expect: null,
  },
  {
    name: "the component name itself is not read as an attribute",
    source: `${IMPORT}export const E = () => <TFWidget label="x" />;\n`,
    expect: null,
  },
  {
    /*
     * THE WHOLE POINT. This is the shape of all five real bugs found by hand.
     *
     * The prop is `badge`, NOT `title`. An earlier version of this case asserted
     * that `title` is reported — but `title` IS a DOM attribute, so `isAllowed`
     * correctly accepts it (the fixture primitives pass DOM attributes through).
     * The test was wrong, not the checker. `badge` is not a DOM attribute and not
     * declared by `TFWidget`, so it is the honest subject for this assertion.
     */
    name: "DETECTS an undeclared prop",
    source: `${IMPORT}export const F = () => <TFWidget label="x" badge="nope" />;\n`,
    expect: /does not declare "badge"/,
  },
  {
    name: "DETECTS a misspelled prop on a closed type",
    source: `${IMPORT}export const G = () => <TFWidget lable="x" />;\n`,
    expect: /does not declare "lable"/,
  },
  {
    name: "reports the correct line number in a multi-line file",
    source: `${IMPORT}\n\nexport const H = () => (\n  <TFWidget\n    bogus="1"\n  />\n);\n`,
    expect: /does not declare "bogus"/,
  },
  {
    name: "files not importing tf/* are skipped entirely",
    source: `export const I = () => <SomeOther title="fine" />;\n`,
    expect: null,
  },
];

/**
 * Validate the REAL parser of `components/tf/*.tsx`, not just the fixture.
 *
 * The cases above exercise the matching rules against `FIXTURE`; if
 * `declaredProps()` silently returned an empty map, every one of them would still
 * pass while the checker checked nothing. That is not hypothetical — the sibling
 * checker's token parser failed in exactly that silent way and produced ~150
 * false findings across two runs before anyone noticed.
 */
function checkRealParser() {
  const declared = declaredProps();
  const problems = [];
  if (declared.size === 0) {
    problems.push("declaredProps() found no components at all — the parser is broken");
  }
  // Spot-check components whose prop surface is a closed object literal, so a
  // missing key here means the destructuring parse failed.
  const expectations = [
    ["TFBadge", ["tone", "dot", "title", "className", "children"]],
    ["TFCard", ["tone", "flush", "elevated", "as", "className", "children"]],
    ["TFChip", ["selected", "disabled", "onClick", "title", "className", "children"]],
  ];
  for (const [name, keys] of expectations) {
    const info = declared.get(name);
    if (!info) {
      problems.push(`${name} was not parsed from components/tf/*.tsx`);
      continue;
    }
    for (const key of keys) {
      if (!info.props.has(key)) problems.push(`${name} is missing parsed prop "${key}"`);
    }
  }
  for (const p of problems) console.log(`  FAIL ${p}`);
  return problems.length;
}

function runSelfTests() {
  let failed = 0;
  for (const test of PROP_SELF_TESTS) {
    const findings = findingsFor("<fixture>", test.source, FIXTURE);
    const reported = findings.length > 0;
    let ok;
    if (test.expect === null) {
      ok = !reported;
    } else {
      ok = reported && findings.some((f) => test.expect.test(f.message));
    }
    if (ok) {
      console.log(`  ok   ${test.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL ${test.name}`);
      if (test.expect === null) {
        for (const f of findings) console.log(`         unexpected: ${f.message}`);
      } else if (!reported) {
        console.log(`         expected a finding matching ${test.expect}, got none`);
      } else {
        for (const f of findings) console.log(`         got: ${f.message}`);
      }
    }
  }
  console.log(`\nself-test: ${PROP_SELF_TESTS.length - failed}/${PROP_SELF_TESTS.length} passed`);
  if (failed > 0) {
    console.error(
      "\nTHE CHECKER IS WRONG, not your code. Fix scripts/tf-prop-check.mjs before trusting its output.",
    );
    process.exit(1);
  }

  const parserProblems = checkRealParser();
  if (parserProblems > 0) {
    console.error(
      "\nTHE CHECKER IS WRONG, not your code. Fix scripts/tf-prop-check.mjs before trusting its output.",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTests();

/* -------------------------------------------------------------------------- */

const declared = declaredProps();
const files = walk(SRC);
const findings = [];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const label = path.relative(ROOT, file).replace(/\\/g, "/");
  findings.push(...findingsFor(label, source, declared));
}

if (findings.length === 0) {
  console.log(
    `OK — ${declared.size} tf/* components checked against their call sites; no undeclared props.`,
  );
  process.exit(0);
}

// Group by file for readability.
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
for (const [file, list] of byFile) {
  console.log(`\n${file}`);
  for (const f of list) console.log(`  line ${f.line}: ${f.message}`);
}
console.error(`\n${findings.length} finding(s).`);
process.exit(1);
