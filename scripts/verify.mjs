#!/usr/bin/env node
/**
 * TalkFirst — full verification, with a report you can hand back.
 *
 * ## Why this is JavaScript and not a .bat
 *
 * The first version of this script was `scripts/verify.bat`. It never ran:
 *
 *   1. `cmd.exe` mangled the header `REM` blocks and tried to execute a stray
 *      token (`'M' is not recognized as an internal or external command`).
 *   2. A step label containing parentheses — `static contracts (testids / ...)`
 *      — blew up an enclosing parenthesised block with
 *      `此时不应有 )` / "unexpected )".
 *
 * Batch quoting is a minefield, and the person who wrote it could not test it.
 * Node has no such problem, is already a hard dependency of this repo, and lets
 * the whole thing stay readable.
 *
 * ## What it does
 *
 * Runs the gate in fastest-failure-first order, streams every step's output to
 * stdout AND to `scripts/verify-report.txt`, and never stops early — one pass
 * tells you everything that is broken, not just the first thing.
 *
 * ## Usage
 *
 *     node scripts/verify.mjs              typecheck, lint, tests, 3 builds
 *     node scripts/verify.mjs --e2e        also run Playwright
 *     node scripts/verify.mjs --only=contracts
 *
 * Exit code: 0 if every step passed, 1 otherwise.
 *
 * ## A database IS needed for the default steps（2026-10-06 更正）
 *
 * The paragraph that used to sit here said no database was needed, on the grounds
 * that `grep "new PrismaClient" apps/api` returns nothing. That grep still returns
 * nothing — but the conclusion drawn from it was wrong: the API suite no longer
 * runs "entirely against mocked Prisma". `src/auth/oauth/oauth-flow-http.spec.ts`
 * boots a real Nest application (`moduleRef.createNestApplication()`) and talks to
 * a real PostgreSQL, and the whole `apps/api` tier is a single `jest` run, so the
 * `tests` step below inherits that requirement.
 *
 * Measured, not assumed: with an unreachable database that suite does not fail
 * fast — it **hangs** (2026-10-05, a bogus DB address, 900s without returning).
 * That is why `.github/workflows/ci.yml` provisions a `postgres:16` service and
 * uses `prisma migrate deploy` as its liveness probe.
 *
 * Postgres is required for `tests` as well as for `--e2e`, whose Playwright
 * fixtures connect to localhost:5433 directly.
 *
 * That is also why the unit tier is `test:static` and not `test`: admin's `test`
 * script chains `playwright test`, which would pull a database requirement into
 * a run that otherwise has none.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const REPORT = join(HERE, "verify-report.txt");

const argv = process.argv.slice(2);
const wantE2E = argv.includes("--e2e");
const only = (argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1];

/**
 * The gate, in the order that fails fastest.
 *
 * Step 0 is the cheap one: the three static checkers are hand-written for this
 * refactor and each runs `--self-test` first, against known-good and known-bad
 * snippets. None of that tooling had ever been executed, so step 0 is what
 * establishes that the checkers themselves work. If it fails, the checker is
 * wrong — not the code.
 */
const STEPS = [
  {
    id: "contracts",
    label: "static checker self-tests",
    shell: "node scripts/static-contract-check.mjs --self-test && node scripts/jsx-balance-check.mjs --self-test && node scripts/tf-prop-check.mjs --self-test",
    hint: "If this fails, THE CHECKER IS WRONG, not your code.",
  },
  {
    id: "contracts",
    label: "static contracts: testids, theme, JSX balance, tf props",
    shell: "node scripts/static-contract-check.mjs && node scripts/jsx-balance-check.mjs && node scripts/tf-prop-check.mjs",
    hint: "Catches what tsc and next build cannot: stale E2E testids, missing barrel exports, Tailwind classes that silently do not exist, overlays that escaped the phone shell, unclosed JSX tags, undeclared primitive props.",
  },
  {
    id: "typecheck",
    label: "typecheck, all workspaces",
    shell: "npm run typecheck",
  },
  {
    id: "lint",
    label: "lint, all workspaces",
    shell: "npm run lint",
  },
  {
    id: "tests",
    label: "unit tests: api jest plus web and admin smoke",
    shell: "npm run test:static",
    hint: "需要数据库（2026-10-06 更正）：`test:static` 在 api 上就是 `jest`（整套单测），其中 src/auth/oauth/oauth-flow-http.spec.ts 会真的启动应用并打真库。库不可达时它**挂住不退出**（实测 900s 未返回），所以看到「卡住不动」先查数据库，而不是查脚本。先跑 npx prisma migrate status。",
  },
  { id: "build", label: "build web", shell: "npm run build -w @talkfirst/web" },
  { id: "build", label: "build api", shell: "npm run build -w @talkfirst/api" },
  { id: "build", label: "build admin", shell: "npm run build -w @talkfirst/admin" },
];

if (wantE2E) {
  STEPS.push({
    id: "e2e",
    label: "e2e: playwright (needs API plus Postgres on 5433 plus browsers)",
    shell: "npm run test:e2e -w @talkfirst/web",
  });
}

const selected = only ? STEPS.filter((s) => s.id === only) : STEPS;
if (selected.length === 0) {
  console.error(`No steps match --only=${only}. Known ids: ${[...new Set(STEPS.map((s) => s.id))].join(", ")}`);
  process.exit(2);
}

/* -------------------------------------------------------------------------- */

const STATUS = join(HERE, "verify-status.txt");

let report = "";
const failed = [];

function emit(line) {
  process.stdout.write(`${line}\n`);
  report += `${line}\n`;
}

/**
 * Heartbeat: record which step is running, before it runs.
 *
 * The report is written only at the END, so if a step hangs or the console output
 * gets truncated there is no way to tell WHICH step stalled. It already happened
 * six times — `unit tests` was the last line visible every run. This file answers
 * "where is it now?" while the run is still in progress:
 *
 *     type scripts\verify-status.txt
 */
function markStatus(text) {
  try {
    writeFileSync(STATUS, `${text}\n`, "utf8");
  } catch {
    // A status file is a convenience; never let it fail the run.
  }
}

function banner(text) {
  emit("");
  emit("-".repeat(64));
  emit(` ${text}`);
  emit("-".repeat(64));
}

emit("TalkFirst verification");
emit(`Started:        ${new Date().toISOString()}`);
emit(`Root:           ${ROOT}`);
emit(`Node:           ${process.version}`);
emit(`Platform:       ${process.platform} ${process.arch}`);
emit(`E2E requested:  ${wantE2E ? "yes" : "no"}`);

if (!wantE2E) {
  emit("Postgres:       not required for these steps (see the header of this file)");
}

for (const step of selected) {
  banner(step.label);
  if (step.hint) emit(`note: ${step.hint}`);
  emit(`$ ${step.shell}`);
  emit("");
  process.stdout.write("  running...\n");
  markStatus(`RUNNING: ${step.label}\n$ ${step.shell}\nsince ${new Date().toISOString()}`);

  const started = Date.now();
  const result = spawnSync(step.shell, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    /**
     * `pipe`, not `inherit`. With `inherit` the child's output reaches the
     * terminal but is NOT capturable, so a failing build's error text would be
     * missing from the report — which is the one thing the report exists to
     * carry. Trade-off: nothing prints until the step finishes, which is why
     * every step announces itself first.
     */
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (result.error) {
    emit(`*** FAILED TO LAUNCH *** ${result.error.message}`);
    failed.push(step.label);
    continue;
  }

  const out = result.stdout ?? "";
  const err = result.stderr ?? "";
  if (out.trim()) emit(out.replace(/\s+$/, ""));
  if (err.trim()) emit(err.replace(/\s+$/, ""));

  if (result.status === 0) {
    emit("");
    emit(`OK  (${seconds}s)`);
  } else {
    emit("");
    emit(`*** FAILED *** (exit ${result.status}, ${seconds}s)`);
    failed.push(step.label);
  }
}

emit("");
emit("=".repeat(64));
if (failed.length === 0) {
  emit("SUMMARY: ALL STEPS PASSED");} else {
  emit(`SUMMARY: ${failed.length} STEP(S) FAILED`);
  for (const name of failed) emit(`  - ${name}`);
}
emit("=".repeat(64));

try {
  mkdirSync(HERE, { recursive: true });
  writeFileSync(REPORT, report, "utf8");
  markStatus(
    failed.length === 0
      ? `DONE: all steps passed at ${new Date().toISOString()}\n`
      : `DONE: failed -> ${failed.join(" | ")} at ${new Date().toISOString()}\n`,
  );
  console.log(`\nReport written to: ${REPORT}`);
  console.log("Paste that file back to continue.");
} catch (error) {
  console.error(`\nCould not write the report: ${error.message}`);
}

process.exit(failed.length === 0 ? 0 : 1);
