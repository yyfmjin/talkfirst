import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ERROR_CODE_HEADER } from "../security/access-log.middleware";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiException");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === "object" && payload !== null && "success" in payload) {
        return this.send(response, exception.getStatus(), payload);
      }
      const message =
        typeof payload === "string"
          ? payload
          : ((payload as { message?: unknown }).message ?? exception.message);
      // Phase A+: a 401 is an authentication failure by definition, so it gets a
      // domain code rather than the generic HTTP_ERROR. This is a safety net for
      // any handler that still throws a bare UnauthorizedException instead of
      // using JwtAuthGuard — the client contract stays "error.code tells you
      // what happened". Only the code changes; status and shape are unchanged.
      const code = exception.getStatus() === HttpStatus.UNAUTHORIZED ? "UNAUTHORIZED" : "HTTP_ERROR";
      return this.send(response, exception.getStatus(), {
        success: false,
        error: { code, message: message || "Authentication required" },
      });
    }

    this.logger.error(String((exception as Error)?.stack ?? exception));
    return this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
  }

  /**
   * Phase O1 — writes the response and, alongside it, echoes the domain error
   * code on an internal header.
   *
   * `AccessLogMiddleware` has only `res.on("finish")`, which exposes a status
   * code but not the domain code. This filter is the one place that knows the
   * real code (including pass-through payloads from guards and services), so it
   * hands it over here. The header is internal: no client ever sees it.
   *
   * FIX (content management phase) — the cleanup used to be a synchronous
   * `removeHeader` right after `send()`, and `send()` ends the response: once the
   * headers are flushed, `removeHeader` throws `ERR_HTTP_HEADERS_SENT`. Express
   * caught that and still answered correctly, so no response was ever wrong — but
   * every rejection logged a throw from inside the error handler, and the
   * management screens make rejection an ordinary path (a 404 from editing a
   * deleted comment, a 403 from someone else's comment).
   *
   * Making the removal EARLIER is not the fix: the access log reads this header
   * when the response finishes, so removing it before or during the send would
   * silently downgrade every logged error code to the status-derived fallback.
   * The property is therefore deleted on the next turn of the event loop — after
   * `finish` has fired and been handled, and after the message is on the wire —
   * so the code still reaches the audit row and the header still cannot be seen
   * by a client. `setImmediate` rather than a microtask: the `finish` listener is
   * itself scheduled off the end of the message, and microtasks run before it.
   */
  private send(response: Response, status: number, body: unknown) {
    const code = extractErrorCode(body);
    if (code && echoErrorCode(response, code)) scheduleHeaderCleanup(response);
    return response.status(status).json(body);
  }
}

/**
 * Attaches the internal header, tolerating a response that is already committed.
 *
 * A diagnostic must never be the reason a client fails to receive its answer, so
 * this reports whether the header was attached instead of throwing. The envelope
 * itself is deliberately NOT wrapped: if the response cannot be sent at all, that
 * is a real failure and Express has to see it.
 */
function echoErrorCode(response: Response, code: string): boolean {
  try {
    response.setHeader(ERROR_CODE_HEADER, code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Response objects whose internal header is already queued for removal.
 *
 * Module-scoped so the callback does not retain the response: the scheduling
 * itself is the only thing that needs to remember it, and this set is cleared as
 * each entry runs. Not exported — the cleanup is this filter's own concern.
 */
const CLEANUP_PENDING = new WeakSet<object>();

function scheduleHeaderCleanup(response: Response) {
  if (CLEANUP_PENDING.has(response)) return;
  CLEANUP_PENDING.add(response);
  setImmediate(() => {
    CLEANUP_PENDING.delete(response);
    // The response has been sent by now, so `removeHeader` would throw; deleting
    // the own property is what actually stops the value from being written again.
    delete (response as unknown as Record<string, unknown>)[ERROR_CODE_HEADER];
  });
}

/** Pulls `error.code` out of a response body, when it has one. */
function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const nested = (body as { error?: { code?: unknown } }).error;
  return typeof nested?.code === "string" ? nested.code : undefined;
}
