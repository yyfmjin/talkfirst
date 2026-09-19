import {
  ExecutionContext,
  HttpException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard, AuthModuleOptions } from "@nestjs/passport";

/**
 * Phase A+: structured 401s for authentication failures.
 *
 * `AuthGuard("jwt")` throws a bare `UnauthorizedException("Unauthorized")` when
 * the token is absent, malformed, expired or badly signed. `ApiExceptionFilter`
 * only forwards a payload that already carries a domain `error.code`, so every
 * one of those failures collapsed into the generic `HTTP_ERROR`. Clients could
 * not tell "not signed in" from "session expired" from "token tampered with" —
 * and `apps/admin/src/lib/session.tsx` already branches on `code ===
 * "UNAUTHORIZED"`, a branch that could never fire.
 *
 * This guard changes only the *failure envelope*. A success response is
 * untouched, and the guard adds no authorization logic of its own.
 *
 * When `JwtStrategy.validate()` throws its own domain exception
 * (`USER_DISABLED`, `USER_BANNED`, `INVALID_TOKEN`, `USER_NOT_FOUND`) that
 * exception is re-thrown untouched — it is strictly more specific than
 * `UNAUTHORIZED`, and replacing it would lose information the client needs.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  /**
   * `AuthGuard("jwt")` is a memoized mixin whose constructor takes
   * `@Optional() AuthModuleOptions`. A subclass with no constructor of its own
   * inherits that `@Inject(AuthModuleOptions)` metadata, but Nest resolves the
   * dependency against the module the guard is *used* in — and only `AuthModule`
   * imports `PassportModule`. Guards are referenced by class in
   * `@UseGuards(JwtAuthGuard)`, so Nest instantiates them per module and the
   * inherited metadata made every other module (Social, Discover, Moments, …)
   * fail at boot with `UnknownDependenciesException`.
   *
   * Declaring the parameter here re-states `@Optional()` as *own* metadata, so
   * Nest injects `undefined` when `PassportModule` is absent instead of
   * throwing. The mixin then falls back to its default `{}` options, exactly as
   * the inline `AuthGuard("jwt")` call sites did before.
   */
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser | false,
    info: unknown,
    _context?: ExecutionContext,
  ): TUser {
    if (err) {
      // A domain exception from the strategy — preserve it verbatim.
      if (err instanceof HttpException) throw err;
      // An unexpected error inside the strategy. Do not disguise it as an
      // authentication failure; let the global filter treat it as a 500.
      throw err;
    }

    if (user) return user;

    throw new UnauthorizedException({
      success: false,
      error: { code: "UNAUTHORIZED", message: unauthorizedMessage(info) },
    });
  }
}

/**
 * Passport hands back a machine-readable `info` describing why extraction
 * failed. The `code` stays uniformly `UNAUTHORIZED` (that is the contract);
 * only the human-readable `message` gets more specific, so a client can still
 * choose to attempt a refresh on an expired token rather than bouncing to the
 * login screen. None of these strings are sensitive.
 */
function unauthorizedMessage(info: unknown): string {
  const name = (info as { name?: unknown } | null)?.name;
  const message = (info as { message?: unknown } | null)?.message;

  if (name === "TokenExpiredError") return "Access token has expired";
  if (name === "JsonWebTokenError") {
    return typeof message === "string" ? message : "Invalid access token";
  }
  if (message === "No auth token") return "Authentication required";
  if (typeof message === "string" && message !== "Unauthorized") return message;
  return "Authentication required";
}
