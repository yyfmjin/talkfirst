/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    // .ts files: handled by ts-jest (CJS mode)
    "^.+\\.ts$": "ts-jest",
    // .js files in node_modules/@nestjs: handled by babel-jest
    // babel-jest reads root babel.config.js which converts ESM -> CJS
    "^.+\\.js$": ["babel-jest", { rootMode: "upward" }],
  },
  // Allow @nestjs packages to be transformed (they are pure ESM in v12)
  transformIgnorePatterns: ["/node_modules/(?!@nestjs)/"],

  /**
   * One worker, always.
   *
   * `src/auth/oauth/oauth-flow-http.spec.ts` boots the real application and drives
   * the whole sign-in flow over real HTTP against the real PostgreSQL instance —
   * the same instance every other suite talks to. In parallel they contend for
   * connections, and the failure mode observed on 2026-10-04 is that this suite's
   * `beforeAll` times out under load: **all 13 of its tests fail at once** after
   * ~40s, while the identical command passes on the next run and on every
   * subsequent run (4 of 5 parallel runs were green).
   *
   * That is the worst kind of gate: it fails for a reason unrelated to the change
   * being tested, so the habit it teaches is "just run it again". Serial costs
   * ~57s instead of ~37s for all 1602 tests and makes the result deterministic.
   *
   * This is a test-isolation limit, not a product defect — if the suite is ever
   * given its own database, this can be reverted.
   */
  maxWorkers: 1,
};
