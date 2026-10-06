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
   * 聊天消息专用：**未读期间同一个会话只占一行**，后来的消息并进去。
   *
   * 需求（2026-10-06）：同一个人连发三条消息，收件人收到三条通知。
   * 线上实测那三条是 21:04:15 / 21:04:35 / 21:04:42，其中两条来自同一人。
   *
   * 为什么不给 `notify` 加开关了事：`MOMENT_LIKE` 那类已被契约钉死
   * 「每次都要提醒一次」（见 `notifications-api.spec.ts` 的 C5 用例），
   * 改了 `notify` 就会静默破坏那条契约。合并规则只属于消息。
   *
   * 查找条件里的 `readAt: null` 是关键的：**读完之后再来消息应当是新的一条**。
   * 若把已读那条改活，用户就看不出这是新消息。
   *
   * 顺带把 `createdAt` 推到最新一条：列表按时间倒序，合并后应该浮到最上面。
   */
  async notifyNewMessage(input: {
    userId: string;
    actorId: string;
    conversationId: string;
    title: string;
    body: string;
  }): Promise<void> {
    try {
      if (!input.userId) {
        this.logger.warn("notification skipped: missing recipient userId");
        return;
      }
      // 自己发的消息不必提醒自己（与 `notify` 同一条规则）。
      if (input.actorId === input.userId) return;

      const dedupeKey = messageDedupeKey(input.conversationId);
      const title = truncate(input.title, NOTIFICATION_LIMITS.title);
      const body = truncate(input.body, NOTIFICATION_LIMITS.body);
      const data: NotificationData = {
        actorId: input.actorId,
        targetType: "CONVERSATION",
        targetId: input.conversationId,
        conversationId: input.conversationId,
      };

      const existing = await this.prisma.notification.findFirst({
        where: { userId: input.userId, type: "NEW_MESSAGE", dedupeKey, readAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (existing) {
        await this.prisma.notification.update({
          where: { id: existing.id },
          data: {
            title,
            body,
            data: this.encodeData(data),
            count: { increment: 1 },
            createdAt: new Date(),
          },
        });
        return;
      }

      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: "NEW_MESSAGE",
          title,
          body,
          data: this.encodeData(data),
          count: 1,
          dedupeKey,
        },
      });
    } catch (error) {
      this.logger.warn(
        `notification not delivered (NEW_MESSAGE): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 会话被读完时，把它的未读消息通知标为已读 —— 合并的另一半。
   *
   * 不做这一步，合并会变成新的麻烦：用户明明看过了，那条通知还挂着，
   * 而且下一条消息会让计数继续涨（“12 条新消息”）。
   *
   * 为什么放在写入方而不是读侧服务：合并的不变式是「未读期间只有一行」，
   * 而「读完了」恰好是这条不变式的另一半；两半分住两个模块，早晚会有一半忘了跟上。
   *
   * 幂等：只改 `readAt: null` 的行，重复调用结果为 0。
   */
  async markConversationMessageNotificationsRead(
    userId: string,
    conversationId: string,
  ): Promise<number> {
    try {
      const result = await this.prisma.notification.updateMany({
        where: {
          userId,
          type: "NEW_MESSAGE",
          dedupeKey: messageDedupeKey(conversationId),
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      return result.count;
    } catch (error) {
      this.logger.warn(
        `notification read-marking failed (NEW_MESSAGE): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
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

/**
 * 参与合并的通知行的键。
 *
 * 带会话 id 就够：同一个人在不同会话里发的消息是两件事，不该并成一条。
 * 以类型开头是为了将来万一有别的类型也用这套合并时，不会跟消息的键撞上。
 */
export function messageDedupeKey(conversationId: string): string {
  return `NEW_MESSAGE:${conversationId}`;
}
