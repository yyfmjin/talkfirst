import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  NOTIFICATION_CORE_DATA_KEYS,
  NOTIFICATION_LIMITS,
  type NotificationData,
  type NotificationType,
  isNotificationTargetType,
  isNotificationType,
} from "./notification.types";

export type NotifyInput = {
  /** The recipient. Never the actor — the actor travels inside `data.actorId`. */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: NotificationData;
};

const CORE_DATA_KEYS: ReadonlySet<string> = new Set(NOTIFICATION_CORE_DATA_KEYS);

/** A usable identifier: present and non-empty. `""` is treated as "no value". */
function readIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Cuts a string to `max` UTF-16 units without leaving a lone high surrogate
 * behind, which would render as a replacement character.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  const last = value.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

/**
 * PC-3.1b — the one place a notification is written.
 *
 * Two invariants matter more than anything else here:
 *
 *  - **A notification never fails its caller.** Every path resolves; a bad
 *    payload is logged and skipped, and a database error is swallowed. Core
 *    business (a connection, an exchange, a comment) must survive a broken
 *    notification, so nothing may be thrown back across this boundary.
 *  - **`data` is always a valid envelope.** It is stored in a `VarChar(2000)`,
 *    so an over-long payload is trimmed by dropping optional fields — never by
 *    slicing the encoded string, which can produce unparseable JSON.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(input: NotifyInput): Promise<void> {
    try {
      if (!input.userId) {
        this.logger.warn("notification skipped: missing recipient userId");
        return;
      }
      if (!isNotificationType(input.type)) {
        this.logger.warn(
          `notification skipped: ${String(input.type)} is not a known notification type`,
        );
        return;
      }

      const actorId = readIdentifier(input.data?.actorId);
      // Self notification is meaningless: nobody needs to be told about the
      // thing they just did. A missing actor is *not* treated as a match — the
      // actor is unknown, not equal.
      if (actorId && actorId === input.userId) return;

      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: truncate(input.title ?? "", NOTIFICATION_LIMITS.title),
          body: input.body ? truncate(input.body, NOTIFICATION_LIMITS.body) : null,
          data: this.encodeData(input.data),
        },
      });
    } catch (error) {
      // Deliberately swallowed: see the class comment. This is the boundary
      // where a notification stops being allowed to hurt the caller.
      this.logger.warn(
        `notification not delivered (${String(input.type)}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Serializes the envelope, shedding optional extras until it fits the column.
   * Returns `null` when the payload carries nothing worth storing.
   */
  private encodeData(data: NotificationData | undefined): string | null {
    if (!data) return null;

    const current: Record<string, unknown> = { ...data };

    // Only a well-formed envelope is ever persisted: an absent actor is not
    // invented, and a value outside the frozen contract is reported rather than
    // stored as-is. The notification itself still goes out — losing it over its
    // metadata would be the worse failure.
    if (readIdentifier(current.actorId) === undefined) {
      delete current.actorId;
    }
    if (!isNotificationTargetType(current.targetType)) {
      this.logger.warn(
        `notification data: ${String(current.targetType)} is not a known target type`,
      );
      delete current.targetType;
    }
    if (readIdentifier(current.targetId) === undefined) {
      this.logger.warn("notification data: missing targetId");
      delete current.targetId;
    }

    let encoded = JSON.stringify(current);
    if (encoded.length <= NOTIFICATION_LIMITS.data) return encoded;

    // 1. Drop the typed extras, keeping the envelope.
    for (const key of Object.keys(current)) {
      if (CORE_DATA_KEYS.has(key)) continue;
      delete current[key];
      encoded = JSON.stringify(current);
      if (encoded.length <= NOTIFICATION_LIMITS.data) return encoded;
    }

    // 2. Drop `actorId` — optional by contract.
    const envelope: Record<string, unknown> = { ...current };
    delete envelope.actorId;
    encoded = JSON.stringify(envelope);
    if (encoded.length <= NOTIFICATION_LIMITS.data) return encoded;

    // 3. Shorten the identifier. Only reachable if a producer passes an
    //    identifier far longer than any real id.
    const targetType = typeof envelope.targetType === "string" ? envelope.targetType : "";
    let candidate = typeof envelope.targetId === "string" ? envelope.targetId : "";
    while (candidate.length > 0) {
      candidate = truncate(candidate, candidate.length - 1);
      encoded = JSON.stringify({ targetType, targetId: candidate });
      if (encoded.length <= NOTIFICATION_LIMITS.data) return encoded;
    }

    this.logger.warn(
      `notification data omitted: envelope does not fit ${NOTIFICATION_LIMITS.data} chars`,
    );
    return null;
  }
}
