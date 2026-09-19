import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * PC-1.4 — real browser tests for the member profile screens.
 *
 * These drive Chromium against a real API and a real PostgreSQL database, so
 * what they prove is that the UI actually reads and writes stored state (a
 * save, a reload, and a second viewer all agree). They do **not** replace the
 * API-level suites: `apps/api/src/users/*.spec.ts` remains the authority on
 * validation and visibility rules, and a hidden control is never a security
 * boundary.
 *
 * ## Prerequisites
 *
 * The servers below serve **already-built** output:
 *
 *     npm run build -w @talkfirst/api
 *     npm run build -w @talkfirst/web
 *
 * `.local-data/pc14/run-playwright.sh` does both and then runs this suite under
 * a live PostgreSQL on :5433. `reuseExistingServer` means an already-running
 * server is reused as-is.
 */

/** Load the repo-root .env so the API and the fixtures see DATABASE_URL/JWT_SECRET. */
function loadRootEnv() {
  const path = resolve(process.cwd(), "../../.env");
  if (!existsSync(path)) return;
  // NODE_ENV is deliberately skipped: `next start` is a production server and
  // warns loudly if it inherits `development`.
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
 * Keep the loopback servers out of any HTTP proxy.
 *
 * When `HTTP_PROXY` is exported without a matching `NO_PROXY`, Playwright's
 * readiness poll for `webServer.url` is routed through the proxy, never reaches
 * `localhost`, and the run dies with "Timed out waiting 120000ms" even though
 * both servers started fine. `NO_PROXY` is additive here.
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

const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";

export default defineConfig({
  testDir: "./test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",

  // The suite shares one database and one pair of servers.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The profile fixtures are re-seeded once per run, so spec order matters for
  // nothing — but a failure should mean a real failure rather than a retry.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalTimeout: 20 * 60_000,

  reporter: [["list"]],

  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The profile card is a bottom sheet on small screens, so the phone
    // viewports are part of the contract rather than a nice-to-have.
    { name: "phone", use: { ...devices["Pixel 5"] } },
  ],

  webServer: [
    {
      command: "node dist/main.js",
      cwd: "../api",
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npx next start --port 3000",
      cwd: ".",
      url: `${WEB_URL}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
