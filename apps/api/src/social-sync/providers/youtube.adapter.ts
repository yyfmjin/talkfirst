import { SocialProviderError, type ExternalPost } from "../external-post";
import type { SocialProviderAdapter } from "./social-provider.adapter";
import type { ExternalAccount, ExternalTokens } from "../external-post";
import type { SocialProviderConfig } from "../social-sync.config";
import { providerRequest } from "./http";

/**
 * YouTube, through the official Data API v3.
 *
 * ## What it reads
 *
 * The member's own uploads: `channels?mine=true` resolves the channel and its uploads
 * playlist, then `playlistItems` lists the newest entries and `videos` fills in the details
 * a card needs (title, description, thumbnail, publish date, duration).
 *
 * ## Why `mediaUrl` is always null
 *
 * YouTube's Terms of Service require playback through the embedded player, and the Data API
 * returns no downloadable media URL. So every post carries an `embedUrl` and no media URL —
 * which is also what the product's import rules want: prefer the embed, never copy media
 * merely because it is reachable.
 *
 * ## Why a 403 is not a re-authorization problem
 *
 * The most common 403 here is "YouTube Data API v3 has not been enabled for this project",
 * which no consent screen can fix. `http.ts` already maps 403 to `SOCIAL_PERMISSION_DENIED`
 * rather than `SOCIAL_TOKEN_EXPIRED` for exactly this reason, and the message a member sees
 * for it says the permission is missing rather than telling them to reconnect.
 *
 * ## Quota
 *
 * `playlistItems.list` costs 1 unit and `videos.list` costs 1 unit per call regardless of
 * how many ids it carries, so one sync of three posts is ~3 units against a 10 000/day
 * default. The ids are therefore fetched in one batched `videos.list`, not one call per
 * video.
 */

const API = "https://www.googleapis.com/youtube/v3";

/** Google's revocation endpoint, used so unbinding actually withdraws the grant. */
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type ChannelListResponse = {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};

type PlaylistItemsResponse = {
  items?: Array<{ contentDetails?: { videoId?: string } }>;
};

type YoutubeVideo = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
};

type VideoListResponse = {
  items?: YoutubeVideo[];
};

/** A thumbnail at a useful size, falling back down the sizes the API may return. */
function bestThumbnail(thumbnails: Record<string, { url?: string }> | undefined): string | null {
  if (!thumbnails) return null;
  for (const key of ["high", "medium", "standard", "maxres", "default"]) {
    const url = thumbnails[key]?.url;
    if (url) return url;
  }
  return null;
}

export class YoutubeAdapter implements SocialProviderAdapter {
  readonly provider = "YOUTUBE" as const;
  /** The only provider that is readable without a developer-programme approval. */
  readonly canReadPosts = true;

  getAuthorizationUrl(input: {
    config: SocialProviderConfig;
    state: string;
    codeChallenge: string | null;
    redirectUri: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.config.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: input.config.scopes.join(" "),
      state: input.state,
      /**
       * `offline` is what makes a refresh token be issued at all; without it Google returns
       * only an access token and the connection dies an hour later with no way to renew it.
       * `consent` forces the consent screen every time so a member who previously granted
       * only sign-in scopes is actually asked for the YouTube one — without it Google
       * silently reuses the old grant and the sync gets a token with no YouTube scope.
       */
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    if (input.codeChallenge) {
      params.set("code_challenge", input.codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${input.config.authorizationEndpoint}?${params.toString()}`;
  }

  private tokensFrom(payload: TokenResponse): ExternalTokens {
    if (!payload.access_token) {
      throw new SocialProviderError("SOCIAL_AUTH_FAILED", "The provider returned no access token");
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? null,
      scope: payload.scope ?? null,
      // `expires_in` is seconds from now. Stored as an absolute instant so a later read
      // does not have to know when the token was issued.
      expiresAt:
        typeof payload.expires_in === "number" && payload.expires_in > 0
          ? new Date(Date.now() + payload.expires_in * 1000)
          : null,
    };
  }

  async handleCallback(input: {
    config: SocialProviderConfig;
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
  }): Promise<{ account: ExternalAccount; tokens: ExternalTokens }> {
    const form: Record<string, string> = {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
    };
    if (input.codeVerifier) form.code_verifier = input.codeVerifier;

    const payload = await providerRequest<TokenResponse>(input.config.tokenEndpoint, {
      method: "POST",
      form,
    });
    const tokens = this.tokensFrom(payload);
    const account = await this.getAccount({ config: input.config, accessToken: tokens.accessToken });
    return { account, tokens };
  }

  async refreshToken(input: { config: SocialProviderConfig; refreshToken: string }): Promise<ExternalTokens> {
    /**
     * Google does not return a new refresh token here, so the existing one is carried
     * forward by the caller. Returning `null` and letting the caller decide is deliberate:
     * overwriting a stored refresh token with null would silently break the connection on
     * the next refresh.
     */
    const payload = await providerRequest<TokenResponse>(input.config.tokenEndpoint, {
      method: "POST",
      form: {
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
      },
    }).catch((error: unknown) => {
      if (error instanceof SocialProviderError && error.code === "SOCIAL_TOKEN_EXPIRED") {
        // Google answers `invalid_grant` with 400 for a revoked or expired refresh token.
        throw new SocialProviderError(
          "SOCIAL_TOKEN_REFRESH_FAILED",
          "The stored authorization is no longer valid",
          error.detail,
        );
      }
      throw error;
    });

    return this.tokensFrom(payload);
  }

  async getAccount(input: { config: SocialProviderConfig; accessToken: string }): Promise<ExternalAccount> {
    const payload = await providerRequest<ChannelListResponse>(`${API}/channels`, {
      query: { part: "snippet,contentDetails", mine: "true" },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const channel = payload.items?.[0];
    if (!channel?.id) {
      /**
       * A Google account with no YouTube channel. That is a normal state, not a defect — but
       * it cannot be synced, so it is reported as a permission-style refusal rather than
       * stored as a connection whose every sync would return nothing.
       */
      throw new SocialProviderError(
        "SOCIAL_PERMISSION_DENIED",
        "This Google account has no YouTube channel",
        "channels.list returned no items",
      );
    }

    return {
      providerUserId: channel.id,
      handle: channel.snippet?.customUrl ?? null,
      displayName: channel.snippet?.title ?? null,
      avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null,
    };
  }

  async getRecentPosts(input: {
    config: SocialProviderConfig;
    accessToken: string;
    providerUserId: string;
    limit: number;
  }): Promise<ExternalPost[]> {
    const authorization = `Bearer ${input.accessToken}`;
    const uploadsPlaylist = await this.uploadsPlaylistId(input.accessToken, input.providerUserId);

    /**
     * `limit` bounds the request, not just the result: the member asked for at most three
     * posts, so asking for fifty and discarding forty-seven spends quota for nothing.
     */
    const wanted = Math.min(Math.max(input.limit, 1), 50);

    const playlist = await providerRequest<PlaylistItemsResponse>(`${API}/playlistItems`, {
      query: {
        part: "contentDetails",
        playlistId: uploadsPlaylist,
        maxResults: wanted,
        // Missing this returns the OLDEST items, which silently syncs a channel's first
        // uploads instead of its latest.
        order: "date",
      },
      headers: { Authorization: authorization },
    });

    const videoIds = (playlist.items ?? [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id))
      .slice(0, wanted);

    if (videoIds.length === 0) return [];

    // One batched call for every id: the cost is per call, not per id.
    const videos = await providerRequest<VideoListResponse>(`${API}/videos`, {
      query: { part: "snippet", id: videoIds.join(",") },
      headers: { Authorization: authorization },
    });

    return (videos.items ?? [])
      .map((video) => this.toExternalPost(video))
      .filter((post): post is ExternalPost => post !== null)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  /**
   * The uploads playlist, which is what actually lists a channel's videos.
   *
   * `channels.list` returns it as `contentDetails.relatedPlaylists.uploads`.
   * `playlistItems` cannot be asked "give me this channel's videos" — it needs a playlist id
   * — so this indirection is required.
   */
  private async uploadsPlaylistId(accessToken: string, providerUserId: string): Promise<string> {
    const payload = await providerRequest<ChannelListResponse>(`${API}/channels`, {
      query: { part: "contentDetails", id: providerUserId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const uploads = payload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (uploads) return uploads;

    /**
     * Documented fallback: a channel's uploads playlist id is its channel id with the `UC`
     * prefix replaced by `UU`. Used only when the API omitted the field, because guessing is
     * worse than asking — but the guess is exact for the id format YouTube defines, and
     * failing here would mean a channel that syncs nothing for no visible reason.
     */
    if (providerUserId.startsWith("UC")) return `UU${providerUserId.slice(2)}`;

    throw new SocialProviderError(
      "SOCIAL_PROVIDER_ERROR",
      "Could not resolve the channel's uploads playlist",
      `channel id ${providerUserId} did not yield an uploads playlist`,
    );
  }

  private toExternalPost(video: YoutubeVideo): ExternalPost | null {
    const id = video?.id;
    if (!id) return null;

    const snippet = video.snippet;
    const publishedAt = snippet?.publishedAt ? new Date(snippet.publishedAt) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;

    const description = snippet?.description?.trim() ?? "";

    return {
      provider: "YOUTUBE",
      externalPostId: id,
      externalUrl: `https://www.youtube.com/watch?v=${id}`,
      authorId: snippet?.channelId ?? null,
      authorName: snippet?.channelTitle ?? null,
      authorAvatar: null,
      // The description doubles as the body; a title-only card would lose the member's own
      // words, and a description-only card would lose the title. Both are kept.
      text: description.length > 0 ? description.slice(0, 4000) : null,
      title: snippet?.title ?? null,
      mediaType: "VIDEO",
      thumbnailUrl: bestThumbnail(snippet?.thumbnails),
      // Null on purpose: YouTube requires playback through its own player.
      mediaUrl: null,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      publishedAt,
      raw: video,
    };
  }

  async revoke(input: { config: SocialProviderConfig; accessToken: string }): Promise<void> {
    /**
     * Google revokes by token, not by client, and answers 200 with an empty body.
     *
     * A failure here is not fatal to unbinding: the local rows are removed regardless, and
     * the caller treats this as best-effort. That is the right order — refusing to unbind
     * because the provider was unreachable would trap the member in a connection they asked
     * to remove.
     */
    await providerRequest<unknown>(REVOKE_ENDPOINT, {
      method: "POST",
      form: { token: input.accessToken },
    });
  }
}
