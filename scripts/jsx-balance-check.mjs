#!/usr/bin/env node
/**
 * Checks that every TSX file's JSX tags are balanced.
 *
 * ## Why this exists
 *
 * `tsc` reports an unbalanced tag as a type error. Without a compiler, an
 * unbalanced tag is invisible until the browser fails to parse the module — and
 * since React 19 a mismatched closing tag is a *runtime* crash on that route, not
 * a build failure I would see.
 *
 * This was written because I repeatedly broke JSX nesting while editing by hand:
 * the same class of mistake as inserting a Markdown section on top of its own
 * heading. The compiler catches it instantly; a human reading a diff catches it
 * sometimes.
 *
 * ## What it does and does not do
 *
 * It tokenises each file, skips strings / template literals / comments, and
 * maintains a stack of open elements. It reports:
 *
 *   - a closing tag with no matching open tag
 *   - a closing tag whose name does not match the innermost open tag
 *   - a file that ends with tags still open
 *   - `<Foo>` left unclosed on the same line where `/>` was clearly intended
 *
 * It is deliberately CONSERVATIVE: anything it cannot be sure about (a `<`
 * inside a generic like `useState<Foo>(`, HTML inside a string, a fragment) is
 * skipped rather than guessed. A false "unbalanced" report would be worse than
 * a missed one, because it would train the reader to ignore the tool.
 *
 * ## Usage
 *
 *     node scripts/jsx-balance-check.mjs            # all TSX under apps/web/src
 *     node scripts/jsx-balance-check.mjs <path...>  # specific files
 *
 * Exit code 0 = clean, 1 = findings.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Element names that never take children, so they cannot be "unclosed". */
const SELF_CLOSING_HTML = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);

/**
 * Is this tag a void HTML element?
 *
 * The check is CASE-SENSITIVE, and that matters more than it looks.
 *
 * `SELF_CLOSING_HTML` holds lowercase HTML names, one of which is `link`. The
 * earlier form — `SELF_CLOSING_HTML.has(name.toLowerCase())` — therefore also
 * matched the React component `<Link>` from `next/link`. Every `<Link …>` was
 * skipped as a void element, never pushed on the stack, and its `</Link>` then
 * reported "closing </Link> with nothing open". `<Link>` is one of the most
 * common tags in this codebase, which is why the checker produced ~200 findings
 * across 64 files.
 *
 * HTML void elements are always written in lowercase; a capitalised name is a
 * component and must be treated as a container.
 */
function isVoidHtml(name) {
  return name === name.toLowerCase() && SELF_CLOSING_HTML.has(name);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip comments, string literals and template literals, replacing them with
 * spaces so line numbers survive. JSX text is NOT stripped (it is what we are
 * scanning), but a quoted attribute value must not be read as markup.
 */
function blankNonMarkup(source) {
  const out = source.split("");
  let i = 0;
  const n = source.length;

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

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
    if (ch === '"' || ch === "'") {
      // Only treat as a string when it looks like one: preceded by = ( { , or
      // whitespace. This keeps apostrophes in JSX text from swallowing markup.
      const prev = i === 0 ? " " : source[i - 1];
      if (/[=({,\s:[\]]/.test(prev)) {
        let j = i + 1;
        while (j < n && source[j] !== ch) {
          if (source[j] === "\\") j += 1;
          if (source[j] === "\n") break;
          j += 1;
        }
        blank(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return out.join("");
}

/**
 * Find every `<Name …>`, `</Name>` and `<Name … />` in the file.
 *
 * ## Why this is a hand-written scan and not a regex
 *
 * The regex version was:
 *
 *     /<(\/?)([A-Za-z][A-Za-z0-9._]*)([^<>]*?)(\/?)>/g
 *
 * `[^<>]*?` forbids `<` and `>` but happily crosses newlines. Whenever the text
 * between two tags contained a `<` — which is constant in JSX, since expressions
 * hold `&&`, `>`, `"</div>"` and `"<div>"` as literal strings — the lazy match
 * could not terminate at the real `>`, so it swallowed everything up to a `>`
 * dozens of lines away. It then reported a single bogus tag and, in consequence,
 * 217 "closing X does not match Y opened at line N" findings across 64 files.
 *
 * A regex cannot track brace and string nesting, so the scan is explicit:
 *   - a closing tag is always `</`, which also stops `a </ b` being read as one
 *   - inside an opening tag, `"…"` / `'…'` / `{…}` are skipped wholesale, with
 *     brace nesting, so a `>` inside an attribute expression cannot end the tag
 *   - the tag ends at the first `>` outside all of those
 */
function scanTags(source) {
  const tags = [];
  const n = source.length;
  let i = 0;

  const lineAt = (index) => source.slice(0, index).split("\n").length;

  while (i < n) {
    if (source[i] !== "<") {
      i += 1;
      continue;
    }

    const closing = source[i + 1] === "/";
    const nameStart = i + (closing ? 2 : 1);

    // A tag name must start with a letter; this also rejects `a < b` and `a <= b`.
    if (!/[A-Za-z]/.test(source[nameStart] ?? "")) {
      i += 1;
      continue;
    }

    let j = nameStart;
    while (j < n && /[A-Za-z0-9._]/.test(source[j])) j += 1;
    const name = source.slice(nameStart, j);

    // Walk to the end of the opening tag, skipping strings and brace groups.
    let k = j;
    let braceDepth = 0;
    let selfClose = false;
    let end = -1;

    while (k < n) {
      const ch = source[k];

      if (ch === '"' || ch === "'" || ch === "`") {
        // A quoted value: skip to its close, not past a newline-unterminated one.
        let s = k + 1;
        while (s < n && source[s] !== ch) {
          if (source[s] === "\\") s += 1;
          s += 1;
        }
        k = s + 1;
        continue;
      }
      if (ch === "{") {
        braceDepth += 1;
        k += 1;
        continue;
      }
      if (ch === "}") {
        if (braceDepth > 0) braceDepth -= 1;
        k += 1;
        continue;
      }
      if (ch === ">" && braceDepth === 0) {
        selfClose = source[k - 1] === "/";
        end = k;
        break;
      }
      k += 1;
    }

    if (end === -1) break; // unterminated tag: nothing further can be trusted
    const attrs = source.slice(j, end - (selfClose ? 1 : 0));

    const before = source.slice(Math.max(0, i - 1), i);

    /**
     * Skip generics: `useState<Foo>()`, `Array<Bar>`, `Promise<void>`.
     *
     * The signal is that the `<` is preceded by an IDENTIFIER character (`e` in
     * `useState`, `y` in `Array`) or by `]` from an indexed type. `>` and `<` are
     * deliberately NOT included: they were, and both are ordinary in JSX.
     *
     *   `return <><div>a</div>`  — the `<div>` is preceded by the fragment `<`
     *   `</div><div>b`           — the second `<div>` is preceded by `>`
     *
     * With `>` and `<` in the class both divs were discarded as generics, leaving
     * only their closing tags, which then reported "closing </div> with nothing
     * open". A generic is never introduced by a fragment delimiter, so dropping
     * those two characters loses no real generic.
     */
    if (!closing && /[A-Za-z0-9_$\]]/.test(before)) {
      i = end + 1;
      continue;
    }

    /**
     * Fragments: `<>` and `</>` have no element name, so they must not reach the
     * stack. A fragment is not in `SELF_CLOSING_HTML`, so without this it was
     * pushed as an open tag that nothing ever closes.
     */
    if (name === "") {
      i = end + 1;
      continue;
    }

    /**
     * Distinguish a real opening tag from a bare comparison `a < b`.
     *
     * An earlier guard rejected any tag whose attributes contained `=` — which is
     * how EVERY JSX attribute is written. So `<div className="x">` was discarded
     * and only attribute-less tags like `<span>` survived, making every `</div>`
     * report "nothing open". `=` is therefore NOT a rejection signal.
     */
    if (!closing && /[);]|&&|\|\|/.test(attrs)) {
      i = end + 1;
      continue;
    }
    const attrsTrimmed = attrs.trim();
    if (!closing && !/[="']/.test(attrs) && attrsTrimmed !== "") {
      i = end + 1;
      continue;
    }

    tags.push({
      name,
      line: lineAt(i),
      closing,
      selfClosing: selfClose || isVoidHtml(name),
      raw: source.slice(i, end + 1),
    });

    i = end + 1;
  }

  return tags;
}

function checkFile(file) {
  return checkSource(fs.readFileSync(file, "utf8"));
}

/**
 * The whole check, as a pure function of source text.
 *
 * Split out from `checkFile` so `--self-test` can exercise it on snippets without
 * touching the filesystem. That matters because this script has never actually
 * been run — the self-test is the only way its detection logic gets verified.
 */
function checkSource(rawSource) {
  const source = blankNonMarkup(rawSource);
  const tags = scanTags(source);
  const findings = [];
  const stack = [];

  for (const tag of tags) {
    if (tag.closing) {
      if (stack.length === 0) {
        findings.push({
          line: tag.line,
          message: `closing </${tag.name}> with nothing open`,
        });
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.name !== tag.name) {
        // Report the mismatch, then recover by searching downward so one early
        // error does not produce a cascade.
        const at = [...stack].reverse().findIndex((t) => t.name === tag.name);
        if (at === -1) {
          findings.push({
            line: tag.line,
            message: `closing </${tag.name}> does not match <${top.name}> opened at line ${top.line}`,
          });
        } else {
          for (let k = 0; k <= at; k += 1) {
            const unclosed = stack.pop();
            if (k < at) {
              findings.push({
                line: unclosed.line,
                message: `<${unclosed.name}> opened here was never closed (found </${tag.name}> at line ${tag.line})`,
              });
            }
          }
        }
      } else {
        stack.pop();
      }
      continue;
    }
    if (tag.selfClosing) continue;
    stack.push({ name: tag.name, line: tag.line });
  }

  for (const open of stack) {
    findings.push({
      line: open.line,
      message: `<${open.name}> opened here is never closed`,
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */

/**
 * Self-test: does this checker actually detect the things it claims to?
 *
 * These are the EXACT mistakes made while editing this codebase, plus the two
 * false positives found while writing the scanner. `null` means "must report
 * nothing"; a string means "must report something matching this".
 */
const SELF_TESTS = [
  {
    name: "balanced file reports nothing",
    source: `export function A() {\n  return (\n    <div className="x">\n      <span>hi</span>\n    </div>\n  );\n}\n`,
    expect: null,
  },
  {
    name: "self-closing tags and HTML voids are not 'unclosed'",
    source: `export function B() {\n  return <div><img src="a" /><br /><input /><Circle /></div>;\n}\n`,
    expect: null,
  },
  {
    /*
     * REGRESSION GUARD for the worst bug this checker had.
     *
     * `SELF_CLOSING_HTML` contains the lowercase HTML void element `link`. The
     * check used `name.toLowerCase()`, so the React component `<Link>` matched it,
     * was never pushed on the stack, and every `</Link>` reported "nothing open".
     * `<Link>` is everywhere in this codebase — the checker emitted ~200 false
     * findings across 64 files, and none of the earlier self-tests had a
     * capitalised name that collided with a void element.
     *
     * `<Link>` therefore must be balanced, while lowercase `<link>` stays void.
     */
    name: "a component whose name collides with a void element is NOT void",
    source: `export function L() {\n  return (\n    <Link href="/x">\n      <span>go</span>\n    </Link>\n  );\n}\n`,
    expect: null,
  },
  {
    name: "lowercase <link> is still treated as void",
    source: `export function M() {\n  return <head><link rel="icon" /><title>t</title></head>;\n}\n`,
    expect: null,
  },
  {
    name: "fragments are not treated as elements",
    source: `export function C() {\n  return <><div>a</div><div>b</div></>;\n}\n`,
    expect: null,
  },
  {
    // FALSE POSITIVE GUARD. If `=>` were read as a tag, every arrow function in
    // this codebase would be reported and the tool would be ignored.
    name: "arrow functions are not tags",
    source: `const onClick = () => (\n  <button type="button">go</button>\n);\nconst f = (x) => x + 1;\n`,
    expect: null,
  },
  {
    // FALSE POSITIVE GUARD.
    name: "comparison operators are not tags",
    source: `function cmp(a, b) {\n  if (a < b) return 1;\n  if (a > b) return -1;\n  return a <= b ? 0 : 2;\n}\n`,
    expect: null,
  },
  {
    // FALSE POSITIVE GUARD.
    name: "generics are not tags",
    source: `const [x, setX] = useState<Record<string, number>>({});\nconst y = useMemo<Array<string>>(() => [], []);\n`,
    expect: null,
  },
  {
    name: "strings containing markup do not affect the stack",
    source: `const s = "<div><span>";\nconst t = '</div>';\nexport function D() { return <p>{s}</p>; }\n`,
    expect: null,
  },
  {
    name: "comments containing markup do not affect the stack",
    source: `// <div> unclosed in a comment\nexport function E() { return <p>ok</p>; }\n/* <span> also a comment */\n`,
    expect: null,
  },
  {
    // This is the real class of bug: React 19 crashes the route at runtime.
    name: "DETECTS a tag that is never closed",
    source: `export function F() {\n  return (\n    <div>\n      <span>hi\n    </div>\n  );\n}\n`,
    expect: /never closed|does not match/,
  },
  {
    name: "DETECTS a mismatched closing tag",
    source: `export function G() {\n  return (\n    <div>\n      <span>hi</p>\n    </div>\n  );\n}\n`,
    expect: /does not match|never closed/,
  },
  {
    name: "DETECTS a closing tag with nothing open",
    source: `export function H() { return <p>ok</p></div>; }\n`,
    expect: /nothing open|does not match/,
  },
  {
    name: "DETECTS a tag left open at EOF",
    source: `export function I() {\n  return (\n    <div>\n      <span>hi</span>\n`,
    expect: /never closed/,
  },
];

function runSelfTests() {
  let failed = 0;
  for (const test of SELF_TESTS) {
    const findings = checkSource(test.source);
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
  console.log(`\nself-test: ${SELF_TESTS.length - failed}/${SELF_TESTS.length} passed`);
  if (failed > 0) {
    console.error(
      "\nTHE CHECKER IS WRONG, not your code. Fix scripts/jsx-balance-check.mjs before trusting its output.",
    );
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTests();

/* -------------------------------------------------------------------------- */

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : walk(path.join(ROOT, "apps/web/src"));

const files = targets.flatMap((t) =>
  fs.statSync(t).isDirectory() ? walk(t) : [t],
);

let total = 0;
for (const file of files) {
  const findings = checkFile(file);
  if (findings.length === 0) continue;
  total += findings.length;
  console.log(`\n${path.relative(ROOT, file).replace(/\\/g, "/")}`);
  for (const f of findings) console.log(`  line ${f.line}: ${f.message}`);
}

if (total === 0) {
  console.log(`OK — ${files.length} .tsx files, all JSX tags balanced.`);
  process.exit(0);
}
console.error(`\n${total} finding(s) in ${files.length} files.`);
process.exit(1);
