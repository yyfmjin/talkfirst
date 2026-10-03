import type { SocialProviderId } from "./social-sync.config";

/**
 * The provider-neutral shape every adapter must produce.
 *
 * ## Why this exists at all
 *
 * Each platform returns a different payload for "a post": YouTube has `snippet.title` and
 * `contentDetails`, X has `text` and `attachments`, TikTok has `video_description` and
 * `cover_image_url`. If those shapes reached the database, the sync logic, the API and the
 * UI would each need a branch per platform — which is exactly the `if (provider === …)`
 * tower the adapter architecture exists to prevent.
 *
 * Normalising at the boundary means downstream code is written once. Every field below is
 * either filled or explicitly `null`; no adapter is allowed to leave a field `undefined`,
 * because `undefined` and "the provider did not supply this" must not be distinguishable
 * later.
 *
 * ## Field notes
 *
 * `externalPostId` is the provider's own id for the post and is the deduplication key.
 * It must be stable across syncs — an adapter that returns a different id for the same
 * post creates a duplicate every run.
 *
 * `embedUrl` is preferred over `mediaUrl` wherever a provider offers one, because an embed
 * renders the provider's own player: nothing is copied, and the provider's terms and view
 * counts still apply. `mediaUrl` is therefore only populated when the provider's API
 * explicitly allows the media to be fetched.
 */
export type ExternalMediaKind = "TEXT" | "IMAGE" | "VIDEO" | "LINK";

export type ExternalPost = {
  provider: SocialProviderId;
  /** The provider's immutable id for this post. The dedup key. */
  externalPostId: string;
  /** The canonical public URL a member can open. */
  externalUrl: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  text: string | null;
  title: string | null;
  mediaType: ExternalMediaKind;
  thumbnailUrl: string | null;
  /**
   * A directly-fetchable media URL, only when the provider's API permits it.
   *
   * Never populated merely because a URL looks downloadable — see the import rules.
   */
  mediaUrl: string | null;
  /** The provider's own embeddable player URL, when it offers one. */
  embedUrl: string | null;
  publishedAt: Date;
  /** The provider's raw payload, for debugging and future re-normalisation. */
  raw: unknown;
};

/** The account a connection belongs to, as the provider describes it. */
export type ExternalAccount = {
  providerUserId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/**
 * Tokens as the provider issued them.
 *
 * `scope` is the granted set, which is NOT always the requested set: a member can decline
 * part of a consent screen, and some providers silently drop a scope. Storing what was
 * granted is what lets the app tell "you did not grant video access" from "your token
 * expired".
 */
export type ExternalTokens = {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  /** Absolute expiry, or null when the provider does not state one. */
  expiresAt: Date | null;
};

/** Everything a completed authorization yields. */
export type ExternalAuthorization = {
  account: ExternalAccount;
  tokens: ExternalTokens;
};

/** Raised by an adapter for anything the caller must translate into an error code. */
export class SocialProviderError extends Error {
  constructor(
    /** Stable, provider-neutral code — never a provider message. */
    readonly code:
      | "SOCIAL_AUTH_REQUIRED"
      | "SOCIAL_AUTH_FAILED"
      | "SOCIAL_TOKEN_EXPIRED"
      | "SOCIAL_TOKEN_REFRESH_FAILED"
      | "SOCIAL_PERMISSION_DENIED"
      | "SOCIAL_RATE_LIMITED"
      | "SOCIAL_PROVIDER_ERROR"
      | "SOCIAL_PROVIDER_NOT_SUPPORTED",
    message: string,
    /** Provider detail. Logged, never returned to a client. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SocialProviderError";
  }
}
