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
  /** 我给他送过花没有；以及他收到的花总数（与 web 同一份服务端字段）。 */
  flowerFromViewer?: boolean;
  flowerCount?: number;
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

/** `GET /auth/oauth/me/methods` 的返回：账号有哪些登录方式。 */
export type AccountLoginMethods = {
  hasPassword: boolean;
  providers: string[];
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
  /** 语音动态（2026-10-24）：与 videoUrl 并列，最多一段录音。 */
  audioUrl: string | null;
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

/** `GET /connections/requests/incoming` 的一项（有人给你打了招呼，等你接受）。 */
export type IncomingRequest = {
  id: string;
  message: string | null;
  status: string;
  createdAt: string;
  sender: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    countryCode: string | null;
  } | null;
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
  /**
   * 会话种类：`DIRECT`（真人，默认）或 `AI`（与 AI 朋友）。
   *
   * `AI` 的会话不能当普通会话用：它的消息只走 `/ai-companion`，
   * 走 `/conversations/:id/messages` 会被服务端 404 CONVERSATION_NOT_FOUND。
   */
  type?: string;
  /** AI 会话里那个朋友的名字（列表顶部拿它当标题）。 */
  aiCompanionName?: string | null;
  connectionId: string | null;
  updatedAt: string;
  unreadCount?: number;
  peer: MomentAuthor | null;
  /**
   * `type` 可选：图片消息的 `content` 是图片 URL（不能当预览显示），
   * 列表要按 `type` 决定预览文案（见 `MessagesScreen.previewText`）。
   * 可选是为了兼容历史上没有这个字段的服务端响应，缺失时按文本处理。
   */
  lastMessage: { content: string; senderId: string; createdAt: string; type?: string } | null;
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

/* ──────────────────────── 某个人的动态（/moments/user/:id） ──────────────────────── */

/**
 * `GET /moments/user/:id` 里的一条。
 *
 * 与 feed 的 `Moment` **只差一个字段**：这里没有嵌套的 `author`，作者在响应的外层
 * （这一页所有的动态都是同一个人的）。服务端的 `userMoments()` 就是这么投影的 ——
 * 所以这里用 `Omit` 把差异写在类型上，而不是另抄一份字段清单。
 */
export type UserMomentItem = Omit<Moment, "author">;

/**
 * `GET /moments/user/:id` 的完整响应。
 *
 * `locked`：对方把动态设成了「仅连接 / 不公开」，服务端不会给条目 —— 这不是空列表，
 * 而是「看不到」，两者在界面上必须说不同的话。
 */
export type UserMomentsDetail = {
  author: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    countryCode: string | null;
    bio: string | null;
  };
  setting: { visibleTo: string };
  bindings: Array<{
    platform: string;
    handle: string;
    displayName: string | null;
    syncEnabled: boolean;
  }>;
  items: UserMomentItem[];
  nextCursor: string | null;
  locked: boolean;
};

/* ──────────────────────── 动态设置（/moments/settings） ──────────────────────── */

/** `GET /moments/platforms`：可绑定平台清单（服务端写死的常量）。 */
export type MomentPlatform = {
  id: string;
  label: string;
  /** 平台自带的两个字母缩写（IG / X / TT …），用作色块里的字。 */
  icon: string;
  color: string;
  /** 未绑定时那句占位说明（如「已连接用户主页」）。 */
  connectedLabel: string;
};

/** `GET /moments/bindings` 里的一条（服务端直接回数据库行，这里只取用得到的字段）。 */
export type MomentPlatformBinding = {
  platform: string;
  handle: string;
  displayName: string | null;
  syncEnabled: boolean;
};

/** `GET /moments/settings`：服务端不会回 null，首次读取时会建一行默认值。 */
export type MomentSettings = {
  syncEnabled: boolean;
  visibleTo: string;
  filterSensitive: boolean;
  showPhotos: boolean;
  showVideos: boolean;
  showTexts: boolean;
  showReels: boolean;
  showLives: boolean;
};

/* ───────────────────── 联系方式交换（/conversations/:id/exchange） ───────────────────── */

/** `GET /exchange/platforms`：可交换的平台清单。 */
export type ExchangePlatformOption = { id: string; label: string };

/** 交换申请/已交换里的一条。方向靠 `requesterId` 判，不靠文案猜。 */
export type ExchangeItem = {
  id: string;
  connectionId: string;
  conversationId: string;
  requesterId: string;
  receiverId: string;
  /** 服务端已经把枚举换成 `{ id, label }`，客户端不再自己维护平台中英文名。 */
  platforms: ExchangePlatformOption[];
  message: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  requester?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  receiver?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
};

/**
 * `GET /conversations/:id/exchange` —— 这一页的全部依据。
 *
 * `eligible` 是服务端算好的（聊够 `requiredMessages` 条且还没有任何交换），客户端
 * **不要自己用 `messageCount >= requiredMessages` 重新算一遍**：门槛变了、或者服务端
 * 加了一条不公开的条件，自算的那版就成了一个能点下去、但会被拒的按钮。
 */
export type ExchangeEligibility = {
  conversationId: string;
  connectionId: string;
  messageCount: number;
  requiredMessages: number;
  eligible: boolean;
  pending: ExchangeItem[];
  exchanged: ExchangeItem[];
  /** 我在「我的」里已经绑过的平台（没绑的平台交换了也给不出账号）。 */
  myAccounts: Array<{ platform: string; label: string; handle: string }>;
};

/** 对方已经交换给我的账号。 */
export type SharedContact = {
  userId: string;
  nickname: string | null;
  platform: string;
  label: string;
  handle: string;
};
