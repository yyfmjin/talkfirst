import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, catchError, tap, throwError } from "rxjs";
import { summarizeQuery } from "../common/redact";
import { AccessLogService } from "./access-log.service";
import { deviceHash } from "./device-hash";
import { getRequestContext } from "./request-context";
import { accessRiskLevel } from "./security.constants";

/**
 * Security Audit Center (P1) — global HTTP access logging.
 *
 * Records one `AccessLog` row for every handled request, on success *and* on
 * failure. Three things matter most here:
 *
 * 1. **It never changes the response.** The write is fire-and-forget and the
 *    service swallows its own errors, so a broken audit table cannot break the
 *    API.
 * 2. **It never queries the database for context.** `request.user`, headers and
 *    the ambient request context already hold everything needed; an extra
 *    lookup per request would be a real cost for no benefit.
 * 3. **It never stores sensitive material.** The query string is reduced to a
 *    whitelisted digest; there is no body capture at all.
 *
 * Requests rejected by a guard (401/403/429) never reach an interceptor, so the
 * throttler emits its own 429 record — see `HttpThrottlerGuard`.
 */
@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  constructor(private readonly accessLogs: AccessLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const startedAt = Date.now();

    const finish = (statusCode: number, errorCode?: string) => {
      const ambient = getRequestContext();
      const path = ambient?.path ?? pathOf(request);
      const userAgent = ambient?.userAgent ?? headerValue(request.headers["user-agent"]);
      const user = request.user as { id?: string } | undefined;

      void this.accessLogs.write({
        requestId: ambient?.requestId ?? "unknown",
        method: request.method,
        path,
        queryDigest: summarizeQuery(request.query),
        statusCode,
        durationMs: Date.now() - startedAt,
        userId: user?.id,
        authenticated: Boolean(user?.id),
        isAdmin: isAdminPath(path),
        ip: ambient?.ip,
        deviceHash: deviceHash(userAgent),
        userAgent,
        referer: headerValue(request.headers["referer"]),
        origin: headerValue(request.headers["origin"]),
        acceptLanguage: headerValue(request.headers["accept-language"]),
        contentType: headerValue(request.headers["content-type"]),
        errorCode,
        riskLevel: accessRiskLevel(statusCode),
      });
    };

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<{ statusCode?: number }>();
        finish(response?.statusCode ?? 200);
      }),
      catchError((error: unknown) => {
        finish(statusOf(error), errorCodeOf(error));
        // Re-throw untouched: the exception filter still owns the response.
        return throwError(() => error);
      }),
    );
  }
}

function statusOf(error: unknown): number {
  return error instanceof HttpException ? error.getStatus() : 500;
}

/**
 * Mirrors the mapping in `ApiExceptionFilter` so the audit row's `errorCode`
 * always matches the code the client actually received.
 */
export function errorCodeOf(error: unknown): string {
  if (error instanceof HttpException) {
    const payload = error.getResponse();
    if (payload && typeof payload === "object" && "error" in payload) {
      const nested = (payload as { error?: { code?: unknown } }).error;
      if (nested && typeof nested.code === "string") return nested.code;
    }
    return error.getStatus() === 401 ? "UNAUTHORIZED" : "HTTP_ERROR";
  }
  return "INTERNAL_ERROR";
}

const ADMIN_PATH_PREFIXES = ["/api/v1/admin", "/admin"];

function isAdminPath(path: string): boolean {
  return ADMIN_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function pathOf(request: Request): string {
  const url = request.originalUrl ?? request.url ?? "";
  const queryIndex = url.indexOf("?");
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}
