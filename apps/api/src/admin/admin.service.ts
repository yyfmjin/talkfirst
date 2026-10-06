import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { SocialPlatform } from "@prisma/client";
import type {
  ConnectionStatus,
  ExchangeStatus,
  Prisma,
  ReportStatus,
  UserStatus,
} from "@prisma/client";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeIp } from "../security/client-ip";
import { normalizeChannelFilter } from "../security/access-channel";
/**
 * A VALUE import, and that is load-bearing.
 *
 * This was `import type { IpBanService }`, which produces no runtime reference —
 * so TypeScript emitted `Function` as this constructor parameter's metadata, and
 * Nest could not resolve it:
 *
 *   Nest can't resolve dependencies of the AdminService (PrismaService,
 *   NotificationService, ?). Please make sure that the argument Function at
 *   index [2] is available in the AdminModule module.
 *
 * The API therefore refused to boot at all (found 2026-10-04, while starting the
 * Playwright servers). Note that `?:` does NOT make a dependency optional for
 * Nest — only `@Optional()` does — so the optional-looking parameter still had to
 * resolve. SecurityModule is `@Global()` and exports this service, so a value
 * import is all it takes.
 *
 * Worth remembering for any injected dependency: `import type` is for types the
 * DI container never sees. It is checked by neither `tsc --noEmit` nor `next
 * build`, which is why this reached a pushed commit.
 */
import { IpBanService } from "../security/ip-ban.service";
import { isProfileComplete, profileCompletionOf } from "../users/profile-completion";
// The same keyword parser the discovery feed matches with, so the value an administrator
// saves is byte-for-byte the value matching consumes.
import { parseCategoryKeywords } from "../discover/discover.service";
import type { ResolvedAdmin } from "./admin.guard";
import { canSetUserStatus, permissionsForRole, type UserStatusAction } from "./permissions";

/**
 * Query parameters for `GET /admin/users`.
 *
 * Phase B2 widened this from `{ q, status, page, pageSize }`. `q` is kept and
 * still works — it is the parameter every pre-B2 caller sends — while `search`
 * is the preferred name and wins when both are present.
 */
export type AdminListQuery = {
  /** Legacy keyword parameter. Still honoured; `search` takes precedence. */
  q?: string;
  /** Phase B2: unified keyword — email, nickname, or an exact user id. */
  search?: string;
  status?: string;
  /** Phase B2: exact `User.countryCode` match, e.g. `US`. */
  country?: string;
  /** Phase B2: inclusive lower bound on `User.createdAt` (ISO 8601). */
  createdFrom?: string;
  /** Phase B2: inclusive upper bound on `User.createdAt` (ISO 8601). */
  createdTo?: string;
  /** Phase B2: one of `USER_SORT_ORDERS`. Never passed to Prisma verbatim. */
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Phase B4: the reports-queue query.
 *
 * Note there is no `sort`. The list has always been `createdAt DESC` and B4
 * adds no ordering parameter — a queue is read newest-first, and inventing sort
 * keys nothing asked for would be surface area with no caller.
 */
export type AdminReportListQuery = {
  status?: string;
  /** Exact, case-insensitive `Report.reason`. Free-form column, not an enum. */
  reason?: string;
  /** Derived: `USER` = no messageId, `MESSAGE` = has messageId. */
  targetType?: string;
  /** UUID (exact id) or free text (email / nickname contains). */
  reporter?: string;
  /** UUID (exact id) or free text (email / nickname contains). */
  reportedUser?: string;
  /** Inclusive lower bound on `Report.createdAt` (ISO 8601). */
  createdFrom?: string;
  /** Inclusive upper bound on `Report.createdAt` (ISO 8601). */
  createdTo?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Phase C2: the connections-list query.
 *
 * `user` is **one** parameter, not a `userA` + `userB` pair, because a
 * `Connection` has no notion of which side a given person is on: `userAId` is
 * whichever of the two ids sorts lower (`connections.service.ts` line 228
 * writes `[senderId, receiverId].sort()`). So filtering by person is
 * inherently "either side", and exposing two separate parameters would invite a
 * caller to believe the sides carry meaning they do not.
 *
 * `status` and `user` follow the existing per-parameter policy: an unusable
 * value is ignored (`status`) or degrades to a text search (`user`), while
 * dates are **400** when malformed. That split is inherited, not invented.
 *
 * `sort` exists here, unlike on the reports queue, because a connection list is
 * genuinely browsed in two ways — "newest first" and "who are these two" — and
 * a viewer looking for a specific pair reads the nickname columns.
 */
export type AdminConnectionListQuery = {
  /** `ACTIVE` or `REMOVED`. Anything else is ignored, matching B2/B4. */
  status?: string;
  /** UUID (exact id of either party) or free text (nickname contains). */
  user?: string;
  /** Inclusive lower bound on `Connection.createdAt` (ISO 8601). */
  createdFrom?: string;
  /** Inclusive upper bound on `Connection.createdAt` (ISO 8601). */
  createdTo?: string;
  /** One of `CONNECTION_SORT_ORDERS`. Never passed to Prisma verbatim. */
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Phase C3: the contact-exchange list query.
 *
 * `user` is **one** parameter, not a `requester` + `receiver` pair. An
 * `ExchangeRequest` *does* have named sides — `requesterId` and `receiverId`
 * are meaningful, unlike a `Connection`'s UUID-sorted `userAId`/`userBId` — but
 * "show me every exchange this person is involved in" is the question an
 * operator actually asks, and it is the same either-side shape C2 established.
 * Splitting it into two parameters would make the common question require two
 * requests and a merge.
 *
 * `platform` is a **single** platform name, matched against the `platforms`
 * array with "contains" semantics — see `buildExchangeWhere`.
 *
 * Per-parameter error policy is inherited, not invented: an unusable `status`
 * or `platform` is ignored, free text `user` degrades to a nickname search, and
 * a malformed date is a **400**.
 */
export type AdminExchangeListQuery = {
  /** One of the four real `ExchangeStatus` values. Anything else is ignored. */
  status?: string;
  /** One real `SocialPlatform` name. Anything else is ignored. */
  platform?: string;
  /** UUID (exact id of either party) or free text (nickname contains). */
  user?: string;
  /** Inclusive lower bound on `ExchangeRequest.createdAt` (ISO 8601). */
  createdFrom?: string;
  /** Inclusive upper bound on `ExchangeRequest.createdAt` (ISO 8601). */
  createdTo?: string;
  /** One of `EXCHANGE_SORT_ORDERS`. Never passed to Prisma verbatim. */
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Phase C4: the blocks-list query.
 *
 * ## Why there is a `blocker`/`blocked` pair *and* a `user`
 *
 * A `Block` is the one relationship in this console whose two sides are
 * genuinely **directional** and where the direction is the entire meaning of
 * the row: `Alice → Bob` ("Alice blocks Bob") and `Bob → Alice` are different
 * facts, not two spellings of one. A `Connection` has no such thing — its
 * `userAId` is whichever id sorts lower, so C2 correctly exposed a single
 * `user`. Here the opposite is true, so both questions must be askable:
 *
 *   - `user`    — "everything this person is involved in", **either side**.
 *                 This is the parameter the console's filter bar drives.
 *   - `blocker` — "whom has this person blocked" — exact side.
 *   - `blocked` — "who has blocked this person" — exact side.
 *
 * The two directional parameters are the ones that make §十三's requirement
 * checkable from outside: an implementation that normalised the pair into
 * `min(blockerId, blockedId) / max(...)` would answer `blocker` and `blocked`
 * with the same set, and that is a test that fails loudly.
 *
 * Per-parameter error policy is inherited, not invented: free text degrades to
 * a case-insensitive nickname `contains` on the matching side, a UUID is
 * matched exactly, and a malformed date is a **400**.
 */
export type AdminBlockListQuery = {
  /** UUID (exact id of either side) or free text (either side's nickname). */
  user?: string;
  /** UUID (exact `blockerId`) or free text (`blocker.nickname` contains). */
  blocker?: string;
  /** UUID (exact `blockedId`) or free text (`blocked.nickname` contains). */
  blocked?: string;
  /** Inclusive lower bound on `Block.createdAt` (ISO 8601). */
  createdFrom?: string;
  /** Inclusive upper bound on `Block.createdAt` (ISO 8601). */
  createdTo?: string;
  /** One of `BLOCK_SORT_ORDERS`. Never passed to Prisma verbatim. */
  sort?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Phase B4: what the reported message looked like, if it still exists.
 *
 * `Report.messageId` has no FK, so `available: false` is a normal outcome
 * rather than an error. `reason` distinguishes "this report never pointed at a
 * message" from "the message is gone", which is useful to the console and costs
 * nothing.
 */
export type ReportMessageSummary =
  | { available: true; id: string; content: string; type: string; createdAt: Date; sender: PartySummary }
  | { available: false; reason: "NO_MESSAGE" | "DELETED" };

/**
 * PC-2.5.3: what the reported moment looked like, if it still exists.
 *
 * The exact counterpart of `ReportMessageSummary`, and for the same reason:
 * `Report.momentId` carries no foreign key (see the schema note), so a report
 * can outlive its moment. `available: false` is therefore a normal outcome
 * rather than an error, and `reason` separates "this report never pointed at a
 * moment" from "the moment is gone". `source` is carried because a `DEMO`
 * placeholder must never be reviewed as if it were genuine user activity.
 */
export type ReportMomentSummary =
  | {
      available: true;
      id: string;
      content: string;
      platform: string;
      source: string;
      createdAt: Date;
      author: PartySummary;
    }
  | { available: false; reason: "NO_MOMENT" | "DELETED" };

/**
 * C2 — what the reported comment looked like, if it still exists.
 *
 * 与上面两个 summary 同一契约：`commentId` 同样是一个**没有外键**的裸指针，
 * 而评论是**硬删除**（`MomentComment` 没有 `deletedAt`），所以一条举报可以在目标消失后
 * 继续存在。`available: false` 因此是普通状态而非错误，`reason` 用来区分
 * 「这条举报从来没指向评论」与「评论已经没了」。**绝不允许抛异常** ——
 * 一次缺失会把整个详情页变成 500。
 */
export type ReportCommentSummary =
  | { available: true; id: string; content: string; createdAt: Date; author: PartySummary }
  | { available: false; reason: "NO_COMMENT" | "DELETED" };

/** The three columns the reports screens show for a user. */
export type PartySummary = { id: string; nickname: string | null; email: string };

/**
 * Who performed an audited action.
 *
 * Mirrors the `AuditActorType` database enum. Declared as a plain string union
 * rather than imported from `@prisma/client` so callers (and the admin app) do
 * not have to depend on generated types just to describe an actor.
 */
export type AuditActor = "USER" | "SYSTEM";

/**
 * Everything a single audit entry needs.
 *
 * `adminId` and `actorType` are optional so the ~10 pre-existing human call
 * sites keep compiling untouched: omitting both yields the historical meaning
 * (`actorType = USER`, `adminId` = the admin who acted). The pairing is not
 * free-form — see `assertActorConsistency`, which mirrors the
 * `AdminAuditLog_actor_consistency_check` database constraint.
 */
export type AuditInput = {
  /** Required when `actorType` is `USER`; must be omitted/null for `SYSTEM`. */
  adminId?: string | null;
  /** Defaults to `USER`, i.e. a human administrator. */
  actorType?: AuditActor;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  detail?: string | null;
};

/**
 * A machine-originated audit entry. `adminId`/`actorType` are not merely
 * optional here — they are structurally absent, so a caller physically cannot
 * name an administrator on a system action.
 */
export type SystemAuditInput = Omit<AuditInput, "adminId" | "actorType">;

/** Narrow client so audit writes can join an existing transaction. */
type AuditClient = Pick<PrismaService, "adminAuditLog">;

export type SetStatusInput = {
  targetUserId: string;
  action: UserStatusAction;
  reason?: string | null;
  admin: ResolvedAdmin;
  /** Required for `suspend`; ignored otherwise. */
  expiresAt?: string | Date | null;
  ip?: string | null;
  userAgent?: string | null;
};

const STATUS_ACTIONS: readonly UserStatusAction[] = [
  "activate",
  "disable",
  "ban",
  "suspend",
  "unban",
];

/**
 * PC-3.1c — what a user is told when their own account state changes.
 *
 * Deliberately silent about *why* and about *who*: the reason and the acting
 * administrator live in `AdminNote` / `AdminAuditLog`, which the affected
 * account does not read. A status with no entry yields no body rather than a
 * fabricated one.
 */
const USER_STATUS_BODY: Record<string, string> = {
  ACTIVE: "你的账号已恢复正常。",
  DISABLED: "你的账号已被停用。",
  SUSPENDED: "你的账号已被临时封禁。",
  BANNED: "你的账号已被封禁。",
};

/**
 * Phase B2: every sort the users list accepts, mapped to a Prisma `orderBy`.
 *
 * The mapping exists so a client string never reaches the query builder.
 * `orderBy: req.query.sort` would let a caller sort by any column — including
 * ones the list deliberately does not expose — and would turn a client typo
 * into a silently different order instead of a visible error.
 *
 * The keys are the wire format; the values are the only thing Prisma sees.
 *
 * `nulls: "last"` on `lastActiveAt` is not decoration. PostgreSQL's default for
 * `ORDER BY … DESC` is NULLS FIRST, so the plain order would lead "最近活跃
 * 倒序" with the accounts that have *never* been active — the exact opposite of
 * what the label promises. Sorting a nullable column by "most recent" only
 * means something if the never-active rows are at the far end.
 */
export const USER_SORT_ORDERS = {
  createdAt_desc: { createdAt: "desc" },
  createdAt_asc: { createdAt: "asc" },
  lastActiveAt_desc: { lastActiveAt: { sort: "desc", nulls: "last" } },
  lastActiveAt_asc: { lastActiveAt: { sort: "asc", nulls: "last" } },
  nickname_asc: { nickname: "asc" },
  nickname_desc: { nickname: "desc" },
  status_asc: { status: "asc" },
  status_desc: { status: "desc" },
} as const satisfies Record<string, Prisma.UserOrderByWithRelationInput>;

export type UserSortKey = keyof typeof USER_SORT_ORDERS;

/** Matches the pre-B2 hardcoded order, so existing callers see no change. */
export const DEFAULT_USER_SORT: UserSortKey = "createdAt_desc";

/**
 * Phase C2: the orderings `GET /admin/connections` accepts.
 *
 * A whitelist `Map` keyed by the wire name, exactly as `USER_SORT_ORDERS` is: a
 * client string never reaches Prisma's `orderBy`, so `sort=id; DROP TABLE` is
 * not a thing that can be expressed.
 *
 * The two nickname keys sort by the **related user's** nickname, which is what a
 * human looking for "Alice and Bob" actually scans. Prisma orders a to-many
 * relation through `{ userA: { nickname: ... } }` on a to-one relation, which is
 * valid here because `userA`/`userB` are both `User` (to-one) — see the schema:
 * `userA User @relation("ConnectionsA", ...)`.
 *
 * `nulls: "last"` is applied to both nickname keys for the same reason
 * `lastActiveAt` uses it: `User.nickname` is nullable, and PostgreSQL's default
 * for `ORDER BY … DESC` is NULLS FIRST, so a descending sort would lead with the
 * connections whose participant has no nickname — the opposite of useful. On
 * `ASC` the database default (NULLS LAST) already agrees, but it is stated
 * explicitly so the two directions cannot drift apart if a future default
 * changes.
 */
export const CONNECTION_SORT_ORDERS = {
  createdAt_desc: { createdAt: "desc" },
  createdAt_asc: { createdAt: "asc" },
  status_asc: { status: "asc" },
  status_desc: { status: "desc" },
  userA_nickname_asc: { userA: { nickname: { sort: "asc", nulls: "last" } } },
  userA_nickname_desc: { userA: { nickname: { sort: "desc", nulls: "last" } } },
  userB_nickname_asc: { userB: { nickname: { sort: "asc", nulls: "last" } } },
  userB_nickname_desc: { userB: { nickname: { sort: "desc", nulls: "last" } } },
} as const satisfies Record<string, Prisma.ConnectionOrderByWithRelationInput>;

export type ConnectionSortKey = keyof typeof CONNECTION_SORT_ORDERS;

/** Newest connection first — the order the pre-C2 console implied. */
export const DEFAULT_CONNECTION_SORT: ConnectionSortKey = "createdAt_desc";

/**
 * Phase C2: the statuses the connections filter accepts.
 *
 * Mirrors the `ConnectionStatus` enum. A value outside it is ignored rather
 * than rejected, matching the `USER_STATUSES` / `REPORT_STATUSES` policy.
 */
const CONNECTION_STATUSES: readonly string[] = ["ACTIVE", "REMOVED"];

/**
 * Phase C2: the exact columns `GET /admin/connections` returns.
 *
 * ## What is deliberately absent
 *
 * A `Connection` is a *link between two people*, so every relation on it is a
 * doorway to the whole user row — and to `SocialAccount`, `ContactExchange` and
 * the rest of the graph behind it. The list therefore names its fields and
 * stops at the two participants:
 *
 *   - **no `conversation`** — the list does not need message metadata, and
 *     joining it would drag `Message` rows into a list response.
 *   - **no `ContactExchange` / `SharedSocialAccount`** — that is Phase C3.
 *     A connection is not an exchange, and this endpoint must not imply one
 *     exists (spec §三十八).
 *   - **no `Block`** — that is Phase C4 (spec §三十九).
 *
 * Both participants expose only `id` + `nickname`. `email` is *not* included:
 * the spec (§十) says the default fields are `id`/`nickname` and email must not
 * be exposed by default. An operator who needs the address can follow the link
 * to `/users/:id`, which is the screen that legitimately shows it.
 */
export const CONNECTION_LIST_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  conversationId: true,
  userA: { select: { id: true, nickname: true } },
  userB: { select: { id: true, nickname: true } },
} as const satisfies Prisma.ConnectionSelect;

/**
 * Phase C2: the detail screen's projection.
 *
 * The same field set as the list, on purpose. There is no `Connection` column
 * the list withholds that the detail is entitled to reveal — the schema has
 * `id`/`userAId`/`userBId`/`conversationId`/`status`/`createdAt` and nothing
 * else — so a wider detail select would have to reach into relations, which is
 * exactly the direction the previous two constants refuse. Declared separately
 * rather than reusing `CONNECTION_LIST_SELECT` so the two can diverge
 * deliberately if a future phase adds a field that is safe on one screen only.
 */
export const CONNECTION_DETAIL_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  conversationId: true,
  userA: { select: { id: true, nickname: true } },
  userB: { select: { id: true, nickname: true } },
} as const satisfies Prisma.ConnectionSelect;

/**
 * Phase C2: audit rows shown on the connection detail screen.
 *
 * A `Connection` has no dedicated audit table, and none was added. The only
 * record of anything ever happening *to* a connection is `AdminAuditLog`, and
 * today that table contains no `CONNECTION`-targeted rows at all — every
 * connection mutation goes through the normal-user `ConnectionsService`, which
 * does not write admin audit rows.
 *
 * So this constant exists to answer the question honestly: the query runs, and
 * an empty list is the truthful answer rather than a fabricated history. The
 * shape mirrors `REPORT_HISTORY_SELECT` — `ip`/`userAgent` excluded because a
 * connection's history is about *what was decided*, not where the operator sat.
 */
export const CONNECTION_HISTORY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  reason: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/** The audit `targetType` a connection-history row would carry, if one existed. */
const CONNECTION_AUDIT_TARGET = "CONNECTION";

/**
 * Phase C3: the orderings `GET /admin/exchanges` accepts.
 *
 * A whitelist keyed by the wire name, exactly as `USER_SORT_ORDERS` and
 * `CONNECTION_SORT_ORDERS` are, so a client string never reaches Prisma's
 * `orderBy`.
 *
 * The two `createdAt` keys are the ones every operator uses; the two `status`
 * keys answer "what is still waiting". The four nickname keys sort by the
 * **related user's** nickname — an exchange *does* have named sides
 * (`requester`/`receiver`), so unlike a connection these are two genuinely
 * different questions: "what did Alice ask for" and "what was asked of Alice".
 *
 * `nulls: "last"` on every nickname key because `User.nickname` is nullable and
 * PostgreSQL's default for `ORDER BY … DESC` is NULLS FIRST, which would lead a
 * descending sort with the rows that have no name at all. `ASC` already agrees
 * with the database default, but it is stated explicitly so the two directions
 * cannot drift apart.
 */
export const EXCHANGE_SORT_ORDERS = {
  createdAt_desc: { createdAt: "desc" },
  createdAt_asc: { createdAt: "asc" },
  status_asc: { status: "asc" },
  status_desc: { status: "desc" },
  requester_nickname_asc: { requester: { nickname: { sort: "asc", nulls: "last" } } },
  requester_nickname_desc: { requester: { nickname: { sort: "desc", nulls: "last" } } },
  receiver_nickname_asc: { receiver: { nickname: { sort: "asc", nulls: "last" } } },
  receiver_nickname_desc: { receiver: { nickname: { sort: "desc", nulls: "last" } } },
} as const satisfies Record<string, Prisma.ExchangeRequestOrderByWithRelationInput>;

export type ExchangeSortKey = keyof typeof EXCHANGE_SORT_ORDERS;

/** Newest exchange first. */
export const DEFAULT_EXCHANGE_SORT: ExchangeSortKey = "createdAt_desc";

/**
 * Phase C3: the statuses the exchanges filter accepts.
 *
 * Mirrors the `ExchangeStatus` enum **exactly** — `PENDING`, `ACCEPTED`,
 * `REJECTED`, `CANCELLED` — and nothing else. There is deliberately no
 * `EXPIRED`, `COMPLETED` or `REVOKED`: those are not stored states, and
 * accepting them would either silently match nothing (looking like a filter
 * that works) or, worse, invite a caller to believe an exchange can reach a
 * state the database cannot represent.
 *
 * A value outside this list is ignored rather than rejected, matching the
 * `USER_STATUSES` / `REPORT_STATUSES` / `CONNECTION_STATUSES` policy.
 */
const EXCHANGE_STATUSES: readonly string[] = ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"];

/**
 * Phase C3: the platforms the exchanges filter accepts.
 *
 * Derived from the **generated Prisma enum**, not typed out by hand. The real
 * `SocialPlatform` has twelve members (INSTAGRAM, TELEGRAM, WHATSAPP, DISCORD,
 * X, TIKTOK, WECHAT, QQ, STEAM, YOUTUBE, FACEBOOK, TALKFIRST) — more than the
 * handful one would guess — and a hardcoded subset would silently ignore a
 * filter for `QQ` or `STEAM`. Reading `Object.values()` of the generated enum
 * means this list cannot drift from the database's own type: adding a member to
 * the schema and regenerating adds it here.
 *
 * A value outside the list is ignored, like an unknown status.
 */
const EXCHANGE_PLATFORMS: readonly string[] = Object.values(SocialPlatform);

/**
 * Phase C3: the exact columns `GET /admin/exchanges` returns.
 *
 * ## What is deliberately absent
 *
 *   - **no `message`** — the request's free text belongs to the detail screen,
 *     not to a list that renders one row per exchange.
 *   - **no `shares` / `SharedSocialAccount`** — the share relation is the
 *     detail screen's subject; the list does not need it and must not drag a
 *     join to `SocialAccount` (and therefore `handle`) into a page of rows.
 *   - **no `conversation`** — nothing in the list renders chat metadata.
 *   - **no `connection`** — see `exchangeDetail`: `connectionId` has no foreign
 *     key, so there is nothing to join *to*.
 *
 * Both parties expose only `id` + `nickname`. `email` is **not** included: the
 * spec says the default party fields are `id`/`nickname`, and an operator who
 * needs the address can follow the link to `/users/:id`.
 */
export const EXCHANGE_LIST_SELECT = {
  id: true,
  status: true,
  platforms: true,
  createdAt: true,
  requester: { select: { id: true, nickname: true } },
  receiver: { select: { id: true, nickname: true } },
} as const satisfies Prisma.ExchangeRequestSelect;

/**
 * Phase C3: the detail screen's projection of the exchange itself.
 *
 * Wider than the list by exactly three columns — `connectionId`,
 * `conversationId` and `message` — plus `updatedAt`. Every one of those is a
 * column *of the exchange*, which is the exchange's own data and legitimately
 * the admin's to see. Nothing here reaches into a relation.
 *
 * `message` is `String? @db.VarChar(200)`: the request's own note, capped by
 * the database, and safe to return because it is what the requester typed to
 * the receiver about the exchange. It is **not** chat history — see
 * `exchangeDetail`, which never loads `Message`.
 */
export const EXCHANGE_DETAIL_SELECT = {
  id: true,
  connectionId: true,
  conversationId: true,
  platforms: true,
  message: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { id: true, nickname: true } },
  receiver: { select: { id: true, nickname: true } },
} as const satisfies Prisma.ExchangeRequestSelect;

/**
 * Phase C3: the share-relation projection — the single most sensitive select in
 * this phase.
 *
 * `SharedSocialAccount` is the **only** thing that proves "this person may see
 * that person's account on this platform" (see the schema comment on the
 * model). The relation itself is therefore exactly what the detail screen
 * reports: who granted it (`ownerId`), who received it (`viewerId`), on which
 * platform, and when.
 *
 * ## What is deliberately absent, and why it is not an oversight
 *
 * `socialAccountId` is not selected. It points at a `SocialAccount`, whose
 * `handle` column is the real-world identifier — a Telegram @username, a phone
 * number — and this phase's rule is that an admin console does **not** display
 * it merely because the caller is an admin. The share is meaningful without it:
 * 「Alice 已与 Bob 共享 TELEGRAM」 is the fact an operator needs. Reading
 * `socialAccountId` would be a step towards joining `handle`, so the join is
 * refused at the source.
 *
 * ## Why no "does the account still exist?" flag is returned
 *
 * `SharedSocialAccount.socialAccountId` is a **real foreign key** with
 * `onDelete: Cascade`. A share row therefore cannot outlive its
 * `SocialAccount` — the database deletes it in the same statement. So
 * `available: true` would be a constant, and a constant is noise, not
 * information. This is the exact opposite of `ExchangeRequest.connectionId`,
 * which has no foreign key and *can* dangle; that case is handled explicitly in
 * `exchangeDetail` with `connectionAvailable`.
 */
export const SHARED_SOCIAL_SELECT = {
  ownerId: true,
  viewerId: true,
  platform: true,
  createdAt: true,
} as const satisfies Prisma.SharedSocialAccountSelect;

/**
 * Phase C3: audit rows shown on the exchange detail screen.
 *
 * An `ExchangeRequest` has no dedicated audit table, and none was added. The
 * only record of anything ever happening *to* an exchange is `AdminAuditLog`,
 * and today that table contains no `EXCHANGE`-targeted rows at all — every
 * exchange mutation goes through the normal-user `ExchangeService`, which does
 * not write admin audit rows.
 *
 * So this constant exists to answer the question honestly: the query runs, and
 * an empty list is the truthful answer rather than a fabricated history. The
 * shape mirrors `CONNECTION_HISTORY_SELECT` — `ip`/`userAgent` excluded because
 * an exchange's history is about *what was decided*, not where the operator sat.
 */
export const EXCHANGE_HISTORY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  reason: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/** The audit `targetType` an exchange-history row would carry, if one existed. */
const EXCHANGE_AUDIT_TARGET = "EXCHANGE";

/**
 * Phase C4: the orderings `GET /admin/blocks` accepts.
 *
 * A whitelist keyed by the wire name, exactly as `USER_SORT_ORDERS`,
 * `CONNECTION_SORT_ORDERS` and `EXCHANGE_SORT_ORDERS` are, so a client string
 * never reaches Prisma's `orderBy`.
 *
 * The two `createdAt` keys are the ones every operator uses. The four nickname
 * keys are **not** interchangeable the way a connection's are: a block has a
 * direction, so "blocker nickname" and "blocked nickname" are two different
 * questions — "who is doing the blocking" and "who is being blocked" — and
 * collapsing them into one key would make the direction invisible in the sort
 * control, which is the one thing this screen exists to make visible.
 *
 * `nulls: "last"` on every nickname key because `User.nickname` is nullable and
 * PostgreSQL's default for `ORDER BY … DESC` is NULLS FIRST, which would lead a
 * descending sort with the rows that have no name at all. `ASC` already agrees
 * with the database default, but it is stated explicitly so the two directions
 * cannot drift apart.
 */
export const BLOCK_SORT_ORDERS = {
  createdAt_desc: { createdAt: "desc" },
  createdAt_asc: { createdAt: "asc" },
  blocker_nickname_asc: { blocker: { nickname: { sort: "asc", nulls: "last" } } },
  blocker_nickname_desc: { blocker: { nickname: { sort: "desc", nulls: "last" } } },
  blocked_nickname_asc: { blocked: { nickname: { sort: "asc", nulls: "last" } } },
  blocked_nickname_desc: { blocked: { nickname: { sort: "desc", nulls: "last" } } },
} as const satisfies Record<string, Prisma.BlockOrderByWithRelationInput>;

export type BlockSortKey = keyof typeof BLOCK_SORT_ORDERS;

/** Newest block first. */
export const DEFAULT_BLOCK_SORT: BlockSortKey = "createdAt_desc";

/**
 * Phase C4: the exact columns `GET /admin/blocks` returns.
 *
 * ## There is no `id`, and none is invented
 *
 * `Block` has no single-column primary key — the schema declares
 * `@@id([blockerId, blockedId])`. So this select names **both halves of the
 * composite key** rather than pretending a synthetic `id` exists. A fabricated
 * `id` (a hash, a joined string) would be a value the database cannot resolve
 * back to a row, which is worse than no id at all: the console links to
 * `/blocks/:blockerId/:blockedId`, and that URL is exactly the pair.
 *
 * ## What is deliberately absent
 *
 * A `Block` is a *directed statement about two people*, so both relations are
 * doorways to the whole user row — and behind it `SocialAccount`, `ContactExchange`,
 * `Conversation` and the rest of the graph. The list therefore names its fields
 * and stops at the two participants:
 *
 *   - **no `email`** — the spec's default party fields are `id`/`nickname`. An
 *     operator who needs the address follows the link to `/users/:id`, which is
 *     the screen that legitimately shows it.
 *   - **no `handle` / `SocialAccount`** — a block is not a social-account audit.
 *     This endpoint is not allowed to read `SocialAccount` at all.
 *   - **no `conversation` / `message` / `SharedSocialAccount`** — nothing in the
 *     response is about a chat or a share, and C4 must not become a side door
 *     into C2's or C3's data.
 *
 * `blocker` and `blocked` expose only `id` + `nickname`, and they are kept as
 * **two named fields** rather than one `users` array: merging them would erase
 * the direction, which is the one thing a block row means.
 */
export const BLOCK_LIST_SELECT = {
  blockerId: true,
  blockedId: true,
  createdAt: true,
  blocker: { select: { id: true, nickname: true } },
  blocked: { select: { id: true, nickname: true } },
} as const satisfies Prisma.BlockSelect;

/**
 * Phase C4: the detail screen's projection.
 *
 * The same field set as the list, on purpose. A `Block` has exactly four
 * columns — `blockerId`, `blockedId`, `createdAt` and nothing else — so there
 * is no wider-but-safe projection to make: anything more would have to reach
 * into a relation, which is the direction `BLOCK_LIST_SELECT` already refuses.
 * Declared separately rather than reusing the list constant so the two can
 * diverge deliberately if a future phase adds a column that is safe on one
 * screen only.
 */
export const BLOCK_DETAIL_SELECT = {
  blockerId: true,
  blockedId: true,
  createdAt: true,
  blocker: { select: { id: true, nickname: true } },
  blocked: { select: { id: true, nickname: true } },
} as const satisfies Prisma.BlockSelect;

/**
 * Phase C4: audit rows shown on the block detail screen.
 *
 * A `Block` has no dedicated audit table, and none was added. The only record
 * of anything ever happening *to* a block would be `AdminAuditLog`, and today
 * that table contains no `BLOCK`-targeted rows at all — every block mutation
 * goes through the normal-user `SocialSafetyController`, which does not write
 * admin audit rows.
 *
 * So this constant exists to answer the question honestly: the query runs, and
 * an empty list is the truthful answer rather than a fabricated history. Note
 * that `AdminAuditLog.targetType` is a free `String @db.VarChar(32)`, **not** an
 * enum, so "is `BLOCK` a valid target type?" is answered by whether any row
 * carries it — and the answer today is that none does. No enum is modified.
 *
 * The shape mirrors `CONNECTION_HISTORY_SELECT` — `ip`/`userAgent` excluded
 * because a block's history is about *what was decided*, not where the operator
 * sat.
 */
export const BLOCK_HISTORY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  reason: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/** The audit `targetType` a block-history row would carry, if one existed. */
const BLOCK_AUDIT_TARGET = "BLOCK";

/**
 * The exact columns `GET /admin/users` returns.
 *
 * Extracted into a named constant for one reason: the list is the widest
 * user-shaped response in the console, so "what does it expose?" should be
 * answerable by reading one declaration rather than a query buried in a
 * service method. `passwordHash` and the token tables are absent by
 * construction — there is no `include`, so no relation can ride along either.
 */
export const USER_LIST_SELECT = {
  id: true,
  email: true,
  nickname: true,
  countryCode: true,
  status: true,
  isAdmin: true,
  bannedAt: true,
  banReason: true,
  suspendedUntil: true,
  createdAt: true,
  lastActiveAt: true,
} as const satisfies Prisma.UserSelect;

/**
 * How many rows each "recent …" list returns — the dashboard feeds and the
 * user-detail reports/notes/audit lists.
 *
 * Declared above the `*_SELECT` constants rather than next to the dashboard,
 * because those constants are evaluated at module load: a `take` referring to a
 * `const` declared further down the file is a temporal-dead-zone error, not a
 * style preference.
 */
const RECENT_LIMIT = 10;

/**
 * Phase O2 — the accepted filters for `GET /admin/access-logs`.
 *
 * Every field is optional and every one becomes a `where` clause executed by the
 * database. The controller forwards raw query strings and this service owns the
 * defaults, coercion and bounds (the pattern the other admin reads already use).
 */
export interface AccessLogListQuery {
  page?: number;
  pageSize?: number;
  /** Exact client IP match. Nullable in the schema, so `null` is filterable. */
  ip?: string;
  userId?: string;
  /** Case-insensitive substring match on the request path. */
  path?: string;
  statusCode?: number;
  riskLevel?: string;
  authenticated?: boolean;
  isAdmin?: boolean;
  /**
   * 渠道筛选（2026-10-06）：`USER` / `ADMIN` / `OPS` / `ALL`。
   *
   * **缺省即 `USER`** —— 后台的默认视图只看成员流量（运营方要求后台与运维的行不混进来）。
   * 想看另两类就显式传 `ADMIN` / `OPS`，想看全部传 `ALL`。
   */
  channel?: string;
  /** ISO date strings, matching `createdFrom` / `createdTo` on the other reads. */
  createdFrom?: string;
  createdTo?: string;
}

/**
 * Builds the `where` for every access-log read, so the list and the stats can
 * never disagree about what "the same filter" means.
 *
 * An empty filter set is **no longer** `{}`: `channel` 默认就是 `USER`（见下）。
 * 这是运营方要的行为 —— 后台默认只看成员流量。想读回「全部」得显式传 `channel=ALL`。
 * 其余条件仍遵循「没给就不加谓词」的旧规矩。
 *
 * Dates come in as strings, exactly like `createdFrom`/`createdTo` on the users
 * and reports reads. An unparseable date is **ignored**, not widened to the
 * epoch: a typo must not silently return the entire table as though it were a
 * filtered result.
 */
function accessLogWhere(query: AccessLogListQuery): Prisma.AccessLogWhereInput {
  const where: Prisma.AccessLogWhereInput = {};

  if (query.ip !== undefined && query.ip !== "") where.ip = query.ip;
  if (query.userId) where.userId = query.userId;
  if (query.path) where.path = { contains: query.path, mode: "insensitive" };
  if (Number.isFinite(query.statusCode)) where.statusCode = query.statusCode;
  if (query.riskLevel) where.riskLevel = query.riskLevel;
  if (query.authenticated !== undefined) where.authenticated = query.authenticated;
  if (query.isAdmin !== undefined) where.isAdmin = query.isAdmin;

  // 渠道默认值放在这个共用函数里，而不是控制器里：list 与 stats 都从这里出 where，
  // 两处各给一个默认值早晚会出现「列表的条数和数字说的不是同一批数据」。
  const channel = normalizeChannelFilter(query.channel);
  if (channel) where.channel = channel;

  const from = parseOptionalDate(query.createdFrom);
  const to = parseOptionalDate(query.createdTo);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  return where;
}

/** Parses an ISO date string, returning `undefined` for missing or invalid input. */
function parseOptionalDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * True for loopback, link-local, and private-range addresses — IPv4 and IPv6.
 *
 * ## Why a ban must refuse these
 *
 * Blocking `127.0.0.1` silences the deployment's own health checks and any
 * server-to-server call that leaves and returns; blocking `10.0.0.0/8` or
 * `192.168.0.0/16` silences an entire office or a whole container network, because
 * every machine behind a NAT appears as its gateway or as its own private address.
 * Neither is ever what an operator means when they click 封禁, and both are
 * unrecoverable through the console if they happen — the console would be behind the
 * block. Refusing them here is cheaper than any recovery procedure.
 *
 * ## Why string prefixes rather than an IP library
 *
 * IPv4 needs no library to classify, and for IPv6 the routable/private split is a
 * small, well-known set of prefixes. Pulling in a dependency to answer "is this
 * private" for a safety check would add supply-chain surface for no capability, and
 * the check is deliberately conservative: anything not clearly identifiable as
 * public is refused, so an unusual form fails closed (the ban is rejected) rather
 * than open (a private range gets blocked).
 */
function isNonRoutableAddress(ip: string): boolean {
  const value = ip.toLowerCase();

  if (value === "127.0.0.1" || value === "::1" || value === "0.0.0.0" || value === "::") return true;

  // IPv4 private, loopback, link-local, CGNAT, and this-network.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    // 100.64.0.0/10 — carrier-grade NAT, i.e. a mobile network's whole subscriber pool.
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true;

  // Anything not recognisable as an IPv4 or IPv6 literal is refused: a value this
  // function cannot classify must not become a ban that silently matches nothing.
  const looksLikeV6 = /^[0-9a-f:]+$/.test(value) && value.includes(":");
  return !looksLikeV6;
}

/**
 * Phase B3: the exact shape `GET /admin/users/:id` returns.
 *
 * ## Why every relation now names its fields
 *
 * The pre-B3 select ended with three bare relation reads:
 *
 *     reportsReceived: { orderBy: { createdAt: "desc" }, take: 10 },
 *     reportsMade:     { orderBy: { createdAt: "desc" }, take: 10 },
 *     adminNotes:      { orderBy: { createdAt: "desc" }, take: 20 },
 *
 * With no `select`, each of those returns **every scalar column** of the row.
 * That is not hypothetical: the detail screen was shipping `Report.description`
 * and would have shipped any column added to `Report` or `AdminNote` later,
 * without anyone editing this file. It is precisely the pattern the Phase B
 * readiness audit flagged. Each relation below names its fields, so a new column
 * stays invisible until someone deliberately adds it here.
 *
 * ## `take` is not a total
 *
 * These are *recent* lists for display. The authoritative numbers are the
 * `*Count` fields returned alongside them — a list capped at 10 can never
 * justify the claim "this user was reported 10 times".
 *
 * ## `birthDate`
 *
 * Selected because the project's completion rule reads it, and deliberately
 * dropped from the response afterwards (see `userDetail`). The console shows the
 * derived score, not the raw date.
 */
export const USER_DETAIL_SELECT = {
  id: true,
  email: true,
  nickname: true,
  avatarUrl: true,
  countryCode: true,
  status: true,
  isAdmin: true,
  bannedAt: true,
  banReason: true,
  suspendedUntil: true,
  createdAt: true,
  lastActiveAt: true,
  birthDate: true,
  adminUser: { select: { role: true, isActive: true } },
  reportsReceived: {
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, reason: true, status: true, createdAt: true },
  },
  reportsMade: {
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, reason: true, status: true, createdAt: true },
  },
  adminNotes: {
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: { id: true, body: true, adminId: true, createdAt: true },
  },
} as const satisfies Prisma.UserSelect;

/**
 * Phase B3: the audit rows the user detail screen shows.
 *
 * `targetType`/`targetId` are included so a reader can see *why* a row belongs
 * on this screen. `ip` and `userAgent` are deliberately absent — they belong to
 * the dedicated audit screen, which is the only place with a reason to display
 * them, not to a general-purpose user summary (B3 §十二).
 */
export const USER_DETAIL_AUDIT_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  reason: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/** The statuses the list filter accepts. Anything else is ignored (see B2 §六). */
const USER_STATUSES: readonly string[] = ["ACTIVE", "DISABLED", "SUSPENDED", "BANNED"];

/**
 * Phase B4: the statuses the reports filter accepts.
 *
 * Mirrors the `ReportStatus` enum. A value outside it is ignored rather than
 * rejected, matching the endpoint's existing behaviour.
 */
const REPORT_STATUSES: readonly string[] = ["OPEN", "REVIEWING", "RESOLVED", "REJECTED"];

/**
 * PC-3.1c — what a reporter is told after their report is reviewed.
 *
 * Keyed by the status the review produced. Deliberately says nothing about the
 * reviewing administrator or the review reason, both of which stay in
 * `AdminAuditLog`. `OPEN` is absent because no action produces it: a review can
 * only move a report forward.
 */
const REPORT_REVIEW_BODY: Record<string, string> = {
  REVIEWING: "你提交的举报正在处理中。",
  RESOLVED: "你提交的举报已处理。",
  REJECTED: "你提交的举报已审核。",
};

/**
 * Phase B4: what the reports queue renders per row.
 *
 * An explicit `select` rather than `include` — see the note on
 * `REPORT_DETAIL_SELECT`. `reportedUser` carries `status` because the queue
 * shows whether the reported account is already actioned; `reporter` does not,
 * because the reporter's own standing is not part of this decision.
 */
export const REPORT_LIST_SELECT = {
  id: true,
  reason: true,
  description: true,
  status: true,
  messageId: true,
  momentId: true,
  createdAt: true,
  reporter: { select: { id: true, nickname: true, email: true } },
  reportedUser: { select: { id: true, nickname: true, email: true, status: true } },
} as const satisfies Prisma.ReportSelect;

/**
 * Phase B4: everything the report detail screen needs from `Report` itself.
 *
 * `include` is forbidden on this path. `Report` has only two relations and both
 * are `User` rows, so a bare `include` would return `passwordHash` on every
 * report — the single most damaging field this module could leak. Naming every
 * column means a future `User` column cannot appear here by default.
 */
export const REPORT_DETAIL_SELECT = {
  id: true,
  reason: true,
  description: true,
  status: true,
  messageId: true,
  momentId: true,
  commentId: true,
  createdAt: true,
  reporter: { select: { id: true, nickname: true, email: true, status: true } },
  reportedUser: { select: { id: true, nickname: true, email: true, status: true } },
} as const satisfies Prisma.ReportSelect;

/**
 * Phase B4: the audit rows shown as a report's review history.
 *
 * `ip` and `userAgent` are deliberately absent. They exist on `AdminAuditLog`
 * and are legitimate on the dedicated audit screen, but a report's review
 * history is about *what was decided*, not where the operator was sitting.
 */
export const REPORT_HISTORY_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  reason: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/**
 * Phase C1: the "recent reports" feed on the Risk Center.
 *
 * Deliberately narrower than `REPORT_LIST_SELECT`: the Risk Overview is a
 * summary surface, not the reports queue, so it shows identity (`id` +
 * `nickname`, with `email` as the fallback handle the console renders
 * everywhere) and the verdict fields. `status` on `reportedUser` is included
 * because the risk context is precisely "is this account already actioned".
 */
export const RISK_RECENT_REPORTS_SELECT = {
  id: true,
  reason: true,
  status: true,
  description: true,
  // The two target pointers. They are the only way to tell what a report
  // points at -- Report has no targetType column -- so omitting them made a
  // moment report indistinguishable from a person report on this surface.
  messageId: true,
  momentId: true,
  createdAt: true,
  reporter: { select: { id: true, nickname: true, email: true } },
  reportedUser: { select: { id: true, nickname: true, email: true, status: true } },
} as const satisfies Prisma.ReportSelect;

/**
 * Phase C1: the "recent admin actions" feed on the Risk Center.
 *
 * The same shape the dashboard feed uses, and for the same two reasons:
 * `actorType`/`adminId` are both present so a SYSTEM row renders as
 * 「系统 · 自动」 without a null `adminId` ever being treated as an id, and
 * `ip`/`userAgent` are absent because a summary surface must not carry forensic
 * request metadata. `before`/`after` are included so a row can state *what*
 * changed rather than implying *why*.
 */
export const RISK_RECENT_ACTIONS_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  actorType: true,
  adminId: true,
  detail: true,
  before: true,
  after: true,
  createdAt: true,
} as const satisfies Prisma.AdminAuditLogSelect;

/**
 * Phase C1: the actions that belong on a Risk Overview.
 *
 * Read from the real vocabulary rather than invented. Only three writers exist:
 *
 *   - `setStatus()`   → `ADMIN_USER_${ACTION}` for activate/disable/ban/suspend/unban
 *   - `reviewReport()` → `REPORT_${ACTION}` for reviewing/resolved/rejected
 *   - `note`           → `ADMIN_USER_NOTE`
 *
 * The SYSTEM scheduler's `SYSTEM_USER_SUSPENSION_EXPIRED` is intentionally
 * included: an automatic suspension expiry is a real risk-relevant state change
 * even though no human performed it.
 *
 * `ADMIN_USER_NOTE` is excluded — an operator writing an internal note is not a
 * risk event, and including it would bury the actual state changes.
 */
const RISK_ACTION_PREFIXES: readonly string[] = [
  "ADMIN_USER_ACTIVATE",
  "ADMIN_USER_DISABLE",
  "ADMIN_USER_BAN",
  "ADMIN_USER_SUSPEND",
  "ADMIN_USER_UNBAN",
  "REPORT_REVIEWING",
  "REPORT_RESOLVED",
  "REPORT_REJECTED",
  "SYSTEM_USER_SUSPENSION_EXPIRED",
];

/**
 * The single definition of the derived target type.
 *
 * `Report` has no `targetType` column. This function and the target predicate
 * in `buildReportWhere` are two readings of one rule, so they are kept adjacent
 * and both are exercised by `admin-reports.spec.ts`.
 *
 * PC-2.5.3 widened this from two states to three, in a fixed priority order:
 *
 *     momentId IS NOT NULL  → MOMENT
 *     commentId IS NOT NULL → COMMENT
 *     messageId IS NOT NULL → MESSAGE
 *     otherwise             → USER
 *
 * `momentId` wins over the others deliberately. A moment report is always
 * written with `messageId: null`, so a row carrying both is a data question the
 * product has not answered; labelling it MOMENT keeps the more specific target
 * visible instead of silently degrading it to a message report.
 *
 * C2 put COMMENT **above** MESSAGE on the same reasoning: `commentId` is a
 * content pointer and `messageId` is evidence attached to a *person* report, so
 * a row carrying both is better read as "a reported comment" than as "a report
 * about someone, with a message attached".
 */
function deriveTargetType(
  momentId: string | null,
  messageId: string | null,
  commentId: string | null,
): "USER" | "MESSAGE" | "MOMENT" | "COMMENT" {
  if (momentId) return "MOMENT";
  if (commentId) return "COMMENT";
  return messageId ? "MESSAGE" : "USER";
}

/**
 * Phase C-c: the target arm that selects every **content** report.
 *
 * "Content" means a report about something a user *published* rather than about
 * the account itself, so it is MOMENT ∪ COMMENT ∪ MESSAGE and never USER. The arms
 * are the exact negation of the USER predicate in `buildReportWhere` and are written
 * in the same priority order: MOMENT first, then COMMENT, then MESSAGE pinned to
 * `momentId: null, commentId: null` so a row can never be counted twice.
 *
 * The pinning is not redundant with the earlier arms. Without it an OR is not a
 * partition — a row carrying two pointers would satisfy several arms, and the
 * count would answer a different question than `targetType ∈ { MOMENT, COMMENT,
 * MESSAGE }`.
 *
 * Defined once because two KPIs read it. Duplicating the OR in each `count`
 * would let one of them drift into a slightly different meaning, which is
 * exactly the failure this constant exists to prevent.
 */
export const CONTENT_REPORT_TARGET: Prisma.ReportWhereInput = {
  OR: [
    { momentId: { not: null } },
    { momentId: null, commentId: { not: null } },
    { momentId: null, commentId: null, messageId: { not: null } },
  ],
};


/** A well-formed UUID, used to decide whether the keyword can be an exact id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `User.countryCode` is `Char(2)`, so only a two-letter code can match. */
const COUNTRY_RE = /^[A-Z]{2}$/;

/**
 * ISO-8601 calendar date or date-time only.
 *
 * `new Date()` also accepts locale formats such as `09/17/2026`, and their
 * interpretation is implementation-defined. Restricting the accepted shape
 * means a client cannot get a different day depending on which runtime parses
 * it — and a malformed value is rejected instead of becoming `Invalid Date`.
 */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The project's standard parameter-error envelope.
 *
 * Same code and `details` shape that `common/validation.pipe.ts` produces for a
 * bad request body, so a client keeps one branch for "your input was wrong"
 * instead of learning a second vocabulary. Reused rather than invented — see
 * B2 §八, "不要擅自引入新错误体系".
 */
function invalidQuery(field: string, message: string): BadRequestException {
  return new BadRequestException({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid query parameters",
      details: { [field]: [message] },
    },
  });
}

/** Resolves the wire sort key to an `orderBy`, or rejects an unknown one. */
function resolveUserSort(raw?: string): Prisma.UserOrderByWithRelationInput {
  const key = raw?.trim();
  if (!key) return USER_SORT_ORDERS[DEFAULT_USER_SORT];
  if (!Object.prototype.hasOwnProperty.call(USER_SORT_ORDERS, key)) {
    throw invalidQuery("sort", `sort must be one of: ${Object.keys(USER_SORT_ORDERS).join(", ")}`);
  }
  return USER_SORT_ORDERS[key as UserSortKey];
}

/**
 * Phase C2: the connections-list counterpart of `resolveUserSort`.
 *
 * An unknown key is a **400**, never a silent fallback to the default order —
 * the same rule B2 established for users. Answering a `sort=userA_nickname`
 * request (which is not a key) with `createdAt_desc` would look like it worked.
 */
function resolveConnectionSort(raw?: string): Prisma.ConnectionOrderByWithRelationInput {
  const key = raw?.trim();
  if (!key) return CONNECTION_SORT_ORDERS[DEFAULT_CONNECTION_SORT];
  if (!Object.prototype.hasOwnProperty.call(CONNECTION_SORT_ORDERS, key)) {
    throw invalidQuery(
      "sort",
      `sort must be one of: ${Object.keys(CONNECTION_SORT_ORDERS).join(", ")}`,
    );
  }
  return CONNECTION_SORT_ORDERS[key as ConnectionSortKey];
}

/**
 * Phase C3: the exchanges-list counterpart of `resolveConnectionSort`.
 *
 * An unknown key is a **400**, never a silent fallback to the default order —
 * answering `sort=platform` (which is not a key, and cannot be: `platforms` is
 * an array, so there is no single value to order by) with `createdAt_desc`
 * would look like it worked.
 */
function resolveExchangeSort(raw?: string): Prisma.ExchangeRequestOrderByWithRelationInput {
  const key = raw?.trim();
  if (!key) return EXCHANGE_SORT_ORDERS[DEFAULT_EXCHANGE_SORT];
  if (!Object.prototype.hasOwnProperty.call(EXCHANGE_SORT_ORDERS, key)) {
    throw invalidQuery(
      "sort",
      `sort must be one of: ${Object.keys(EXCHANGE_SORT_ORDERS).join(", ")}`,
    );
  }
  return EXCHANGE_SORT_ORDERS[key as ExchangeSortKey];
}

/**
 * Phase C4: the blocks-list counterpart of `resolveConnectionSort` /
 * `resolveExchangeSort`.
 *
 * Same contract as its two predecessors: an absent value yields the default, a
 * known key yields its pre-built `orderBy`, and **an unknown key is a 400** —
 * never a silent fallback to the default. Silently reordering the response when
 * a caller misspells `sort` would hide the mistake behind a plausible-looking
 * page.
 */
function resolveBlockSort(raw?: string): Prisma.BlockOrderByWithRelationInput {
  const key = raw?.trim();
  if (!key) return BLOCK_SORT_ORDERS[DEFAULT_BLOCK_SORT];
  if (!Object.prototype.hasOwnProperty.call(BLOCK_SORT_ORDERS, key)) {
    throw invalidQuery(
      "sort",
      `sort must be one of: ${Object.keys(BLOCK_SORT_ORDERS).join(", ")}`,
    );
  }
  return BLOCK_SORT_ORDERS[key as BlockSortKey];
}

/** Days in a Gregorian month; `Date.UTC` applies the leap-year rule for us. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Rolling window for the "last 7 days" signup count: 7 * 24h back from `now`. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * PC-3.1c — the single notification writer, so a status change and a report
     * review can tell the affected user. Optional only because the admin specs
     * construct this service directly with a prisma stub; `NotificationsModule`
     * is global, so Nest always supplies it in the running application.
     */
    private readonly notifications?: NotificationService,
    /**
     * The ban cache the middleware reads.
     *
     * Optional for the same reason as `notifications` above: the admin specs build
     * this service by hand, and a required third argument would either break every one
     * of them or force each to construct a service it has no interest in. Only the
     * ban write paths need it, and they fail with an explicit message rather than a
     * null dereference when it is absent.
     */
    private readonly ipBans?: IpBanService,
  ) {}

  /**
   * The ban cache, or a clear failure.
   *
   * Called only from the ban write paths, so "not injected" is a construction mistake
   * rather than a runtime condition — and it must not be able to silently skip cache
   * invalidation, which would make 解封 appear broken for up to a TTL.
   */
  private requireIpBans(): IpBanService {
    if (!this.ipBans) {
      throw new Error("AdminService was constructed without IpBanService; ban writes cannot invalidate the cache.");
    }
    return this.ipBans;
  }

  /**
   * The acting administrator's `AdminUser.id`, or a refusal.
   *
   * `ResolvedAdmin.adminUserId` is nullable because of the legacy compatibility path
   * where an account is an administrator through `User.isAdmin` with no `AdminUser`
   * row. That path cannot perform a ban: `IpBan.createdById` references `AdminUser`, so
   * passing `User.id` would violate the foreign key, and passing `null` would record a
   * moderation action with no actor — which is precisely the audit guarantee this
   * feature exists to provide. Refusing is the honest outcome; the fix is to create the
   * missing `AdminUser` row.
   */
  private requireAdminUserId(actor: ResolvedAdmin): string {
    if (!actor.adminUserId) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "IP_BAN_ACTOR_REQUIRED",
          message:
            "当前管理员账号没有对应的 AdminUser 记录（旧版兼容模式），无法执行封禁。请先为该账号创建管理员记录。",
        },
      });
    }
    return actor.adminUserId;
  }

  /**
   * Phase B1: platform-operations summary for the console landing screen.
   *
   * Read-only. This performs no mutation, so it writes no `AdminAuditLog` row —
   * there is no action to audit. Every number comes from a real query against
   * PostgreSQL; nothing is mocked, sampled, or computed on the client.
   *
   * ## Time boundaries
   *
   * A single `now` is captured per request and reused by every query, so the
   * "today" and "last 7 days" windows cannot drift apart across the parallel
   * calls:
   *
   *   today    = local midnight -> now      (`dayStart()`)
   *   last 7d  = now - 7 * 24h  -> now
   *
   * These are the definitions the console already used. No new time semantics
   * are introduced, and the day boundary stays local rather than UTC so it
   * matches what an operator reading the screen expects.
   *
   * ## Why the response is additive
   *
   * `users`, `activeToday`, `messagesToday`, `connections`, `reportsOpen`,
   * `admins` and `banned` all predate this phase and keep their names, so no
   * existing consumer breaks. The one deliberate semantic change is `admins`:
   * it now counts **active `AdminUser` rows** instead of `User.isAdmin`, because
   * `AdminUser.role` — not the legacy compatibility flag — is what
   * authorisation actually reads. Counting the flag would report an
   * administrator whose access has been revoked as still active.
   *
   * ## Why every read is an explicit `select`
   *
   * `AdminAuditLog` carries `ip` and `userAgent`. A bare `findMany` would ship
   * both to the browser in a general-purpose summary where nobody asked for
   * them, and would silently start shipping any column added later. Every query
   * below therefore names the fields it needs.
   */
  dashboard() {
    const now = new Date();
    const today = this.dayStart();
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

    return this.prisma.$transaction(async (tx) => {
      const [
        users,
        active,
        suspended,
        banned,
        activeToday,
        todayNewUsers,
        newUsers7d,
        messagesToday,
        connections,
        reportsOpen,
        admins,
        recentAudit,
        recentResolvedReports,
        recentSystemEvents,
      ] = await Promise.all([
        tx.user.count(),
        tx.user.count({ where: { status: "ACTIVE" } }),
        tx.user.count({ where: { status: "SUSPENDED" } }),
        tx.user.count({ where: { status: "BANNED" } }),
        tx.user.count({ where: { lastActiveAt: { gte: today } } }),
        tx.user.count({ where: { createdAt: { gte: today } } }),
        tx.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        tx.message.count({ where: { createdAt: { gte: today }, deletedAt: null } }),
        tx.connection.count({ where: { status: "ACTIVE" } }),
        tx.report.count({ where: { status: "OPEN" } }),
        // Administrators who can actually sign in. `isActive: false` models a
        // revoked administrator, who must not be counted as available.
        tx.adminUser.count({ where: { isActive: true } }),

        // Recent activity feed. `actorType`/`adminId` are both included so the
        // UI can render a SYSTEM row as "系统 · 自动" without ever touching a
        // null `adminId` as if it were an id. `ip`/`userAgent` are deliberately
        // absent — they belong to the audit screen, not a summary.
        tx.adminAuditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            actorType: true,
            adminId: true,
            detail: true,
            createdAt: true,
          },
        }),

        // Reports that reached a terminal state. `email` is included for both
        // parties because the console renders `nickname ?? email` everywhere —
        // an operator needs *some* handle for a member who never set a
        // nickname. Nothing beyond identity is selected.
        tx.report.findMany({
          where: { status: { in: ["RESOLVED", "REJECTED"] } },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            reason: true,
            status: true,
            // See RISK_RECENT_REPORTS_SELECT: the target pointers are what
            // let the feed say "about a moment" instead of "about a person".
            messageId: true,
            momentId: true,
            createdAt: true,
            reporter: { select: { id: true, nickname: true, email: true } },
            reportedUser: { select: { id: true, nickname: true, email: true } },
          },
        }),

        // Machine-originated events (the suspension-expiry sweep is currently
        // the only producer). This list is SYSTEM by definition, so `adminId` is
        // not selected — there is no actor id to render.
        tx.adminAuditLog.findMany({
          where: { actorType: "SYSTEM" },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            detail: true,
            createdAt: true,
          },
        }),
      ]);

      return {
        // Pre-existing fields — names and meanings preserved.
        users,
        activeToday,
        messagesToday,
        connections,
        reportsOpen,
        admins,
        banned,
        // Phase B1 additions.
        active,
        suspended,
        todayNewUsers,
        newUsers7d,
        recentAudit,
        recentResolvedReports,
        recentSystemEvents,
      };
    });
  }

  /**
   * Phase C1 — the Risk Center overview.
   *
   * ## What this is
   *
   * An **operational overview of facts already in the database**, not a risk
   * engine. There is no `RiskRecord`, no `riskLevel` column and no score: the
   * codebase has no risk model at all, and Phase C's spec forbids adding one.
   * So this method counts and lists what genuinely exists — reports, user
   * statuses and audit rows — and abstains from every judgement it cannot
   * support from data.
   *
   * ## What this deliberately is NOT
   *
   * It does not interpret a status as a risk level. `BANNED` is not
   * "high risk"; `SUSPENDED` is not "scam". Those would be business rules that
   * no one has defined, and inventing them is the one thing the spec bans
   * outright. Every field below is a count of a stored fact.
   *
   * ## Suspicious self-reports
   *
   * `suspiciousSelfReports` counts rows where `reporterId === reportedUserId`.
   * Those exist because `SafetyService.recordAutoFlag` writes
   * `reporterId: userId, reportedUserId: userId` on its non-HIGH path. That is
   * a known latent defect, and Phase C explicitly forbids repairing it here —
   * so this method reports the *signal* and names it neutrally
   * (「待核查异常举报」). It never claims the row is a machine flag or that the
   * user is malicious, because the data cannot prove either.
   *
   * ## Reads only
   *
   * Every query here is a `count`/`findMany`. No `recordAudit`: a read must not
   * manufacture an audit trail, and Phase C is GET-only by design.
   */
  riskOverview() {
    return this.prisma.$transaction(async (tx) => {
      const [
        totalReports,
        openReports,
        reviewingReports,
        resolvedReports,
        rejectedReports,
        suspendedUsers,
        bannedUsers,
        disabledUsers,
        activeUsers,
        suspiciousSelfReports,
        recentReports,
        recentActions,
        suspiciousSignals,
      ] = await Promise.all([
        tx.report.count(),
        tx.report.count({ where: { status: "OPEN" } }),
        tx.report.count({ where: { status: "REVIEWING" } }),
        tx.report.count({ where: { status: "RESOLVED" } }),
        tx.report.count({ where: { status: "REJECTED" } }),

        // Live account states. Each is a stored fact — `UserStatus` is an enum
        // column, not a derived judgement.
        tx.user.count({ where: { status: "SUSPENDED" } }),
        tx.user.count({ where: { status: "BANNED" } }),
        tx.user.count({ where: { status: "DISABLED" } }),
        tx.user.count({ where: { status: "ACTIVE" } }),

        // See the method doc — this counts rows, it does not label users.
        tx.report.count({ where: { reporterId: { equals: tx.report.fields.reportedUserId } } }),

        tx.report.findMany({
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: RISK_RECENT_REPORTS_SELECT,
        }),

        // Scoped to the real vocabulary (see `RISK_ACTION_PREFIXES`) so the feed
        // shows state changes and review outcomes, not notes.
        tx.adminAuditLog.findMany({
          where: { action: { in: [...RISK_ACTION_PREFIXES] } },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: RISK_RECENT_ACTIONS_SELECT,
        }),

        tx.report.findMany({
          where: { reporterId: { equals: tx.report.fields.reportedUserId } },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: RISK_RECENT_REPORTS_SELECT,
        }),
      ]);

      return {
        overview: {
          totalReports,
          openReports,
          reviewingReports,
          resolvedReports,
          rejectedReports,
          suspendedUsers,
          bannedUsers,
          disabledUsers,
          activeUsers,
          suspiciousSelfReports,
        },
        recentReports,
        recentActions,
        suspiciousSignals,
      };
    });
  }

  /**
   * Phase C2 — the connections list.
   *
   * ## What a "connection" is here
   *
   * Read from `connections.service.ts` rather than assumed. A `Connection` row
   * is created when a `ConnectionRequest` is **accepted** (`respond`), with
   * `status: "ACTIVE"`, and it is what the normal-user app shows as 「已连接」.
   * `REMOVED` is written by `removeConnection`, which is a **soft delete**: the
   * row is updated, never deleted, so `REMOVED` is a real, permanently stored
   * state and not an error or a tombstone-to-be-ignored.
   *
   * That is why this list **does not filter by status by default**. The
   * normal-user `listConnections` returns `status: "ACTIVE"` only — a user has
   * no reason to see a connection they ended. An operations console needs the
   * opposite: 「this pair connected and one of them removed it」 is precisely the
   * kind of thing someone opens an admin tool to find out, and a REMOVED row is
   * the only surviving evidence of it (spec §二十一).
   *
   * ## Read-only
   *
   * There is no delete, restore or status-change route in Phase C2, even though
   * `connections:write` exists in the permission matrix. The permission matrix
   * describes the role model; it does not oblige this phase to ship a mutation.
   * Every route added here is a `GET`, so none of them writes an `AdminAuditLog`
   * row (spec §十九, §四十).
   *
   * ## Filtering happens in the database
   *
   * `count` and `findMany` share one `where`, so the total a caller renders can
   * never disagree with the page they were given, and a filter is never applied
   * to a page of rows in JavaScript — the shape that works at 10 rows and
   * silently returns wrong totals at 100 000.
   */
  listConnections(query: AdminConnectionListQuery) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = this.buildConnectionWhere(query);
    const orderBy = resolveConnectionSort(query.sort);

    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.connection.count({ where }),
        tx.connection.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: CONNECTION_LIST_SELECT,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    });
  }

  /**
   * Translates the connections query into a `Connection` filter.
   *
   * ## The `user` filter is inherently "either side"
   *
   * `Connection` has no `ownerId`. Its two columns are `userAId` and `userBId`,
   * and which one a given person occupies depends on the UUID sort order
   * performed at creation (`connections.service.ts`: `[senderId,
   * receiverId].sort()`). So "connections involving Bob" cannot be answered by
   * looking at one column — it is `userAId = bob OR userBId = bob`, and this is
   * stated explicitly rather than left to the caller to discover (spec §十一).
   *
   * A well-formed UUID is matched against those two ids **exactly**, on both
   * sides. Any other text is a case-insensitive `contains` over **both**
   * participants' nicknames. Both clauses are `Prisma` filters, so they run in
   * the database; nothing is retrieved and then filtered in JavaScript.
   *
   * ## Per-parameter error policy, inherited
   *
   * `status` — an unknown value is **ignored** (all statuses shown), matching
   * the pre-B2 `USER_STATUSES` and pre-B4 `REPORT_STATUSES` behaviour.
   * `createdFrom`/`createdTo` — a malformed or non-existent date is a **400**
   * via `parseDateBoundary`, so `2026-02-30` is rejected instead of silently
   * rolling over to 2 March.
   */
  private buildConnectionWhere(query: AdminConnectionListQuery): Prisma.ConnectionWhereInput {
    const status = (query.status ?? "").trim().toUpperCase();
    const keyword = query.user?.trim().slice(0, 64);
    const createdFrom = this.parseDateBoundary(query.createdFrom, "createdFrom");
    const createdTo = this.parseDateBoundary(query.createdTo, "createdTo");

    // Either side matches. A UUID is an exact id on both columns; free text is
    // a nickname contains on both relations. Relation filters are used rather
    // than `userAId`/`userBId` string comparison for the text case because the
    // match is on the *participant's* nickname, which lives on `User`.
    const userFilter: Prisma.ConnectionWhereInput | undefined = !keyword
      ? undefined
      : UUID_RE.test(keyword)
        ? { OR: [{ userAId: keyword }, { userBId: keyword }] }
        : {
            OR: [
              { userA: { nickname: { contains: keyword, mode: "insensitive" as const } } },
              { userB: { nickname: { contains: keyword, mode: "insensitive" as const } } },
            ],
          };

    return {
      // Unknown status is ignored, not rejected — the existing policy.
      ...(CONNECTION_STATUSES.includes(status)
        ? { status: status as ConnectionStatus }
        : {}),
      ...(userFilter ?? {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Phase C2 — one connection in full, for the detail screen.
   *
   * ## Shape
   *
   * The same projection as the list, plus the history query. Nothing wider:
   * `Connection` has six columns and all six are either returned
   * (`id`/`status`/`createdAt`/`conversationId`) or represented by the two
   * participants they point at.
   *
   * ## `REMOVED` is readable
   *
   * No status check gates this lookup. A removed connection is a stored fact
   * and its detail page must render rather than 404 — an operator following a
   * link from the list does not expect the row to vanish because it was ended.
   *
   * ## `conversationId` may be `null`
   *
   * The column is `String? @unique`, so `null` is legal stored data. It is
   * returned as `null` rather than substituted with a placeholder: the API
   * reports what is there, and the console renders 「未关联」. Inventing an
   * empty string here would make "no conversation" indistinguishable from a
   * conversation whose id failed to load (spec §二十二).
   *
   * ## History from the only table that has any
   *
   * There is no `ConnectionAudit` model and none was added. The history is
   * therefore read from `AdminAuditLog` where `targetType = 'CONNECTION'`. That
   * query currently returns nothing — no connection mutation in the codebase
   * writes an admin audit row — and an empty array is the honest answer. It is
   * queried rather than hardcoded to `[]` so that if a later phase begins
   * auditing connection actions, the history appears without touching this
   * method (spec §十八).
   *
   * ## Unknown id is a 404
   *
   * `CONNECTION_NOT_FOUND`, which is the error code the existing normal-user
   * service already uses for this exact situation (`connections.service.ts`,
   * `removeConnection`). Reused rather than invented, so a client keeps one
   * branch for "that connection does not exist". Never `200 { data: null }` —
   * that shape is the bug Phase A+ fixed on the users endpoint, where the
   * console sat on 「加载中…」 forever because `data` never became truthy.
   */
  async connectionDetail(connectionId: string) {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      select: CONNECTION_DETAIL_SELECT,
    });

    if (!connection) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
      });
    }

    const history = await this.prisma.adminAuditLog.findMany({
      where: { targetType: CONNECTION_AUDIT_TARGET, targetId: connectionId },
      orderBy: { createdAt: "desc" },
      select: CONNECTION_HISTORY_SELECT,
    });

    return {
      connection: {
        id: connection.id,
        status: connection.status,
        createdAt: connection.createdAt,
        conversationId: connection.conversationId,
      },
      userA: connection.userA,
      userB: connection.userB,
      history,
    };
  }

  /**
   * Phase C3 — the contact-exchange list.
   *
   * ## Filtering happens in the database
   *
   * `count` and `findMany` share one `where` inside a single `$transaction`, so
   * the total a caller renders can never disagree with the page they were
   * given. Nothing is retrieved and then filtered in JavaScript.
   *
   * ## Only `EXCHANGE_LIST_SELECT` comes back
   *
   * There is no `include` anywhere in this method, so no relation can ride
   * along by accident. The two parties expose `id`/`nickname`; `email` is not
   * selected and `handle` is not reachable from this query at all.
   */
  listExchanges(query: AdminExchangeListQuery) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = this.buildExchangeWhere(query);
    const orderBy = resolveExchangeSort(query.sort);

    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.exchangeRequest.count({ where }),
        tx.exchangeRequest.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: EXCHANGE_LIST_SELECT,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    });
  }

  /**
   * Translates the exchanges query into an `ExchangeRequest` filter.
   *
   * ## `platform` is "array contains", not equality
   *
   * `ExchangeRequest.platforms` is `SocialPlatform[]` — one request may ask to
   * share several platforms at once. So the filter is Prisma's `has`, which
   * compiles to PostgreSQL's `@>`. The tempting `{ platforms: value }` would not
   * even type-check, and the tempting `{ platforms: { equals: [value] } }` would
   * only match requests that asked for *exactly* that one platform — silently
   * hiding every multi-platform request. The spec calls this out explicitly.
   *
   * ## The `user` filter is "either side"
   *
   * Unlike a `Connection`, an exchange has named sides: `requesterId` and
   * `receiverId` are assigned by who sent the request, not by a UUID sort. But
   * "every exchange involving Bob" still spans both columns, so the filter is
   * `requesterId = bob OR receiverId = bob` (spec §十五). A UUID is matched
   * against those two ids **exactly**; any other text is a case-insensitive
   * `contains` over **both** parties' nicknames. `email` is deliberately not
   * searched — the users list is the screen that searches addresses, and an
   * exchange list that quietly matched on email would be a wider disclosure
   * than its own response body (spec §十六).
   *
   * ## Per-parameter error policy, inherited
   *
   * `status` / `platform` — an unknown value is **ignored** (no filter applied),
   * matching `USER_STATUSES`, `REPORT_STATUSES` and `CONNECTION_STATUSES`.
   * `createdFrom`/`createdTo` — a malformed or non-existent date is a **400**
   * via `parseDateBoundary`, so `2026-02-30` is rejected rather than silently
   * rolling over to 2 March.
   */
  private buildExchangeWhere(query: AdminExchangeListQuery): Prisma.ExchangeRequestWhereInput {
    const status = (query.status ?? "").trim().toUpperCase();
    const platform = (query.platform ?? "").trim().toUpperCase();
    const keyword = query.user?.trim().slice(0, 64);
    const createdFrom = this.parseDateBoundary(query.createdFrom, "createdFrom");
    const createdTo = this.parseDateBoundary(query.createdTo, "createdTo");

    const userFilter: Prisma.ExchangeRequestWhereInput | undefined = !keyword
      ? undefined
      : UUID_RE.test(keyword)
        ? { OR: [{ requesterId: keyword }, { receiverId: keyword }] }
        : {
            OR: [
              { requester: { nickname: { contains: keyword, mode: "insensitive" as const } } },
              { receiver: { nickname: { contains: keyword, mode: "insensitive" as const } } },
            ],
          };

    return {
      // Unknown status is ignored, not rejected — the existing policy.
      ...(EXCHANGE_STATUSES.includes(status) ? { status: status as ExchangeStatus } : {}),
      // Unknown platform is ignored too. `has` is the array-contains operator;
      // see the method comment for why equality would be wrong here.
      ...(EXCHANGE_PLATFORMS.includes(platform)
        ? { platforms: { has: platform as SocialPlatform } }
        : {}),
      ...(userFilter ?? {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Phase C3 — one contact exchange in full, for the detail screen.
   *
   * ## Shape
   *
   * The exchange's own columns, its two parties, the share relations granted
   * under it, the connection it claims to belong to, and the (currently empty)
   * audit history. Four independent reads, issued together — see below.
   *
   * ## `connectionId` has NO foreign key — so it is not joined
   *
   * `ExchangeRequest.connectionId` is a bare `String @db.Uuid` with no relation
   * to `Connection`. A value is therefore a *claim*, not a guarantee: the
   * connection may have been deleted, or may never have existed (a fixture, a
   * bad migration, a hand-edited row). Prisma cannot `include` a relation that
   * is not declared in the schema, so the only correct reading is a **separate,
   * fallible lookup** whose `null` result is normal data rather than an error.
   *
   * Hence `connectionAvailable`: `false` with `connection: null` rather than a
   * 500, and the console renders 「连接记录不可用」. The exchange itself is still
   * fully readable — an operator inspecting an exchange must not be blocked
   * because a link is stale.
   *
   * ## `conversationId` IS a real FK, and is still not joined
   *
   * `conversationId` is a required column with a real foreign key, so it always
   * resolves. It is returned as an **id and nothing more**: the detail screen
   * shows 「会话 ID」 so an operator can correlate, and that is all it shows.
   * Loading `Conversation` would mean `Message` and `ConversationMember` — the
   * participants' private chat — which is neither needed for the requirement
   * nor permitted by it. The absence is a decision, not an omission.
   *
   * ## `message` is returned; the chat is not
   *
   * `message` is `String? @db.VarChar(200)`: the note the requester wrote *to
   * the receiver about this exchange*. It is the exchange's own field, it is
   * what the screen is for, and the database already caps its length. It is not
   * a `Message` row.
   *
   * ## Shares come from `SharedSocialAccount`, and only from there
   *
   * `SharedSocialAccount` is the single source of truth for "who may see whose
   * account on which platform" (schema comment on the model). This method does
   * **not** consult `SocialAccount.userId + platform` to infer a share, does not
   * re-implement the owner/viewer check, and does not read `SocialAccount` at
   * all. The direction is reported as stored: `ownerId` granted, `viewerId`
   * received. Reversing them would tell an operator the opposite of the truth.
   *
   * ## Unknown id is a 404
   *
   * `EXCHANGE_NOT_FOUND` — the code the existing normal-user `ExchangeService`
   * already throws for this exact situation, reused rather than invented so a
   * client keeps one branch for "that exchange does not exist". Never
   * `200 { data: null }`.
   */
  async exchangeDetail(exchangeId: string) {
    const exchange = await this.prisma.exchangeRequest.findUnique({
      where: { id: exchangeId },
      select: EXCHANGE_DETAIL_SELECT,
    });

    if (!exchange) {
      throw new NotFoundException({
        success: false,
        error: { code: "EXCHANGE_NOT_FOUND", message: "Exchange request not found" },
      });
    }

    // Four independent reads, issued together rather than in sequence. The
    // connection lookup is deliberately *outside* any `include`, and its `null`
    // is handled as data — see the method comment.
    const [connection, sharedAccounts, history] = await Promise.all([
      this.prisma.connection.findUnique({
        where: { id: exchange.connectionId },
        select: CONNECTION_DETAIL_SELECT,
      }),
      this.prisma.sharedSocialAccount.findMany({
        where: { exchangeId },
        orderBy: { createdAt: "asc" },
        select: SHARED_SOCIAL_SELECT,
      }),
      this.prisma.adminAuditLog.findMany({
        where: { targetType: EXCHANGE_AUDIT_TARGET, targetId: exchangeId },
        orderBy: { createdAt: "desc" },
        select: EXCHANGE_HISTORY_SELECT,
      }),
    ]);

    return {
      exchange: {
        id: exchange.id,
        connectionId: exchange.connectionId,
        conversationId: exchange.conversationId,
        platforms: exchange.platforms,
        message: exchange.message,
        status: exchange.status,
        createdAt: exchange.createdAt,
        updatedAt: exchange.updatedAt,
      },
      requester: exchange.requester,
      receiver: exchange.receiver,
      sharedAccounts,
      connectionAvailable: connection !== null,
      connection,
      history,
    };
  }

  /**
   * Phase C4 — the blocks list.
   *
   * ## Filtering happens in the database
   *
   * `count` and `findMany` share one `where` inside a single `$transaction`, so
   * the total a caller renders can never disagree with the page they were
   * given. Nothing is retrieved and then filtered in JavaScript.
   *
   * ## Only `BLOCK_LIST_SELECT` comes back
   *
   * There is no `include` anywhere in this method, so no relation can ride
   * along by accident. The two sides expose `id`/`nickname`; `email` is not
   * selected, and `handle` is not reachable from this query at all — nothing
   * here touches `SocialAccount`.
   *
   * ## The row's key is the pair, because that is the row's key
   *
   * `Block` has no `id`. The response therefore carries `blockerId` and
   * `blockedId` and no synthetic identifier — see `BLOCK_LIST_SELECT`.
   */
  listBlocks(query: AdminBlockListQuery) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = this.buildBlockWhere(query);
    const orderBy = resolveBlockSort(query.sort);

    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.block.count({ where }),
        tx.block.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: BLOCK_LIST_SELECT,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    });
  }

  /**
   * Translates the blocks query into a `Block` filter.
   *
   * ## `user` is "either side", and that is not a convenience
   *
   * `Block` is keyed on `(blockerId, blockedId)` with no owner column, so
   * "everything involving Alice" necessarily spans both columns:
   * `blockerId = alice OR blockedId = alice`. Filtering only `blockerId` is the
   * classic mistake here — it answers "whom has Alice blocked" and silently
   * omits everyone who has blocked Alice, which looks like a working filter
   * with a plausible-looking but wrong result set. The spec calls this out and
   * the fixtures are built so it is caught: Alice appears once as a blocker and
   * once as a blocked party, so a one-sided filter returns 1 instead of 2.
   *
   * ## `blocker` / `blocked` are the directional pair
   *
   * These are the opposite question and are answered on **one** column each.
   * Both existing at once is what makes §十三 verifiable: `blocker=alice` and
   * `blocked=alice` must return *different* sets, because the two directions
   * are different facts. An implementation that normalised the pair — sorting
   * the two ids, or `min`/`max`-ing them — would return the same rows for both
   * and is caught by that difference.
   *
   * ## Text vs UUID
   *
   * A UUID is matched against the relevant id column **exactly**; any other
   * text is a case-insensitive `contains` over the matching side's nickname.
   * `email` is deliberately not searched — the users list is the screen that
   * searches addresses, and a block list that quietly matched on email would be
   * a wider disclosure than its own response body (spec §七).
   *
   * ## Per-parameter error policy, inherited
   *
   * `createdFrom`/`createdTo` — a malformed or non-existent date is a **400**
   * via `parseDateBoundary`, so `2026-02-30` is rejected rather than silently
   * rolling over to 2 March. There is no status or platform parameter to
   * ignore: a `Block` has no status column and no platform.
   */
  private buildBlockWhere(query: AdminBlockListQuery): Prisma.BlockWhereInput {
    const createdFrom = this.parseDateBoundary(query.createdFrom, "createdFrom");
    const createdTo = this.parseDateBoundary(query.createdTo, "createdTo");

    const user = this.sideFilter(query.user, "both");
    const blocker = this.sideFilter(query.blocker, "blocker");
    const blocked = this.sideFilter(query.blocked, "blocked");

    return {
      ...(user ?? {}),
      ...(blocker ?? {}),
      ...(blocked ?? {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * One keyword against one side (or both) of a `Block`.
   *
   * Extracted because `user` / `blocker` / `blocked` are the *same* rule applied
   * to a different column pair, and writing it three times is how the three
   * drift apart — one of them ends up UUID-only, or searches email, and nothing
   * catches it. `side` selects the columns; the keyword handling is identical.
   *
   * Returns `undefined` for an absent/blank keyword so the caller can spread it
   * away, and never returns an empty `OR: []` (which Prisma would treat as
   * "match nothing").
   */
  private sideFilter(
    raw: string | undefined,
    side: "both" | "blocker" | "blocked",
  ): Prisma.BlockWhereInput | undefined {
    const keyword = raw?.trim().slice(0, 64);
    if (!keyword) return undefined;

    // Written out per branch rather than built from computed keys: the object
    // literals below are checked against `BlockWhereInput` directly, so a
    // renamed column or a relation that does not exist is a compile error
    // instead of a cast that silences one.
    if (UUID_RE.test(keyword)) {
      if (side === "both") return { OR: [{ blockerId: keyword }, { blockedId: keyword }] };
      if (side === "blocker") return { blockerId: keyword };
      return { blockedId: keyword };
    }

    const contains = { contains: keyword, mode: "insensitive" as const };
    if (side === "both") {
      return { OR: [{ blocker: { nickname: contains } }, { blocked: { nickname: contains } }] };
    }
    if (side === "blocker") return { blocker: { nickname: contains } };
    return { blocked: { nickname: contains } };
  }

  /**
   * Phase C4 — one block relationship, addressed by its composite key.
   *
   * ## The route is `/blocks/:blockerId/:blockedId`, not `/blocks/:id`
   *
   * `Block` declares `@@id([blockerId, blockedId])` and has no `id` column, so
   * there is no single value that identifies a row. The URL therefore carries
   * the pair, and the lookup uses Prisma's generated composite key
   * `blockerId_blockedId` — the same key the normal-user block endpoint already
   * uses (`social-safety.controller.ts`). A `/blocks/:id` route would have to
   * invent an identifier the database cannot resolve.
   *
   * ## Direction is reported exactly as stored
   *
   * `blockerId` is the person who **did** the blocking and `blockedId` the
   * person it was done to — that is how the write path stores it. This method
   * does not sort the two ids, does not normalise them into a canonical pair,
   * and does not swap them. `Alice → Bob` and `Bob → Alice` are two different
   * rows and must read as two different relationships; reversing them would
   * tell an operator the opposite of the truth, and in a moderation console
   * that is the difference between "Alice is being harassed" and "Alice is
   * harassing someone".
   *
   * ## Unknown pair is a 404
   *
   * `BLOCK_NOT_FOUND`, following the existing `USER_NOT_FOUND` /
   * `REPORT_NOT_FOUND` / `CONNECTION_NOT_FOUND` / `EXCHANGE_NOT_FOUND`
   * convention. Never `200 { data: null }`. Note this is "no such pair", not
   * "no such user": a request naming two real users who have no block between
   * them is a 404 for the same reason — there is no such block.
   *
   * ## Nothing beyond the block is read
   *
   * No `Conversation`, no `Message`, no `SharedSocialAccount`, and no
   * `SocialAccount` — a block is not a chat and not a social-account audit, and
   * the share relation belongs to C3's screen. The audit query runs and is
   * expected to be empty; that empty list is the honest answer, not a
   * placeholder.
   */
  async blockDetail(blockerId: string, blockedId: string) {
    const block = await this.prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      select: BLOCK_DETAIL_SELECT,
    });

    if (!block) {
      throw new NotFoundException({
        success: false,
        error: { code: "BLOCK_NOT_FOUND", message: "Block not found" },
      });
    }

    // `targetId` is a single `VarChar(128)` column, so a composite key cannot be
    // stored in it whole. `blockerId` is used because it is the side the row is
    // *about* from an operator's point of view, and the value is only ever a
    // correlation key — the block itself is already identified by the URL pair.
    const history = await this.prisma.adminAuditLog.findMany({
      where: { targetType: BLOCK_AUDIT_TARGET, targetId: blockerId },
      orderBy: { createdAt: "desc" },
      select: BLOCK_HISTORY_SELECT,
    });

    return {
      block: {
        blockerId: block.blockerId,
        blockedId: block.blockedId,
        createdAt: block.createdAt,
      },
      blocker: block.blocker,
      blocked: block.blocked,
      history,
    };
  }

  /**
   * Phase A: identity + capabilities for the admin console shell.
   * Never exposes passwordHash, tokens or any secret.
   */
  async me(admin: ResolvedAdmin) {
    const user = await this.prisma.user.findUnique({
      where: { id: admin.userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarUrl: true,
        status: true,
        isAdmin: true,
        createdAt: true,
        lastActiveAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return {
      user,
      role: admin.role,
      permissions: permissionsForRole(admin.role),
      // True while this admin is still resolved via the isAdmin fallback.
      legacy: admin.legacy,
    };
  }

  /**
   * Phase B2: the users list.
   *
   * Every filter is translated into a `where` clause that the database
   * evaluates: `count` and `findMany` both receive it, and pagination is
   * `skip`/`take` on the same query. Nothing is fetched wholesale and filtered
   * in JavaScript — that shape works at 168 rows and stops working at 100 000,
   * which is exactly when nobody is looking.
   *
   * ## Keyword semantics
   *
   * `search` (falling back to the legacy `q`) matches email and nickname with a
   * case-insensitive `contains`. A keyword that *is* a well-formed UUID is
   * additionally matched against `id` **exactly** — a fuzzy match on a uuid
   * column is not meaningful, and `contains` on it is not even expressible.
   *
   * ## What is rejected vs ignored
   *
   * Three different policies, each deliberate:
   *   - `status` — an unknown value falls back to "all statuses". This is the
   *     behaviour the endpoint already had, kept for compatibility (B2 §六).
   *   - `createdFrom` / `createdTo` — a malformed date is a **400**. Silently
   *     dropping a date bound would answer a different question than the one
   *     that was asked, and letting it through to Prisma would surface a raw
   *     driver error (B2 §八).
   *   - `sort` — an unknown key is a **400**, never a silent fallback to the
   *     default order (B2 §九).
   *
   * ## Response shape
   *
   * `items`, `total`, `page` and `pageSize` predate this phase and keep their
   * names. `totalPages` is the one addition. It is the plain ceiling — so it is
   * `0`, not `1`, when there are no rows — and the console treats `0` as "no
   * pages" rather than rendering 「第 1 / 0 页」.
   */
  searchUsers(query: AdminListQuery) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = this.buildUserWhere(query);
    const orderBy = resolveUserSort(query.sort);

    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: USER_LIST_SELECT,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    });
  }

  /** Translates the list query into a `User` filter. */
  private buildUserWhere(query: AdminListQuery): Prisma.UserWhereInput {
    // `search` wins; `q` is the pre-B2 name and still works on its own.
    const keyword = (query.search ?? query.q ?? "").trim().slice(0, 64);
    const status = (query.status ?? "ALL").toUpperCase();
    const country = (query.country ?? "").trim().toUpperCase();
    const createdFrom = this.parseDateBoundary(query.createdFrom, "createdFrom");
    const createdTo = this.parseDateBoundary(query.createdTo, "createdTo");

    return {
      ...(keyword
        ? {
            OR: [
              { email: { contains: keyword, mode: "insensitive" as const } },
              { nickname: { contains: keyword, mode: "insensitive" as const } },
              // Exact only, and only when the keyword can be an id at all.
              ...(UUID_RE.test(keyword) ? [{ id: keyword }] : []),
            ],
          }
        : {}),
      // Unknown status is ignored rather than rejected: the pre-B2 behaviour.
      ...(USER_STATUSES.includes(status) ? { status: status as UserStatus } : {}),
      // A code that cannot be a `Char(2)` value can never match anything, so it
      // is treated the same way as an unknown status rather than returning a
      // confusing empty list.
      ...(COUNTRY_RE.test(country) ? { countryCode: country } : {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * Parses one ISO-8601 bound, or reports it through the standard envelope.
   *
   * `new Date()` is only reached after the shape *and* the calendar check, so a
   * value that parses "somehow" in one runtime cannot be accepted here. The
   * calendar check is not redundant: `new Date("2026-02-30")` does not return
   * `Invalid Date` — it silently rolls over to 2 March — so a shape check plus
   * `Number.isNaN` would let a non-existent day through as a different day.
   */
  private parseDateBoundary(raw: string | undefined, field: string): Date | undefined {
    const value = raw?.trim();
    if (!value) return undefined;
    if (!ISO_8601_RE.test(value)) {
      throw invalidQuery(field, `${field} must be an ISO 8601 date or date-time`);
    }
    const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) ?? [];
    const monthNumber = Number(month);
    const dayNumber = Number(day);
    if (
      monthNumber < 1 ||
      monthNumber > 12 ||
      dayNumber < 1 ||
      dayNumber > daysInMonth(Number(year), monthNumber)
    ) {
      throw invalidQuery(field, `${field} is not a valid calendar date`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw invalidQuery(field, `${field} is not a valid calendar date`);
    }
    return parsed;
  }

  /**
   * Page/pageSize clamps, unchanged from before Phase B2.
   *
   * `0` falls back to the default rather than to the minimum: `Number(x) || d`
   * treats an absent, empty and zero value alike, and that is the behaviour the
   * endpoint already had. `-1` and `5000` are the cases the bounds are for.
   */
  private clampPage(raw?: number) {
    return Math.min(Math.max(Number(raw ?? 1) || 1, 1), 1000);
  }

  private clampPageSize(raw?: number) {
    return Math.min(Math.max(Number(raw ?? 20) || 20, 1), 100);
  }

  /**
   * Phase A+: an unknown user id is a 404, never `{ success: true, data: null }`.
   *
   * `findUnique` returns `null` for an id that does not exist, and the controller
   * wrapped that in the success envelope — so `GET /admin/users/:id` answered
   * **200 with a null body**. A caller could not distinguish "no such user" from
   * "user exists but has no data", and the console sat on 「加载中…」 forever
   * because `data` never became truthy and no error was ever raised.
   *
   * The throw lives here rather than in the controller so every current and
   * future caller inherits the guarantee — including `setStatus`, which returns
   * this method's result.
   *
   * ## Phase B3: one aggregate, one request
   *
   * The screen needs a profile, six real totals and a recent-activity list.
   * Returning them together means the cards cannot arrive in different orders,
   * and a user banned between two calls cannot be shown as two different people.
   *
   * ## Every total is a `count`
   *
   * The six numbers come from `prisma.count`, never from the length of a capped
   * list. Pre-B3 the screen rendered 「被举报（N）」 from `reportsReceived.length` —
   * the length of a `take: 10` window — so a user with 40 reports was displayed
   * as having 10. Nothing is counted in JavaScript, and nothing is counted on
   * the client.
   *
   * ## The definitions
   *
   *   connectionCount       Connection where the user is A or B and status = ACTIVE
   *   reportsReceivedCount  Report where reportedUserId = user
   *   reportsMadeCount      Report where reporterId = user
   *   contentReportsReceived  reportsReceivedCount, restricted to content targets
   *   contentReportsMade      reportsMadeCount, restricted to content targets
   *   blocksMadeCount       Block where blockerId = user
   *   blocksReceivedCount   Block where blockedId = user
   *   socialAccountCount    SocialAccount where userId = user
   *
   * ## Why the content KPIs are additions, not redefinitions
   *
   * `reportsReceivedCount` counts every row naming this user as `reportedUserId`
   * — a person report, a report about a message they sent and a report about a
   * moment they published all land in that one number. That is the meaning the
   * reports queue's `reportedUser` filter already has, and Phase C5 §5 pins the
   * two as equivalent, so it is deliberately left alone.
   *
   * The content pair answers the narrower question the user page could not ask
   * before: how much of that total is about things the user published. It is a
   * strict subset — `contentReportsReceived <= reportsReceivedCount` always — and
   * the two are never merged, so `existing total != content total` is the
   * expected reading, not a bug.
   *
   * Both content counts read `Report` rows only. `momentId` has no foreign key,
   * so a report survives its moment's deletion and keeps being counted here; a
   * join would silently drop it.
   *
   * `ConnectionStatus` is `ACTIVE | REMOVED` and the dashboard already treats
   * `ACTIVE` as "a connection", so a REMOVED row is not counted. That is the
   * product's existing meaning, not a new one (B3 §六) — no Connection semantics
   * were changed to make this number work.
   *
   * ## The 404 costs one query, not eight
   *
   * The existence check short-circuits inside the transaction before any count
   * runs, so an unknown id does not pay for six aggregates and an audit scan.
   */
  async userDetail(userId: string) {
    const detail = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: USER_DETAIL_SELECT });
      if (!user) return null;

      const [
        connectionCount,
        reportsReceivedCount,
        reportsMadeCount,
        contentReportsReceived,
        contentReportsMade,
        blocksMadeCount,
        blocksReceivedCount,
        socialAccountCount,
        auditSummary,
      ] = await Promise.all([
        tx.connection.count({
          where: { status: "ACTIVE", OR: [{ userAId: userId }, { userBId: userId }] },
        }),
        tx.report.count({ where: { reportedUserId: userId } }),
        tx.report.count({ where: { reporterId: userId } }),
        // The same two totals, narrowed to content targets. `CONTENT_REPORT_TARGET`
        // is the shared arm — see its definition for why the two are separate
        // numbers rather than a redefinition of the totals above.
        tx.report.count({ where: { reportedUserId: userId, ...CONTENT_REPORT_TARGET } }),
        tx.report.count({ where: { reporterId: userId, ...CONTENT_REPORT_TARGET } }),
        tx.block.count({ where: { blockerId: userId } }),
        tx.block.count({ where: { blockedId: userId } }),
        tx.socialAccount.count({ where: { userId } }),
        tx.adminAuditLog.findMany({
          where: { targetType: "USER", targetId: userId },
          orderBy: { createdAt: "desc" },
          take: RECENT_LIMIT,
          select: USER_DETAIL_AUDIT_SELECT,
        }),
      ]);

      return {
        user,
        connectionCount,
        reportsReceivedCount,
        reportsMadeCount,
        contentReportsReceived,
        contentReportsMade,
        blocksMadeCount,
        blocksReceivedCount,
        socialAccountCount,
        auditSummary,
      };
    });

    if (!detail) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // `birthDate` was read to evaluate the completion rule; it is not part of
    // this endpoint's contract, so it is dropped rather than spread through.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { birthDate, ...profile } = detail.user;

    return {
      ...profile,
      // The project-wide boolean, so the console and the app cannot disagree…
      profileCompleted: isProfileComplete(detail.user),
      // …and the countable form of that same rule.
      profileCompletion: profileCompletionOf(detail.user),
      connectionCount: detail.connectionCount,
      reportsReceivedCount: detail.reportsReceivedCount,
      reportsMadeCount: detail.reportsMadeCount,
      // Content-only subsets of the two totals above. Additive by design: no
      // existing key changed meaning, so no consumer of this endpoint breaks.
      contentReportsReceived: detail.contentReportsReceived,
      contentReportsMade: detail.contentReportsMade,
      blocksMadeCount: detail.blocksMadeCount,
      blocksReceivedCount: detail.blocksReceivedCount,
      socialAccountCount: detail.socialAccountCount,
      auditSummary: detail.auditSummary,
    };
  }

  /**
   * Phase A: user status changes with the full security rule set.
   *
   * Enforced here (not only in the controller) so no future caller can bypass it:
   *   1. reason is mandatory and must not be blank
   *   2. an admin may never change their own status (self-ban guard)
   *   3. the role must be allowed to perform this specific action
   *      (SUPPORT cannot ban; MODERATOR cannot permanently ban; ANALYST cannot write)
   *   4. an active admin target may only be modified by SUPER_ADMIN
   *   5. a temporary suspension requires an expiry
   *   6. the mutation and its audit entry share one transaction — if the audit
   *      write fails, the status change is rolled back too
   */
  async setStatus(input: SetStatusInput) {
    const { targetUserId, action, admin } = input;

    if (!STATUS_ACTIONS.includes(action)) {
      throw new BadRequestException({
        success: false,
        error: { code: "INVALID_ACTION", message: `Unknown action: ${action}` },
      });
    }

    // (1) Mandatory, non-blank reason.
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException({
        success: false,
        error: { code: "REASON_REQUIRED", message: "A reason is required for this action" },
      });
    }

    // (2) Self-protection.
    if (targetUserId === admin.userId) {
      throw new ForbiddenException({
        success: false,
        error: { code: "CANNOT_MODIFY_SELF", message: "You cannot change your own account status" },
      });
    }

    // (3) Role capability.
    if (!canSetUserStatus(admin.role, action)) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ACTION_NOT_ALLOWED_FOR_ROLE",
          message: `Your role (${admin.role}) is not allowed to perform "${action}"`,
        },
      });
    }

    // (5) Temporary suspension must carry an expiry.
    let expiresAt: Date | null = null;
    if (action === "suspend") {
      if (!input.expiresAt) {
        throw new BadRequestException({
          success: false,
          error: {
            code: "EXPIRES_AT_REQUIRED",
            message: "A temporary suspension requires an expiry time",
          },
        });
      }
      expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException({
          success: false,
          error: { code: "INVALID_EXPIRES_AT", message: "expiresAt is not a valid date" },
        });
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          success: false,
          error: { code: "INVALID_EXPIRES_AT", message: "expiresAt must be in the future" },
        });
      }
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        status: true,
        bannedAt: true,
        banReason: true,
        suspendedUntil: true,
        adminUser: { select: { id: true, isActive: true } },
      },
    });
    if (!target) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // (4) Protecting other administrators.
    if (target.adminUser?.isActive && admin.role !== "SUPER_ADMIN") {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "CANNOT_MODIFY_ADMIN",
          message: "Only a SUPER_ADMIN may modify another administrator",
        },
      });
    }

    const next = this.nextStatusState(action, reason, expiresAt);
    const before = {
      status: target.status,
      bannedAt: target.bannedAt,
      banReason: target.banReason,
      suspendedUntil: target.suspendedUntil,
    };
    const after = {
      status: next.status,
      bannedAt: next.bannedAt,
      banReason: next.banReason,
      suspendedUntil: next.suspendedUntil,
    };

    // (6) Business mutation + audit in one transaction.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: targetUserId }, data: next });
      await tx.adminNote.create({
        data: { userId: targetUserId, adminId: admin.userId, body: `${action}: ${reason}`.slice(0, 1000) },
      });
      await this.recordAudit(
        {
          adminId: admin.userId,
          action: `ADMIN_USER_${action.toUpperCase()}`,
          targetType: "USER",
          targetId: targetUserId,
          reason,
          before,
          after,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          detail: `${action}: ${reason}`,
        },
        tx,
      );
    });

    // PC-3.1c — the account is told its own state changed.
    //
    // Written after the commit, never inside the transaction: the status change
    // is the safety-critical part and must not be held hostage by a notification
    // insert. A no-op change (the same status saved twice) sends nothing, so
    // "a real transition happened" and "one message was sent" stay in step.
    //
    // No `actorId` and no administrator identity travels with it — who acted is
    // audit data, not something the affected account is told.
    if (next.status !== target.status) {
      await this.notifications?.notify({
        userId: targetUserId,
        type: "USER_STATUS",
        title: "账号状态已更新",
        body: USER_STATUS_BODY[next.status],
        data: {
          targetType: "USER",
          targetId: targetUserId,
          status: next.status,
          ...(next.suspendedUntil ? { suspendedUntil: next.suspendedUntil.toISOString() } : {}),
        },
      });
    }

    return this.userDetail(targetUserId);
  }

  /**
   * Phase B4: the reports queue.
   *
   * ## Derived `targetType` — not a column
   *
   * `Report` has no `targetType`; it has two nullable pointers, `momentId` and
   * `messageId`. The console's distinction is therefore derived, and the *only*
   * definition (PC-2.5.3) is:
   *
   *     momentId IS NOT NULL  → MOMENT
   *     messageId IS NOT NULL → MESSAGE
   *     otherwise             → USER
   *
   * `buildReportWhere` uses exactly this rule and `deriveTargetType` reads it
   * back, so a filter and the label shown next to a row can never disagree.
   * Adding a `targetType` column would create a second source of truth that
   * drifts as soon as either pointer changes.
   *
   * ## Filter policies (deliberately not uniform)
   *
   *   - `status` — an unknown value is **ignored** (all statuses). This is what
   *     the endpoint already did, kept for compatibility (B2 §六).
   *   - `targetType` — an unknown value is ignored, same reasoning.
   *   - `reason` — **exact, case-insensitive**. `Report.reason` is a free-form
   *     `VarChar(64)`, not an enum, so there is no vocabulary to validate
   *     against; an unmatched value yields an empty page rather than a 400.
   *   - `reporter` / `reportedUser` — a well-formed UUID matches the id
   *     **exactly** (a fuzzy match on a uuid column is not meaningful). Any
   *     other text is a case-insensitive `contains` over email and nickname,
   *     the same semantics `searchUsers` uses.
   *   - `createdFrom` / `createdTo` — a malformed or non-existent date is a
   *     **400**. Dropping it silently would answer a different question than the
   *     one asked (B2 §八).
   *
   * ## Response
   *
   * `items`, `total`, `page`, `pageSize` are unchanged. `totalPages` is the one
   * addition and it is the plain ceiling — `0`, not `1`, when there are no rows.
   * A page past the end returns `items: []`; it is never clamped back to the
   * last page, because silently answering page 3 with page 1's rows is worse
   * than an empty page.
   */
  listReports(query: AdminReportListQuery) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = this.buildReportWhere(query);

    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.report.count({ where }),
        tx.report.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: REPORT_LIST_SELECT,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    });
  }

  /**
   * Translates the reports query into a `Report` filter.
   *
   * The `targetType` arm is the query-side twin of `deriveTargetType`, in the
   * same priority order. MESSAGE and USER both pin `momentId: null` so that a
   * moment report can never surface under a message or user filter — without it,
   * a moment report would match `USER` (its `messageId` is null) and the
   * queue would disagree with the badge beside it.
   */
  private buildReportWhere(query: AdminReportListQuery): Prisma.ReportWhereInput {
    const {
      status,
      reason,
      targetType,
      reporter,
      reportedUser,
      createdFrom: createdFromRaw,
      createdTo: createdToRaw,
    } = query;

    const createdFrom = this.parseDateBoundary(createdFromRaw, "createdFrom");
    const createdTo = this.parseDateBoundary(createdToRaw, "createdTo");

    const normalizedStatus = status?.trim().toUpperCase();
    const normalizedTarget = targetType?.trim().toUpperCase();
    const normalizedReason = reason?.trim();

    return {
      // Unknown status is ignored rather than rejected: the pre-B4 behaviour.
      ...(normalizedStatus && REPORT_STATUSES.includes(normalizedStatus)
        ? { status: normalizedStatus as ReportStatus }
        : {}),
      ...(normalizedReason
        ? { reason: { equals: normalizedReason, mode: "insensitive" as const } }
        : {}),
      // The filter and the displayed label share this single rule, and the
      // priority order is the one deriveTargetType() reads back.
      ...(normalizedTarget === "MOMENT"
        ? { momentId: { not: null } }
        : normalizedTarget === "COMMENT"
          ? { momentId: null, commentId: { not: null } }
          : normalizedTarget === "MESSAGE"
            ? { momentId: null, commentId: null, messageId: { not: null } }
            : normalizedTarget === "USER"
              ? { messageId: null, momentId: null, commentId: null }
              : {}),
      ...(this.partyFilter(reporter) ? { reporter: this.partyFilter(reporter)! } : {}),
      ...(this.partyFilter(reportedUser) ? { reportedUser: this.partyFilter(reportedUser)! } : {}),
      ...(createdFrom || createdTo
        ? {
            createdAt: {
              ...(createdFrom ? { gte: createdFrom } : {}),
              ...(createdTo ? { lte: createdTo } : {}),
            },
          }
        : {}),
    };
  }

  /**
   * One `reporter` / `reportedUser` filter clause.
   *
   * A UUID is an exact id match and nothing else — it must not widen into a
   * text search, or a valid id would also match anyone whose nickname happened
   * to contain it. Any other text searches email and nickname, matching the
   * `searchUsers` keyword semantics.
   */
  private partyFilter(raw?: string): Prisma.UserWhereInput | undefined {
    const keyword = raw?.trim();
    if (!keyword) return undefined;
    if (UUID_RE.test(keyword)) return { id: keyword };
    return {
      OR: [
        { email: { contains: keyword, mode: "insensitive" as const } },
        { nickname: { contains: keyword, mode: "insensitive" as const } },
      ],
    };
  }

  /**
   * Phase B4: one report in full, for the detail screen.
   *
   * Three things this deliberately does *not* do:
   *
   *  1. **It does not join the target.** Neither `Report.messageId` nor
   *     `Report.momentId` carries a foreign key (see the schema note), so the row
   *     can outlive either of them. Each lookup is a separate, fallible step —
   *     see `messageSummary` and `momentSummary`.
   *  2. **It does not use `include`.** Every relation is an explicit `select`
   *     constant, so a column added to `User` later cannot appear here by
   *     accident. `passwordHash` and `RefreshToken.tokenHash` are the columns
   *     this protects.
   *  3. **It does not return `null` for a missing id.** An unknown report is a
   *     404 `REPORT_NOT_FOUND`, never `{ success: true, data: null }`.
   *
   * The top level mirrors that two-sided approach: `target` states which kind of
   * thing was reported, while `message` and `moment` each carry their own
   * "available or not" verdict. Exactly one of them is ever `available: true`.
   */
  async reportDetail(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: REPORT_DETAIL_SELECT,
    });

    if (!report) {
      throw new NotFoundException({
        success: false,
        error: { code: "REPORT_NOT_FOUND", message: "Report not found" },
      });
    }

    const [message, moment, comment, history] = await Promise.all([
      this.messageSummary(report.messageId),
      this.momentSummary(report.momentId),
      this.commentSummary(report.commentId),
      this.prisma.adminAuditLog.findMany({
        where: { targetType: "REPORT", targetId: reportId },
        orderBy: { createdAt: "desc" },
        select: REPORT_HISTORY_SELECT,
      }),
    ]);

    return {
      report: {
        id: report.id,
        reason: report.reason,
        description: report.description,
        status: report.status,
        messageId: report.messageId,
        momentId: report.momentId,
        commentId: report.commentId,
        createdAt: report.createdAt,
      },
      reporter: report.reporter,
      reportedUser: report.reportedUser,
      target: {
        targetType: deriveTargetType(report.momentId, report.messageId, report.commentId),
        messageId: report.messageId,
        momentId: report.momentId,
        commentId: report.commentId,
      },
      message,
      moment,
      comment,
      history,
    };
  }

  /**
   * C2 — the reported comment, or an explicit "not available".
   *
   * 与 `messageSummary` 同一契约、同一理由：`commentId` 是没有外键的裸指针，
   * 所以举报可能比目标活得久。评论是**硬删除**（没有 `deletedAt`），
   * 因此只有「存在」与「不存在」两种情形，没有软删除那一支。
   * **绝不抛异常**：缺一条评论会把整个详情页变成 500。
   */
  private async commentSummary(commentId: string | null): Promise<ReportCommentSummary> {
    if (!commentId) return { available: false, reason: "NO_COMMENT" };

    const comment = await this.prisma.momentComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: { select: { id: true, nickname: true, email: true } },
      },
    });

    if (!comment) return { available: false, reason: "DELETED" };

    return {
      available: true,
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: comment.user,
    };
  }

  /**
   * The reported message, or an explicit "not available".
   *
   * `Report.messageId` carries no foreign key, so a report can point at a
   * message that has since been hard-deleted. That is an ordinary state, not an
   * error: this returns `{ available: false }` and the screen renders
   * 「内容已删除或不可用」. It must never throw — a missing message would
   * otherwise turn the whole detail page into a 500.
   *
   * A soft-deleted message (`deletedAt` set) is reported as unavailable too:
   * the body is intentionally withheld, which is the same outcome for the
   * reader while keeping the distinction visible to the API.
   */
  private async messageSummary(
    messageId: string | null,
  ): Promise<ReportMessageSummary> {
    if (!messageId) return { available: false, reason: "NO_MESSAGE" };

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        type: true,
        createdAt: true,
        deletedAt: true,
        sender: { select: { id: true, nickname: true, email: true } },
      },
    });

    if (!message) return { available: false, reason: "DELETED" };
    if (message.deletedAt) return { available: false, reason: "DELETED" };

    return {
      available: true,
      id: message.id,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
      sender: message.sender,
    };
  }

  /**
   * PC-2.5.3: the reported moment, or an explicit "not available".
   *
   * Same contract as `messageSummary` above, for the same reason: `momentId` is
   * a bare pointer with no foreign key, so the moment can be gone while the
   * report remains. That is ordinary, not an error, and this must never throw —
   * a missing moment would otherwise turn the whole detail page into a 500.
   *
   * `Moment` has no `deletedAt`, so unlike messages there is no soft-delete arm
   * to report: a row either exists or does not.
   */
  private async momentSummary(
    momentId: string | null,
  ): Promise<ReportMomentSummary> {
    if (!momentId) return { available: false, reason: "NO_MOMENT" };

    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
      select: {
        id: true,
        content: true,
        platform: true,
        source: true,
        createdAt: true,
        user: { select: { id: true, nickname: true, email: true } },
      },
    });

    if (!moment) return { available: false, reason: "DELETED" };

    return {
      available: true,
      id: moment.id,
      content: moment.content,
      platform: moment.platform,
      source: moment.source,
      createdAt: moment.createdAt,
      author: moment.user,
    };
  }

  /**
   * Phase A: reason is now mandatory, and the audit entry uses proper
   * `targetType`/`targetId` instead of stuffing the reported user's id into the
   * free-text `detail` column.
   */
  async reviewReport(
    reportId: string,
    action: "reviewing" | "resolved" | "rejected",
    admin: ResolvedAdmin,
    reasonRaw?: string | null,
    ip?: string | null,
    userAgent?: string | null,
  ) {
    const reason = reasonRaw?.trim();
    if (!reason) {
      throw new BadRequestException({
        success: false,
        error: { code: "REASON_REQUIRED", message: "A reason is required for this action" },
      });
    }

    const existing = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, reportedUserId: true, reporterId: true },
    });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "REPORT_NOT_FOUND", message: "Report not found" },
      });
    }

    const status = action === "reviewing" ? "REVIEWING" : action === "resolved" ? "RESOLVED" : "REJECTED";

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.report.update({
        where: { id: reportId },
        data: { status: status as never },
      });
      await this.recordAudit(
        {
          adminId: admin.userId,
          action: `REPORT_${action.toUpperCase()}`,
          targetType: "REPORT",
          targetId: reportId,
          reason,
          before: { status: existing.status },
          after: { status: row.status },
          ip: ip ?? null,
          userAgent: userAgent ?? null,
          detail: reason,
        },
        tx,
      );
      return row;
    });

    // PC-3.1c — the reporter learns what happened to what they filed.
    //
    // Only a real transition notifies. The endpoint has always allowed the same
    // action to be submitted twice (it re-writes the same status and appends a
    // second audit row); a second message claiming something new happened would
    // be a lie, so an unchanged status sends nothing.
    //
    // Written after the commit, never inside the transaction, so a notification
    // problem cannot undo a review that was successfully recorded. No `actorId`
    // travels with it: the reviewing administrator and the review reason are
    // audit data, and the reporter is told *that* their report was looked at —
    // never by whom, or on what grounds.
    if (existing.status !== status) {
      await this.notifications?.notify({
        userId: existing.reporterId,
        type: "REPORT_REVIEW",
        title: "举报处理结果",
        body: REPORT_REVIEW_BODY[status],
        data: {
          targetType: "REPORT",
          targetId: reportId,
          reportId,
          status,
        },
      });
    }

    return updated;
  }

  async addNote(userId: string, admin: ResolvedAdmin, body: string, ip?: string | null, userAgent?: string | null) {
    const trimmed = body.trim();
    if (!trimmed) {
      throw new BadRequestException({
        success: false,
        error: { code: "REASON_REQUIRED", message: "A note body is required" },
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const note = await tx.adminNote.create({
        data: { userId, adminId: admin.userId, body: trimmed.slice(0, 1000) },
      });
      await this.recordAudit(
        {
          adminId: admin.userId,
          action: "ADMIN_USER_NOTE",
          targetType: "USER",
          targetId: userId,
          reason: trimmed.slice(0, 500),
          ip: ip ?? null,
          userAgent: userAgent ?? null,
          detail: trimmed.slice(0, 500),
        },
        tx,
      );
      return note;
    });
  }

  listAudit(page = 1, pageSize = 20) {
    const safePage = Math.min(Math.max(Number(page) || 1, 1), 1000);
    const safeSize = Math.min(Math.max(Number(pageSize) || 20, 1), 100);
    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.adminAuditLog.count(),
        tx.adminAuditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (safePage - 1) * safeSize,
          take: safeSize,
        }),
      ]);
      return { items, total, page: safePage, pageSize: safeSize };
    });
  }

  // ---------------------------------------------------------------------------
  // Phase O2 — site operations: HTTP access logs
  // ---------------------------------------------------------------------------

  /**
   * The access-log list projection.
   *
   * Explicit `select`, never `include` — the C4 convention, and here it is also
   * load-bearing for privacy: `AccessLog` has no Prisma relation on `userId`, so
   * an `include` is not even expressible, and naming the columns is how the
   * "no body capture, no cookies, no tokens" promise stays checkable by reading
   * this constant rather than the database.
   */
  static readonly ACCESS_LOG_LIST_SELECT = {
    id: true,
    requestId: true,
    method: true,
    path: true,
    queryDigest: true,
    statusCode: true,
    durationMs: true,
    userId: true,
    authenticated: true,
    isAdmin: true,
    channel: true,
    ip: true,
    deviceHash: true,
    userAgent: true,
    referer: true,
    origin: true,
    acceptLanguage: true,
    contentType: true,
    errorCode: true,
    riskLevel: true,
    createdAt: true,
  } as const;

  /**
   * Phase O2 — the access-log list.
   *
   * ## Filtering is server-side, always
   *
   * Every filter becomes a `where` clause and the page is taken by the database.
   * The console must never fetch a page and then hide rows: `total` and the page
   * count would then describe the unfiltered set, which looks correct and lies.
   *
   * ## The `userId` join is manual, on purpose
   *
   * `AccessLog.userId` deliberately has no foreign key and no Prisma relation
   * (an audit row must survive the deletion of the account it describes). So the
   * account is resolved with one extra query over the distinct ids on the page —
   * one round trip per page, not one per row — and merged in. A deleted account
   * resolves to `null` and the UI renders a placeholder rather than crashing on
   * `userId.slice(...)`.
   */
  async listAccessLogs(query: AccessLogListQuery = {}) {
    const page = this.clampPage(query.page);
    const pageSize = this.clampPageSize(query.pageSize);
    const where = accessLogWhere(query);

    const [total, items] = await Promise.all([
      this.prisma.accessLog.count({ where }),
      this.prisma.accessLog.findMany({
        where,
        select: AdminService.ACCESS_LOG_LIST_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const accounts = await this.accountsFor(items.map((item) => item.userId));
    return {
      items: items.map((item) => ({
        ...item,
        account: item.userId ? (accounts.get(item.userId) ?? null) : null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Phase O2 — one access-log row, or a 404 rather than `data: null`. */
  async accessLogDetail(id: string) {
    const row = await this.prisma.accessLog.findUnique({
      where: { id },
      select: AdminService.ACCESS_LOG_LIST_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        success: false,
        error: { code: "ACCESS_LOG_NOT_FOUND", message: "No such access log entry" },
      });
    }
    const accounts = await this.accountsFor([row.userId]);
    return { ...row, account: row.userId ? (accounts.get(row.userId) ?? null) : null };
  }

  /**
   * Phase O2 — aggregate counters for the ops dashboard.
   *
   * Every number is a count of stored facts over the requested window. Deliberately
   * no derived "threat score": assigning severity is a business rule nobody has
   * defined, and the Phase C1 precedent (`riskOverview`) is to report facts and
   * abstain from judgement.
   *
   * `distinctIpCount` answers "how many visitors", which `total` cannot: one
   * client polling a feed inflates `total` without adding a visitor.
   *
   * `channel` 与列表同口径（**默认只看 `USER`**）：两个读共用 `accessLogWhere`，
   * 所以「列表的条数」与「这里的合计」不会各说各话。
   */
  async accessLogStats(query: { createdFrom?: string; createdTo?: string; channel?: string } = {}) {
    const where = accessLogWhere(query);
    const from = parseOptionalDate(query.createdFrom) ?? null;
    const to = parseOptionalDate(query.createdTo) ?? null;
    const [total, distinctIpRows, byStatus, byRisk, topPaths, topIps] = await Promise.all([
      this.prisma.accessLog.count({ where }),
      this.prisma.accessLog.findMany({
        where: { ...where, ip: { not: null } },
        select: { ip: true },
        distinct: ["ip"],
      }),
      this.prisma.accessLog.groupBy({ by: ["statusCode"], where, _count: { _all: true } }),
      this.prisma.accessLog.groupBy({ by: ["riskLevel"], where, _count: { _all: true } }),
      this.prisma.accessLog.groupBy({
        by: ["path"],
        where,
        _count: { _all: true },
        orderBy: { _count: { path: "desc" } },
        take: 10,
      }),
      this.prisma.accessLog.groupBy({
        by: ["ip"],
        where,
        _count: { _all: true },
        orderBy: { _count: { ip: "desc" } },
        take: 10,
      }),
    ]);

    return {
      total,
      distinctIpCount: distinctIpRows.length,
      byStatus: byStatus
        .map((row) => ({ statusCode: row.statusCode, count: row._count._all }))
        .sort((a, b) => a.statusCode - b.statusCode),
      byRisk: byRisk.map((row) => ({ riskLevel: row.riskLevel, count: row._count._all })),
      topPaths: topPaths.map((row) => ({ path: row.path, count: row._count._all })),
      // `ip` is nullable in the schema, so the null bucket is a real group.
      topIps: topIps.map((row) => ({ ip: row.ip, count: row._count._all })),
      from,
      to,
    };
  }

  /**
   * IP ban administration.
   *
   * ## Why these live on `AdminService` rather than a new service
   *
   * Every write here must land an `AdminAuditLog` row atomically with the ban itself,
   * and `recordAudit` — the one place human audit rows are written — is already here.
   * A separate service would either duplicate that or reach back across a boundary for
   * it.
   *
   * ## Gates that make an operator unable to lock themselves out
   *
   * A PRIMARY ban refuses every request from an address, so banning the address an
   * operator is currently using ends their session permanently and requires database
   * surgery to undo. Three refusals prevent the realistic versions of that mistake:
   * loopback/private ranges, and any address already recorded against an admin
   * account. See `assertBanableIp`.
   */

  /** The active bans, newest first, plus the lifted history when asked for. */
  async listIpBans(query: { ip?: string; includeLifted?: boolean; page?: number; pageSize?: number } = {}) {
    const page = Number.isFinite(query.page) && (query.page as number) > 0 ? (query.page as number) : 1;
    const pageSize = Math.min(
      Number.isFinite(query.pageSize) && (query.pageSize as number) > 0 ? (query.pageSize as number) : 50,
      200,
    );

    const where: Prisma.IpBanWhereInput = {};
    if (query.ip?.trim()) where.ip = normalizeIp(query.ip);
    // Active-only by default: an operator opening this screen wants the bans in force,
    // not every ban ever issued.
    if (!query.includeLifted) where.liftedAt = null;

    const [items, total] = await Promise.all([
      this.prisma.ipBan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          ip: true,
          level: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
          liftedAt: true,
          createdById: true,
          liftedById: true,
        },
      }),
      this.prisma.ipBan.count({ where }),
    ]);

    const adminIds = [
      ...new Set([
        ...items.map((row) => row.createdById),
        ...items.map((row) => row.liftedById),
      ]),
    ].filter((id): id is string => Boolean(id));

    const admins =
      adminIds.length === 0
        ? []
        : await this.prisma.adminUser.findMany({
            where: { id: { in: adminIds } },
            select: { id: true, user: { select: { nickname: true, email: true } } },
          });
    const adminLabels = new Map(
      admins.map((row) => [row.id, row.user.nickname ?? row.user.email]),
    );

    return {
      items: items.map((row) => ({
        ...row,
        createdByLabel: row.createdById ? (adminLabels.get(row.createdById) ?? null) : null,
        liftedByLabel: row.liftedById ? (adminLabels.get(row.liftedById) ?? null) : null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** How many addresses are currently blocked, for the console summary. */
  async ipBanCounts() {
    const now = new Date();
    const activeWhere: Prisma.IpBanWhereInput = {
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
    const [active, primary, secondary] = await Promise.all([
      this.prisma.ipBan.count({ where: activeWhere }),
      this.prisma.ipBan.count({ where: { ...activeWhere, level: "PRIMARY" } }),
      this.prisma.ipBan.count({ where: { ...activeWhere, level: "SECONDARY" } }),
    ]);
    return { active, primary, secondary };
  }

  /**
   * Blocks an address.
   *
   * The ban row and its audit entry are written in one transaction, so a ban can never
   * exist without a record of who ordered it — the requirement that makes this feature
   * reviewable at all.
   */
  async createIpBan(
    input: { ip: string; level: "SECONDARY" | "PRIMARY"; reason: string; expiresAt?: string | null },
    actor: ResolvedAdmin,
  ) {
    const adminUserId = this.requireAdminUserId(actor);
    const ip = normalizeIp(input.ip);
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException({
        success: false,
        error: { code: "BAN_REASON_REQUIRED", message: "A ban must state a reason" },
      });
    }

    await this.assertBanableIp(ip);

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "expiresAt is not a valid date" },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      /**
       * An existing ACTIVE ban for the same address is updated rather than duplicated.
       *
       * Two active rows for one address would make "why is this blocked" ambiguous and
       * make lifting it a guess about which row to close, so the newest intent replaces
       * the old one — and the previous level/reason is preserved in the audit `before`.
       */
      const existing = await tx.ipBan.findFirst({ where: { ip, liftedAt: null } });

      const row = existing
        ? await tx.ipBan.update({
            where: { id: existing.id },
            data: { level: input.level, reason, expiresAt, createdById: adminUserId },
          })
        : await tx.ipBan.create({
            data: { ip, level: input.level, reason, expiresAt, createdById: adminUserId },
          });

      await this.recordAudit(
        {
          adminId: adminUserId,
          action: existing ? "ip_ban_update" : "ip_ban_create",
          targetType: "IP",
          targetId: ip,
          reason,
          before: existing ? { level: existing.level, reason: existing.reason } : null,
          after: { level: input.level, reason, expiresAt: expiresAt?.toISOString() ?? null },
        },
        tx,
      );

      return row;
    });

    // Take effect on the next request rather than up to a TTL later.
    this.requireIpBans().invalidate(ip);
    return created;
  }

  /**
   * Lifts a ban.
   *
   * The row is KEPT and stamped (`liftedAt`/`liftedById`) rather than deleted, so the
   * history of who was blocked and why survives the decision to stop blocking them.
   */
  async liftIpBan(banId: string, actor: ResolvedAdmin, reason?: string) {
    const adminUserId = this.requireAdminUserId(actor);
    const existing = await this.prisma.ipBan.findUnique({ where: { id: banId } });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "IP_BAN_NOT_FOUND", message: "No such IP ban" },
      });
    }
    if (existing.liftedAt) {
      throw new BadRequestException({
        success: false,
        error: { code: "IP_BAN_ALREADY_LIFTED", message: "This ban has already been lifted" },
      });
    }

    const lifted = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ipBan.update({
        where: { id: banId },
        data: { liftedAt: new Date(), liftedById: adminUserId },
      });
      await this.recordAudit(
        {
          adminId: adminUserId,
          action: "ip_ban_lift",
          targetType: "IP",
          targetId: existing.ip,
          reason: reason ?? null,
          before: { level: existing.level, reason: existing.reason },
          after: null,
        },
        tx,
      );
      return row;
    });

    this.requireIpBans().invalidate(existing.ip);
    return lifted;
  }

  /**
   * Refuses the addresses that would take the console down with the ban.
   *
   * ## The three refusals, and why each is not paranoia
   *
   * 1. **Loopback and private ranges.** Banning `127.0.0.1` blocks the deployment's own
   *    health checks and any server-to-server call; banning a private range blocks the
   *    operator's whole office. Neither is ever the intent.
   * 2. **An address already seen on an admin request.** `AccessLog` records the resolved
   *    address of every request including `isAdmin` ones, so the console can refuse to
   *    block an address an administrator has actually used. This is the check that
   *    prevents the self-lockout, and it is deliberately based on observed traffic
   *    rather than on the operator's current IP, which the API cannot know reliably
   *    behind Cloudflare.
   * 3. **Empty / unparseable input.** Rejected before anything else, because
   *    `normalizeIp("")` is `""` and an empty unique-ish key would match nothing —
   *    a ban that silently does nothing is worse than a refusal.
   *
   * Path prefixes cannot be used here: the console's own prefix is already exempt from
   * the middleware, so it is not part of this decision.
   */
  private async assertBanableIp(ip: string): Promise<void> {
    if (!ip) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "An IP address is required" },
      });
    }

    if (isNonRoutableAddress(ip)) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "IP_BAN_REFUSED_LOCAL",
          message: "回环地址与内网地址不允许封禁：会连带阻断部署自身的健康检查或整个办公网络。",
        },
      });
    }

    const adminUse = await this.prisma.accessLog.findFirst({
      where: { ip, isAdmin: true },
      select: { id: true },
    });
    if (adminUse) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "IP_BAN_REFUSED_ADMIN_IP",
          message:
            "该地址曾用于访问管理后台，封禁会让管理员（可能包括你自己）立即失去访问权限，因此被拒绝。",
        },
      });
    }
  }

  /**
   * Moment moderation queue ("内容审核").
   *
   * ## What was missing before this
   *
   * The permission pair `moderation:read` / `moderation:write` existed from the start, and
   * a test in `admin-integration.spec.ts` recorded that they belonged to "a standalone
   * moderation domain that does not exist yet". The 审核工作台 screen read the *reports*
   * endpoint, not content, and a published moment went live immediately with no way to
   * withhold it. This is that domain.
   *
   * ## Why the queue is PENDING-only by default
   *
   * The scanner escalates the narrow risk cases, so the queue is meant to be short and
   * worked oldest-first. Listing every moment would turn a review task into a browsing
   * task, and a queue nobody finishes is a queue nobody reads.
   */

  async listMomentQueue(query: {
    status?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const page = Number.isFinite(query.page) && (query.page as number) > 0 ? (query.page as number) : 1;
    const pageSize = Math.min(
      Number.isFinite(query.pageSize) && (query.pageSize as number) > 0 ? (query.pageSize as number) : 50,
      200,
    );

    // An unrecognised status is ignored rather than rejected, matching the other reads.
    // The default is PENDING because that is the queue.
    const allowed = ["PENDING", "APPROVED", "REJECTED", "HIDDEN"];
    const status = query.status && allowed.includes(query.status) ? query.status : "PENDING";

    const where: Prisma.MomentWhereInput = { reviewStatus: status as never };

    const [rows, total] = await Promise.all([
      this.prisma.moment.findMany({
        where,
        // Oldest first: a queue is worked from the front, and a newest-first list leaves
        // the earliest reports permanently at the bottom.
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          content: true,
          images: true,
          videoUrl: true,
          tags: true,
          source: true,
          reviewStatus: true,
          reviewReasons: true,
          reviewedAt: true,
          reviewedById: true,
          createdAt: true,
          user: { select: { id: true, nickname: true, email: true, status: true } },
        },
      }),
      this.prisma.moment.count({ where }),
    ]);

    return {
      items: rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      status,
    };
  }

  async momentQueueCounts() {
    const [pending, rejected, hidden] = await Promise.all([
      this.prisma.moment.count({ where: { reviewStatus: "PENDING" } }),
      this.prisma.moment.count({ where: { reviewStatus: "REJECTED" } }),
      this.prisma.moment.count({ where: { reviewStatus: "HIDDEN" } }),
    ]);
    return { pending, rejected, hidden };
  }

  /**
   * Approves, refuses or withdraws a moment.
   *
   * `HIDDEN` is a distinct outcome from `REJECTED`: refusing means it never became public,
   * withdrawing means it did and now does not. Recording which happened is what makes the
   * history readable later, and the audit row carries the previous state so the change is
   * reversible by a reader.
   */
  async reviewMoment(
    id: string,
    action: "approve" | "reject" | "hide",
    actor: ResolvedAdmin,
    reason?: string,
  ) {
    const existing = await this.prisma.moment.findUnique({
      where: { id },
      select: { id: true, reviewStatus: true, userId: true },
    });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "MOMENT_NOT_FOUND", message: "No such moment" },
      });
    }

    const nextStatus = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "HIDDEN";

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.moment.update({
        where: { id },
        data: {
          reviewStatus: nextStatus as never,
          reviewedAt: new Date(),
          reviewedById: actor.adminUserId,
          // The scanner's reasons are cleared once a human has decided, so the column
          // reflects "why was this flagged" rather than "why was it once flagged".
          ...(action === "approve" ? { reviewReasons: [] } : {}),
        },
        select: { id: true, reviewStatus: true },
      });

      await this.recordAudit(
        {
          adminId: actor.adminUserId,
          action: `moment_${action}`,
          targetType: "MOMENT",
          targetId: id,
          reason: reason ?? null,
          before: { reviewStatus: existing.reviewStatus },
          after: { reviewStatus: nextStatus },
        },
        tx,
      );

      return row;
    });

    return updated;
  }

  /**
   * Discover category administration ("发现页类别").
   *
   * ## Why this is `settings:*` and not `moderation:*`
   *
   * A category is product configuration — which tabs the discovery screen offers — not a
   * judgement about a member's content. `settings:read`/`settings:write` is the pair that
   * already meant "the product's own configuration", and it is held by SUPER_ADMIN and
   * MODERATOR.
   *
   * ## Why `slug` is validated rather than derived from the label
   *
   * The slug travels in the query string and is what an existing client already sends for
   * the built-in tabs. Deriving it from a Chinese label would produce percent-encoded
   * noise, and silently rewriting a slug would break a bookmarked tab. So it is an
   * explicit, validated field — and `parseCategoryKeywords` normalises the keywords, which
   * is the value matching depends on.
   */

  async listDiscoverCategories(includeInactive = false) {
    const rows = await this.prisma.discoverCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        slug: true,
        label: true,
        labelZh: true,
        keywords: true,
        sort: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      items: rows.map((row) => ({ ...row, keywords: parseCategoryKeywords(row.keywords) })),
      total: rows.length,
    };
  }

  async createDiscoverCategory(input: {
    slug: string;
    label: string;
    labelZh?: string | null;
    keywords?: string | null;
    sort?: number;
  }) {
    const slug = this.assertCategorySlug(input.slug);
    const label = (input.label ?? "").trim();
    if (!label) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "A category needs a label" },
      });
    }

    const existing = await this.prisma.discoverCategory.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      throw new BadRequestException({
        success: false,
        error: { code: "CATEGORY_SLUG_TAKEN", message: `分类标识 ${slug} 已存在` },
      });
    }

    // Stored already-normalised so the value in the database is the value matching uses,
    // rather than a raw string that has to be interpreted identically in two places.
    const keywords = parseCategoryKeywords(input.keywords).join(",");

    return this.prisma.discoverCategory.create({
      data: {
        slug,
        label,
        labelZh: input.labelZh?.trim() || null,
        keywords,
        sort: Number.isFinite(input.sort) ? (input.sort as number) : 0,
      },
      select: { id: true, slug: true, label: true, labelZh: true, keywords: true, sort: true, isActive: true },
    });
  }

  async updateDiscoverCategory(
    id: string,
    input: { label?: string; labelZh?: string | null; keywords?: string | null; sort?: number; isActive?: boolean },
  ) {
    const existing = await this.prisma.discoverCategory.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "CATEGORY_NOT_FOUND", message: "No such category" },
      });
    }

    const data: Record<string, unknown> = {};
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) {
        throw new BadRequestException({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "A category needs a label" },
        });
      }
      data.label = label;
    }
    if (input.labelZh !== undefined) data.labelZh = input.labelZh?.trim() || null;
    if (input.keywords !== undefined) data.keywords = parseCategoryKeywords(input.keywords).join(",");
    if (input.sort !== undefined && Number.isFinite(input.sort)) data.sort = input.sort;
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Nothing to change" },
      });
    }

    /**
     * The slug is deliberately not updatable.
     *
     * It is the value clients send and bookmarks hold. Renaming it would silently break
     * every saved tab and any cached client, and the operator's intent — "call this
     * something else" — is served by the labels.
     */
    return this.prisma.discoverCategory.update({
      where: { id },
      data,
      select: { id: true, slug: true, label: true, labelZh: true, keywords: true, sort: true, isActive: true },
    });
  }

  /**
   * Removes a category.
   *
   * A hard delete, unlike `IpBan` and `AttributeDefinition`: a category holds no history
   * and nothing references it by id — the filter is a query-string slug that simply falls
   * back to the unfiltered view once the row is gone. Deactivating is still available via
   * `isActive` for an operator who wants to keep the configuration but hide the tab.
   */
  async deleteDiscoverCategory(id: string) {
    const existing = await this.prisma.discoverCategory.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "CATEGORY_NOT_FOUND", message: "No such category" },
      });
    }
    await this.prisma.discoverCategory.delete({ where: { id } });
    return { id };
  }

  /**
   * A slug has to be safe in a query string and stable as an identifier.
   *
   * Restricted to lower-case letters, digits and hyphens so it needs no encoding, and
   * length-bounded so it cannot be used to fill a column. The two built-in slugs
   * (`language`, `gaming`) satisfy this, which is what lets an administrator take over
   * their rows without changing what clients send.
   */
  private assertCategorySlug(raw: string): string {
    const slug = (raw ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(slug)) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "分类标识只能包含小写字母、数字和连字符，且不能以连字符开头",
        },
      });
    }
    return slug;
  }

  /**
   * Resolves the accounts behind a page of access-log rows in one query.
   *
   * Only `id` / `nickname` / `email` — the console needs something to label a row
   * with and link on, nothing more. Unknown ids are simply absent from the map,
   * which is how a deleted account becomes an honest `null` instead of an error.
   */
  private async accountsFor(    userIds: Array<string | null>,
  ): Promise<Map<string, { id: string; nickname: string | null; email: string }>> {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, nickname: true, email: true },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Application-layer mirror of `AdminAuditLog_actor_consistency_check`.
   *
   * The database enforces exactly two legal shapes:
   *
   *     actorType = 'USER'   AND adminId IS NOT NULL
   *     actorType = 'SYSTEM' AND adminId IS NULL
   *
   * Checking the same rule here means a programming mistake fails in a unit
   * test with a readable message, instead of surfacing as a raw Postgres
   * `23514 check_violation` at insert time — or, worse, as a row that silently
   * misattributes a machine action to a human.
   *
   * The two forbidden states are precisely the ones the audit trail exists to
   * rule out:
   *   - `SYSTEM` + `adminId` — would make the platform look like a specific
   *     administrator acted (the forgery the requirement bans outright);
   *   - `USER` + `null` — an ownerless human action, unattributable by design.
   *
   * Kept in sync with the migration by `admin-audit.spec.ts`.
   */
  private assertActorConsistency(actorType: AuditActor, adminId: string | null): void {
    if (actorType === "SYSTEM" && adminId !== null) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "AUDIT_ACTOR_INVALID",
          message: "A SYSTEM audit entry cannot carry an adminId",
        },
      });
    }
    if (actorType === "USER" && !adminId) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "AUDIT_ACTOR_INVALID",
          message: "A USER audit entry requires an adminId",
        },
      });
    }
  }

  /**
   * Phase A: the single place human audit rows are written.
   *
   * Pass a transaction client to make the audit write atomic with the business
   * mutation it describes; if this insert throws, the surrounding transaction
   * rolls back and the action does not happen. Never write secrets here — only
   * the fields that changed.
   *
   * `actorType` defaults to `USER`, so every call site written before the
   * SYSTEM actor existed keeps producing exactly the row it always did. A
   * `SYSTEM` row can be written through here, but `recordSystemAudit` is the
   * intended entry point — it is the one that cannot be passed an `adminId`.
   */
  async recordAudit(input: AuditInput, client: AuditClient = this.prisma) {
    const actorType: AuditActor = input.actorType ?? "USER";
    const adminId = input.adminId ?? null;
    this.assertActorConsistency(actorType, adminId);

    return client.adminAuditLog.create({
      data: {
        actorType,
        adminId,
        action: input.action.slice(0, 64),
        targetType: input.targetType?.slice(0, 32) ?? null,
        targetId: input.targetId?.slice(0, 128) ?? null,
        reason: input.reason?.slice(0, 500) ?? null,
        before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: input.ip?.slice(0, 45) ?? null,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        detail: input.detail?.slice(0, 2000) ?? null,
      },
    });
  }

  /**
   * Records an action performed by the platform itself — a scheduler tick or
   * background job — rather than by any human.
   *
   * `actorType` is pinned to `SYSTEM` and `adminId` to `null` here, and the
   * input type has no `adminId` field at all. That is the whole point: no real
   * administrator's id can be borrowed to fill the actor column, and no
   * synthetic "system user" row is needed to satisfy the foreign key. The audit
   * trail stays honest about the fact that nobody was at the keyboard.
   *
   * Accepts a transaction client for the same atomicity guarantee as
   * `recordAudit`.
   */
  async recordSystemAudit(input: SystemAuditInput, client: AuditClient = this.prisma) {
    return this.recordAudit({ ...input, actorType: "SYSTEM", adminId: null }, client);
  }

  /** Maps an action to the resulting user columns. */
  private nextStatusState(action: UserStatusAction, reason: string, expiresAt: Date | null) {
    switch (action) {
      case "ban":
        return {
          status: "BANNED" as UserStatus,
          bannedAt: new Date(),
          banReason: reason.slice(0, 500),
          suspendedUntil: null,
        };
      case "suspend":
        return {
          status: "SUSPENDED" as UserStatus,
          bannedAt: null,
          banReason: reason.slice(0, 500),
          suspendedUntil: expiresAt,
        };
      case "disable":
        return {
          status: "DISABLED" as UserStatus,
          bannedAt: null,
          banReason: reason.slice(0, 500),
          suspendedUntil: null,
        };
      case "unban":
      case "activate":
      default:
        return {
          status: "ACTIVE" as UserStatus,
          bannedAt: null,
          banReason: null,
          suspendedUntil: null,
        };
    }
  }

  private dayStart() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
}
