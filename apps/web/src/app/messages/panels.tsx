"use client";

import { useCallback, useEffect, useState } from "react";
import { NotificationItem, useNotificationReader } from "@/components/notification-item";
import { OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { type NotificationPage, type NotificationRecord } from "@/lib/notifications";
import { useSession } from "@/lib/session";

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
    <section className="mt-4 rounded-3xl bg-[#F7F9FF] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold">通知{unread > 0 ? `（${unread} 未读）` : ""}</h2>
        {unread > 0 ? (
          <button onClick={() => void markRead()} className="text-[12px] text-[#6572D8] underline">
            全部已读
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
  const [items, setItems] = useState<SentRequest[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<SentRequest[]>("/connections/requests/sent");
      setItems(data.filter((item) => item.status === "PENDING").slice(0, 5));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    }
  }, [user]);

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
      setError(requestError instanceof Error ? requestError.message : "取消失败");
    } finally {
      setActing(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-[14px] font-semibold">我发出的请求（{items.length}）</h2>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-2xl border border-line p-3">
            <div>
              <p className="text-[13px] font-medium">{item.receiver?.nickname ?? "对方"}</p>
              <p className="text-[11px] text-muted">等待对方接受 · 可随时取消</p>
            </div>
            <OutlineButton className="h-9 w-20 text-[12px]" onClick={() => void cancel(item.id)}>
              {acting === item.id ? "…" : "取消"}
            </OutlineButton>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[12px] text-red-500">{error}</p> : null}
    </section>
  );
}
