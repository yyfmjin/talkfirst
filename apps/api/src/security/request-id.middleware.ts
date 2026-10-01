import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getClientIp } from "./client-ip";
import { runWithRequestContext } from "./request-context";

/**
 * Security Audit Center (P1) — request correlation id.
 *
 * A valid upstream `X-Request-Id` is honoured so a trace can span proxies and
 * services; anything else is replaced with a server-generated UUID. The value is
 * validated strictly (length + charset) so a client cannot inject arbitrary,
 * oversized or log-breaking content into the audit trail — and it is echoed back
 * on the response so support can quote it.
 */
export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_ID_RESPONSE_HEADER = "X-Request-Id";

const MAX_REQUEST_ID_LENGTH = 64;
const MIN_REQUEST_ID_LENGTH = 8;
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]+$/;

/** Returns the upstream id when it is actually usable, otherwise `undefined`. */
export function sanitizeRequestId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_REQUEST_ID_LENGTH || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return undefined;
  }
  return VALID_REQUEST_ID.test(trimmed) ? trimmed : undefined;
}

export function resolveRequestId(raw: unknown): string {
  return sanitizeRequestId(raw) ?? randomUUID();
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function requestPath(request: Request): string {
  const url = request.originalUrl ?? request.url ?? "";
  const queryIndex = url.indexOf("?");
  return (queryIndex === -1 ? url : url.slice(0, queryIndex)).slice(0, 256);
}

/**
 * Seeds the per-request context and the response header. Registered as the very
 * first middleware in `main.ts` so both are available to guards, interceptors
 * and services for the whole lifetime of the request.
 */
export function createRequestIdMiddleware(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);
    response.setHeader(REQUEST_ID_RESPONSE_HEADER, requestId);

    runWithRequestContext(
      {
        requestId,
        ip: getClientIp(request),
        userAgent: headerValue(request.headers["user-agent"]),
        method: request.method,
        path: requestPath(request),
        referer: headerValue(request.headers["referer"]),
        origin: headerValue(request.headers["origin"]),
        acceptLanguage: headerValue(request.headers["accept-language"]),
        contentType: headerValue(request.headers["content-type"]),
      },
      () => next(),
    );
  };
}
