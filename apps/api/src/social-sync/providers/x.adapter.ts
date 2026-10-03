import { SocialProviderError, type ExternalAccount, type ExternalPost } from "../external-post";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import type { SocialProviderConfig } from "../social-sync.config";
import { OAuthFormAdapter } from "./oauth-form.adapter";
import { providerRequest } from "./http";

/**
 * X (Twitter), through the official API v2.
 *
 * ## Read access depends on the API tier, and that is the operator's problem to know
 *
 * `GET /2/users/:id/tweets` is the documented endpoint for a member's own posts, but X's
 * free tier has historically allowed only a small monthly read allowance and the paid tiers
 * change. Nothing here can detect that in advance: the call simply returns 429 or 403 when
 * the allowance is gone, which `http.ts` maps to `SOCIAL_RATE_LIMITED` or
 * `SOCIAL_PERMISSION_DENIED`. Those two codes are the honest answer, and the settings screen
 * surfaces them rather than claiming a connection works when the tier does not support it.
 *
 * ## Why PKCE is mandatory here
 *
 * X requires `code_challenge` for public clients and accepts it for confidential ones, so the
 * flow always sends it. The verifier is generated and held by the shared state cookie, which
 * is the same mechanism sign-in already uses.
 *
 * ## Why the member's own id is needed
 *
 * The timeline endpoint is addressed by numeric user id, not by handle, so `getAccount`
 * resolves `users/me` first — and its id is stored as `providerUserId`, which is what lets a
 * later sync skip the lookup.
 *
 * ## NOT VERIFIED against a live API
 *
 * This deployment has no X developer credentials, and X requires an application review. The
 * request shapes below follow the published v2 documentation, but no call in this file has
 * ever been executed. Treat the contract as unverified until a real credential runs it.
 */

const API = "https://api.twitter.com/2";

type MeResponse = { data?: { id?: string; name?: string; username?: string; profile_image_url?: string } };

type TweetsResponse = {
  data?: Array<{
    id?: string;
    text?: string;
    created_at?: string;
    author_id?: string;
    attachments?: { media_keys?: string[] };
  }>;
  includes?: {
    media?: Array<{ media_key?: string; type?: string; url?: string; preview_image_url?: string }>;
    users?: Array<{ id?: string; name?: string; username?: string; profile_image_url?: string }>;
  };
};

export class XAdapter extends OAuthFormAdapter implements SocialProviderAdapter {
  readonly provider = "X" as const;
  /**
   * Declared true because the integration is implemented; whether a given API tier permits
   * the read is answered by the API itself, not by this flag. The flag means "this adapter
   * has a real implementation", and the approval state is separate (see the config).
   */
  readonly canReadPosts = true;

  protected readonly clientAuth = "body" as const;

  getAuthorizationUrl(input: {
    config: SocialProviderConfig;
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
  }): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: input.config.clientId,
      redirect_uri: input.redirectUri,
      scope: input.config.scopes.join(" "),
      state: input.state,
    });
    if (input.codeChallenge) {
      params.set("code_challenge", input.codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${input.config.authorizationEndpoint}?${params.toString()}`;
  }

  async handleCallback(input: {
    config: SocialProviderConfig;
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
  }): Promise<{ account: ExternalAccount; tokens: ReturnType<OAuthFormAdapter["tokensFrom"]> }> {
    const tokens = await this.exchangeCode({
      config: input.config,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      /**
       * X only issues a refresh token when `offline.access` was granted. Requiring it makes a
       * connection that cannot be kept alive fail now rather than an hour later.
       */
      requireRefreshToken: true,
    });
    const account = await this.getAccount({ config: input.config, accessToken: tokens.accessToken });
    return { account, tokens };
  }

  async refreshToken(input: { config: SocialProviderConfig; refreshToken: string }) {
    return this.refresh(input);
  }

  async getAccount(input: { config: SocialProviderConfig; accessToken: string }): Promise<ExternalAccount> {
    const payload = await providerRequest<MeResponse>(`${API}/users/me`, {
      query: { "user.fields": "profile_image_url,name,username" },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const me = payload.data;
    if (!me?.id) {
      throw new SocialProviderError("SOCIAL_PROVIDER_ERROR", "The provider returned no account", "users/me had no data");
    }

    return {
      providerUserId: me.id,
      handle: me.username ?? null,
      displayName: me.name ?? null,
      avatarUrl: me.profile_image_url ?? null,
    };
  }

  async getRecentPosts(input: {
    config: SocialProviderConfig;
    accessToken: string;
    providerUserId: string;
    limit: number;
  }): Promise<ExternalPost[]> {
    const wanted = Math.min(Math.max(input.limit, 1), 100);

    const payload = await providerRequest<TweetsResponse>(`${API}/users/${input.providerUserId}/tweets`, {
      query: {
        max_results: wanted,
        // Retweets and replies are excluded: neither is the member's own post, and including
        // them would fill the profile with other people's words.
        exclude: "retweets,replies",
        "tweet.fields": "created_at,author_id,attachments",
        // `url` and `preview_image_url` are what make an image post renderable; without them
        // every media post would be text-only.
        "media.fields": "url,preview_image_url,type",
        expansions: "attachments.media_keys,author_id",
      },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const posts = payload.data ?? [];
    const mediaByKey = new Map((payload.includes?.media ?? []).map((item) => [item.media_key, item]));
    const author = payload.includes?.users?.[0];

    return posts
      .map((tweet): ExternalPost | null => {
        if (!tweet.id) return null;
        const publishedAt = tweet.created_at ? new Date(tweet.created_at) : null;
        if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

        const keys = tweet.attachments?.media_keys ?? [];
        const firstMedia = keys.map((key) => mediaByKey.get(key)).find(Boolean);

        // A photo is embedded through the public URL X serves; a video cannot be, and X's API
        // exposes no embeddable player URL, so the card links out instead of inventing one.
        const isPhoto = firstMedia?.type === "photo";
        const imageUrl = isPhoto ? (firstMedia?.url ?? firstMedia?.preview_image_url ?? null) : null;

        return {
          provider: "X",
          externalPostId: tweet.id,
          externalUrl: `https://x.com/i/web/status/${tweet.id}`,
          authorId: author?.id ?? tweet.author_id ?? null,
          authorName: author?.name ?? null,
          authorAvatar: author?.profile_image_url ?? null,
          text: tweet.text ?? null,
          title: null,
          mediaType: keys.length > 0 ? (isPhoto ? "IMAGE" : "VIDEO") : "TEXT",
          thumbnailUrl: imageUrl,
          mediaUrl: null,
          // X offers no first-party embed URL in the API; the canonical post URL is what the
          // client can render a card from.
          embedUrl: null,
          publishedAt,
          raw: tweet,
        };
      })
      .filter((post): post is ExternalPost => post !== null)
      .slice(0, wanted);
  }

  async revoke(input: { config: SocialProviderConfig; accessToken: string }): Promise<void> {
    /**
     * X's revocation endpoint requires the same Basic client authentication as the token
     * endpoint, which `withClientAuth` already knows how to build.
     */
    const { headers } = this.withClientAuth(input.config, {});
    await providerRequest<unknown>("https://api.twitter.com/2/oauth2/revoke", {
      method: "POST",
      form: { token: input.accessToken, token_type_hint: "access_token" },
      headers,
    });
  }
}
