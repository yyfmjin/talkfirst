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

/**
 * 登录 / 注册 / 刷新的响应信封（**未拆封**的那一层）。
 *
 * token 在信封**顶层**，和 `data` 平级；`data` 里只有用户对象。
 * 这个区别曾经让 App「登录成功却停在登录页」：`signIn` 用会拆信封的 `apiFetch`
 * 取它，拿到的其实是用户对象，`accessToken` 成了 `undefined`。
 * 取信封必须用 `apiFetchEnvelope`。
 */
export type AuthSession = {
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
 * 一条评论。与 web 端 `MomentComment` 同形：顶层评论带 `replies`（一层嵌套），
 * 回复里不再有 `replies`。
 */
export type MomentComment = {
  id: string;
  content: string;
  createdAt: string;
  /** 顶层评论为 null；嵌套回复里无此字段。 */
  parentCommentId?: string | null;
  user: { id: string; nickname: string | null; avatarUrl: string | null };
  replies?: MomentComment[];
};

/** 评论分页（`GET /moments/:id/comments` 的返回）。 */
export type CommentPage = {
  items: MomentComment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * 视频流的一页。
 *
 * `exhausted` = 「库里的视频已经翻完了」：客户端应当从头循环，而不是继续拉取
 * （服务端的 `exclude` 只认最后 50 个 id）。
 */
export type VideoFeedPage = { items: Moment[]; exhausted: boolean };

/* ─────────────────── 资料完善：语言 / 兴趣 / 交友目的 / 国家 ─────────────────── */

/** `GET /meta/languages` 的一项。 */
export type LanguageOption = { code: string; name: string; nativeName: string | null };
/** `GET /meta/interests` 的一项。 */
export type InterestOption = { id: string; slug: string; name: string; nameZh: string | null; category: string };
/** `GET /meta/purposes` 的一项。 */
export type PurposeOption = { slug: string; name: string; nameZh: string | null };
/** `GET /meta/countries` 的一项。 */
export type CountryOption = { code: string; name: string; flag: string | null };

/** `GET /users/me` 里「资料完善」相关的字段（与 web 的 FullCard 同形）。 */
export type ProfileFullCard = {
  languages: Array<{ code: string; type: string; level: string }>;
  interests: Array<{ slug: string }>;
  purposes: Array<{ slug: string }>;
  preferredCountries: Array<{ code: string }>;
};

/* ─────────────────── 我的：连接 / 社交账号 / 可见范围 / 安全中心 ─────────────────── */

/** `GET /connections` 的一项（镜像 web 的 /connections 页）。 */
export type ConnectionItem = {
  id: string;
  conversationId: string | null;
  createdAt: string;
  exchange: {
    id: string;
    status: string;
    platforms: string[];
    requesterId: string;
    receiverId: string;
    updatedAt: string;
  } | null;
  peer: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    countryCode: string | null;
    bio: string | null;
    lastActiveAt: string | null;
    interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  };
};

/** `GET /social-sync/providers` 的一项。 */
export type SocialSyncProvider = {
  provider: string;
  label: string;
  availability: "AVAILABLE" | "REQUIRES_APPROVAL" | "NOT_CONFIGURED";
  canReadPosts: boolean;
};

/** `GET /social-sync/accounts` 的一项。 */
export type SocialSyncAccount = {
  id: string;
  provider: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  syncLimit: number;
  syncEnabled: boolean;
  status: "ACTIVE" | "NEEDS_REAUTH" | "REVOKED";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

/** 好友可见的社交账号（老功能，只读展示）。 */
export type SharedBinding = {
  platform: string;
  handle: string;
  displayName: string | null;
  syncEnabled: boolean;
};

export type VisibilityTier = "PUBLIC" | "CONNECTIONS" | "PRIVATE";

/* ───────────────────────── 交友属性 ───────────────────────── */

export type AttributeKind = "ABOUT_ME" | "LOOKING_FOR";
export type AttributeSource = "SYSTEM" | "CUSTOM";

/** 一条已选属性。与 web `@/lib/profile` 的 `AttributeView` 同形（API 投影结果）。 */
export type AttributeView = {
  id: string;
  kind: AttributeKind;
  source: AttributeSource;
  definitionId: string | null;
  /** 目录 key，仅 SYSTEM 行有。 */
  key: string | null;
  category: string | null;
  label: string;
  labelZh: string | null;
  value: string | null;
  visibility: VisibilityTier;
  sortOrder: number;
  reviewStatus: string;
  /** null=自定义；false=系统标签已停用（仍要展示，只是不能再选）。 */
  definitionActive: boolean | null;
  createdAt: string;
  updatedAt: string;
};

export type AttributeGroups = {
  aboutMe: AttributeView[];
  lookingFor: AttributeView[];
};

/** `GET /meta/attributes` 的一项（原始 AttributeDefinition 模型）。 */
export type AttributeDefinition = {
  id: string;
  key: string;
  scope: AttributeSource;
  kind: AttributeKind;
  category: string;
  label: string;
  labelZh: string | null;
  valueType: string;
  sort: number;
  isActive: boolean;
  isSearchable: boolean;
};

/**
 * 资料可见范围的 13 个白名单字段。
 * 必须与服务端 `PROFILE_VISIBILITY_FIELD_WHITELIST`（apps/api/src/users/
 * profile-visibility.constants.ts）保持一致 —— 不在名单里的字段服务端回 400。
 */
export type ProfileVisibilityField =
  | "nickname"
  | "avatarUrl"
  | "birthDate"
  | "countryCode"
  | "city"
  | "region"
  | "gender"
  | "bio"
  | "languages"
  | "interests"
  | "purposes"
  | "preferredCountries"
  | "attributes";

/** `GET /users/me/profile-field-visibility` 的一项。 */
export type FieldVisibilityRow = {
  fieldKey: ProfileVisibilityField;
  visibility: VisibilityTier;
};

/** `GET /blocks` 的一项。 */
export type BlockItem = {
  blockedId: string;
  blocked: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  createdAt: string;
};

/** `GET /reports/mine` 的一项。 */
export type ReportItem = {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  reportedUser: { id: string; nickname: string | null };
};

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
