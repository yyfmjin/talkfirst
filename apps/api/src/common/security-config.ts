/**
 * FIX (audit P007) — the single place that decides whether this process is
 * allowed to run with development defaults.
 *
 * ## The defect this replaces
 *
 * Every hardening switch used to be keyed on `NODE_ENV === "production"`:
 *
 *   - `main.ts` only validated `JWT_SECRET` / `JWT_REFRESH_SECRET` in production;
 *   - `auth.service.ts`, `jwt.strategy.ts` and `chat-auth.service.ts` all fall
 *     back to the literal `"change-me-in-development"`;
 *   - `auth.constants.ts` only set `secure` on the session cookies in production;
 *   - `verification.service.ts` returned the e-mail verification code in the API
 *     response whenever `NODE_ENV !== "production"`.
 *
 * That is fail-open: a deployment that simply forgets to set `NODE_ENV` — a
 * bare `node dist/main.js`, a container built without the variable, a PaaS that
 * names it something else — silently ran with a publicly known JWT signing key,
 * non-Secure cookies over plain HTTP, and an unauthenticated endpoint that hands
 * out account-verification codes for any e-mail address.
 *
 * ## The rule now
 *
 * The *unsafe* behaviour is what has to be requested explicitly, by naming the
 * deployment as non-production in a variable whose name says exactly what it
 * does. Absent that opt-in, the process refuses to start without real secrets.
 * So the failure mode is "will not boot, and says why" instead of "boots and is
 * quietly insecure".
 *
 * `NODE_ENV=development` and `NODE_ENV=test` are still honoured as opt-ins, so
 * local workflows and the Jest suite are unchanged.
 */

/** Explicit opt-in to development defaults. Its name is the warning. */
export const ALLOW_INSECURE_DEFAULTS_ENV = "ALLOW_INSECURE_DEFAULTS";

/** The literal that must never reach a real deployment. */
export const INSECURE_JWT_FALLBACK = "change-me-in-development";
/** Substring matched case-insensitively to catch `change-me-*` variants. */
export const INSECURE_JWT_MARKER = "change-me";

export type DeploymentEnvironment = "development" | "production";

/**
 * True when this process may use development defaults.
 *
 * Deliberately generous about *how* a developer opts in, and strict about what
 * happens when nobody did. `ALLOW_INSECURE_DEFAULTS=true` is the explicit
 * switch; `NODE_ENV=development` / `test` are treated as the same statement
 * because that is what they have always meant in this repo.
 */
export function allowsInsecureDefaults(env: NodeJS.ProcessEnv = process.env): boolean {
  /**
   * Precedence, highest first:
   *
   *  1. `ALLOW_INSECURE_DEFAULTS=true` — the master override. It is checked
   *     first so a developer can force development mode even where `.env` says
   *     `NODE_ENV=production`.
   *  2. an explicit `NODE_ENV` — `production` is a statement, and so is
   *     `development` / `test`. Checked before the runner check below so a spec
   *     that deliberately sets `NODE_ENV=production` really does see production
   *     behaviour (otherwise the `devCode` leak guard could never be tested).
   *  3. a live test runner (`JEST_WORKER_ID`, set by Jest itself) — equivalent
   *     to `NODE_ENV=test`, without the suite having to say so. This only
   *     matters when `NODE_ENV` is unset, which is exactly the case that used to
   *     fall through to "production" and make a bare spec look like a deployment.
   *  4. anything else, including an unset `NODE_ENV` — production.
   */
  const explicit = (env[ALLOW_INSECURE_DEFAULTS_ENV] ?? "").trim().toLowerCase();
  if (explicit === "true") return true;

  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "production") return false;
  if (nodeEnv === "development" || nodeEnv === "test") return true;

  if (env.JEST_WORKER_ID) return true;
  return false;
}

/** `NODE_ENV` reported as-is for logging; unknown values are treated as production. */
export function deploymentEnvironment(env: NodeJS.ProcessEnv = process.env): DeploymentEnvironment {
  return allowsInsecureDefaults(env) ? "development" : "production";
}

export class InsecureConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureConfigurationError";
  }
}

/**
 * Refuse to start when a secret is missing, empty, or still a `change-me`
 * placeholder, and the process has not explicitly opted into development
 * defaults.
 *
 * `names` is passed in rather than hard-coded so the same guard covers any
 * future signing key. The error message names the variables only — never their
 * values.
 */
export function assertSecretConfigured(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (allowsInsecureDefaults(env)) return;

  const missing: string[] = [];
  for (const name of names) {
    const value = (env[name] ?? "").trim();
    if (!value || value.toLowerCase().includes(INSECURE_JWT_MARKER)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    throw new InsecureConfigurationError(
      `Missing required production secrets: ${missing.join(", ")}. ` +
        `Set them to strong random values, or set NODE_ENV=development ` +
        `(or ${ALLOW_INSECURE_DEFAULTS_ENV}=true) to run with development defaults.`,
    );
  }
}

/**
 * The value to sign with, once `assertSecretConfigured` has been satisfied.
 *
 * Kept here so no module invents its own fallback literal: a missing secret in
 * an opted-in development process still gets *a* value, and every other process
 * has already refused to boot.
 */
export function jwtSecretOrDevFallback(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = (env[name] ?? "").trim();
  if (value) return value;
  if (!allowsInsecureDefaults(env)) {
    // Unreachable when `assertSecretConfigured` ran at boot; kept as a second
    // line of defence so a module imported outside the normal bootstrap cannot
    // silently sign with a known key.
    throw new InsecureConfigurationError(
      `${name} is not set. Set it, or run with development defaults.`,
    );
  }
  return INSECURE_JWT_FALLBACK;
}

/**
 * `THROTTLE_MULTIPLIER` exists so the browser suites can raise every rate limit
 * in one place (the login route is capped at 50/min and the suites perform ~74
 * logins). It must never reach a real deployment: at `100`, login becomes
 * 5000/min/IP and the global default 12000/min/IP, which is no rate limiting at
 * all. The template shipping it at `100` (audit P007) is what made this
 * reachable by simply copying `.env.example`.
 *
 * A production process therefore refuses to boot with a multiplier above 1.
 */
export function assertThrottleMultiplierSafe(env: NodeJS.ProcessEnv = process.env): void {
  const raw = (env.THROTTLE_MULTIPLIER ?? "").trim();
  if (!raw) return;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 1) return;
  if (allowsInsecureDefaults(env)) return;
  throw new InsecureConfigurationError(
    `THROTTLE_MULTIPLIER=${raw} disables rate limiting and is only for local test runs. ` +
      `Remove it, set it to 1, or set NODE_ENV=development (or ` +
      `${ALLOW_INSECURE_DEFAULTS_ENV}=true) if this really is a development process.`,
  );
}

/** True when the deployment should behave like production for security purposes. */
export function isProductionDeployment(env: NodeJS.ProcessEnv = process.env): boolean {
  return deploymentEnvironment(env) === "production";
}

/**
 * Phase O1-5 — refuse to run a production deployment that has not stated how
 * many proxy hops sit in front of it.
 *
 * ## The defect
 *
 * `trustProxySetting()` (see `security/client-ip.ts`) defaults to `1` in
 * production. That default is only correct for a one-proxy topology. Measured
 * against real Express, in a topology with **no** proxy:
 *
 *     app.set("trust proxy", false) -> req.ip = 127.0.0.1   (X-Forwarded-For ignored)
 *     app.set("trust proxy", 1)     -> req.ip = 1.2.3.4     (X-Forwarded-For TRUSTED)
 *     app.set("trust proxy", 0)     -> req.ip = 127.0.0.1   (X-Forwarded-For ignored)
 *
 * So with the production default and no proxy, **any caller controls their own
 * recorded address** by sending a single header. `AccessLog.ip` is the field the
 * entire operations console is built around — IP grouping, the "one device, many
 * accounts" investigation, abuse forensics — and it would have been
 * attacker-authored. The audit trail would look complete and be worthless.
 *
 * This is fail-open in the same shape audit P007 removed for the JWT secret, so
 * it gets the same treatment: an unstated topology is a **refusal to boot**, not
 * a silent guess.
 *
 * ## Why the value cannot be defaulted here
 *
 * The correct number is a property of the deployment, not of the code — and this
 * repository describes **no** proxy: `docker-compose.yml` publishes the API
 * directly and defines no nginx / traefik / caddy service. `TRUST_PROXY=0` is
 * therefore right today, and `1` or `2` becomes right the moment a proxy is
 * added. Only the operator can know which, so the operator has to say.
 */
export const TRUST_PROXY_ENV = "TRUST_PROXY";

export function assertTrustProxyConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (allowsInsecureDefaults(env)) return;
  if ((env[TRUST_PROXY_ENV] ?? "").trim()) return;
  throw new InsecureConfigurationError(
    `${TRUST_PROXY_ENV} is not set, so the API would fall back to trusting 1 proxy hop. ` +
      `With no proxy in front (which is what docker-compose.yml describes) that lets ANY ` +
      `caller forge their own address with an X-Forwarded-For header, and every value in ` +
      `AccessLog.ip becomes attacker-controlled. Set ${TRUST_PROXY_ENV} to the real number ` +
      `of proxy hops in front of this API (0 when it is exposed directly, 1 for a single ` +
      `reverse proxy, 2 for a CDN in front of a reverse proxy), or set NODE_ENV=development ` +
      `(or ${ALLOW_INSECURE_DEFAULTS_ENV}=true) if this really is a development process.`,
  );
}

/**
 * Phase O1 — refuse to run a production deployment without a device salt.
 *
 * `SECURITY_DEVICE_SALT` gates device identification (`security/device-hash.ts`).
 * When it is absent that module deliberately does NOT substitute a constant —
 * it returns `undefined` and warns once, which is correct at the unit level but
 * fail-open at the deployment level: `AccessLog.deviceHash` and
 * `SecurityEvent.deviceHash` simply stay NULL forever and every "one device,
 * many accounts" question becomes unanswerable, with nothing but a single log
 * line to say so. That is exactly the silent-degradation shape
 * `assertThrottleMultiplierSafe` exists to prevent, so it gets the same
 * treatment: the failure mode is "will not boot, and says why".
 *
 * Unlike `assertSecretConfigured`, an insecure placeholder is not the concern
 * here (any non-empty random value is acceptable) — only absence is.
 */
export function assertDeviceSaltConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (allowsInsecureDefaults(env)) return;
  if ((env.SECURITY_DEVICE_SALT ?? "").trim()) return;
  throw new InsecureConfigurationError(
    `SECURITY_DEVICE_SALT is not set, so device identifiers would be permanently ` +
      `disabled and AccessLog/SecurityEvent.deviceHash would always be NULL. ` +
      `Set it to a random value, or set NODE_ENV=development (or ` +
      `${ALLOW_INSECURE_DEFAULTS_ENV}=true) if this really is a development process.`,
  );
}

/** True when the e-mail verification code may be echoed back to the caller. */
export function mayExposeVerificationCode(env: NodeJS.ProcessEnv = process.env): boolean {
  return allowsInsecureDefaults(env);
}
