import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Phase A+ — minimal real browser behaviour tests for the admin console.
 *
 * `apps/admin` previously had only static-regex assertions (read the source,
 * `assert.match` a string). Those pass whether or not the UI actually works.
 * These tests drive a real Chromium against a real API and a real database.
 *
 * ## What is and is not being tested
 *
 * These tests verify **presentation only** — that a role sees the controls it is
 * allowed to use and not the ones it is not. They are NOT the security boundary.
 * The backend `PermissionGuard` + `AdminService` scope checks remain the only
 * thing that actually prevents an action; a hidden button is a convenience. The
 * API-level enforcement is covered by `apps/api/src/admin/*.spec.ts` and
 * `scripts/phaseA-rbac-verify.mjs`. Never remove a backend check because a
 * browser test passes.
 *
 * ## Prerequisites
 *
 * The web servers below serve **already-built** output, so both apps must be
 * built first:
 *
 *     npx nest build        # in apps/api
 *     npx next build        # in apps/admin
 *
 * `npm run test:e2e:all` in apps/admin does both and then runs the suite.
 * `reuseExistingServer` means an already-running dev server is used as-is.
 */

/** Load the repo-root .env so the API and the fixtures see DATABASE_URL/JWT_SECRET. */
function loadRootEnv() {
  const path = resolve(process.cwd(), "../../.env");
  if (!existsSync(path)) return;
  // NODE_ENV is deliberately skipped: `next start` is a production server and
  // warns loudly if it inherits `development`. The API reads NODE_ENV from the
  // same file itself via ConfigModule, so nothing loses it.
  const skip = new Set(["NODE_ENV"]);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (skip.has(key)) continue;
    if (process.env[key] !== undefined) continue; // never clobber the real env
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
loadRootEnv();

/**
 * Keep the two loopback servers out of any HTTP proxy.
 *
 * Playwright decides a `webServer` is ready by polling its `url`. When the host
 * environment exports `HTTP_PROXY`/`http_proxy` without a matching `NO_PROXY`
 * (common in sandboxed and corporate setups), that poll is routed through the
 * proxy, never reaches `localhost`, and the run dies with
 * "Timed out waiting 120000ms from config.webServer" even though both servers
 * started fine. `NO_PROXY` is additive here, so an existing value is preserved.
 */
function ensureLoopbackBypass() {
  const loopback = ["localhost", "127.0.0.1", "::1"];
  for (const key of ["NO_PROXY", "no_proxy"]) {
    const current = (process.env[key] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const missing = loopback.filter((host) => !current.includes(host));
    if (missing.length > 0) process.env[key] = [...current, ...missing].join(",");
  }
}
ensureLoopbackBypass();

const ADMIN_URL = "http://localhost:3001";
const API_URL = "http://localhost:4000";

export default defineConfig({
  testDir: "./test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",

  // The suite drives one shared database and one shared pair of servers.
  fullyParallel: false,
  workers: 1,
  /**
   * No retries.
   *
   * A retry was added briefly to absorb the API's rate limiter, then removed:
   * it did not fix the problem (the requests keep coming, so a retry just fails
   * again) and it hid a real misconfiguration behind a "flaky" label. A failure
   * here should mean a real failure.
   *
   * The limiter itself was the actual bug. `login` carries a per-route
   * `@Throttle({ limit: 50 })`, and the suite performs ~74 logins, so it crossed
   * 50/min and got a genuine 429. `THROTTLE_LIMIT` cannot help — it only moves
   * the global default. `THROTTLE_MULTIPLIER` in `.env` scales every limit
   * including the per-route ones; see `HttpThrottlerGuard`. Left at 1 there is
   * no change at all.
   */
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },

  /**
   * Safety net for a known environment defect, not a workaround for our code.
   *
   * Playwright 1.63 + Node 22 on Windows intermittently fails to let the worker
   * process exit after the last test. The worker is not deadlocked — Playwright
   * tracks a heartbeat and only force-kills after the heartbeat stops for
   * `PWTEST_CHILD_PROCESS_TIMEOUT` (default 300s). During that window the CLI
   * sits silent, `globalTeardown` never runs, and the run finally reports
   * `status: "timedout"` with `failedTests: []`.
   *
   * **It is content-independent.** Measured: a full 74-test run, an 8-test run,
   * a 21-test run, and a 5-test spec that uses no Prisma at all were each seen
   * hanging; a different 15-test spec exited cleanly. So it is not caused by
   * Prisma, by any one spec, or by our test code.
   *
   * Because the same defect costs the run ~300s of silence, the budget has to
   * clear (real test time + that window): real time is ~2.5–12 min depending on
   * machine load, so 20 minutes. Judge the suite by `passed` and `failedTests`
   * — **not** by the exit code, and not by whether a `did not exit within`
   * message appears. To reproduce quickly while debugging, set
   * `PWTEST_CHILD_PROCESS_TIMEOUT=15000` in the environment.
   */
  globalTimeout: 20 * 60_000,

  reporter: [["list"]],

  use: {
    baseURL: ADMIN_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      command: "node dist/main.js",
      cwd: "../api",
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx next start --port 3001",
      cwd: ".",
      url: `${ADMIN_URL}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
