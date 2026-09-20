import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { encodeNotificationCursor, type NotificationCursor } from "./notification-cursor";
import type { NotificationType } from "./notification.types";

/**
 * PC-3.1d — the read side of notifications.
 *
 * Named in the plural, next to the singular `NotificationService`, because the
 * two have opposite jobs and must not be confused:
 *
 *  - `NotificationService` (singular, PC-3.1b) is the one **writer**. It is
 *    called by producers and deliberately never fails its caller.
 *  - `NotificationsService` (plural, this file) is the **reader**. It answers
 *    `GET /notifications` and the two read-marking endpoints for one
 *    authenticated user, and it does report failures — a malformed cursor or an
 *    unknown notification must reach the client as a `400` / `404`.
 *
 * ## The page-size contract
 *
 * `pageSize` defaults to 20 and is capped at 50. A value below 1 is rejected by
 * the DTO before it gets here; the floor in `clampPageSize` is the second line
 * of defence so that no caller can hand Prisma a `take` of zero or less.
 */

/** The page-size contract for `GET /notifications`. */
export const NOTIFICATION_PAGE_SIZE = {
  default: 20,
  max: 50,
} as const;

export type NotificationListQuery = {
  /** Narrow to one notification type. Validated against the frozen union. */
  type?: NotificationType;
  pageSize?: number;
  cursor?: NotificationCursor;
};

/**
 * The exact columns a list row exposes.
 *
 * `userId` is deliberately absent: the JWT already established whose list this
 * is, so echoing the owner's id back is one field of no use to the client and
 * one field of needless exposure if the response is ever logged or cached. The
 * exclusion is enforced by the query, not by a response mapper, so a column
 * added to the model later does not silently start being published.
 */
export const NOTIFICATION_ITEM_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

function clampPageSize(raw?: number): number {
  if (raw === undefined) return NOTIFICATION_PAGE_SIZE.default;
  return Math.min(Math.max(raw, 1), NOTIFICATION_PAGE_SIZE.max);
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the caller's notifications, newest first.
   *
   * ## Ordering
   *
   * `createdAt DESC, id DESC`. The second key is not decoration: without it,
   * rows sharing a millisecond have no defined relative order, which is exactly
   * the situation a cursor boundary cannot resolve.
   *
   * ## The cursor boundary
   *
   * The tuple comparison `(createdAt, id) < (cursor.createdAt, cursor.id)`,
   * written in the two-branch form Prisma can express:
   *
   *     createdAt < cursor.createdAt
   *     OR (createdAt = cursor.createdAt AND id < cursor.id)
   *
   * Both branches are needed — the first alone would build a strict boundary
   * that is wrong for rows sharing the cursor's timestamp, and an `offset`-based
   * page would re-read or skip rows whenever something is inserted mid-walk.
   *
   * ## `unread`
   *
   * It is always the count over *every* notification the user has, never the
   * count within the current `type` filter. The number exists to drive a badge
   * ("3 things happened"), so narrowing it to the filter would make the badge
   * disagree with the list beneath it.
   */
  async list(userId: string, query: NotificationListQuery = {}) {
    const pageSize = clampPageSize(query.pageSize);

    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          ...(query.type ? { type: query.type } : {}),
          ...(query.cursor
            ? {
                OR: [
                  { createdAt: { lt: query.cursor.createdAt } },
                  { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        // One row past the page. Its presence is the only thing that says
        // "there is more", and it costs a single extra row rather than a second
        // count query that could disagree with the list.
        take: pageSize + 1,
        select: NOTIFICATION_ITEM_SELECT,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    const hasMore = rows.length > pageSize;
    const items = hasMore ? rows.slice(0, pageSize) : rows;
    // The last row the caller actually received — not the look-ahead row, which
    // would make the next page start one item too late.
    const last = items[items.length - 1];

    return {
      items,
      unread,
      nextCursor:
        hasMore && last
          ? encodeNotificationCursor({ createdAt: last.createdAt, id: last.id })
          : null,
    };
  }

  /**
   * Marks one notification read.
   *
   * ## Ownership, and why a stranger's row is `404` and not `403`
   *
   * The `userId` in the `where` is both the ownership check and the
   * anti-enumeration device. `updateMany` reports how many rows it touched, and
   * "belongs to someone else" and "does not exist" are the same answer — zero.
   * Answering `403` would require reading the row first and would confirm the
   * existence of another user's notification to anyone who can guess an id.
   *
   * ## Idempotence and concurrency
   *
   * There is no `readAt: null` in the `where`, so an already-read notification
   * matches and the call succeeds — a `PATCH` is a statement of desired state,
   * not an event, and the second one must not fail. That also makes two
   * concurrent requests safe by construction: both match the same row and both
   * write, and neither can observe the other's write as an error.
   */
  async markRead(userId: string, id: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });

    if (updated.count === 0) {
      throw new NotFoundException({
        success: false,
        error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" },
      });
    }

    return { read: true };
  }

  /**
   * Marks everything the caller has unread as read.
   *
   * Scoped to `userId` and to `readAt: null`, so it is idempotent (the second
   * call simply matches nothing) and can never touch another account's rows.
   */
  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { read: true };
  }
}
