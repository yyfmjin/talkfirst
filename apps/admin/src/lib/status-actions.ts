/**
 * Shared presentation metadata for user status actions.
 *
 * Phase A put this table inside the users *list* screen, which left the detail
 * screen with no status controls at all. Both screens now read from here so the
 * labels, warnings and confirmation phrases can never drift apart.
 *
 * Scope note: this file is presentation only. Which actions a role may actually
 * perform comes from `canSetUserStatus` (which mirrors the backend matrix), and
 * the backend re-validates every request regardless of what is rendered.
 */

/** The five status actions the API accepts. */
export type StatusAction = "ban" | "unban" | "disable" | "activate" | "suspend";

/** The minimum a target must expose for these labels to render. */
export type StatusTarget = {
  id: string;
  nickname: string | null;
  email: string;
};

export type ActionMeta = {
  label: string;
  title: string;
  describe: (user: StatusTarget) => string;
  /** Extra red warning, e.g. for permanent bans. */
  danger?: string;
  /** Text the admin must type to confirm. */
  phrase?: string;
  /** Show a required expiry picker (temporary suspension). */
  withExpiry?: boolean;
};

export const ACTION_META: Record<StatusAction, ActionMeta> = {
  ban: {
    label: "永久封禁",
    title: "永久封禁用户",
    describe: (user) => `将永久封禁 ${user.nickname ?? user.email}，该账号将无法登录。`,
    danger: "这是永久性操作，不会自动解除。",
    phrase: "BAN",
  },
  suspend: {
    label: "临时封禁",
    title: "临时封禁用户",
    describe: (user) => `将临时封禁 ${user.nickname ?? user.email}，到期后需人工或定时任务解除。`,
    withExpiry: true,
  },
  disable: {
    label: "停用",
    title: "停用用户",
    describe: (user) => `将停用 ${user.nickname ?? user.email} 的账号。`,
  },
  activate: {
    label: "解封",
    title: "解除封禁",
    describe: (user) => `将恢复 ${user.nickname ?? user.email} 为正常状态。`,
  },
  unban: {
    label: "解封",
    title: "解除封禁",
    describe: (user) => `将恢复 ${user.nickname ?? user.email} 为正常状态。`,
  },
};

/**
 * Display order for the action buttons. `unban` is intentionally absent — it is
 * the same outcome as `activate` and is offered through that label.
 */
export const STATUS_ACTION_ORDER: readonly StatusAction[] = [
  "activate",
  "disable",
  "suspend",
  "ban",
];
