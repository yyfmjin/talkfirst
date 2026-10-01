import { Injectable } from "@nestjs/common";

/**
 * SEC-001 — account-dimension brute-force protection.
 *
 * The existing `HttpThrottlerGuard` only counts by IP, so one address spraying a
 * single password across many e-mails — or the same account approached from a
 * rotating set of IPs — slips through. This service adds the missing half: a
 * failure budget keyed on the normalised e-mail, with exponential backoff and a
 * temporary, self-expiring lock.
 *
 * It deliberately does **not** touch the IP limiter: the two layers are additive
 * (IP budget + account budget), and neither one replaces the other.
 *
 * Storage is an in-memory `Map`, i.e. per-process. TalkFirst runs a single API
 * replica today; a multi-replica or restarted deployment loses the counters and
 * therefore has a weaker (but still present) guarantee. Moving this to Redis is
 * an explicit later phase — see the Phase 2 plan. Keeping the state in-process
 * is what lets this ship without reshaping the (currently unused) Redis wiring.
 *
 * Pure and clock-injectable, so it is unit-testable without HTTP or a database.
 */

export interface LoginAttemptPolicy {
  /** Consecutive credential failures before a regular account is locked. */
  maxFailures: number;
  /** Admins get a tighter budget — a compromised admin is worth more. */
  adminMaxFailures: number;
  /** First lock duration; each further failure in the window doubles it. */
  baseLockMs: number;
  /** Upper bound on a single lock, so an account is never locked forever. */
  maxLockMs: number;
  /** Failure budget resets once this much time passes without a new failure. */
  windowMs: number;
}

/**
 * Defaults, and why:
 *  - 5 failures: a human fumbling a password rarely exceeds it; a script does
 *    immediately. Low enough to bite, high enough not to lock out honest typos.
 *  - 3 for admins: the same reasoning with a smaller tolerance because the blast
 *    radius of a compromised administrator is larger.
 *  - 30s → doubling → 15min cap: the first lock is a speed bump, sustained
 *    guessing is throttled to a crawl, and nobody is permanently locked out.
 *  - 15min window: long enough to catch a slow, spread-out guesser.
 *
 * Adjust `baseLockMs`/`maxLockMs` together if the numbers ever change; the
 * comment above is the rationale the current values encode.
 */
export const DEFAULT_LOGIN_ATTEMPT_POLICY: LoginAttemptPolicy = {
  maxFailures: 5,
  adminMaxFailures: 3,
  baseLockMs: 30_000,
  maxLockMs: 15 * 60_000,
  windowMs: 15 * 60_000,
};

export interface LockCheck {
  locked: boolean;
  retryAfterMs: number;
}

export interface FailureOutcome extends LockCheck {
  failures: number;
  /** True only on the failure that *crossed* the threshold — emit an event here. */
  lockedNow: boolean;
}

interface AttemptState {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
}

@Injectable()
export class LoginAttemptService {
  private readonly states = new Map<string, AttemptState>();
  private readonly policy: LoginAttemptPolicy;
  private readonly now: () => number;

  constructor(policy: Partial<LoginAttemptPolicy> = {}, now: () => number = Date.now) {
    this.policy = { ...DEFAULT_LOGIN_ATTEMPT_POLICY, ...policy };
    this.now = now;
  }

  /** Whether `email` is currently locked, without recording anything. */
  check(email: string): LockCheck {
    const state = this.states.get(email);
    if (!state || state.lockedUntil <= this.now()) {
      return { locked: false, retryAfterMs: 0 };
    }
    return { locked: true, retryAfterMs: state.lockedUntil - this.now() };
  }

  /**
   * Records one credential failure for `email` and reports the resulting state.
   * Keyed on the submitted e-mail, so an address that does not exist is counted
   * exactly like one that does — the budget itself leaks no account existence.
   */
  recordFailure(email: string, isAdmin: boolean): FailureOutcome {
    const now = this.now();
    this.prune(now);

    const threshold = isAdmin ? this.policy.adminMaxFailures : this.policy.maxFailures;
    let state = this.states.get(email);
    if (!state || now - state.windowStartedAt > this.policy.windowMs) {
      state = { failures: 0, windowStartedAt: now, lockedUntil: 0 };
    }

    state.failures += 1;
    let lockedNow = false;
    if (state.failures >= threshold) {
      const overThreshold = state.failures - threshold;
      const lockMs = Math.min(
        this.policy.baseLockMs * 2 ** overThreshold,
        this.policy.maxLockMs,
      );
      state.lockedUntil = now + lockMs;
      lockedNow = true;
    }

    this.states.set(email, state);
    return {
      locked: state.lockedUntil > now,
      retryAfterMs: Math.max(0, state.lockedUntil - now),
      failures: state.failures,
      lockedNow,
    };
  }

  /** Clears the budget after a successful authentication. */
  reset(email: string): void {
    this.states.delete(email);
  }

  /** Drops unlocked states whose window has elapsed, bounding memory. */
  private prune(now: number): void {
    for (const [key, state] of this.states) {
      if (state.lockedUntil <= now && now - state.windowStartedAt > this.policy.windowMs) {
        this.states.delete(key);
      }
    }
  }
}
