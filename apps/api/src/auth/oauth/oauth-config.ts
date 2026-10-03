import { InsecureConfigurationError, allowsInsecureDefaults } from "../../common/security-config";
/**
 * Google 快捷登录的环境配置。
 *
 * ## The rule: complete or absent, never half
 *
 * A deployment either offers Google sign-in or it does not. `GOOGLE_CLIENT_ID`
 * without `GOOGLE_CLIENT_SECRET` is not a degraded feature — it is a login button
 * that fails on the callback with an unactionable error, which is worse than the
 * button not being there. So this module has exactly two states and a production
 * process refuses to boot in any third one.
 *
 * ## Why the redirect URI is derived, not configured
 *
 * It must match the value registered in the Google Cloud console *character for
 * character*, and the console entry is a consequence of where the API is
 * deployed. Deriving it from `API_PUBLIC_URL` means the two cannot drift, and the
 * startup assertion can insist on `https` in production (Google rejects plain
 * HTTP for a non-localhost redirect).
 */

/** Provider ids that can appear in `OAUTH_PROVIDERS`. */
export const SUPPORTED_OAUTH_PROVIDERS = ["google"] as const;
export type SupportedOAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];

/**
 * `local` is the development-only stand-in for Google (`OAUTH_DEV_PROVIDER`).
 *
 * It exists so the whole flow can be built and tested before any credential
 * exists, and it is refused outright in production — see
 * `assertOAuthConfiguration`.
 */
export const DEV_PROVIDER_ID = "local";

export type GoogleConfig = {
  kind: "google";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Google's fixed endpoints. Not configurable: they are not per-tenant. */
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuer: string;
};

export type LocalDevConfig = {
  kind: "local";
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Local JWKS served by the API itself; see `local-dev-provider`. */
  jwksUri: string;
  issuer: string;
};

export type OAuthProviderConfig = GoogleConfig | LocalDevConfig;

const GOOGLE_ENDPOINTS = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuer: "https://accounts.google.com",
} as const;

/**
 * Read `OAUTH_PROVIDERS`, defaulting to whatever is actually configured.
 *
 * Returns plain strings rather than `SupportedOAuthProvider[]` because the
 * development stand-in (`local`, see `DEV_PROVIDER_ID`) is a legitimate entry
 * that is deliberately NOT part of the supported set — it exists only under
 * `OAUTH_DEV_PROVIDER=true` and is refused outside development.
 */
export function readConfiguredProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = (env.OAUTH_PROVIDERS ?? "").trim();
  const requested = raw
    ? raw
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const known = requested.filter((entry): entry is SupportedOAuthProvider =>
    (SUPPORTED_OAUTH_PROVIDERS as readonly string[]).includes(entry),
  );
  /**
   * An unknown name is not silently dropped: a typo in `OAUTH_PROVIDERS` would
   * otherwise disable a provider and look like "the button is missing", which is
   * the hardest kind of configuration bug to notice. The assertion below fails
   * the boot instead.
   */
  const unknown = requested.filter((entry) => !(SUPPORTED_OAUTH_PROVIDERS as readonly string[]).includes(entry));
  if (unknown.length > 0) {
    throw new InsecureConfigurationError(
      `OAUTH_PROVIDERS contains unsupported provider(s): ${unknown.join(", ")}. ` +
        `Supported: ${SUPPORTED_OAUTH_PROVIDERS.join(", ")}.`,
    );
  }
  if (known.length > 0) return known;
  /**
   * No explicit list: enable whatever is actually configured, so an unconfigured
   * deployment does not advertise a button that cannot work.
   *
   * `local` is included because it is a provider a developer explicitly switched
   * on — without this the dev stand-in would be reachable by URL but absent from
   * the provider list, so the login screen would never offer it.
   */
  const providers: string[] = [];
  if (googleRawConfigured(env)) providers.push("google");
  if ((env.OAUTH_DEV_PROVIDER ?? "").trim() === "true") providers.push(DEV_PROVIDER_ID);
  return providers;
}

function googleRawConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean((env.GOOGLE_CLIENT_ID ?? "").trim() || (env.GOOGLE_CLIENT_SECRET ?? "").trim());
}

/**
 * The API's own public origin, used to build the redirect URI.
 *
 * `API_PUBLIC_URL` is the intended variable. `APP_URL` is NOT a fallback: it
 * points at the web app, and building a redirect URI on the wrong origin produces
 * a `redirect_uri_mismatch` from Google that says nothing about the real cause.
 */
export function apiPublicOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return (env.API_PUBLIC_URL ?? "http://localhost:4000").trim().replace(/\/+$/, "");
}

export function oauthCallbackPath(provider: string): string {
  return `/api/v1/auth/oauth/${provider}/callback`;
}

/**
 * Base path for the local dev provider's own endpoints.
 *
 * Deliberately NOT nested under `callback`. The controller's routes are
 * `:provider/start`, `:provider/callback`, `:provider/authorize`,
 * `:provider/token` and `:provider/jwks.json` — so `:provider` only ever matches a
 * single segment. Putting the dev provider's endpoints at
 * `/<provider>/callback/authorize` produced a request path of
 * `/local/callback/authorize`, which matches no route and answered a bare 404
 * "Cannot GET …" that looks nothing like a configuration mistake.
 */
export function oauthDevBasePath(provider: string): string {
  return `/api/v1/auth/oauth/${provider}`;
}

export function oauthRedirectUri(provider: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${apiPublicOrigin(env)}${oauthCallbackPath(provider)}`;
}

/**
 * Reject a redirect URI Google will refuse, before a user discovers it.
 *
 * Two rules, and the second is the one that matters in practice:
 *
 *  1. A real host must use `https`. Google rejects plain http except on loopback.
 *  2. In a **production** deployment the origin must not be loopback. `localhost`
 *     is legal for Google, so rule 1 alone would accept
 *     `API_PUBLIC_URL=http://localhost:4000` — the default — in production, and the
 *     callback registered in the console would then never be the one this process
 *     sends. That surfaces as a `redirect_uri_mismatch` from Google, which names
 *     neither the variable nor the mismatch, so it is refused here instead.
 *
 * `env` is threaded through rather than read from `process.env` at the point of
 * use: this function is called from a public, explicitly-parameterised helper, and
 * reading the ambient environment here would validate a DIFFERENT environment than
 * the caller asked about — which is exactly the bug that let a production
 * `localhost` configuration pass its own test.
 */
function assertRedirectUriIsAcceptable(
  provider: string,
  redirectUri: string,
  env: NodeJS.ProcessEnv,
): void {
  const url = new URL(redirectUri);
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

  if (isLoopback) {
    if (!allowsInsecureDefaults(env)) {
      throw new InsecureConfigurationError(
        `${provider} redirect URI resolves to ${redirectUri}, which is a loopback address — but this ` +
          `process is running as a production deployment. Set API_PUBLIC_URL to the public https origin ` +
          `of this API (the same origin whose callback is registered in the Google Cloud console).`,
      );
    }
    return;
  }

  if (url.protocol !== "https:") {
    throw new InsecureConfigurationError(
      `${provider} redirect URI must be https in a deployed environment (got ${redirectUri}). ` +
        `Google rejects plain http except for loopback addresses; set API_PUBLIC_URL to the ` +
        `public https origin of this API.`,
    );
  }
}

/**
 * Resolve the provider config, or null when the provider is off.
 *
 * Returns null rather than throwing for "not configured": an unconfigured
 * provider is a legitimate state (the button is simply not offered), and the
 * caller answers `OAUTH_PROVIDER_DISABLED`. Throwing here would make every
 * unrelated request that happens to read this config fail.
 */
export function readOAuthProviderConfig(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): OAuthProviderConfig | null {
  const normalized = provider.toLowerCase();

  if (normalized === DEV_PROVIDER_ID) {
    /**
     * The development stand-in. Refused in production here as well as at boot,
     * because a single guard in `main.ts` is one refactor away from being
     * bypassed by a spec, a script or a future entry point.
     */
    if (!allowsInsecureDefaults(env)) {
      throw new InsecureConfigurationError(
        `The ${DEV_PROVIDER_ID} OAuth provider is a development stand-in and must never be enabled in production.`,
      );
    }
    if ((env.OAUTH_DEV_PROVIDER ?? "").trim() !== "true") return null;
    const redirectUri = oauthRedirectUri(DEV_PROVIDER_ID, env);
    const devBase = `${apiPublicOrigin(env)}${oauthDevBasePath(DEV_PROVIDER_ID)}`;
    return {
      kind: "local",
      clientId: "local-dev-client",
      clientSecret: "local-dev-secret",
      redirectUri,
      authorizationEndpoint: `${devBase}/authorize`,
      tokenEndpoint: `${devBase}/token`,
      jwksUri: `${devBase}/jwks.json`,
      issuer: "talkfirst-local-dev",
    };
  }

  if (normalized !== "google") return null;

  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;

  const redirectUri = oauthRedirectUri("google", env);
  assertRedirectUriIsAcceptable("google", redirectUri, env);

  return { kind: "google", clientId, clientSecret, redirectUri, ...GOOGLE_ENDPOINTS };
}

/**
 * Boot-time validation for the whole feature.
 *
 * Mirrors `assertSecretConfigured`: the failure mode is "will not boot, and says
 * exactly what is wrong", never "boots and fails for the user later". It checks
 * three things a developer cannot see from the code:
 *
 *  1. a provider listed in `OAUTH_PROVIDERS` is actually configured — a typo or a
 *     half-filled `.env` would otherwise surface as a button that 503s;
 *  2. the redirect URI is one Google will accept;
 *  3. the development provider is not enabled outside development.
 */
export function assertOAuthConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  const providers = readConfiguredProviders(env);

  for (const provider of providers) {
    if (!readOAuthProviderConfig(provider, env)) {
      throw new InsecureConfigurationError(
        `OAUTH_PROVIDERS lists "${provider}" but its configuration is incomplete. ` +
          `Google needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and API_PUBLIC_URL for the redirect).`,
      );
    }
  }

  /**
   * The development stand-in is probed ONLY when it is actually switched on.
   *
   * Probing it unconditionally is what an earlier draft did, and it was wrong in
   * the worst direction: `readOAuthProviderConfig("local", …)` throws in a
   * production deployment *by design*, so every production boot refused to start
   * whether or not the flag was set — the assertion became "never run in
   * production" instead of "do not run the stand-in in production".
   */
  if ((env.OAUTH_DEV_PROVIDER ?? "").trim() === "true") {
    if (!allowsInsecureDefaults(env)) {
      throw new InsecureConfigurationError(
        "OAUTH_DEV_PROVIDER=true is a development stand-in and must not be set in production. " +
          "Remove it, or run with NODE_ENV=development.",
      );
    }
    /**
     * A second, independent lock: `readOAuthProviderConfig` refuses `local` outside
     * development as well, so a future entry point that skips this assertion still
     * cannot reach the stand-in.
     */
    readOAuthProviderConfig(DEV_PROVIDER_ID, env);
  }
}
