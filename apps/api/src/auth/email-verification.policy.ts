/**
 * SEC-005 — the single source of truth for "must this deployment verify an
 * e-mail before letting an account use the product?".
 *
 * `REQUIRE_EMAIL_VERIFICATION` (legacy) gated *registration* behind a prior
 * verification — the opposite order from the product flow, which registers and
 * then verifies (the web `/register` → `/verify` → `/legal` path). It is kept
 * only because the frozen `auth.controller.ts` still reads it, and it must not
 * be used for any new behaviour. `ENFORCE_EMAIL_VERIFICATION` supersedes it.
 */

/** New, post-registration enforcement switch. */
export const ENFORCE_EMAIL_VERIFICATION = "ENFORCE_EMAIL_VERIFICATION";

/** Legacy, pre-registration gate. Deprecated — see the note above. */
export const LEGACY_REQUIRE_EMAIL_VERIFICATION = "REQUIRE_EMAIL_VERIFICATION";

/**
 * Read live from the environment (not cached at import time) so a unit test can
 * flip the switch per case without reloading the module.
 */
export function emailVerificationEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ENFORCE_EMAIL_VERIFICATION] === "true";
}

/**
 * The API is served under a global prefix, and the audit context records
 * `req.originalUrl`, so an incoming path looks like `/api/v1/auth/me`. Routing
 * strips the prefix before a guard ever sees the request, so compare on the
 * prefix-free form.
 */
export const API_GLOBAL_PREFIX = "/api/v1";

/**
 * SEC-005 — what an unverified account may still reach.
 *
 * The rule is *deny by default*: this is an explicit allow-list, so a route
 * added later is closed to unverified accounts unless someone deliberately opts
 * it in. Anything not listed — `/discover`, `/messages`, `/moments`,
 * `/connections`, `/exchange`, and even the rest of `/users/me/*` — is blocked.
 *
 * `/users/me` is here (and only it, not `users/me/*`) because the web `/verify`
 * screen and the session provider read the signed-in user's own profile from
 * that exact route to render the verification flow.
 */
export const EMAIL_VERIFICATION_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/auth/me",
  "/auth/refresh",
  "/auth/logout",
  "/auth/send-verification-code",
  "/auth/verify-email",
  "/users/me",
]);

/** Strips the global prefix and any trailing slash from a request path. */
export function normalizeApiPath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  let path = rawPath.split("?")[0];
  if (path.startsWith(API_GLOBAL_PREFIX)) {
    path = path.slice(API_GLOBAL_PREFIX.length);
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path || "/";
}

/**
 * Whether `rawPath` is reachable while an account is unverified. Exact matches
 * only, so `users/me/attributes` and friends stay blocked.
 */
export function isEmailVerificationAllowedPath(rawPath: string | undefined): boolean {
  const path = normalizeApiPath(rawPath);
  return path !== undefined && EMAIL_VERIFICATION_ALLOWED_PATHS.has(path);
}
