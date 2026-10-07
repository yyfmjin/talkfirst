/**
 * Shared API types for the mobile client.
 *
 * These mirror the web client's contracts (apps/web/src/lib) and the API's
 * response envelopes. Only the fields the mobile MVP renders are described;
 * the server already applies privacy projection before these reach a client.
 */

export type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: string | null;
  countryCode: string | null;
  countryName?: string | null;
  countryFlag?: string | null;
  city: string | null;
  region: string | null;
  gender: string | null;
  bio: string | null;
  profileCompleted: boolean;
  isAdmin?: boolean;
  status?: string;
};

export type PublicProfile = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  age: number | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  city: string | null;
  region: string | null;
  gender: string | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  relationship: { isSelf: boolean; isConnected: boolean };
};

export type Recommendation = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  age: number | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  matchScore: number;
  matchReasons: string[];
};

export type RecommendationResponse = {
  items: Recommendation[];
  limit: number;
  used: number;
  remaining: number;
  filter?: string;
};

export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  /** 合并了几条（目前只有聊天消息会 > 1）：未读期间同一会话只占一行。 */
  count: number;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NotificationRecord[];
  unread: number;
  nextCursor: string | null;
};

export type AuthSession = {
  success: boolean;
  data: SessionUser;
  accessToken: string;
  refreshToken: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: Record<string, string[]>;
};

/* ──────────────────────────── 动态 / 视频流 ──────────────────────────── */

/** 动态作者。与 `PublicProfile` 里同一个人的最小形状。 */
export type MomentAuthor = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
};

/**
 * 一条动态。**与 web 端同形**：服务端在 `MomentsService.feedItem()` 里统一投影，
 * `feed` 与 `videoFeed`（视频流）共用那一份 —— 所以这里的字段也就是视频流的字段。
 */
export type Moment = {
  id: string;
  userId: string;
  author: MomentAuthor;
  platform: string;
  platformName: string | null;
  content: string;
  images: string[];
  videoUrl: string | null;
  durationSec: number | null;
  tags: string[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  bookmarked: boolean;
  source: string;
  isDemo: boolean;
  syncedAt: string | null;
  createdAt: string;
};

export type MomentPage = { items: Moment[]; nextCursor: string | null };

/**
 * 视频流的一页。
 *
 * `exhausted` = 「库里的视频已经翻完了」：客户端应当从头循环，而不是继续拉取
 * （服务端的 `exclude` 只认最后 50 个 id）。
 */
export type VideoFeedPage = { items: Moment[]; exhausted: boolean };

/* ──────────────────────────────── 聊天 ──────────────────────────────── */

export type ConversationItem = {
  id: string;
  connectionId: string | null;
  updatedAt: string;
  unreadCount?: number;
  peer: MomentAuthor | null;
  lastMessage: { content: string; senderId: string; createdAt: string } | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
};

/** `GET /conversations/:id/messages`：**最旧在前**，`nextCursor` 指向更早的一页。 */
export type MessagePage = { items: ChatMessage[]; nextCursor: string | null };
