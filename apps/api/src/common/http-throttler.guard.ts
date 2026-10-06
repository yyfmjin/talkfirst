import { ExecutionContext, Inject, Injectable } from "@nestjs/common";
import {
  ThrottlerGuard,
  ThrottlerRequest,
  type ThrottlerLimitDetail,
} from "@nestjs/throttler";
import type { Request } from "express";
import { summarizeQuery } from "./redact";
import { AccessLogService } from "../security/access-log.service";
import { accessChannel } from "../security/access-channel";
import { isAdminPath } from "../security/access-log.middleware";
import { deviceHash } from "../security/device-hash";
import { getRequestContext } from "../security/request-context";
import { SecurityEventService } from "../security/security-event.service";
import {
  RiskLevel,
  SecurityEventSource,
  SecurityEventType,
  accessRiskLevel,
} from "../security/security.constants";

/**
 * Requests allowed per IP per minute, when a route does not declare its own
 * limit.
 *
 * 120 is the production default; every environment gets it unless it opts out.
 * Read from the environment so there is one code path rather than an
 * `if (test)` branch that ships untested behaviour.
 *
 * Note this only governs the *global default*. Most sensitive routes declare a
 * `@Throttle({ limit: N })` override, which this function never sees — see
 * `throttleMultiplier()`.
 */
export function globalThrottleLimit(): number {
  const raw = process.env.THROTTLE_LIMIT;
  if (!raw) return 120;
  const parsed = Number(raw);
  // A malformed value must not silently disable throttling.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

/**
 * Multiplier applied to *every* limit, including per-route `@Throttle`
 * overrides.
 *
 * ## Why a multiplier rather than only a global limit
 *
 * Sensitive routes carry their own limit. `POST /auth/login` is capped at
 * **50/min** — well below the global 120 (`auth.controller.ts`). A browser
 * suite's dominant traffic is logins, and the admin Playwright suite performs
 * roughly 74 of them, so it crosses 50/min mid-run and receives a genuine 429
 * no matter what the global limit is set to. Raising `THROTTLE_LIMIT` alone was
 * tried first and changed nothing; that dead end is what this function exists
 * to close.
 *
 * Defaults to `1` — no change whatsoever — so production, staging and any
 * environment that does not set the variable behave exactly as before. Only an
 * explicit `THROTTLE_MULTIPLIER` loosens anything, and its intended use is
 * local test runs. Relative shaping is preserved: a route limited to 10 stays
 * stricter than one limited to 60.
 */
export function throttleMultiplier(): number {
  const raw = process.env.THROTTLE_MULTIPLIER;
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * API rate limiting.
 *
 * Phase A+: HTTP only. The guard is global, so websocket and queue contexts
 * pass straight through — they have no client IP to key on and must not be
 * throttled.
 *
 * B4 follow-up: every limit is scaled by `THROTTLE_MULTIPLIER`, so a raised
 * ceiling reaches per-route overrides such as `login`, not merely the global
 * default. The scaling happens in `handleRequest`, the hook `ThrottlerGuard`
 * itself calls once per throttler with the already-resolved per-route limit —
 * so all 17 `@Throttle` decorators are covered from this one place.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  /**
   * Observation-only dependencies. Injected as optional properties rather than
   * constructor parameters so the guard's inherited constructor signature (and
   * therefore the throttler's own DI contract) stays exactly as it was; a
   * failure to inject can only *disable auditing*, never break rate limiting.
   */
  @Inject(SecurityEventService)
  private securityEvents?: SecurityEventService;

  @Inject(AccessLogService)
  private accessLogs?: AccessLogService;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    return super.canActivate(context);
  }

  /**
   * Scales the resolved limit (per-route override or module default) before the
   * hit is recorded. `ttl` is deliberately left untouched: multiplying the
   * window as well as the budget would make the effective rate unchanged, which
   * is not what a test run wants.
   *
   * `limit` is an integer by construction, and `Math.max(1, …)` guarantees a
   * multiplier below 1 can never round a limit down to zero and lock a route
   * out entirely.
   */
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const multiplier = throttleMultiplier();
    if (multiplier === 1) return super.handleRequest(requestProps);
    return super.handleRequest({
      ...requestProps,
      limit: Math.max(1, Math.floor(requestProps.limit * multiplier)),
    });
  }

  /**
   * Security Audit Center (P1): observes the moment a request is actually
   * blocked. Guards run *before* interceptors, so a 429 never reaches the
   * access-log interceptor — this hook is the only place that sees it.
   *
   * The contract with the throttler is unchanged: the original exception is
   * still thrown by `super`. Observation is fire-and-forget and wrapped in a
   * try/catch, so auditing can never turn a 429 into something else.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    this.observeRateLimit(context);
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }

  private observeRateLimit(context: ExecutionContext): void {
    try {
      if (context.getType() !== "http") return;
      const request = context.switchToHttp().getRequest<Request>();
      const ambient = getRequestContext();
      const path = ambient?.path ?? stripQuery(request.originalUrl ?? request.url ?? "");
      const userAgent = ambient?.userAgent ?? headerValue(request.headers["user-agent"]);
      const userId = (request.user as { id?: string } | undefined)?.id;
      const hash = deviceHash(userAgent);

      void this.securityEvents?.record({
        type: SecurityEventType.RATE_LIMITED,
        source: SecurityEventSource.THROTTLE,
        riskLevel: RiskLevel.MEDIUM,
        userId,
        ip: ambient?.ip,
        userAgent,
        deviceHash: hash,
        method: request.method,
        path,
        statusCode: 429,
        requestId: ambient?.requestId,
        success: false,
        detail: { reasonCode: "RATE_LIMITED" },
      });

      // 「是否后台路径」共用同一个判断：这里原本是一行内联的 `startsWith`，
      // 既与中间件重复，又少了分隔符校验 —— `/api/v1/administrators` 这种普通公开路径
      // 会被它当成后台请求（中间件那边已经把这条修掉了，这里跟着收敛）。
      const adminPath = isAdminPath(path);

      void this.accessLogs?.write({
        requestId: ambient?.requestId ?? "unknown",
        method: request.method,
        path,
        queryDigest: summarizeQuery(request.query),
        statusCode: 429,
        // The guard fires before the handler starts, so no measurable duration
        // exists yet. P2 can thread a start timestamp through if it matters.
        durationMs: 0,
        userId,
        authenticated: Boolean(userId),
        isAdmin: adminPath,
        channel: accessChannel({ isAdminPath: adminPath, ip: ambient?.ip }),
        ip: ambient?.ip,
        deviceHash: hash,
        userAgent,
        referer: headerValue(request.headers["referer"]),
        origin: headerValue(request.headers["origin"]),
        acceptLanguage: headerValue(request.headers["accept-language"]),
        contentType: headerValue(request.headers["content-type"]),
        errorCode: "RATE_LIMITED",
        riskLevel: accessRiskLevel(429),
      });
    } catch {
      // Observation must never affect throttling.
    }
  }
}

function stripQuery(url: string): string {
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
