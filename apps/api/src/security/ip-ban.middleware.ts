import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ERROR_CODE_HEADER } from "./access-log.middleware";
import { getClientIp } from "./client-ip";
import { IpBanService, isAllowedWhileSecondaryBanned, type ActiveBan } from "./ip-ban.service";

/**
 * Refuses requests from a banned address.
 *
 * ## Where this sits in the stack, and why the order is load-bearing
 *
 * `main.ts` registers this AFTER `createRequestIdMiddleware` and BEFORE
 * `createAccessLogMiddleware`:
 *
 *   requestId → [ipBan] → accessLog → cookieParser → body parsers
 *
 * 1. **After requestId** so `getRequestContext()` already holds the resolved IP. This
 *    middleware deliberately does not resolve the address itself — see below.
 * 2. **Before accessLog** so a refused request still produces an `AccessLog` row. If
 *    the check ran first, the traffic a ban exists to stop would be the only traffic
 *    with no audit trail, and an operator could not tell a working ban from a
 *    misconfigured one that never fired. It also means a ban that accidentally
 *    catches the operator's own address is visible in the log rather than silent.
 *
 * ## One IP implementation, on purpose
 *
 * The address comes from `getClientIp(request)` — the same function `AccessLog`
 * writes with. Resolving it independently here (reading `X-Forwarded-For`, say) would
 * mean the ban list and the audit trail could disagree about who a request came from.
 * Behind Cloudflare + Nginx that disagreement is not academic: the wrong answer is a
 * Cloudflare or Nginx address, and banning one of those refuses the entire site to
 * every member. Sharing the resolution is the only way the two can never diverge.
 *
 * ## Admin routes are never blocked
 *
 * A PRIMARY ban refuses everything, and "everything" would include the admin console
 * an operator uses to lift the ban. That turns a mis-typed address into a permanent
 * lockout requiring database surgery. Admin paths are therefore exempt at every level.
 * This is a deliberate asymmetry: an operator can always get back in, and the
 * exemption is narrow (the console's own prefix) rather than broad.
 *
 * ## The response body copies the app's envelope
 *
 * `{ success: false, error: { code, message } }`, matching `ApiExceptionFilter`, so a
 * client's existing error handling reads it without a special case. The `reason` an
 * operator typed is NOT echoed — it is internal notes, and on a PRIMARY ban telling an
 * attacker what tripped it is free reconnaissance.
 */
export const IP_BAN_ERROR_CODE = "IP_BANNED";

/** Paths the console is served under; a ban must never lock an operator out. */
const ADMIN_PATH_PREFIX = "/api/v1/admin";

export function createIpBanMiddleware(ipBans: IpBanService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    // Cheap synchronous reject before any await: an OPTIONS preflight or a
    // non-string path has nothing to act on.
    const pathname = pathnameOf(request);
    if (!pathname || pathname.startsWith(ADMIN_PATH_PREFIX)) {
      next();
      return;
    }

    void (async () => {
      try {
        const ip = getClientIp(request);
        const ban = await ipBans.activeBanFor(ip);
        if (!ban) {
          next();
          return;
        }

        if (ban.level === "SECONDARY" && isAllowedWhileSecondaryBanned(pathname)) {
          next();
          return;
        }

        refuse(response, ban);
      } catch (error) {
        /**
         * Fail OPEN, matching `IpBanService`. A defect in this middleware must not be
         * able to take the site down: `next()` on an unexpected error keeps the API
         * serving, and the error is the service's to log.
         */
        void error;
        next();
      }
    })();
  };
}

function refuse(response: Response, ban: ActiveBan): void {
  /**
   * Reported to `AccessLogMiddleware` through the same header the exception filter
   * uses, so a refused request is recorded with `errorCode: "IP_BANNED"` rather than
   * an anonymous 403 that an operator cannot distinguish from a permission error.
   */
  response.setHeader(ERROR_CODE_HEADER, IP_BAN_ERROR_CODE);

  response.status(403).json({
    success: false,
    error: {
      code: IP_BAN_ERROR_CODE,
      // Two different messages, because the remedies differ: a SECONDARY ban still
      // allows signing in, a PRIMARY one does not.
      message:
        ban.level === "PRIMARY"
          ? "此网络地址已被禁止访问，请联系客服。"
          : "此网络地址的访问权限受限，你仍可以登录查看账号状态或联系客服。",
    },
  });
}

/**
 * The decoded pathname, which is what the allow-list is matched against.
 *
 * `request.path` already excludes the query string, so `/auth/login?next=/x` becomes
 * `/auth/login` and matches. `decodeURIComponent` is applied because the comparison
 * must not be evadable by encoding: `%2Fauth%2Flogin` and `/auth/login` are the same
 * route to Express, and treating them differently here would let a banned address
 * reach anything by encoding the path.
 */
function pathnameOf(request: Request): string {
  const raw = typeof request.path === "string" ? request.path : "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape sequence is not a valid route; return it unchanged and let
    // the router reject it rather than throwing inside the middleware.
    return raw;
  }
}
