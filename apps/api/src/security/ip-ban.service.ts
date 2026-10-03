import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * IP ban levels, mirrored from the `IpBanLevel` enum.
 *
 * Declared as a TS union as well so the middleware and the admin API can talk
 * about a level without importing the Prisma enum type, which keeps the pure
 * decision logic testable without a generated client.
 */
export type IpBanLevel = "SECONDARY" | "PRIMARY";

export type ActiveBan = { level: IpBanLevel; reason: string };

/**
 * Whether a request to `path` may proceed while its IP is under a SECONDARY ban.
 *
 * ## What a SECONDARY ban is for
 *
 * The operator's intent is "this address may not use the product, but must remain
 * able to sign in". That is not a courtesy: without a reachable login the account
 * holder cannot see why they are blocked, cannot appeal, and cannot even retrieve
 * their own data — which turns a moderation action into a silent lockout.
 *
 * ## Why this is an explicit path list rather than a metadata decorator
 *
 * A `@BanExempt()` decorator on each auth handler would be self-documenting, but it
 * only covers routes that remember to carry it: a new auth route that forgets the
 * decorator becomes silently unreachable for a secondary-banned member, and that
 * failure mode is invisible until someone is locked out. A list in one file, paired
 * with a test asserting the auth controller exposes nothing outside it (see
 * `ip-ban.middleware.spec.ts`), fails loudly instead.
 *
 * Every entry is a SUFFIX match against the decoded pathname, so the global
 * `api/v1` prefix need not be repeated here. They are deliberately exact paths —
 * `startsWith` on `/auth` would exempt the entire auth surface, including
 * `POST /auth/password`, which a banned address must not be able to use to change
 * credentials.
 */
export const SECONDARY_BAN_ALLOWED_PATHS: readonly string[] = [
  // Sign in, so the member can reach the app and see their own state.
  "/auth/login",
  /**
   * Sign UP as well as sign in.
   *
   * The first draft of this list omitted registration, on the reasoning that a banned
   * address is a returning visitor. That is wrong: an address is shared by a
   * household, a school, an office or a mobile carrier's NAT pool, so the person who
   * trips a ban is frequently not the only person behind it. Refusing registration
   * would punish uninvolved people who have no account yet and therefore no other way
   * in — and it would do so invisibly, as a signup form that always fails.
   */
  "/auth/register",
  // Email verification, which registration cannot complete without.
  "/auth/send-verification-code",
  "/auth/verify-email",
  // Session upkeep. Blocking these would sign a member out mid-session, which is a
  // silent total lockout wearing a smaller label.
  "/auth/refresh",
  "/auth/logout",
  // Account recovery, for the same reason as login: an address that cannot reset a
  // forgotten password has no route back to its own account.
  "/auth/password/forgot",
  "/auth/password/reset",
  /**
   * Reading your own session.
   *
   * Needed because the client calls it on boot to decide whether it is signed in. A
   * member under a SECONDARY ban whose client cannot resolve its own session sees a
   * broken app rather than a restricted one.
   */
  "/auth/me",
];

/**
 * True when a secondary-banned address may still reach `pathname`.
 *
 * ## The matching bug this is written to avoid
 *
 * A bare `pathname.endsWith(suffix)` matches `/x/auth/login` and
 * `/anything/at/all/auth/login`, because a suffix says nothing about where the
 * path starts. A route that happened to end in one of these strings would be
 * silently exempt. Anchoring on a `/` boundary and comparing against the end of
 * the whole pathname is what makes the exemption mean "this exact route".
 *
 * Query strings are not part of `pathname` (the caller splits them off first), so
 * `/auth/login?next=/` is covered by the `/auth/login` entry.
 */
export function isAllowedWhileSecondaryBanned(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return SECONDARY_BAN_ALLOWED_PATHS.some((allowed) => path.endsWith(allowed));
}

/**
 * Reads active IP bans and answers the one question the middleware asks.
 *
 * ## Caching, and why it is short
 *
 * The middleware runs on every request, so a database round trip per request is not
 * acceptable. A small in-process cache with a short TTL keeps the hot path cheap.
 *
 * The TTL is deliberately short (see `CACHE_TTL_MS`). A long TTL makes lifting a
 * ban feel broken — the operator clicks 解封 and the address keeps getting 403s for
 * minutes — so the cache favours responsiveness over load. Nothing here is a
 * security boundary that a stale entry could widen: a stale entry can only delay a
 * NEW ban or prolong an ALREADY-LIFTED one, and both windows are bounded by the TTL.
 *
 * The cache stores `null` for "no ban", and that negative entry matters more than
 * the positive ones: without it, every request from every un-banned visitor would
 * still hit the database.
 */
@Injectable()
export class IpBanService {
  private readonly logger = new Logger(IpBanService.name);

  /** 30 seconds: long enough to absorb a burst, short enough that 解封 feels immediate. */
  private static readonly CACHE_TTL_MS = 30_000;

  /** Bounded so a flood of distinct spoofed addresses cannot grow it without limit. */
  private static readonly CACHE_MAX_ENTRIES = 5_000;

  private readonly cache = new Map<string, { ban: ActiveBan | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active ban for `ip`, or null.
   *
   * `PRIMARY` wins over `SECONDARY` when both are active: the stricter level is the
   * one the operator most recently intended, and silently downgrading a PRIMARY to a
   * SECONDARY because an older row happened to be read first would hand back an
   * address the operator had fully blocked.
   */
  async activeBanFor(ip: string | undefined): Promise<ActiveBan | null> {
    if (!ip) return null;

    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.ban;

    const ban = await this.loadActiveBan(ip);
    this.remember(ip, ban);
    return ban;
  }

  private async loadActiveBan(ip: string): Promise<ActiveBan | null> {
    try {
      const rows = await this.prisma.ipBan.findMany({
        where: {
          ip,
          // A lifted ban is history, not a block.
          liftedAt: null,
          // An expired ban is likewise no longer in force. `null` means permanent.
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { level: true, reason: true },
      });

      if (rows.length === 0) return null;
      if (rows.some((row) => row.level === "PRIMARY")) {
        return { level: "PRIMARY", reason: rows.find((row) => row.level === "PRIMARY")!.reason };
      }
      return { level: "SECONDARY", reason: rows[0].reason };
    } catch (error) {
      /**
       * Fail OPEN, deliberately, and this is the most important decision in the file.
       *
       * If the ban table cannot be read, the choice is between refusing every request
       * on the platform and letting traffic through un-filtered. A database blip that
       * turned into a site-wide outage caused by the *ban feature* would be a far
       * larger incident than the abuse a ban exists to stop — and the abuse is still
       * recorded in `AccessLog`, so nothing is lost that cannot be acted on once the
       * table is readable again.
       */
      this.logger.error(
        `Could not read IP bans (failing open): ${error instanceof Error ? error.message : "unknown"}`,
      );
      return null;
    }
  }

  private remember(ip: string, ban: ActiveBan | null): void {
    // Cheap eviction: drop the oldest insertion when the bound is reached. A real
    // LRU would need ordering this hot path does not warrant.
    if (this.cache.size >= IpBanService.CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(ip, { ban, expiresAt: Date.now() + IpBanService.CACHE_TTL_MS });
  }

  /**
   * Drops a cached verdict.
   *
   * Called by the admin write paths so creating or lifting a ban takes effect on the
   * next request instead of up to a TTL later — the one case where a stale entry is
   * user-visible as a bug.
   */
  invalidate(ip: string): void {
    this.cache.delete(ip);
  }
}
