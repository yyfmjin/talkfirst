"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/moments";
import { notificationTargetHref, notificationTypeMeta, type NotificationRecord } from "@/lib/notifications";
import { type MsgKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

/**
 * PC-3.1e — one notification row, and the interaction every surface shares.
 *
 * There is exactly one renderer for a notification: the Notification Center
 * lists them, and the Messages hub reuses this component for its five-row
 * preview. Neither owns a second copy of the type → icon table (that lives in
 * `lib/notifications.ts`) and neither shows the stored `type`: the row shows the
 * writer's own Chinese `title` / `body`, with the type's label used as the
 * accessible name and as the fallback for a titleless row.
 *
 * `useNotificationReader` is the single "open a notification" rule. It marks the
 * row read *first* and navigates second, so a tap never lands on a screen with
 * the row still highlighted as new. An already-read row is not re-sent (the read
 * endpoint is idempotent, but skipping it also keeps a repeated tap free), and a
 * failed mark keeps the row visually unread — a tap is never faked as
 * successful. `notificationTargetHref` chooses the destination and answers null
 * for anything the app cannot route to, which is what keeps a legacy row or a
 * deleted target readable instead of sending the reader somewhere wrong.
 */

/** The type → label dictionary key, mirroring `META` in `lib/notifications.ts`. */
const TYPE_LABEL_KEYS: Record<string, MsgKey> = {
  NEW_MESSAGE: "notices.type.NEW_MESSAGE",
  SAY_HELLO: "notices.type.SAY_HELLO",
  REQUEST_ACCEPTED: "notices.type.REQUEST_ACCEPTED",
  EXCHANGE_REQUEST: "notices.type.EXCHANGE_REQUEST",
  EXCHANGE_ACCEPTED: "notices.type.EXCHANGE_ACCEPTED",
  MOMENT_LIKE: "notices.type.MOMENT_LIKE",
  MOMENT_COMMENT: "notices.type.MOMENT_COMMENT",
  MOMENT_REPLY: "notices.type.MOMENT_REPLY",
  REPORT_REVIEW: "notices.type.REPORT_REVIEW",
  USER_STATUS: "notices.type.USER_STATUS",
  FLOWER_RECEIVED: "notices.type.FLOWER_RECEIVED",
};

const UNKNOWN_TYPE_KEY: MsgKey = "notices.unknown";

export function notificationTypeLabelKey(type: string): MsgKey {
  return TYPE_LABEL_KEYS[type] ?? UNKNOWN_TYPE_KEY;
}

export function NotificationItem({
  notification,
  onActivate,
  pending = false,
  compact = false,
}: {
  notification: NotificationRecord;
  /** Omit it and the row is inert (a surface with nothing to do on tap). */
  onActivate?: (notification: NotificationRecord) => void;
  /** True while this row's read request is in flight. */
  pending?: boolean;
  /** Messages hub styling: a smaller icon and a clamped body. */
  compact?: boolean;
}) {
  const { t } = useT();
  const meta = notificationTypeMeta(notification.type);
  const Icon = meta.icon;
  const label = t(notificationTypeLabelKey(notification.type));
  const unread = !notification.readAt;
  const title = notification.title?.trim() || label;

  return (
    <button
      type="button"
      data-testid="notification-item"
      data-notification-type={notification.type}
      data-unread={unread ? "true" : "false"}
      aria-label={`${label}：${title}`}
      aria-busy={pending || undefined}
      onClick={onActivate ? () => onActivate(notification) : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-card border bg-surface p-3 text-left transition-colors duration-instant",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
        /* Unread is conveyed by the icon tint plus a weight change on the title —
           and by `data-unread`, which the suite reads. The border alone was the
           only visual difference before, which is "colour alone". */
        unread ? "border-brand-200 bg-brand-50/40" : "border-border",
        pending && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          compact ? "h-7 w-7" : "h-9 w-9",
          unread ? "bg-brand-100 text-brand-600" : "bg-surface-sunken text-content-muted",
        )}
      >
        <Icon size={compact ? 14 : 16} />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block break-words text-ui leading-5",
            unread ? "font-semibold text-content" : "font-medium text-content-muted",
          )}
        >
          {title}
        </span>
        {notification.body ? (
          <span
            className={cn(
              "mt-0.5 block break-words text-caption leading-5 text-content-muted",
              compact && "line-clamp-2",
            )}
          >
            {notification.body}
          </span>
        ) : null}
        <span className="mt-1 flex items-center gap-1.5 text-overline text-content-subtle">
          {relativeTime(notification.createdAt, t)}
          {/* 合并过的行（聊天消息）：把「几条」直接说清楚，比一串同样的行好读。 */}
          {notification.count > 1 ? (
            <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 font-medium text-content-muted">
              {t("notices.count", { count: notification.count })}
            </span>
          ) : null}
        </span>
      </span>

      {unread ? (
        <span
          data-testid="notification-unread"
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500"
        />
      ) : null}
    </button>
  );
}

/**
 * The one read-then-navigate rule, shared by the center and the hub preview.
 *
 * `onMarked` is where a caller applies its own bookkeeping (flip the row, drop
 * the unread counter); the hook deliberately owns no list state so both surfaces
 * can keep theirs.
 */
export function useNotificationReader(onMarked: (notification: NotificationRecord) => void) {
  const router = useRouter();
  const { t } = useT();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activate = useCallback(
    async (notification: NotificationRecord) => {
      if (pendingId === notification.id) return;
      const href = notificationTargetHref(notification.data);

      if (!notification.readAt) {
        setPendingId(notification.id);
        setError("");
        try {
          await apiFetch(`/notifications/${notification.id}/read`, { method: "PATCH" });
          onMarked(notification);
        } catch (requestError) {
          // The row stays unread: a failed write is never shown as a success.
          setError(friendlyErrorMessage(requestError, t("notices.markReadFailed")));
        } finally {
          setPendingId(null);
        }
      }

      // A target the app cannot route to leaves the reader on this screen.
      if (href) router.push(href);
    },
    [onMarked, pendingId, router, t],
  );

  return { activate, pendingId, error };
}
