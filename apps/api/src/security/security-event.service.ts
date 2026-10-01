import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { toSafeJson } from "../common/redact";
import { deviceHash } from "./device-hash";
import { getRequestContext } from "./request-context";
import {
  RiskLevel,
  SecurityEventSource,
  type SecurityEventType,
} from "./security.constants";

/**
 * Security Audit Center (P1) — the one place security events are written.
 *
 * Everything recorded here is routed through `toSafeJson` (redaction + size
 * cap), so no caller can accidentally persist a password or a token, and the
 * request environment (ip / User-Agent / requestId / method / path) is filled
 * from the ambient request context unless the caller supplies it.
 *
 * Like the access log writer, `record()` never throws: an audit failure must not
 * turn a successful login into a 500.
 */
export interface SecurityEventInput {
  type: SecurityEventType;
  source?: SecurityEventSource;
  riskLevel?: RiskLevel;
  riskScore?: number;
  /** Explainable contributions to `riskScore` (see P2 scoring). */
  factors?: unknown;
  userId?: string;
  ip?: string;
  deviceHash?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  requestId?: string;
  success?: boolean;
  /** Free-form context. Redacted and size-capped before it is stored. */
  detail?: unknown;
}

/** Upper bound on `detail` / `factors` so one event cannot bloat a row. */
const MAX_JSON_CHARS = 4000;

@Injectable()
export class SecurityEventService {
  private readonly logger = new Logger("SecurityEvent");

  constructor(private readonly prisma: PrismaService) {}

  /** Records one security event. Never throws. */
  async record(input: SecurityEventInput): Promise<void> {
    try {
      const context = getRequestContext();
      const userAgent = input.userAgent ?? context?.userAgent;

      await this.prisma.securityEvent.create({
        data: {
          type: input.type,
          source: input.source ?? SecurityEventSource.SYSTEM,
          riskLevel: input.riskLevel ?? RiskLevel.LOW,
          riskScore: input.riskScore ?? 0,
          factors: toSafeJson(input.factors, MAX_JSON_CHARS) as
            | Prisma.InputJsonValue
            | undefined,
          userId: input.userId ?? null,
          ip: input.ip ?? context?.ip ?? null,
          deviceHash: input.deviceHash ?? deviceHash(userAgent) ?? null,
          userAgent: userAgent ? userAgent.slice(0, 512) : null,
          method: input.method ?? context?.method ?? null,
          path: (input.path ?? context?.path)?.slice(0, 256) ?? null,
          statusCode: input.statusCode ?? null,
          requestId: input.requestId ?? context?.requestId ?? null,
          success: input.success ?? true,
          detail: toSafeJson(input.detail, MAX_JSON_CHARS) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist security event ${input.type}: ${(error as Error)?.message ?? error}`,
      );
    }
  }
}
