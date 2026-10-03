/**
 * Per-provider OAuth credentials for CONTENT SYNC.
 *
 * ## Why this is separate from sign-in
 *
 * The sync flow requests a different scope and uses a different redirect URI than
 * `auth/oauth`, even though YouTube reuses the same Google OAuth application. Sharing one
 * configuration would mean a scope change for sync could break sign-in, and the two
 * redirect URIs must both be registered anyway — so they are read separately and the
 * credential source is the only thing they have in common.
 *
 * ## Complete or absent, never half
 *
 * The same rule `oauth-config.ts` states for sign-in: a client id without a secret is not a
 * degraded feature, it is a button that fails on the callback with an unactionable error.
 * `providerConfiguration` therefore reports one of three states and never a partial one.
 *
 * ## Why YouTube falls back to the Google credentials
 *
 * YouTube's API is a Google API and can be called with the same OAuth client, so requiring
 * a second pair of variables would make an operator create a duplicate client for no
 * reason. `SOCIAL_YOUTUBE_CLIENT_ID` still wins when present, so a deployment that wants a
 * dedicated client can have one.
 */

export const SOCIAL_PROVIDERS = ["YOUTUBE", "X", "TIKTOK", "INSTAGRAM", "DOUYIN"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: unknown): value is SocialProviderId {
  return typeof value === "string" && (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/**
 * What the API tells a client about a provider.
 *
 * Three states rather than a boolean, because the two failure modes need different copy:
 * `AVAILABLE` can be connected now, `REQUIRES_APPROVAL` needs the operator to finish a
 * developer programme, and `NOT_CONFIGURED` needs credentials to be placed on the server.
 * Collapsing them into "not available" would tell a member to ask for access when the real
 * answer is that the server is not ready.
 */
export type ProviderAvailability = "AVAILABLE" | "REQUIRES_APPROVAL" | "NOT_CONFIGURED";

export type SocialProviderConfig = {
  provider: SocialProviderId;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Space-separated scopes for this provider's read access. */
  scopes: readonly string[];
  availability: ProviderAvailability;
  /** Shown in the settings screen; the member-facing name. */
  label: string;
};

/** Where a provider authenticates and issues tokens. Fixed: they are not per-tenant. */
const ENDPOINTS: Record<SocialProviderId, { authorizationEndpoint: string; tokenEndpoint: string }> = {
  YOUTUBE: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  },
  X: {
    authorizationEndpoint: "https://twitter.com/i/oauth2/authorize",
    tokenEndpoint: "https://api.twitter.com/2/oauth2/token",
  },
  TIKTOK: {
    authorizationEndpoint: "https://www.tiktok.com/v2/auth/authorize/",
    tokenEndpoint: "https://open.tiktokapis.com/v2/oauth/token/",
  },
  INSTAGRAM: {
    authorizationEndpoint: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v21.0/oauth/access_token",
  },
  DOUYIN: {
    authorizationEndpoint: "https://open.douyin.com/platform/oauth/connect/",
    tokenEndpoint: "https://open.douyin.com/oauth/access_token/",
  },
};

/**
 * Scopes, one per provider.
 *
 * Every one is the narrowest read-only scope that returns the member's own posts —
 * `youtube.readonly` rather than `youtube`, `user.info.basic` plus `video.list` for TikTok
 * rather than an upload scope. Requesting more than is used is how an integration gets
 * rejected in review and how a member is asked to grant rights the product never exercises.
 */
const SCOPES: Record<SocialProviderId, readonly string[]> = {
  YOUTUBE: ["https://www.googleapis.com/auth/youtube.readonly"],
  X: ["tweet.read", "users.read", "offline.access"],
  TIKTOK: ["user.info.basic", "video.list"],
  INSTAGRAM: ["instagram_basic", "pages_show_list", "pages_read_engagement"],
  DOUYIN: ["user_info", "video.list"],
};

const LABELS: Record<SocialProviderId, string> = {
  YOUTUBE: "YouTube",
  X: "X",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  DOUYIN: "抖音",
};

/**
 * Credential variable names per provider.
 *
 * TikTok and Douyin call theirs a "client key", which is the same thing as a client id —
 * the variable is named `*_CLIENT_KEY` because that is what their consoles call it, and an
 * operator copying from their console should not have to translate.
 */
const CREDENTIAL_VARS: Record<SocialProviderId, { id: string[]; secret: string[] }> = {
  // `youtube`-specific first, then the shared Google client.
  YOUTUBE: {
    id: ["SOCIAL_YOUTUBE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
    secret: ["SOCIAL_YOUTUBE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
  },
  X: { id: ["SOCIAL_X_CLIENT_ID"], secret: ["SOCIAL_X_CLIENT_SECRET"] },
  TIKTOK: { id: ["SOCIAL_TIKTOK_CLIENT_KEY"], secret: ["SOCIAL_TIKTOK_CLIENT_SECRET"] },
  INSTAGRAM: { id: ["SOCIAL_INSTAGRAM_CLIENT_ID"], secret: ["SOCIAL_INSTAGRAM_CLIENT_SECRET"] },
  DOUYIN: { id: ["SOCIAL_DOUYIN_CLIENT_KEY"], secret: ["SOCIAL_DOUYIN_CLIENT_SECRET"] },
};

/** First non-empty value among `names`. */
function firstConfigured(names: readonly string[], env: NodeJS.ProcessEnv): string {
  for (const name of names) {
    const value = (env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/**
 * Platforms that cannot be connected regardless of configuration.
 *
 * ## Why this is a list in the code and not just an absence of credentials
 *
 * These four require a developer-programme review that this deployment has not completed,
 * and (for Instagram) a Business or Creator account that a personal profile simply does
 * not have. Reporting them as `NOT_CONFIGURED` would tell an operator "add credentials and
 * it works", which is false — no credential makes Instagram readable for a personal
 * account. `REQUIRES_APPROVAL` states the real blocker.
 *
 * Removing an entry from this list is the step that turns a platform on, and it should only
 * happen once the approval actually exists.
 */
const REQUIRES_APPROVAL: ReadonlySet<SocialProviderId> = new Set(["X", "TIKTOK", "INSTAGRAM", "DOUYIN"]);

export function apiPublicOriginForSocial(env: NodeJS.ProcessEnv = process.env): string {
  return (env.API_PUBLIC_URL ?? "http://localhost:4000").trim().replace(/\/+$/, "");
}

/**
 * The callback this flow registers, distinct from the sign-in callback.
 *
 * Both must be listed in the provider's console. Deriving it from `API_PUBLIC_URL` rather
 * than configuring it separately is the same reasoning as sign-in: the console entry is a
 * consequence of where the API runs, so deriving keeps the two from drifting.
 */
export function socialCallbackUri(provider: SocialProviderId, env: NodeJS.ProcessEnv = process.env): string {
  return `${apiPublicOriginForSocial(env)}/api/v1/social-sync/${provider.toLowerCase()}/callback`;
}

/**
 * Resolves one provider's configuration.
 *
 * Availability is decided in this order, and the order matters: approval status outranks
 * credentials, because a platform that needs approval is not made connectable by setting a
 * variable.
 */
export function providerConfiguration(
  provider: SocialProviderId,
  env: NodeJS.ProcessEnv = process.env,
): SocialProviderConfig {
  const vars = CREDENTIAL_VARS[provider];
  const clientId = firstConfigured(vars.id, env);
  const clientSecret = firstConfigured(vars.secret, env);

  let availability: ProviderAvailability;
  if (REQUIRES_APPROVAL.has(provider)) {
    availability = "REQUIRES_APPROVAL";
  } else if (clientId && clientSecret) {
    availability = "AVAILABLE";
  } else {
    availability = "NOT_CONFIGURED";
  }

  return {
    provider,
    clientId,
    clientSecret,
    ...ENDPOINTS[provider],
    scopes: SCOPES[provider],
    availability,
    label: LABELS[provider],
  };
}

export function allProviderConfigurations(env: NodeJS.ProcessEnv = process.env): SocialProviderConfig[] {
  return SOCIAL_PROVIDERS.map((provider) => providerConfiguration(provider, env));
}

/**
 * The configuration for a provider that must actually work, or a typed refusal.
 *
 * Returning a config object with empty credentials would push the failure to the first
 * network call, where it surfaces as a provider error that says nothing about configuration.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: SocialProviderId,
    readonly availability: ProviderAvailability,
  ) {
    super(
      availability === "REQUIRES_APPROVAL"
        ? `${LABELS[provider]} requires developer-programme approval before its API can be read`
        : `${LABELS[provider]} is not configured on this deployment`,
    );
    this.name = "ProviderUnavailableError";
  }
}

export function requireProviderConfig(
  provider: SocialProviderId,
  env: NodeJS.ProcessEnv = process.env,
): SocialProviderConfig {
  const config = providerConfiguration(provider, env);
  if (config.availability !== "AVAILABLE") {
    throw new ProviderUnavailableError(provider, config.availability);
  }
  return config;
}
