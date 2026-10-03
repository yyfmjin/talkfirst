import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Phase O1 — audit-table retention.
 *
 * ## The problem this closes
 *
 * `AccessLog` and `SecurityEvent` are written on every request and every auth
 * event, and **nothing ever deleted from them**. They were the only two growing
 * tables in the schema with no retention story, so the audit trail was on a path
 * to becoming the largest object in the database — and the thing an operator
 * reaches for during an incident is exactly the thing that gets slow first.
 *
 * ## Why batched deletes
 *
 * `deleteMany` with a date predicate looks simpler, but on a large table it
 * takes one long lock and can hold a transaction open long enough to block
 * writes. This sweeps in bounded batches using a keyset on `createdAt` + `id`,
 * so each statement is short and the scheduler can never stall the API. The loop
 * stops as soon as a batch comes back short, so an empty sweep costs one query.
 *
 * Prisma's `deleteMany` has no `take`, which is why each batch is selected first
 * and then deleted by id — that is the only way to bound the statement.
 *
 * ## Why security events are kept longer
 *
 * They are the evidentiary record: `BRUTE_FORCE_DETECTED`, session revocations,
 * account-state changes. A short window would destroy the history needed to
 * explain an incident that is only noticed weeks later. Access logs are
 * high-volume, low-signal and are therefore pruned much sooner.
 *
 * ## Safety
 *
 * - Retention is **configurable** and both windows can be disabled with `0`,
 *   which means "keep forever" rather than "delete everything".
 * - Overlapping ticks are skipped (`running`), so a slow sweep cannot stack.
 * - A failure is logged and swallowed: retention must never crash the process.
 */

/** Access logs are high-volume and low-signal — pruned aggressively. */
export const ACCESS_LOG_RETENTION_DAYS = 30;
/** Security events are the evidentiary record — kept far longer. */
export const SECURITY_EVENT_RETENTION_DAYS = 180;
/** Rows deleted per statement. Bounded so no single delete takes a long lock. */
const BATCH_SIZE = 5000;
/** Upper bound on batches per sweep, so one tick cannot run unbounded. */
const MAX_BATCHES = 40;

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  /** Guards against overlapping ticks on a slow database. */
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Access-log window in days; `0` means "keep forever". */
  accessLogRetentionDays(): number {
    return resolveDays("ACCESS_LOG_RETENTION_DAYS", ACCESS_LOG_RETENTION_DAYS);
  }

  /** Security-event window in days; `0` means "keep forever". */
  securityEventRetentionDays(): number {
    return resolveDays("SECURITY_EVENT_RETENTION_DAYS", SECURITY_EVENT_RETENTION_DAYS);
  }

  /**
   * Daily at 03:00 — outside peak hours for every launch market so far, and a
   * time when a burst of short delete statements is least likely to be felt.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleRetentionSweep(): Promise<void> {
    if (this.running) {
      this.logger.warn("Retention sweep still running; skipping this tick.");
      return;
    }
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      // A failed sweep must not kill the process or stop future ticks.
      this.logger.error(
        `Retention sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs both prunes. Public and separate from the cron so it can be invoked
   * directly (and tested) without waiting for a schedule.
   */
  async sweep(): Promise<{ accessLogs: number; securityEvents: number }> {
    const accessLogs = await this.pruneAccessLogs();
    const securityEvents = await this.pruneSecurityEvents();
    if (accessLogs > 0 || securityEvents > 0) {
      this.logger.log(
        `Retention sweep removed ${accessLogs} access log(s) and ${securityEvents} security event(s).`,
      );
    }
    return { accessLogs, securityEvents };
  }

  private async pruneAccessLogs(): Promise<number> {
    const days = this.accessLogRetentionDays();
    if (days <= 0) return 0;
    const cutoff = cutoffFrom(days);

    return this.deleteInBatches(
      (ids) => this.prisma.accessLog.deleteMany({ where: { id: { in: ids } } }),
      () =>
        this.prisma.accessLog.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: BATCH_SIZE,
        }),
    );
  }

  private async pruneSecurityEvents(): Promise<number> {
    const days = this.securityEventRetentionDays();
    if (days <= 0) return 0;
    const cutoff = cutoffFrom(days);

    // `handledAt: null` is deliberately NOT special-cased into a longer life:
    // an unhandled event still ages out on the same schedule, because keeping
    // every un-triaged row forever is precisely how the table became unbounded.
    return this.deleteInBatches(
      (ids) => this.prisma.securityEvent.deleteMany({ where: { id: { in: ids } } }),
      () =>
        this.prisma.securityEvent.findMany({
          where: { createdAt: { lt: cutoff } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take: BATCH_SIZE,
        }),
    );
  }

  /**
   * Selects one bounded batch, deletes it by id, repeats until a short batch is
   * seen or `MAX_BATCHES` is reached.
   */
  private async deleteInBatches(
    del: (ids: string[]) => Promise<{ count: number }>,
    select: () => Promise<Array<{ id: string }>>,
  ): Promise<number> {
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const rows = await select();
      if (rows.length === 0) break;
      const result = await del(rows.map((row) => row.id));
      removed += result.count;
      if (rows.length < BATCH_SIZE) break;
    }
    if (removed > 0 && removed >= BATCH_SIZE * MAX_BATCHES) {
      this.logger.warn(
        `Retention hit the per-sweep cap (${MAX_BATCHES} batches); the remainder will be pruned on the next run.`,
      );
    }
    return removed;
  }
}

/** Reads a positive integer day count from the environment, else the default. */
function resolveDays(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    // Never fall through to "delete everything" on a typo like `30d`.
    return fallback;
  }
  return Math.floor(parsed);
}

function cutoffFrom(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
