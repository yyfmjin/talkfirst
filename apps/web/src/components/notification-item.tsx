"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { friendlyErrorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/moments";
import { notificationTargetHref, notificationTypeMeta, type NotificationRecord } from "@/lib/notifications";

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
  const meta = notificationTypeMeta(notification.type);
  const Icon = meta.icon;
  const unread = !notification.readAt;
  const title = notification.title?.trim() || meta.label;

  return (
    <button
      type="button"
      data-testid="notification-item"
      data-notification-type={notification.type}
      data-unread={unread ? "true" : "false"}
      aria-label={`${meta.label}：${title}`}
      aria-busy={pending || undefined}
      onClick={onActivate ? () => onActivate(notification) : undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-3xl border bg-white p-3 text-left transition active:scale-[0.99]",
        unread ? "border-indigo-100 shadow-sm shadow-indigo-100/60" : "border-line",
        pending && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          compact ? "h-7 w-7" : "h-9 w-9",
          unread ? "bg-[#E4E8FF] text-[#6572D8]" : "bg-[#F3F4F9] text-muted",
        )}
      >
        <Icon size={compact ? 14 : 16} />
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block break-words text-[13px] leading-5",
            unread ? "font-semibold" : "font-medium text-ink/80",
          )}
        >
          {title}
        </span>
        {notification.body ? (
          <span
            className={cn(
              "mt-0.5 block break-words text-[12px] leading-5 text-muted",
              compact && "line-clamp-2",
            )}
          >
            {notification.body}
          </span>
        ) : null}
        <span className="mt-1 block text-[11px] text-muted">
          {relativeTime(notification.createdAt)}
        </span>
      </span>

      {unread ? (
        <span
          data-testid="notification-unread"
          aria-hidden
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#6B7CFF]"
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
          setError(friendlyErrorMessage(requestError, "标记已读失败，请稍后重试。"));
        } finally {
          setPendingId(null);
        }
      }

      // A target the app cannot route to leaves the reader on this screen.
      if (href) router.push(href);
    },
    [onMarked, pendingId, router],
  );

  return { activate, pendingId, error };
}
