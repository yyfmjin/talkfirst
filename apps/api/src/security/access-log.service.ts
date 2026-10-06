import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Security Audit Center (P1) — HTTP access audit writer.
 *
 * ## Fault isolation
 *
 * Auditing is observability, not the business. If the audit insert fails — the
 * table is gone, the connection dropped, the payload is malformed — the original
 * request must still return its real response. `write()` therefore never throws:
 * it downgrades a failure to an internal log line. That is also why it can be
 * safely `void`-ed from a hot path.
 */
export interface AccessLogEntry {
  requestId: string;
  method: string;
  path: string;
  queryDigest?: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  authenticated: boolean;
  isAdmin: boolean;
  /** `USER` / `ADMIN` / `OPS` —— 见 `access-channel.ts`。 */
  channel: string;
  ip?: string;
  deviceHash?: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
  acceptLanguage?: string;
  contentType?: string;
  errorCode?: string;
  riskLevel: string;
}

@Injectable()
export class AccessLogService {
  private readonly logger = new Logger("AccessLog");

  constructor(private readonly prisma: PrismaService) {}

  /** Persists one access log row. Never throws. */
  async write(entry: AccessLogEntry): Promise<void> {
    try {
      await this.prisma.accessLog.create({
        data: {
          requestId: entry.requestId,
          method: entry.method.slice(0, 8),
          path: entry.path.slice(0, 256),
          queryDigest: entry.queryDigest ?? null,
          statusCode: entry.statusCode,
          durationMs: Math.max(0, Math.trunc(entry.durationMs)),
          userId: entry.userId ?? null,
          authenticated: entry.authenticated,
          isAdmin: entry.isAdmin,
          channel: entry.channel,
          ip: entry.ip ?? null,
          deviceHash: entry.deviceHash ?? null,
          userAgent: entry.userAgent ? entry.userAgent.slice(0, 512) : null,
          referer: entry.referer ? entry.referer.slice(0, 256) : null,
          origin: entry.origin ? entry.origin.slice(0, 128) : null,
          acceptLanguage: entry.acceptLanguage ? entry.acceptLanguage.slice(0, 64) : null,
          contentType: entry.contentType ? entry.contentType.slice(0, 96) : null,
          errorCode: entry.errorCode ? entry.errorCode.slice(0, 48) : null,
          riskLevel: entry.riskLevel,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist access log ${entry.requestId}: ${(error as Error)?.message ?? error}`,
      );
    }
  }
}
