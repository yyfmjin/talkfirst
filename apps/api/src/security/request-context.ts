import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Security Audit Center (P1) — per-request context.
 *
 * Audit writers need the request id, IP and User-Agent every time they record
 * something, but the services that know *what* happened (AuthService,
 * VerificationService) are not request-scoped and must not grow a controller-
 * shaped parameter list just to carry them. `AsyncLocalStorage` lets the request
 * metadata follow the async call chain instead: the middleware seeds it once and
 * anything downstream can read it without plumbing.
 */
export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  referer?: string;
  origin?: string;
  acceptLanguage?: string;
  contentType?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

/** Returns the context for the in-flight request, or `undefined` outside one. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
