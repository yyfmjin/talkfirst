import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { ValidationPipe } from "../common/validation.pipe";
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { PermissionGuard } from "./permission.guard";
import { RequirePermission } from "./require-permission.decorator";
import { AdminPublic } from "./admin-public.decorator";
import { AdminService } from "./admin.service";
import { UuidParamPipe } from "./uuid-param.pipe";
import { FeedbackService } from "../feedback/feedback.service";

class UserStatusDto {
  @IsIn(["ban", "unban", "disable", "activate", "suspend"])
  action!: "ban" | "unban" | "disable" | "activate" | "suspend";

  // Phase A: the reason is enforced as mandatory inside AdminService (400 when
  // missing or blank) so the rule holds even for callers that bypass this DTO.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Required when action = "suspend". */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

class ReportReviewDto {
  @IsIn(["reviewing", "resolved", "rejected"])
  action!: "reviewing" | "resolved" | "rejected";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * A new IP ban.
 *
 * `reason` is REQUIRED here, unlike on `UserStatusDto` where the service enforces it —
 * on this endpoint the DTO can state it directly, which gives a 400 before the service
 * is entered. A ban with no stated cause is unusable in a later review, which is the
 * whole reason the column is non-nullable.
 *
 * `ip` is only checked for presence and length: the real validation is
 * `normalizeIp` plus `isNonRoutableAddress` in the service, because "is this a
 * banable address" depends on the deployment's topology (loopback, private ranges),
 * not on syntax alone.
 */
class IpBanDto {
  @IsString()
  @MaxLength(64)
  ip!: string;

  @IsIn(["SECONDARY", "PRIMARY"])
  level!: "SECONDARY" | "PRIMARY";

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/** Lifting a ban. The reason is optional: the action itself is the record. */
class LiftIpBanDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Handling a feedback message.
 *
 * Both fields are optional and at least one is required, which the service enforces —
 * a status-only change is the common case (triaging a queue), and a reply without a
 * status change is the other.
 */
class FeedbackReviewDto {
  @IsOptional()
  @IsIn(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  replyBody?: string;
}

/** The member-facing support address.
 *
 * A blank string is meaningful and distinct from omission: it CLEARS the override and
 * falls back to the shipped default, which is how an operator undoes a bad value
 * without database access.
 */
class SupportEmailDto {
  @IsString()
  @MaxLength(320)
  supportEmail!: string;
}

/**
 * A moderation decision on a moment.
 *
 * Three actions rather than a free-text status, because the three are genuinely
 * different acts: approve makes it (or keeps it) public, reject refuses content that was
 * never public, and hide withdraws content that was. Letting a caller post an arbitrary
 * `ReviewStatus` would allow `PENDING`, which is the scanner's state and not a human
 * decision.
 */
class MomentReviewDto {
  @IsIn(["approve", "reject", "hide"])
  action!: "approve" | "reject" | "hide";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * A discover filter tab.
 *
 * `slug` is only accepted on create: it is what clients send in the query string, so
 * renaming one would silently break every saved tab. The labels are what an operator
 * changes.
 */
class DiscoverCategoryDto {
  @IsString()
  @MaxLength(48)
  slug!: string;

  @IsString()
  @MaxLength(48)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  labelZh?: string;

  /** Comma-separated interest/purpose slugs, e.g. `minecraft,steam`. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  keywords?: string;

  @IsOptional()
  sort?: number;
}

class DiscoverCategoryPatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  labelZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  keywords?: string;

  @IsOptional()
  sort?: number;

  @IsOptional()
  isActive?: boolean;
}

class AdminNoteDto {
  @IsString()
  @MaxLength(1000)
  body!: string;
}

/**
 * Phase O2 — query-string coercion for the access-log filters.
 *
 * A query parameter is always a string, but `statusCode` and the two booleans
 * are not. `Number("abc")` is `NaN`, which the service's `Number.isFinite` check
 * then drops — so a typo widens *nothing* rather than matching zero rows and
 * looking like an honest empty result.
 *
 * The booleans accept only the literal `"true"` / `"false"`; anything else is
 * `undefined` (no filter) rather than a JavaScript truthiness accident, where
 * `Boolean("false")` is `true` and the filter silently inverts.
 */
function optionalNumber(raw?: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(raw?: string): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/**
 * Phase A: every admin route declares the permission it needs.
 *
 * Guard order matters — `JwtAuthGuard` authenticates (401 `UNAUTHORIZED` when the
 * token is missing, malformed or expired; a domain code such as `USER_DISABLED`
 * when the account itself is unusable), `AdminGuard`
 * establishes admin identity and attaches `request.admin`, and only then does
 * `PermissionGuard` evaluate the declared permission.
 *
 * Phase C5: every `@Param` that names a row carries `UuidParamPipe`, so a path
 * parameter that is not a UUID is a `400 VALIDATION_ERROR` instead of a `500`
 * from Prisma's UUID parser. See `uuid-param.pipe.ts` for the observed
 * behaviour this replaces.
 */
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard, PermissionGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    /**
     * The same service the member-facing endpoints use, injected rather than
     * reimplemented so the address an operator saves is byte-for-byte the one a member
     * is shown.
     */
    private readonly feedbackService: FeedbackService,
  ) {}

  @Get("dashboard")
  @RequirePermission("dashboard:read")
  dashboard() {
    return this.adminService.dashboard().then((data) => ({ success: true as const, data }));
  }

  @Get("me")
  // Every authenticated admin may read their own identity and permission list,
  // so this route requires no *capability* — but `PermissionGuard` is now
  // fail-closed (audit P006), so the exemption has to be explicit rather than
  // implied by a missing decorator.
  @AdminPublic()
  me(@Req() request: AdminRequest) {
    return this.adminService.me(request.admin!).then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase B2: the users list.
   *
   * Every parameter is optional and forwarded as-is; `AdminService` owns the
   * defaults, the validation and the whitelists. That keeps one place where the
   * rules live — a controller that defaulted `status` here would be the second
   * place to update.
   *
   * `q` is still accepted (the pre-B2 name); `search` takes precedence.
   */
  @Get("users")
  @RequirePermission("users:read")
  users(
    @Query("search") search?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("country") country?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("sort") sort?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .searchUsers({
        search,
        q,
        status,
        country,
        createdFrom,
        createdTo,
        sort,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Get("users/:id")
  @RequirePermission("users:read")
  user(@Param("id", UuidParamPipe) id: string) {
    return this.adminService.userDetail(id).then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase B3: `POST` and `PATCH` are two routes onto **one** implementation.
   *
   * `POST /users/:id/status` predates B3 and is what the console, the browser
   * tests and the real-E2E script all send today. It is **kept exactly as it
   * was** — no redirect to PATCH, no change in behaviour — because deleting or
   * rewriting it would break every existing caller for a purely cosmetic gain.
   *
   * `PATCH` is the REST-conventional spelling of the same operation, added so a
   * new client can use the verb that matches a partial update. It is not a
   * second code path: both routes declare the same permission, the same
   * throttle, the same `UserStatusDto`, and both delegate to `applyStatus`,
   * which calls the single existing `AdminService.setStatus`. Duplicating the
   * status rules here would mean two places to keep in sync — and the RBAC and
   * business-rule guarantees would hold on whichever one was tested.
   *
   * The action vocabulary is unchanged (`activate` / `unban` / `disable` /
   * `suspend` / `ban`). B3 deliberately does **not** add `ACTIVE` / `SUSPENDED` /
   * `BANNED` actions: the role matrix and `ROLE_ALLOWED_STATUS_ACTIONS` are
   * written in terms of the existing action names, so a second vocabulary would
   * either bypass that gating or need a translation table nobody asked for.
   */
  @Post("users/:id/status")
  @RequirePermission("users:write")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  setStatus(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: UserStatusDto,
  ) {
    return this.applyStatus(request, id, dto);
  }

  /** Phase B3: the same operation, addressed with `PATCH`. */
  @Patch("users/:id/status")
  @RequirePermission("users:write")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  patchStatus(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: UserStatusDto,
  ) {
    return this.applyStatus(request, id, dto);
  }

  /**
   * The one place a status change is dispatched from.
   *
   * Everything that makes the operation safe — mandatory reason, expiry rules,
   * self- and admin-protection, role capability, the audit row — lives inside
   * `AdminService.setStatus`, so both verbs above inherit all of it by
   * construction rather than by convention.
   */
  private applyStatus(request: AdminRequest & Request, id: string, dto: UserStatusDto) {
    return this.adminService
      .setStatus({
        targetUserId: id,
        action: dto.action,
        reason: dto.reason,
        expiresAt: dto.expiresAt,
        admin: request.admin!,
        ip: clientIp(request),
        userAgent: request.headers["user-agent"] ?? null,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Post("users/:id/notes")
  @RequirePermission("users:write")
  addNote(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: AdminNoteDto,
  ) {
    return this.adminService
      .addNote(id, request.admin!, dto.body, clientIp(request), request.headers["user-agent"] ?? null)
      .then((data) => ({ success: true as const, data }));
  }

  @Get("reports")
  @RequirePermission("reports:read")
  reports(
    @Query("status") status?: string,
    @Query("reason") reason?: string,
    @Query("targetType") targetType?: string,
    @Query("reporter") reporter?: string,
    @Query("reportedUser") reportedUser?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .listReports({
        status,
        reason,
        targetType,
        reporter,
        reportedUser,
        createdFrom,
        createdTo,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase B4. Route order matters: `reports/:id` must not shadow
   * `reports/:id/review`, and Nest matches the more specific path first because
   * the review route is registered later with an extra segment. An unknown id
   * is a 404 `REPORT_NOT_FOUND` from the service, never a 200 with `null`.
   */
  @Get("reports/:id")
  @RequirePermission("reports:read")
  reportDetail(@Param("id", UuidParamPipe) id: string) {
    return this.adminService
      .reportDetail(id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("reports/:id/review")
  // FIX (audit P013): the report *queue* is gated on `reports:read`, but
  // adjudicating a report is content moderation, so the write is gated on
  // `moderation:write`. It previously required `reports:write`, which
  // CONTENT_MANAGER does not hold — so the role whose entire purpose is content
  // moderation could open 审核工作台 and have every action refused. The change
  // also tightens SUPPORT, which holds `reports:write` but not
  // `moderation:write`, and should not be banning people.
  @RequirePermission("moderation:write")
  review(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: ReportReviewDto,
  ) {
    return this.adminService
      .reviewReport(
        id,
        dto.action,
        request.admin!,
        dto.reason,
        clientIp(request),
        request.headers["user-agent"] ?? null,
      )
      .then((data) => ({ success: true as const, data }));
  }

  @Get("audit")
  @RequirePermission("audit:read")
  audit(@Query("page") page = "1", @Query("pageSize") pageSize = "20") {
    return this.adminService
      .listAudit(Number(page), Number(pageSize))
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase O2 — the HTTP access log ("网站访问日志").
   *
   * ## Why this is a new permission rather than `audit:read`
   *
   * `GET /admin/audit` returns `AdminAuditLog`: what *administrators* did. This
   * returns `AccessLog`: what *everyone* did, including anonymous visitors, and
   * it necessarily carries the raw client IP and raw User-Agent. `audit:read` is
   * held by all five roles, so reusing it would expose every visitor's IP to
   * support and content staff. `ops:read` is held by SUPER_ADMIN and ANALYST
   * only — the same holder set as the other privacy-sensitive read surfaces.
   *
   * ## Query handling
   *
   * Raw `@Query` strings are forwarded as-is and `AdminService` owns defaults,
   * coercion and bounds — the established split on this controller, which is why
   * `Number(...)` is not applied here.
   */
  @Get("access-logs")
  @RequirePermission("ops:read")
  accessLogs(
    @Query("ip") ip?: string,
    @Query("userId") userId?: string,
    @Query("path") path?: string,
    @Query("statusCode") statusCode?: string,
    @Query("riskLevel") riskLevel?: string,
    @Query("authenticated") authenticated?: string,
    @Query("isAdmin") isAdmin?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .listAccessLogs({
        ip,
        userId,
        path,
        statusCode: optionalNumber(statusCode),
        riskLevel,
        authenticated: optionalBoolean(authenticated),
        isAdmin: optionalBoolean(isAdmin),
        createdFrom,
        createdTo,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase O2 — aggregate counters over the same filter set as the list.
   *
   * Declared BEFORE `access-logs/:id` because Nest matches routes in declaration
   * order: with the parameterised route first, `GET /admin/access-logs/stats`
   * would be captured as `:id = "stats"` and answered with a 404 (or, worse, a
   * confusing not-found for a route that exists).
   */
  @Get("access-logs/stats")
  @RequirePermission("ops:read")
  accessLogStats(
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
  ) {
    return this.adminService
      .accessLogStats({ createdFrom, createdTo })
      .then((data) => ({ success: true as const, data }));
  }

  /** Phase O2 — one access-log row, addressed by its own id. */
  @Get("access-logs/:id")
  @RequirePermission("ops:read")
  accessLog(@Param("id", UuidParamPipe) id: string) {
    return this.adminService
      .accessLogDetail(id)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * IP bans ("IP 封禁").
   *
   * ## Why the read and the write are different permissions
   *
   * Listing bans is `ops:read` — it is the same operational data as the access log,
   * and it necessarily exposes addresses. Creating one is `ops:write`, which is held by
   * SUPER_ADMIN and MODERATOR. `ops:read`'s other holder, ANALYST, is read-only across
   * the entire console, so a single shared permission would either let ANALYST ban
   * addresses or leave nobody able to act on the list they can see.
   *
   * ## Why there is no delete
   *
   * A ban is lifted, never removed. `liftedAt`/`liftedById` keep the history, so "why
   * was this address blocked in March" stays answerable after the decision is reversed.
   *
   * ## Why `POST` carries the address verbatim
   *
   * `AdminService` normalises it through `normalizeIp` — the same function `AccessLog`
   * writes with — so a ban created from a log row keys on exactly the string that row
   * stored. Normalising in the controller as well would create a second chance to
   * diverge.
   */
  @Get("ip-bans")
  @RequirePermission("ops:read")
  ipBans(
    @Query("ip") ip?: string,
    @Query("includeLifted") includeLifted?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.adminService
      .listIpBans({
        ip,
        // Only the literal "true" opts in, so a typo shows the active list rather than
        // silently widening the screen to every ban ever issued.
        includeLifted: includeLifted === "true",
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Get("ip-bans/counts")
  @RequirePermission("ops:read")
  ipBanCounts() {
    return this.adminService
      .ipBanCounts()
      .then((data) => ({ success: true as const, data }));
  }

  @Post("ip-bans")
  @RequirePermission("ops:write")
  createIpBan(@Req() request: AdminRequest & Request, @Body(new ValidationPipe()) dto: IpBanDto) {
    return this.adminService
      .createIpBan(
        { ip: dto.ip, level: dto.level, reason: dto.reason, expiresAt: dto.expiresAt ?? null },
        request.admin!,
      )
      .then((data) => ({ success: true as const, data }));
  }

  @Post("ip-bans/:id/lift")
  @RequirePermission("ops:write")
  liftIpBan(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: LiftIpBanDto,
  ) {
    return this.adminService
      .liftIpBan(id, request.admin!, dto.reason)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Content moderation ("内容审核").
   *
   * This is the domain `moderation:read` / `moderation:write` were created for and which
   * did not exist until now — a fact an existing test recorded. The 审核工作台 screen is
   * the *reports* queue; this is the content queue, and the two are deliberately separate
   * endpoints because a report is a member's claim about content while a queue row is
   * content the scanner flagged.
   */
  @Get("moments/queue")
  @RequirePermission("moderation:read")
  momentQueue(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.adminService
      .listMomentQueue({
        status,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Get("moments/queue/counts")
  @RequirePermission("moderation:read")
  momentQueueCounts() {
    return this.adminService.momentQueueCounts().then((data) => ({ success: true as const, data }));
  }

  @Post("moments/:id/review")
  @RequirePermission("moderation:write")
  reviewMoment(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: MomentReviewDto,
  ) {
    return this.adminService
      .reviewMoment(id, dto.action, request.admin!, dto.reason)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Member feedback ("意见反馈").
   *
   * Gated on `moderation:*` rather than `ops:*`: answering a member is content
   * moderation work, which is what MODERATOR and CONTENT_MANAGER are for, and neither
   * of them holds any `ops:*` permission. Gating it on `ops:read` would have left the
   * queue readable only by SUPER_ADMIN and ANALYST, and writable by nobody.
   */
  @Get("feedback")
  @RequirePermission("moderation:read")
  feedback(
    @Query("status") status?: string,
    @Query("kind") kind?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.feedbackService
      .listForAdmin({
        status,
        kind,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Get("feedback/counts")
  @RequirePermission("moderation:read")
  feedbackCounts() {
    return this.feedbackService.adminCounts().then((data) => ({ success: true as const, data }));
  }

  @Post("feedback/:id/review")
  @RequirePermission("moderation:write")
  reviewFeedback(
    @Req() request: AdminRequest & Request,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: FeedbackReviewDto,
  ) {
    return this.feedbackService
      .review(id, { status: dto.status, replyBody: dto.replyBody }, { adminUserId: request.admin?.adminUserId ?? null })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * The support address members are shown.
   *
   * `settings:read` / `settings:write` — the permission pair that existed from the
   * beginning and had no implementation until this feature needed it. Held by
   * SUPER_ADMIN and ANALYST for reading, SUPER_ADMIN and MODERATOR for writing, which
   * is the right shape for "the address the product advertises".
   */
  @Get("settings/support-email")
  @RequirePermission("settings:read")
  supportEmail() {
    return this.feedbackService
      .readSupportEmailSetting()
      .then((data) => ({ success: true as const, data }));
  }

  @Patch("settings/support-email")
  @RequirePermission("settings:write")
  setSupportEmail(@Req() request: AdminRequest & Request, @Body(new ValidationPipe()) dto: SupportEmailDto) {
    return this.feedbackService
      .writeSupportEmailSetting(dto.supportEmail, request.admin?.adminUserId ?? null)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Discover filter tabs ("发现页类别").
   *
   * These were hardcoded in the frontend and in `DiscoverService`, which is why there were
   * only two. Gated on `settings:*` because a tab is product configuration rather than a
   * judgement about a member's content — the same reasoning as the support address.
   *
   * `:id` routes are declared after the two static paths (`categories/discover` is the
   * only other one) so a future static sibling cannot be captured as an id.
   */
  @Get("categories/discover")
  @RequirePermission("settings:read")
  discoverCategories(@Query("includeInactive") includeInactive?: string) {
    return this.adminService
      .listDiscoverCategories(includeInactive === "true")
      .then((data) => ({ success: true as const, data }));
  }

  @Post("categories/discover")
  @RequirePermission("settings:write")
  createDiscoverCategory(@Body(new ValidationPipe()) dto: DiscoverCategoryDto) {
    return this.adminService
      .createDiscoverCategory({
        slug: dto.slug,
        label: dto.label,
        labelZh: dto.labelZh ?? null,
        keywords: dto.keywords ?? "",
        sort: dto.sort,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Patch("categories/discover/:id")
  @RequirePermission("settings:write")
  updateDiscoverCategory(
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: DiscoverCategoryPatchDto,
  ) {
    return this.adminService
      .updateDiscoverCategory(id, {
        label: dto.label,
        labelZh: dto.labelZh,
        keywords: dto.keywords,
        sort: dto.sort,
        isActive: dto.isActive,
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Delete("categories/discover/:id")
  @RequirePermission("settings:write")
  deleteDiscoverCategory(@Param("id", UuidParamPipe) id: string) {
    return this.adminService
      .deleteDiscoverCategory(id)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C1: the Risk Center overview.
   *
   * Read-only by design, and the only Risk route that exists — there is no
   * `/risk/:id`, `/risk/events`, `/risk/actions` or `/risk/score`, because
   * there is no risk model behind them to serve. The response is a count of
   * stored facts plus three recent feeds, and it deliberately carries no
   * `riskLevel` or `riskScore`: assigning a severity would be a business rule
   * nobody has defined, and inventing one is exactly what this phase forbids.
   *
   * `risk:read` is held by SUPER_ADMIN, MODERATOR and ANALYST — read from the
   * real matrix in `permissions.ts`, not assumed. SUPPORT and CONTENT_MANAGER
   * are refused with 403 by `PermissionGuard` before this body runs.
   */
  @Get("risk")
  @RequirePermission("risk:read")
  risk() {
    return this.adminService
      .riskOverview()
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C2: the connections list.
   *
   * Read-only, and the two routes below are the only Connection routes that
   * exist. There is no `POST`/`PATCH`/`DELETE` here even though
   * `connections:write` is present in the permission matrix: the matrix
   * describes which role may hold which capability, not which capabilities this
   * phase has to ship. C2 is an inspection console for connections, so it
   * inspects.
   *
   * `connections:read` is held by SUPER_ADMIN and ANALYST — read from the real
   * matrix in `permissions.ts`, not assumed. MODERATOR, SUPPORT and
   * CONTENT_MANAGER are refused with 403 `PERMISSION_DENIED` by
   * `PermissionGuard` before this body runs; a MODERATOR does not gain
   * connection access by virtue of holding moderation access.
   *
   * Every parameter is optional and forwarded as-is. `AdminService` owns the
   * defaults, the validation and the whitelists, so the rules live in one
   * place — a controller that defaulted `status` here would be a second place
   * to keep in sync.
   */
  @Get("connections")
  @RequirePermission("connections:read")
  connections(
    @Query("status") status?: string,
    @Query("user") user?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("sort") sort?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .listConnections({
        status,
        user,
        createdFrom,
        createdTo,
        sort,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C2: one connection in full.
   *
   * An unknown id is a 404 `CONNECTION_NOT_FOUND` thrown by the service, never
   * a `200` with a `null` body — the same guarantee `reports/:id` and
   * `users/:id` already carry.
   *
   * Route order is not a hazard here: `connections` and `connections/:id` are
   * distinct paths with no shared prefix ambiguity, unlike
   * `reports/:id` vs `reports/:id/review`.
   */
  @Get("connections/:id")
  @RequirePermission("connections:read")
  connectionDetail(@Param("id", UuidParamPipe) id: string) {
    return this.adminService
      .connectionDetail(id)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C3: the contact-exchange list.
   *
   * Read-only, and together with `exchanges/:id` these are the only Exchange
   * routes that exist. There is no `POST`/`PATCH`/`DELETE` here even though
   * `exchanges:write` is present in the permission matrix: the matrix describes
   * which role may hold which capability, not which capabilities this phase has
   * to ship. C3 is an inspection console for contact exchanges, so it inspects.
   *
   * `exchanges:read` is held by SUPER_ADMIN and ANALYST — read from the real
   * matrix in `permissions.ts`, not assumed. MODERATOR, SUPPORT and
   * CONTENT_MANAGER are refused with 403 `PERMISSION_DENIED` by
   * `PermissionGuard` before this body runs.
   *
   * Every parameter is optional and forwarded as-is; `AdminService` owns the
   * defaults, the validation and the whitelists, so the rules live in one place.
   */
  @Get("exchanges")
  @RequirePermission("exchanges:read")
  exchanges(
    @Query("status") status?: string,
    @Query("platform") platform?: string,
    @Query("user") user?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("sort") sort?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .listExchanges({
        status,
        platform,
        user,
        createdFrom,
        createdTo,
        sort,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C3: one contact exchange in full.
   *
   * An unknown id is a 404 `EXCHANGE_NOT_FOUND` thrown by the service, never a
   * `200` with a `null` body — the same guarantee `reports/:id`,
   * `users/:id` and `connections/:id` already carry.
   *
   * Route order is not a hazard here: `exchanges` and `exchanges/:id` are
   * distinct paths with no shared-prefix ambiguity.
   */
  @Get("exchanges/:id")
  @RequirePermission("exchanges:read")
  exchangeDetail(@Param("id", UuidParamPipe) id: string) {
    return this.adminService
      .exchangeDetail(id)
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C4: the blocks list.
   *
   * Read-only, and together with the pair-addressed detail route below these
   * are the only Block routes that exist. There is no `POST`/`PATCH`/`DELETE`
   * here even though `blocks:write` is present in the permission matrix: the
   * matrix describes which role may hold which capability, not which
   * capabilities this phase has to ship. C4 is an inspection console for block
   * relationships, so it inspects — unblocking, creating a block and bulk
   * operations are all explicitly out of scope.
   *
   * `blocks:read` is held by SUPER_ADMIN and ANALYST — read from the real
   * matrix in `permissions.ts`, not assumed. MODERATOR, SUPPORT and
   * CONTENT_MANAGER are refused with 403 `PERMISSION_DENIED` by
   * `PermissionGuard` before this body runs.
   *
   * Every parameter is optional and forwarded as-is; `AdminService` owns the
   * defaults, the validation and the whitelists, so the rules live in one place.
   */
  @Get("blocks")
  @RequirePermission("blocks:read")
  blocks(
    @Query("user") user?: string,
    @Query("blocker") blocker?: string,
    @Query("blocked") blocked?: string,
    @Query("createdFrom") createdFrom?: string,
    @Query("createdTo") createdTo?: string,
    @Query("sort") sort?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "20",
  ) {
    return this.adminService
      .listBlocks({
        user,
        blocker,
        blocked,
        createdFrom,
        createdTo,
        sort,
        page: Number(page),
        pageSize: Number(pageSize),
      })
      .then((data) => ({ success: true as const, data }));
  }

  /**
   * Phase C4: one block relationship, addressed by **both** halves of its key.
   *
   * The path is `blocks/:blockerId/:blockedId` rather than `blocks/:id` because
   * `Block` declares `@@id([blockerId, blockedId])` and has no `id` column —
   * there is no single value that identifies a row. A route taking one `:id`
   * would have to invent an identifier the database cannot resolve back.
   *
   * An unknown pair is a 404 `BLOCK_NOT_FOUND` thrown by the service, never a
   * `200` with a `null` body — the same guarantee `reports/:id`, `users/:id`,
   * `connections/:id` and `exchanges/:id` already carry.
   *
   * Route order is not a hazard here: `blocks` and
   * `blocks/:blockerId/:blockedId` are distinct paths with no shared-prefix
   * ambiguity, and there is no third `blocks/...` route for either to shadow.
   */
  @Get("blocks/:blockerId/:blockedId")
  @RequirePermission("blocks:read")
  blockDetail(
    @Param("blockerId", UuidParamPipe) blockerId: string,
    @Param("blockedId", UuidParamPipe) blockedId: string,
  ) {
    return this.adminService
      .blockDetail(blockerId, blockedId)
      .then((data) => ({ success: true as const, data }));
  }
}

/** Best-effort client IP, honouring a proxy header when present. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === "string" && raw.length > 0) {
    return raw.split(",")[0].trim().slice(0, 45);
  }
  return request.ip?.slice(0, 45) ?? null;
}
