import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { AdminService } from "../admin/admin.service";

/**
 * Phase A+: releases temporary suspensions when they expire.
 *
 * `AdminService.setStatus({ action: "suspend" })` writes `status = SUSPENDED`
 * plus a `suspendedUntil` deadline, but nothing ever acted on that deadline — an
 * expired suspension stayed in force forever and the account was locked out
 * with `USER_DISABLED` indefinitely. A "temporary" suspension was in practice a
 * permanent one.
 *
 * ## Restored state
 *
 * The end state is deliberately identical to what `AdminService.nextStatusState`
 * produces for `activate` / `unban`:
 *
 *     status = ACTIVE, suspendedUntil = null, bannedAt = null, banReason = null
 *
 * `banReason` is cleared rather than preserved because `User` has no dedicated
 * suspension-reason column — `setStatus({action:"suspend"})` stores the reason
 * in `banReason`, and `activate`/`unban` already clear it. Keeping the same end
 * state means "suspension expired" and "admin re-activated" converge, which is
 * what the product means by both. These are the only three status columns on
 * `User`; no other field is touched.
 *
 * ## Audit — how a machine action is recorded honestly
 *
 * A suspension expiring is a **machine action**, not a human one. Recording it
 * used to be impossible: `AdminAuditLog.adminId` was a required FK to `User`,
 * there was no `SYSTEM_USER`, and the only two ways to write a row were both
 * wrong — borrow a real administrator's id (falsifies the trail, and would make
 * a SUPER_ADMIN appear to have acted at 3am), or invent a "system" User row (a
 * real login-able identity that would pollute `/admin/users`, the user count and
 * the dashboard's admin count).
 *
 * The schema now models "nobody was at the keyboard" explicitly:
 * `actorType = SYSTEM` with `adminId = NULL`. So the sweep writes a real audit
 * row through `AdminService.recordSystemAudit`, which pins both values and whose
 * input type has no `adminId` field at all. No administrator identity is
 * borrowed, and no synthetic account exists.
 *
 * `AdminNote` stays human-only (its `adminId` is still required) — a note means
 * "an administrator observed this", and a timer never observes anything.
 *
 * ## One row per sweep, not one row per user
 *
 * The row describes the batch that this tick released: `action`, `before`,
 * `after` and a `detail` carrying the count. `targetId` is `null` because a
 * single row cannot honestly name one target when several were released.
 *
 * Per-user rows would require knowing *which* users the statement changed, i.e.
 * replacing `updateMany` with `updateManyAndReturn` (available in the generated
 * Prisma client) or a `findMany` + per-row update loop. That changes the shape
 * of the sweep — and a `findMany`-then-`updateMany` pair is not equivalent
 * either, since the two statements can observe different row sets. It is
 * therefore deliberately **not** done here and is recorded as an open decision.
 */
@Injectable()
export class UserStatusScheduler {
  private readonly logger = new Logger(UserStatusScheduler.name);

  /** Guards against overlapping ticks on a slow database. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleSuspensionExpiry(): Promise<void> {
    try {
      await this.releaseExpiredSuspensions();
    } catch (error) {
      // A failed sweep must not kill the process or stop future ticks.
      this.logger.error(
        `Suspension sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reverts every `SUSPENDED` user whose deadline has passed back to `ACTIVE`,
   * then records one SYSTEM audit entry describing the release.
   *
   * ## Idempotency
   *
   * The sweep is still a **single `updateMany`** and its predicate is still
   * self-consuming: once a row is updated, `status` is no longer `SUSPENDED`
   * and `suspendedUntil` is `null`, so it cannot match again. A second run in
   * the same instant therefore updates zero rows — there is no
   * `SUSPENDED -> ACTIVE -> ACTIVE` oscillation and no extra side effect. The
   * in-flight flag additionally prevents two overlapping ticks from racing.
   *
   * The audit write is gated on `count > 0` for the same reason: an empty sweep
   * has nothing to report, so a re-tick cannot append a duplicate row. That is
   * what keeps the pair "one released batch -> one audit row" stable under
   * repetition.
   *
   * ## Ordering and failure handling
   *
   * The audit row is written **after** the release succeeds, not in the same
   * transaction: the release is the safety-critical part (a user locked out of
   * their account) and must not be held hostage by an audit insert. A failed
   * audit write is logged at `error` level so the gap is visible, and the
   * released count is still returned. Note the consequence: if the audit insert
   * fails, that tick leaves no row and a later tick will not backfill it, since
   * the predicate no longer matches.
   *
   * @param now Injectable clock so tests can control the boundary.
   * @returns number of suspensions released by this run.
   */
  async releaseExpiredSuspensions(now: Date = new Date()): Promise<number> {
    if (this.running) {
      this.logger.warn("Previous suspension sweep is still running; skipping this tick");
      return 0;
    }
    this.running = true;
    try {
      const { count } = await this.prisma.user.updateMany({
        where: { status: "SUSPENDED", suspendedUntil: { not: null, lte: now } },
        data: {
          status: "ACTIVE",
          suspendedUntil: null,
          bannedAt: null,
          banReason: null,
        },
      });

      if (count > 0) {
        this.logger.log(`Auto-released ${count} expired suspension(s)`);
        await this.recordRelease(count);
      }
      return count;
    } finally {
      this.running = false;
    }
  }

  /**
   * Writes the SYSTEM audit entry for a released batch.
   *
   * Split out so the failure handling is explicit and the sweep's own control
   * flow stays readable. Never throws: an audit problem must not turn a
   * successful release into a failed sweep, and must not stop future ticks.
   */
  private async recordRelease(count: number): Promise<void> {
    try {
      await this.admin.recordSystemAudit({
        action: "SYSTEM_USER_SUSPENSION_EXPIRED",
        targetType: "USER",
        // The transition applied to every released row.
        before: { status: "SUSPENDED" },
        after: { status: "ACTIVE" },
        // `targetId` is intentionally omitted: a batch has no single target.
        detail: `Auto-released ${count} expired suspension(s)`,
      });
    } catch (error) {
      this.logger.error(
        `Released ${count} expired suspension(s) but failed to record the SYSTEM audit entry: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
