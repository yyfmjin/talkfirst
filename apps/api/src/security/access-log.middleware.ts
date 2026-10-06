import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AccessLogService } from "./access-log.service";
import type { DeviceIdentityService } from "./device-identity.service";
import { summarizeQuery } from "../common/redact";
import { deviceHash } from "./device-hash";
import { getRequestContext } from "./request-context";
import { accessChannel } from "./access-channel";
import { accessRiskLevel } from "./security.constants";

/**
 * Phase O1 — access logging as a *middleware*, not an interceptor.
 *
 * ## The defect this fixes
 *
 * `AccessLogInterceptor` was registered as `APP_INTERCEPTOR`, and interceptors
 * run **after** guards in Nest's request lifecycle. So any request a guard
 * rejected — `JwtAuthGuard` on every protected controller, `AdminGuard`,
 * `PermissionGuard` on the whole admin surface — was answered *before* the
 * interceptor existed, and left **no AccessLog row at all**.
 *
 * Measured on the running API: an unauthenticated `GET /api/v1/users/me`
 * returned 401 and produced zero rows, while the same window contained 19 rows
 * for requests that reached a handler. The audit trail was therefore blind to
 * precisely the traffic it exists to catch: anonymous probing of protected
 * endpoints. A `404` on an unmatched route was equally invisible, because no
 * handler and therefore no interceptor ran.
 *
 * ## Why middleware is the only correct layer
 *
 * Guards short-circuit before interceptors, so no interceptor can ever observe
 * a guard rejection. Middleware is the only hook that runs for *every* request
 * regardless of routing or guards, and `res.on("finish")` is the only event that
 * fires for every response no matter which layer produced it (handler, guard,
 * Nest's built-in 404, or the exception filter).
 *
 * ## No double-writing
 *
 * The interceptor no longer writes anything; this middleware is the single
 * writer, so exactly one row is produced per request. The interceptor keeps the
 * pure `errorCodeOf` helper, which is still used (and tested) for mapping thrown
 * exceptions to codes.
 *
 * ## Keeping the real error code
 *
 * `res.on("finish")` only exposes a status code, but the audit row wants the
 * domain code (`RATE_LIMITED`, `PERMISSION_DENIED`, …). `ApiExceptionFilter`
 * runs as the response is produced and therefore *can* see the real code, so it
 * echoes it on an internal response header which is read here. That header is
 * deleted from the outgoing response so no client ever sees it, and when it is
 * absent (guard rejections, Nest's built-in 404) the code is derived from the
 * status instead of guessed.
 *
 * ## Fault isolation
 *
 * As before, the write is fire-and-forget and `AccessLogService.write()` never
 * throws, so auditing can never change a response.
 */

/** Response header used internally to carry the domain error code. */
export const ERROR_CODE_HEADER = "x-tf-error-code";

export function createAccessLogMiddleware(
  accessLogs: AccessLogService,
  devices?: DeviceIdentityService,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = Date.now();

    response.once("finish", () => {
      try {
        const context = getRequestContext();
        const path = context?.path ?? pathOf(request);
        const userAgent = context?.userAgent ?? headerValue(request.headers["user-agent"]);
        // `request.user` is set by Passport during guard execution, which for a
        // rejected request never happens — so a guard rejection is correctly
        // recorded as anonymous rather than as nobody-knows.
        const user = request.user as { id?: string } | undefined;
        const statusCode = response.statusCode ?? 200;

        // 「是否后台路径」只算一次：`isAdmin` 字段与渠道分类必须用同一个判断，
        // 两处各算一遍退了迟早会漂（改了一处前缀、另一处忘了）。
        const adminPath = isAdminPath(path);

        void accessLogs.write({
          requestId: context?.requestId ?? "unknown",
          method: request.method,
          path,
          queryDigest: summarizeQuery(request.query),
          statusCode,
          durationMs: Date.now() - startedAt,
          userId: user?.id,
          authenticated: Boolean(user?.id),
          isAdmin: adminPath,
          channel: accessChannel({ isAdminPath: adminPath, ip: context?.ip }),
          ip: context?.ip,
          deviceHash: deviceHash(userAgent),
          userAgent,
          referer: headerValue(request.headers["referer"]),
          origin: headerValue(request.headers["origin"]),
          acceptLanguage: headerValue(request.headers["accept-language"]),
          contentType: headerValue(request.headers["content-type"]),
          errorCode: statusCode >= 400 ? resolveErrorCode(response) : undefined,
          riskLevel: accessRiskLevel(statusCode),
        });

        // Device discovery: "this account was seen on this device" for every
        // authenticated request. `loginCount` is deliberately not bumped here —
        // this is traffic, not authentication (see `DeviceIdentityService`).
        if (user?.id) {
          void devices?.record({ userAgent, userId: user.id });
        }
      } catch (error) {
        // Belt-and-braces: a bug while *assembling* the row must not break the
        // response. `write()` already swallows its own failures.
        void error;
      }
    });

    next();
  };
}

/**
 * The domain code for a failed response.
 *
 * Prefers the code the exception filter actually produced. Falls back to a
 * status-derived code, which is all that is available when Nest itself answered
 * (a guard rejection or the built-in 404 handler) and no filter ran on our side.
 */
export function resolveErrorCode(response: Response): string {
  const echoed = response.getHeader?.(ERROR_CODE_HEADER);
  const code = Array.isArray(echoed) ? echoed[0] : echoed;
  if (typeof code === "string" && code.length > 0) return code.slice(0, 48);
  return statusErrorCode(response.statusCode ?? 500);
}

/**
 * Status → code, for responses that never passed through `ApiExceptionFilter`.
 */
export function statusErrorCode(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "HTTP_ERROR";
  }
}

const ADMIN_PATH_PREFIXES = ["/api/v1/admin", "/admin"];

/**
 * True when the request targeted an admin route.
 *
 * The prefix must be followed by a path separator (or be the whole path), not
 * merely start the string: a plain `startsWith` also flags `/api/v1/administrators`,
 * which is an ordinary-looking public path being labelled as an admin-surface
 * request in the audit trail. Found while migrating the logging to middleware.
 */
export function isAdminPath(path: string): boolean {
  return ADMIN_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function pathOf(request: Request): string {
  const url = request.originalUrl ?? request.url ?? "";
  const queryIndex = url.indexOf("?");
  return (queryIndex === -1 ? url : url.slice(0, queryIndex)).slice(0, 256);
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
