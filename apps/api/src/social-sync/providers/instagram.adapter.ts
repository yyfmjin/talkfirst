import { SocialProviderError, type ExternalAccount, type ExternalPost } from "../external-post";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import type { SocialProviderConfig } from "../social-sync.config";
import { OAuthFormAdapter } from "./oauth-form.adapter";
import { providerRequest } from "./http";

/**
 * Instagram, through the Facebook Graph API.
 *
 * ## Why this goes through Facebook at all
 *
 * Instagram's content API is served by the Graph API and authorised by a Facebook Login
 * application. There is no separate Instagram developer programme for this, which is why the
 * authorization endpoint below is a `facebook.com` URL even though the platform is Instagram.
 *
 * ## Why `pages_show_list` is requested as well as `instagram_basic`
 *
 * The Instagram account is reached THROUGH a Facebook Page: `me/accounts` lists the member's
 * pages, and each page names its `instagram_business_account`. Without the page scope the
 * Instagram id is not discoverable, and the connection would fail with a permission error that
 * looks like an Instagram problem but is not.
 *
 * ## Why this can never work for a personal Instagram account
 *
 * An Instagram Business or Creator account linked to a Facebook Page is a hard requirement of
 * the API. A personal account has no Graph node to read, so no credential or consent can make
 * this work — which is why the config reports Instagram as `REQUIRES_APPROVAL` and this
 * adapter's failures are reported as a permission problem rather than as a configuration one.
 *
 * ## Why `media_url` is not stored
 *
 * Instagram's `media_url` is a CDN link that expires, and Instagram's platform terms restrict
 * redistributing the media. The thumbnail is used for the card and the post links out, which
 * is the "reference, do not copy" rule the brief requires.
 *
 * ## NOT VERIFIED against a live API
 *
 * No Facebook application exists for this deployment. Request shapes follow the published
 * Graph API reference; no call in this file has been executed.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type AccountsResponse = {
  data?: Array<{
    id?: string;
    name?: string;
    instagram_business_account?: { id?: string };
  }>;
};

type IgProfileResponse = {
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
};

type IgMediaResponse = {
  data?: Array<{
    id?: string;
    caption?: string;
    media_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
  }>;
};

export class InstagramAdapter extends OAuthFormAdapter implements SocialProviderAdapter {
  readonly provider = "INSTAGRAM" as const;
  readonly canReadPosts = true;

  /**
   * Facebook accepts the credentials either way; the base-class `body` style is used because
   * Facebook's own examples send them as query/form fields.
   */
  protected readonly clientAuth = "body" as const;

  getAuthorizationUrl(input: {
    config: SocialProviderConfig;
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.config.clientId,
      redirect_uri: input.redirectUri,
      // Facebook uses `state` for CSRF but has no PKCE for this flow; the parameter is simply
      // not sent when no challenge exists.
      state: input.state,
      response_type: "code",
      scope: input.config.scopes.join(","),
    });
    return `${input.config.authorizationEndpoint}?${params.toString()}`;
  }

  async handleCallback(input: {
    config: SocialProviderConfig;
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
  }): Promise<{ account: ExternalAccount; tokens: ReturnType<OAuthFormAdapter["tokensFrom"]> }> {
    /**
     * Facebook's token endpoint takes the code as query parameters on a GET-shaped exchange,
     * but accepts the same fields as a form POST, which is what the base class sends.
     */
    const tokens = await this.exchangeCode({
      config: input.config,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      // Facebook long-lived tokens can be exchanged again on expiry, but a token without a
      // refresh path would die in ~60 days with no renewal. Requiring one makes that visible
      // at connect time.
      requireRefreshToken: false,
    });
    const account = await this.getAccount({ config: input.config, accessToken: tokens.accessToken });
    return { account, tokens };
  }

  async refreshToken(input: { config: SocialProviderConfig; refreshToken: string }) {
    /**
     * Facebook has no `grant_type=refresh_token`. It exchanges a still-valid token for a
     * long-lived one through `fb_exchange_token`, which is why this adapter overrides the
     * shared refresh rather than calling it.
     */
    const payload = await providerRequest<TokenResponse>(input.config.tokenEndpoint, {
      query: {
        grant_type: "fb_exchange_token",
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        fb_exchange_token: input.refreshToken,
      },
    }).catch((error: unknown) => {
      if (error instanceof SocialProviderError) {
        throw new SocialProviderError(
          "SOCIAL_TOKEN_REFRESH_FAILED",
          "The stored authorization is no longer valid",
          error.detail,
        );
      }
      throw error;
    });
    return this.tokensFrom(payload as unknown as Record<string, unknown>);
  }

  /**
   * Resolves the Instagram account behind the member's first Facebook Page.
   *
   * A member may hold several pages; the first with a linked Instagram account is used. An
   * account chooser would be the complete answer, and the schema already stores one row per
   * platform, so the honest simplification is stated here rather than hidden: a member with
   * two Instagram-linked pages gets the first.
   */
  async getAccount(input: { config: SocialProviderConfig; accessToken: string }): Promise<ExternalAccount> {
    const accounts = await providerRequest<AccountsResponse>(`${GRAPH}/me/accounts`, {
      query: { fields: "id,name,instagram_business_account", access_token: input.accessToken },
    });

    const page = (accounts.data ?? []).find((entry) => entry.instagram_business_account?.id);
    const igId = page?.instagram_business_account?.id;
    if (!igId) {
      throw new SocialProviderError(
        "SOCIAL_PERMISSION_DENIED",
        "No Instagram Business or Creator account is linked to a Facebook Page on this login",
        "me/accounts returned no instagram_business_account",
      );
    }

    const profile = await providerRequest<IgProfileResponse>(`${GRAPH}/${igId}`, {
      query: { fields: "id,username,name,profile_picture_url", access_token: input.accessToken },
    });

    return {
      providerUserId: igId,
      handle: profile.username ?? null,
      displayName: profile.name ?? profile.username ?? null,
      avatarUrl: profile.profile_picture_url ?? null,
    };
  }

  async getRecentPosts(input: {
    config: SocialProviderConfig;
    accessToken: string;
    providerUserId: string;
    limit: number;
  }): Promise<ExternalPost[]> {
    const wanted = Math.min(Math.max(input.limit, 1), 25);

    const media = await providerRequest<IgMediaResponse>(`${GRAPH}/${input.providerUserId}/media`, {
      query: {
        fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
        limit: wanted,
        access_token: input.accessToken,
      },
    });

    return (media.data ?? [])
      .map((item): ExternalPost | null => {
        if (!item.id) return null;
        const publishedAt = item.timestamp ? new Date(item.timestamp) : null;
        if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

        const isVideo = item.media_type === "VIDEO";
        const isCarousel = item.media_type === "CAROUSEL_ALBUM";

        return {
          provider: "INSTAGRAM",
          externalPostId: item.id,
          externalUrl: item.permalink ?? `https://www.instagram.com/p/${item.id}/`,
          authorId: input.providerUserId,
          authorName: null,
          authorAvatar: null,
          text: item.caption?.trim() || null,
          title: null,
          mediaType: isVideo ? "VIDEO" : isCarousel ? "IMAGE" : item.media_type === "IMAGE" ? "IMAGE" : "TEXT",
          // A video's `media_url` is the video file and its `thumbnail_url` is the still; the
          // card wants the still, so they are not interchangeable here.
          thumbnailUrl: isVideo ? (item.thumbnail_url ?? null) : (item.media_url ?? null),
          mediaUrl: null,
          embedUrl: null,
          publishedAt,
          raw: item,
        };
      })
      .filter((post): post is ExternalPost => post !== null)
      .slice(0, wanted);
  }

  async revoke(input: { config: SocialProviderConfig; accessToken: string }): Promise<void> {
    /**
     * `me/permissions` DELETE revokes the whole grant for this application, which is what
     * unbinding means. Facebook returns `{success: true}` rather than an empty body.
     */
    await providerRequest<unknown>(`${GRAPH}/me/permissions`, {
      method: "POST",
      query: { access_token: input.accessToken },
    });
  }
}
