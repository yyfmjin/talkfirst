import {
  Bell,
  CheckCircle2,
  CornerDownRight,
  Flower2,
  Hand,
  Heart,
  MessageCircle,
  MessageSquare,
  Repeat,
  ShieldCheck,
  UserCheck,
  UserCog,
  type LucideIcon,
} from "lucide-react";

/**
 * PC-3.1e — the web client's half of the PC-3.1a notification contract.
 *
 * `GET /notifications` returns the stored row verbatim, so this module is the
 * one place that knows three things about it:
 *
 *   1. the ten frozen `type` values, and the Chinese label / icon each maps to
 *      (a raw enum must never reach a member);
 *   2. how `data` is decoded. It is still a JSON *string* on the wire, and a
 *      row written before PC-3.1a may hold no envelope at all — or not be valid
 *      JSON. `parseNotificationData` therefore answers `null` rather than
 *      throwing, and every field it hands back is checked before use;
 *   3. which stored target has a member-facing screen. Only `targetType` /
 *      `targetId` from a decoded envelope ever become a link: a notification
 *      whose target is gone, missing or unrouteable stays readable, it simply
 *      does not navigate.
 *
 * Nothing here writes to the API and nothing here decides authorization — the
 * server already answered that when it built the list.
 */

/** The frozen set. Mirrors `apps/api/src/notifications/notification.types.ts`. */
export const NOTIFICATION_TYPES = [
  "NEW_MESSAGE",
  "SAY_HELLO",
  "REQUEST_ACCEPTED",
  "EXCHANGE_REQUEST",
  "EXCHANGE_ACCEPTED",
  "MOMENT_LIKE",
  "MOMENT_COMMENT",
  "MOMENT_REPLY",
  "REPORT_REVIEW",
  "USER_STATUS",
  "FLOWER_RECEIVED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The `targetType` whitelist from the frozen envelope. */
export const NOTIFICATION_TARGET_TYPES = [
  "USER",
  "MOMENT",
  "COMMENT",
  "MESSAGE",
  "CONNECTION",
  "EXCHANGE",
  "REPORT",
  "CONVERSATION",
] as const;

export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

/** Exactly the projection `GET /notifications` selects — `userId` is not sent. */
export type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  /** A JSON string, or null on legacy rows. Never parsed by the API. */
  data: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NotificationRecord[];
  unread: number;
  nextCursor: string | null;
};

/**
 * The single type → label / icon table.
 *
 * `label` names the *event* ("评论收到回复"), not the stored `title`, which the
 * writer already words for the reader. It therefore drives the filter control
 * and the accessible name, and stands in for the title only on a row that
 * somehow carries none.
 */
const META: Record<NotificationType, { label: string; icon: LucideIcon }> = {
  NEW_MESSAGE: { label: "新消息", icon: MessageCircle },
  SAY_HELLO: { label: "有人向你打招呼", icon: Hand },
  REQUEST_ACCEPTED: { label: "连接已接受", icon: UserCheck },
  EXCHANGE_REQUEST: { label: "交换请求", icon: Repeat },
  EXCHANGE_ACCEPTED: { label: "交换已接受", icon: CheckCircle2 },
  MOMENT_LIKE: { label: "动态收到赞", icon: Heart },
  MOMENT_COMMENT: { label: "动态收到评论", icon: MessageSquare },
  MOMENT_REPLY: { label: "评论收到回复", icon: CornerDownRight },
  REPORT_REVIEW: { label: "举报处理结果", icon: ShieldCheck },
  USER_STATUS: { label: "账号状态更新", icon: UserCog },
  FLOWER_RECEIVED: { label: "收到一朵花", icon: Flower2 },
};

const UNKNOWN_META = { label: "通知", icon: Bell };

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = Object.fromEntries(
  NOTIFICATION_TYPES.map((type) => [type, META[type].label]),
) as Record<NotificationType, string>;

export function notificationTypeMeta(type: string): { label: string; icon: LucideIcon } {
  return (META as Record<string, { label: string; icon: LucideIcon }>)[type] ?? UNKNOWN_META;
}

/** A decoded envelope. Fields are read through the helpers below, never trusted. */
export type NotificationData = Record<string, unknown>;

/**
 * Decodes `data`, tolerating everything the column may legally hold.
 *
 * Legacy rows predate the envelope (they might carry only `momentId`) and a few
 * are not JSON at all. This is best-effort by design: a row that cannot be
 * decoded renders as a plain title / body notification instead of breaking the
 * screen, which is why a failure answers `null` and never throws.
 */
export function parseNotificationData(raw: unknown): NotificationData | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as NotificationData;
}

/** A non-empty string field, or null. Nothing else is accepted. */
export function notificationDataString(data: NotificationData | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Ids are interpolated into hrefs, so they are narrowed to an opaque-token shape
 * first. A stored value that cannot match is treated as no target at all.
 */
const ID_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

function idToken(data: NotificationData | null, key: string): string | null {
  const value = notificationDataString(data, key);
  return value && ID_TOKEN.test(value) ? value : null;
}

/**
 * The stored target of a notification, or null when the row has no usable
 * envelope (legacy row, invalid JSON, unknown `targetType`, unusable `targetId`).
 */
export function notificationTarget(
  data: NotificationData | null,
): { targetType: NotificationTargetType; targetId: string } | null {
  const targetType = notificationDataString(data, "targetType");
  if (!targetType) return null;
  if (!(NOTIFICATION_TARGET_TYPES as readonly string[]).includes(targetType)) return null;
  const targetId = idToken(data, "targetId");
  if (!targetId) return null;
  return { targetType: targetType as NotificationTargetType, targetId };
}

/**
 * Where a notification should go, using only routes the app already has.
 *
 * A `COMMENT` target has no screen of its own — the thread lives on the moment
 * — so a reply opens the enclosing moment through the row's own `momentId`. An
 * `EXCHANGE` target is only routable through its conversation, which the same
 * envelope carries. `REPORT` and `MESSAGE` have no member-facing page and
 * deliberately answer null: those notifications stay readable and simply do not
 * navigate. Anything without a usable envelope does the same.
 */
export function notificationTargetHref(rawData: unknown): string | null {
  const data = parseNotificationData(rawData);
  const target = notificationTarget(data);
  if (!target) return null;

  switch (target.targetType) {
    case "CONVERSATION":
      return `/messages/${target.targetId}`;
    case "MOMENT":
      return `/moments/${target.targetId}`;
    case "COMMENT": {
      const momentId = idToken(data, "momentId");
      return momentId ? `/moments/${momentId}` : null;
    }
    case "EXCHANGE": {
      const conversationId = idToken(data, "conversationId");
      return conversationId ? `/messages/${conversationId}/connect` : null;
    }
    case "CONNECTION":
      return "/messages";
    case "USER":
      return `/profile/${target.targetId}`;
    default:
      return null;
  }
}
