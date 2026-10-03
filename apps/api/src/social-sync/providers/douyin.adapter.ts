import { SocialProviderError, type ExternalAccount, type ExternalPost } from "../external-post";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import type { SocialProviderConfig } from "../social-sync.config";
import { OAuthFormAdapter } from "./oauth-form.adapter";
import { providerRequest } from "./http";

/**
 * 抖音 (Douyin), through the official 开放平台 API.
 *
 * ## Why this is not the same adapter as TikTok
 *
 * They are different companies, different developer programmes and different endpoints, even
 * where the API shapes look similar. Sharing an adapter would mean a change for one platform
 * silently altering the other, and the two consoles issue different credential names —
 * 抖音 uses `client_key` and `client_secret`, and its user id field is `open_id`.
 *
 * ## Why `video.list` needs approval
 *
 * The scope is granted per application after 抖音's review of the developer account. Adding
 * credentials alone does not make it work, which is why the config reports `REQUIRES_APPROVAL`
 * rather than `NOT_CONFIGURED`.
 *
 * ## Why the envelope is unwrapped rather than checked by status
 *
 * 抖音 answers `200` with a `data.error_code` for most refusals, so a status check alone would
 * read a refusal as an empty success and produce a sync that silently returns nothing.
 *
 * ## NOT VERIFIED against a live API
 *
 * No 抖音 open-platform credentials exist for this deployment and the application has not been
 * reviewed. Request shapes follow the published 开放平台 documentation; no call in this file
 * has been executed.
 */

const API = "https://open.douyin.com";

type DouyinEnvelope<T> = {
  data?: T & { error_code?: number; description?: string };
  message?: string;
};

/**
 * Unwraps `data`, converting a non-zero `error_code` into a thrown code.
 *
 * `error_code: 0` is success. The specific numbers below are the documented ones that need a
 * different remedy; anything else is reported as a generic provider error rather than guessed
 * at.
 */
function unwrap<T>(envelope: DouyinEnvelope<T>): T {
  const data = envelope.data;
  const code = data?.error_code;
  if (typeof code === "number" && code !== 0) {
    const mapped =
      // 10008 / 2190008 — token invalid or expired.
      code === 10008 || code === 2190008
        ? "SOCIAL_TOKEN_EXPIRED"
        : // 2190003 — the scope was not granted.
          code === 2190003
          ? "SOCIAL_PERMISSION_DENIED"
          : code === 2190005
            ? "SOCIAL_RATE_LIMITED"
            : "SOCIAL_PROVIDER_ERROR";
    throw new SocialProviderError(mapped, `抖音拒绝了请求（错误码 ${code}）`, data?.description ?? envelope.message);
  }
  if (!data) {
    throw new SocialProviderError("SOCIAL_PROVIDER_ERROR", "抖音没有返回数据");
  }
  return data;
}

export class DouyinAdapter extends OAuthFormAdapter implements SocialProviderAdapter {
  readonly provider = "DOUYIN" as const;
  readonly canReadPosts = true;

  protected readonly clientAuth = "body" as const;

  /** 抖音 expects `client_key`, where the base class would send `client_id`. */
  protected extraTokenFields(config: SocialProviderConfig): Record<string, string> {
    return { client_key: config.clientId };
  }

  protected withClientAuth(
    config: SocialProviderConfig,
    form: Record<string, string>,
  ): { form: Record<string, string>; headers: Record<string, string> } {
    return { form: { ...form, client_key: config.clientId, client_secret: config.clientSecret }, headers: {} };
  }

  getAuthorizationUrl(input: {
    config: SocialProviderConfig;
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
  }): string {
    /**
     * 抖音's authorization page takes `client_key`, a comma-separated scope list, and the
     * state it will echo back. No PKCE: the platform does not document it for this flow.
     */
    const params = new URLSearchParams({
      client_key: input.config.clientId,
      response_type: "code",
      scope: input.config.scopes.join(","),
      redirect_uri: input.redirectUri,
      state: input.state,
    });
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
      // 抖音 issues a refresh token with `renew_refresh_token`; without one the connection
      // cannot outlive the access token, so its absence is a failure now rather than later.
      requireRefreshToken: true,
    });
    const account = await this.getAccount({ config: input.config, accessToken: tokens.accessToken });
    return { account, tokens };
  }

  async refreshToken(input: { config: SocialProviderConfig; refreshToken: string }) {
    return this.refresh(input);
  }

  async getAccount(input: { config: SocialProviderConfig; accessToken: string }): Promise<ExternalAccount> {
    const envelope = await providerRequest<
      DouyinEnvelope<{ open_id?: string; union_id?: string; nickname?: string; avatar?: string }>
    >(`${API}/oauth/userinfo/`, {
      query: { open_id: "self", access_token: input.accessToken },
    });

    const data = unwrap(envelope);
    if (!data.open_id) {
      throw new SocialProviderError("SOCIAL_PROVIDER_ERROR", "抖音没有返回账号标识");
    }

    return {
      // `open_id` is per-application, which is the correct key for this row.
      providerUserId: data.open_id,
      handle: null,
      displayName: data.nickname ?? null,
      avatarUrl: data.avatar ?? null,
    };
  }

  async getRecentPosts(input: {
    config: SocialProviderConfig;
    accessToken: string;
    providerUserId: string;
    limit: number;
  }): Promise<ExternalPost[]> {
    const wanted = Math.min(Math.max(input.limit, 1), 20);

    const envelope = await providerRequest<
      DouyinEnvelope<{
        list?: Array<{
          item_id?: string;
          title?: string;
          cover?: string;
          share_url?: string;
          create_time?: number;
          video_status?: number;
        }>;
      }>
    >(`${API}/video/list/`, {
      method: "POST",
      query: { open_id: input.providerUserId, access_token: input.accessToken },
      json: { cursor: 0, count: wanted },
    });

    const items = unwrap(envelope).list ?? [];

    return items
      .map((item): ExternalPost | null => {
        if (!item.item_id) return null;
        /**
         * `video_status !== 0` means the video is not publicly visible yet (still processing,
         * or the member set it private). Including it would put a post on the profile that
         * nobody — including its author — can open.
         */
        if (typeof item.video_status === "number" && item.video_status !== 0) return null;

        const publishedAt = item.create_time ? new Date(item.create_time * 1000) : null;
        if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

        return {
          provider: "DOUYIN",
          externalPostId: item.item_id,
          externalUrl: item.share_url ?? `https://www.douyin.com/video/${item.item_id}`,
          authorId: input.providerUserId,
          authorName: null,
          authorAvatar: null,
          text: item.title?.trim() || null,
          title: item.title?.trim() || null,
          mediaType: "VIDEO",
          thumbnailUrl: item.cover ?? null,
          // 抖音's terms require playback through its own client; no media URL is stored.
          mediaUrl: null,
          embedUrl: item.share_url ?? null,
          publishedAt,
          raw: item,
        };
      })
      .filter((post): post is ExternalPost => post !== null)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, wanted);
  }

  async revoke(input: { config: SocialProviderConfig; accessToken: string }): Promise<void> {
    await providerRequest<unknown>(`${API}/oauth/revoke/`, {
      method: "POST",
      query: { access_token: input.accessToken },
    });
  }
}
