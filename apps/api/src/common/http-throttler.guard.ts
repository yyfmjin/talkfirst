import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerRequest } from "@nestjs/throttler";

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
}
