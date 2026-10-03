import { SocialProviderError, type ExternalAccount, type ExternalPost } from "../external-post";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import type { SocialProviderConfig } from "../social-sync.config";
import { OAuthFormAdapter } from "./oauth-form.adapter";
import { providerRequest } from "./http";

/**
 * TikTok, through the official Display API.
 *
 * ## The client credential is called a "key" here
 *
 * TikTok's console issues a *client key* and a *client secret*, and the token endpoint expects
 * the form field `client_key`. The environment variables follow that naming
 * (`SOCIAL_TIKTOK_CLIENT_KEY`) so an operator copying from the console does not have to
 * translate, and this adapter sends `client_key` rather than `client_id`.
 *
 * ## Why `video.list` needs approval
 *
 * The scope is available only to an application that has passed TikTok's review; before that,
 * a sandbox application can read only the accounts explicitly added to the sandbox. So the
 * code path is complete, and whether it returns data depends on the application's status —
 * which is why the config reports TikTok as `REQUIRES_APPROVAL` rather than
 * `NOT_CONFIGURED`: adding credentials does not make it work on its own.
 *
 * ## Why the response envelope is unwrapped here
 *
 * TikTok answers `200` with `{"error": {"code": "..."}}` for some refusals, so a status-code
 * check alone would treat an error as success and produce a post-less sync with no
 * explanation. Every response goes through `unwrap`.
 *
 * ## NOT VERIFIED against a live API
 *
 * No TikTok developer credentials exist for this deployment and the application has not been
 * reviewed. Request shapes follow the published Display API reference; no call in this file
 * has been executed.
 */

const API = "https://open.tiktokapis.com/v2";

type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

/**
 * Turns TikTok's in-body error into a thrown code.
 *
 * `ok` is the success value; anything else is a refusal. The providers' own message is kept
 * as `detail` for the log and never placed in `message`.
 */
function unwrap<T>(envelope: Envelope<T>): T {
  const code = envelope.error?.code;
  if (code && code !== "ok") {
    const mapped =
      code === "access_token_invalid" || code === "access_token_expired"
        ? "SOCIAL_TOKEN_EXPIRED"
        : code === "scope_not_authorized" || code === "scope_permission_missed"
          ? "SOCIAL_PERMISSION_DENIED"
          : code === "rate_limit_exceeded"
            ? "SOCIAL_RATE_LIMITED"
            : "SOCIAL_PROVIDER_ERROR";
    throw new SocialProviderError(mapped, `TikTok refused the request (${code})`, envelope.error?.message);
  }
  if (!envelope.data) {
    throw new SocialProviderError("SOCIAL_PROVIDER_ERROR", "TikTok returned no data");
  }
  return envelope.data;
}

export class TiktokAdapter extends OAuthFormAdapter implements SocialProviderAdapter {
  readonly provider = "TIKTOK" as const;
  readonly canReadPosts = true;

  /**
   * `body`, not `basic`.
   *
   * TikTok accepts the key and secret as form fields; sending them as HTTP Basic as well
   * would be a second, undocumented authentication attempt on the same request.
   */
  protected readonly clientAuth = "body" as const;

  /** TikTok's token endpoint wants `client_key`, where the base class would send `client_id`. */
  protected extraTokenFields(config: SocialProviderConfig): Record<string, string> {
    return { client_key: config.clientId };
  }

  /** Suppresses the base class's `client_id`, which TikTok does not recognise. */
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
     * TikTok uses `client_key` in the query string too, and requires the scopes
     * comma-separated rather than space-separated.
     */
    const params = new URLSearchParams({
      client_key: input.config.clientId,
      response_type: "code",
      scope: input.config.scopes.join(","),
      redirect_uri: input.redirectUri,
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
      // `offline.access` equivalent: TikTok issues a refresh token only with the
      // `user.info.basic` + refresh-enabled application, so a connection without one cannot
      // outlive its access token.
      requireRefreshToken: true,
    });
    const account = await this.getAccount({ config: input.config, accessToken: tokens.accessToken });
    return { account, tokens };
  }

  async refreshToken(input: { config: SocialProviderConfig; refreshToken: string }) {
    return this.refresh(input);
  }

  async getAccount(input: { config: SocialProviderConfig; accessToken: string }): Promise<ExternalAccount> {
    const envelope = await providerRequest<Envelope<{ user?: { open_id?: string; display_name?: string; avatar_url?: string; union_id?: string } }>>(
      `${API}/user/info/`,
      {
        query: { fields: "open_id,union_id,display_name,avatar_url" },
        headers: { Authorization: `Bearer ${input.accessToken}` },
      },
    );
    const data = unwrap(envelope);
    const user = data.user;
    if (!user?.open_id) {
      throw new SocialProviderError("SOCIAL_PROVIDER_ERROR", "TikTok returned no account identity");
    }

    return {
      // `open_id` is per-application, which is the correct key here: two different apps see
      // different open_ids for the same person, and this row belongs to this application.
      providerUserId: user.open_id,
      handle: null,
      displayName: user.display_name ?? null,
      avatarUrl: user.avatar_url ?? null,
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
      Envelope<{
        videos?: Array<{
          id?: string;
          title?: string;
          video_description?: string;
          create_time?: number;
          cover_image_url?: string;
          share_url?: string;
          duration?: number;
        }>;
      }>
    >(`${API}/video/list/`, {
      method: "POST",
      query: { fields: "id,title,video_description,create_time,cover_image_url,share_url,duration" },
      json: { max_count: wanted },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const videos = unwrap(envelope).videos ?? [];

    return videos
      .map((video): ExternalPost | null => {
        if (!video.id) return null;
        // TikTok reports `create_time` in seconds since the epoch.
        const publishedAt = video.create_time ? new Date(video.create_time * 1000) : null;
        if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

        return {
          provider: "TIKTOK",
          externalPostId: video.id,
          externalUrl: video.share_url ?? `https://www.tiktok.com/@me/video/${video.id}`,
          authorId: input.providerUserId,
          authorName: null,
          authorAvatar: null,
          text: video.video_description?.trim() || null,
          title: video.title?.trim() || null,
          mediaType: "VIDEO",
          thumbnailUrl: video.cover_image_url ?? null,
          // The Display API returns no downloadable media URL, and TikTok's terms require the
          // embed. Left null deliberately.
          mediaUrl: null,
          embedUrl: video.share_url ?? null,
          publishedAt,
          raw: video,
        };
      })
      .filter((post): post is ExternalPost => post !== null)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, wanted);
  }

  async revoke(input: { config: SocialProviderConfig; accessToken: string }): Promise<void> {
    const { form } = this.withClientAuth(input.config, { token: input.accessToken });
    await providerRequest<unknown>(`${API}/oauth/revoke/`, { method: "POST", form });
  }
}
