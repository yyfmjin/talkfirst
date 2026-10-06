/**
 * PC-3.1a — the frozen notification contract.
 *
 * The database column is still a plain `VarChar(32)`, so these unions are the
 * only thing that keeps producers honest. They are the single source of truth:
 * no producer may spell a type or a target as a bare string literal.
 */

/**
 * The complete set of notification types. `MOMENT_REPLY`, `REPORT_REVIEW` and
 * `USER_STATUS` are part of the frozen contract and are produced by PC-3.1c.
 *
 * `FLOWER_RECEIVED`（送花，2026-10-06）是后面加的：虚拟礼物就是「送花」，
 * 形状与 `MOMENT_LIKE` 一致 —— 收花人有知情权，所以新类型而不是复用点赞。
 */
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

const NOTIFICATION_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && NOTIFICATION_TYPE_SET.has(value);
}

/**
 * What a notification points at. Kept to business models that already exist —
 * adding a value here without a real target would make the UI guess.
 */
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

const NOTIFICATION_TARGET_TYPE_SET: ReadonlySet<string> = new Set(NOTIFICATION_TARGET_TYPES);

export function isNotificationTargetType(value: unknown): value is NotificationTargetType {
  return typeof value === "string" && NOTIFICATION_TARGET_TYPE_SET.has(value);
}

/**
 * The envelope every new notification writes into `Notification.data`.
 *
 * `actorId` is optional because a system-originated notification has no actor;
 * when it is absent the service must **not** invent one. `targetType` and
 * `targetId` are required so a client never has to parse a nickname out of
 * `title` to learn what a notification is about.
 */
export type NotificationData = {
  actorId?: string;
  targetType: NotificationTargetType;
  targetId: string;
  [key: string]: unknown;
};

/** The envelope keys that survive every truncation pass. */
export const NOTIFICATION_CORE_DATA_KEYS = ["actorId", "targetType", "targetId"] as const;

/**
 * The limits the `Notification` row actually enforces. Producers must never
 * rely on the database to reject an over-long value.
 */
export const NOTIFICATION_LIMITS = {
  type: 32,
  title: 128,
  body: 500,
  data: 2000,
} as const;
