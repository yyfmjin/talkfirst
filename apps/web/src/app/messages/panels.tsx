"use client";

import { useCallback, useEffect, useState } from "react";
import { NotificationItem, useNotificationReader } from "@/components/notification-item";
import { TFButton } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { type NotificationPage, type NotificationRecord } from "@/lib/notifications";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

type SentRequest = {
  id: string;
  status: string;
  createdAt: string;
  receiver: { id: string; nickname: string | null; countryCode: string | null } | null;
};

/**
 * PC-3.1e — the hub preview. It renders the same rows as `/notifications`
 * through the same `NotificationItem`, and it still asks for exactly five: the
 * hub has never been the place to read a long list, and a member who wants one
 * taps through to the Notification Center.
 */
export function NotificationsPanel({ onRead }: { onRead: () => void }) {
  const { t } = useT();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<NotificationPage>("/notifications?pageSize=5");
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // Notifications are best-effort on the messages hub.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onMarked = useCallback((notification: NotificationRecord) => {
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, readAt } : item)),
    );
    setUnread((current) => Math.max(0, current - 1));
  }, []);
  const { activate, pendingId } = useNotificationReader(onMarked);

  async function markRead() {
    try {
      await apiFetch("/notifications/read", { method: "POST" });
      setUnread(0);
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      onRead();
    } catch {
      // keep unread badge rather than hiding a failure
    }
  }

  if (items.length === 0 && unread === 0) return null;

  return (
    <section className="mt-4 rounded-card bg-surface-sunken p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-ui font-semibold text-content">
          {unread > 0 ? t("mp.notificationsWithUnread", { count: unread }) : t("mp.notifications")}
        </h2>
        {unread > 0 ? (
          <button
            type="button"
            onClick={() => void markRead()}
            className="rounded-control px-1.5 py-1 text-caption font-medium text-brand-600 underline decoration-dotted"
          >
            {t("mp.markAllRead")}
          </button>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <NotificationItem
            key={item.id}
            notification={item}
            compact
            pending={pendingId === item.id}
            onActivate={(notification) => void activate(notification)}
          />
        ))}
      </div>
    </section>
  );
}

export function SentRequestsPanel() {
  const { user } = useSession();
  const { t } = useT();
  const [items, setItems] = useState<SentRequest[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<SentRequest[]>("/connections/requests/sent");
      setItems(data.filter((item) => item.status === "PENDING").slice(0, 5));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("mp.loadFailed"));
    }
  }, [user, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    setActing(id);
    setError("");
    try {
      await apiFetch(`/connections/requests/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("mp.cancelFailed"));
    } finally {
      setActing(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-ui font-semibold text-content">{t("mp.sentHeading", { count: items.length })}</h2>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-ui font-medium text-content">{item.receiver?.nickname ?? t("mp.peer")}</p>
              <p className="text-caption text-content-muted">{t("mp.sentNote")}</p>
            </div>
            <TFButton
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => void cancel(item.id)}
              loading={acting === item.id}
              loadingLabel="…"
            >
              {t("mp.cancel")}
            </TFButton>
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 break-words text-caption text-danger-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
