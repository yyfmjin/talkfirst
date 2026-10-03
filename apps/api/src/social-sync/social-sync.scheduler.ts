import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { SocialSyncService } from "./social-sync.service";
import { SocialProviderError } from "./external-post";

/**
 * Refreshes connected accounts on a schedule.
 *
 * ## Why the lock is in-process
 *
 * The documented production topology is a single PM2-managed API instance, and this codebase
 * has no Redis client — `login-attempt.service.ts` records the same choice for the same
 * reason. A Redis lock would mean adding a dependency and a piece of infrastructure for a
 * guarantee that one process already provides.
 *
 * The lock is therefore per-process, and it does what it needs to: `provider + accountId` is
 * held while one synced, so two ticks, a tick and a manual `立即同步`, cannot spend the same
 * provider quota twice or interleave two writes to the same rows. It does NOT coordinate
 * across processes — if this is ever scaled out, this class is the seam to replace, and the
 * key is already the right granularity for a distributed lock.
 *
 * ## Why the sweep is bounded
 *
 * Accounts are taken oldest-synced-first with a cap per tick. A hundred connections all coming
 * due at once would otherwise fire a hundred provider calls in one burst, which is how a
 * deployment earns a rate limit from every platform simultaneously. The next tick picks up
 * where this one stopped, because `lastSyncedAt` is what the ordering reads.
 */

/** How long between automatic sweeps. */
const SWEEP_CRON = CronExpression.EVERY_30_MINUTES;

/** Connections refreshed per tick. Bounds a burst against provider rate limits. */
const MAX_PER_TICK = 10;

/** A connection is due once it has not been synced within this window. */
const DUE_AFTER_MINUTES = 30;

@Injectable()
export class SocialSyncScheduler {
  private readonly logger = new Logger(SocialSyncScheduler.name);

  /** Guards against overlapping ticks on a slow provider. */
  private running = false;

  /**
   * Accounts currently being synced, as `PROVIDER:accountId`.
   *
   * A `Set` rather than a counter because the lock is per account: two different members
   * syncing at once is fine and desirable, while the same account twice is not.
   */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SocialSyncService,
  ) {}

  @Cron(SWEEP_CRON)
  async handleScheduledSync(): Promise<void> {
    try {
      await this.runSweep();
    } catch (error) {
      // A failed sweep must not kill the process or stop future ticks, matching the
      // convention `UserStatusScheduler` set.
      this.logger.error(`Social sync sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Refreshes every due connection, oldest first.
   *
   * Returns what it did, which makes the method callable from a test or an operator script
   * without reading the log.
   */
  async runSweep(): Promise<{ attempted: number; succeeded: number; failed: number; skipped: number }> {
    // A global re-entrancy guard on top of the per-account lock: if the previous tick is still
    // working through ten accounts, starting another sweep would only add contention.
    if (this.running) return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
    this.running = true;

    try {
      if ((process.env.SOCIAL_SYNC_ENABLED ?? "true").trim() === "false") {
        // An explicit off switch, so a development machine does not spend a real provider's
        // quota every half hour.
        return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
      }

      const dueBefore = new Date(Date.now() - DUE_AFTER_MINUTES * 60 * 1000);

      const accounts = await this.prisma.socialSyncAccount.findMany({
        where: {
          syncEnabled: true,
          // Only ACTIVE: a NEEDS_REAUTH connection cannot succeed, and retrying it every tick
          // would keep failing forever instead of waiting for the member to reconnect.
          status: "ACTIVE",
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: dueBefore } }],
        },
        // Oldest first, so nothing starves behind a stream of newer connections.
        orderBy: { lastSyncedAt: "asc" },
        take: MAX_PER_TICK,
        select: { id: true, provider: true },
      });

      let succeeded = 0;
      let failed = 0;
      let skipped = 0;

      for (const account of accounts) {
        const key = `${account.provider}:${account.id}`;
        if (this.inFlight.has(key)) {
          skipped += 1;
          continue;
        }

        this.inFlight.add(key);
        try {
          await this.sync.syncAccount(account.id);
          succeeded += 1;
        } catch (error) {
          failed += 1;
          /**
           * Logged at warn, not error: a rate limit or a revoked grant is an expected outcome
           * for a background job, and the account's own `lastSyncError` is what surfaces it to
           * the member. Logging every provider refusal as an error would make a real outage
           * indistinguishable from normal churn.
           */
          this.logger.warn(
            `Sync failed for ${account.provider} account ${account.id}: ${
              error instanceof SocialProviderError ? error.code : "unknown"
            }`,
          );
        } finally {
          this.inFlight.delete(key);
        }
      }

      return { attempted: accounts.length, succeeded, failed, skipped };
    } finally {
      this.running = false;
    }
  }

  /** Exposed so the manual sync endpoint can share the same lock. */
  isInFlight(provider: string, accountId: string): boolean {
    return this.inFlight.has(`${provider}:${accountId}`);
  }
}
