"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import {
  TFAvatar,
  TFButton,
  TFCard,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";
import { NotificationsPanel, SentRequestsPanel } from "./panels";

type IncomingRequest = {
  id: string;
  message: string | null;
  status: string;
  createdAt: string;
  sender: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null } | null;
};

type ConversationItem = {
  id: string;
  connectionId: string | null;
  updatedAt: string;
  unreadCount?: number;
  peer: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null } | null;
  lastMessage: { content: string; senderId: string; createdAt: string } | null;
};

type NoticeSummary = { items: Array<{ id: string }>; unread: number };

export default function MessagesPage() {
  const { locale, t } = useT();
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [requests, chats, notices] = await Promise.all([
        apiFetch<IncomingRequest[]>("/connections/requests/incoming"),
        apiFetch<ConversationItem[]>("/conversations"),
        apiFetch<NoticeSummary>("/notifications").catch(() => ({ items: [], unread: 0 })),
      ]);
      setIncoming(requests);
      setConversations(chats);
      setUnreadTotal(notices.unread ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(id: string, action: "accept" | "reject") {
    setActingId(id);
    try {
      await apiFetch(`/connections/requests/${id}/respond`, {
        method: "POST",
        body: { action },
      });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.actionFailed"));
    } finally {
      setActingId(null);
    }
  }

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-title font-semibold text-content">
              {unreadTotal > 0 ? t("messages.titleUnread", { n: unreadTotal }) : t("messages.title")}
            </h1>
            <p className="mt-1 text-caption text-content-muted">{t("messages.subtitle")}</p>
          </div>
          {/* PC-3.1e — the one way into the Notification Center. The tab bar
              badge still counts notifications *and* chats, so this is a link
              and deliberately not a second badge. `notification-center-entry` is
              asserted by `notification.spec.ts`. */}
          <Link
            href={localePath(locale, "/notifications")}
            data-testid="notification-center-entry"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-2 text-caption text-brand-600 transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <Bell size={15} aria-hidden="true" />
            {t("messages.notificationCenter")}
          </Link>
        </div>
        {!loading && !error ? <NotificationsPanel onRead={() => setUnreadTotal(0)} /> : null}

        {loading ? (
          <TFLoadingRegion label={t("messages.loading")}>
            <div className="mt-6 divide-y divide-border">
              <TFRowSkeleton />
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error ? (
          <div className="mt-6">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading && !error ? (
          <>
            <section className="mt-6">
              <h2 className="text-ui font-semibold text-content">{t("messages.requests", { n: incoming.length })}</h2>
              {incoming.length === 0 ? (
                <p className="mt-3 rounded-card bg-surface-sunken p-4 text-caption leading-5 text-content-muted">
                  {t("messages.noRequests")}
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {incoming.map((request) => (
                    <TFCard key={request.id}>
                      <div className="flex items-center gap-3">
                        <TFAvatar name={request.sender?.nickname} size="md" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-ui font-semibold text-content">
                            {request.sender?.nickname ?? t("common.talkFirstUser")}
                          </p>
                          <p className="truncate text-caption text-content-muted">
                            {request.sender?.countryCode ?? t("common.global")} · {request.message ?? t("messages.saidHello")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <TFButton
                          variant="secondary"
                          className="flex-1"
                          onClick={() => void respond(request.id, "reject")}
                          loading={actingId === request.id}
                          loadingLabel={t("common.processing")}
                          aria-label={t("messages.rejectAria", { name: request.sender?.nickname ?? t("common.otherParty") })}
                        >
                          {t("messages.reject")}
                        </TFButton>
                        <TFButton
                          className="flex-1"
                          onClick={() => void respond(request.id, "accept")}
                          disabled={actingId === request.id}
                        >
                          {t("messages.acceptAndChat")}
                        </TFButton>
                      </div>
                    </TFCard>
                  ))}
                </div>
              )}
            </section>

            <SentRequestsPanel />

            <section className="mt-7">
              <h2 className="text-ui font-semibold text-content">{t("messages.chats", { n: conversations.length })}</h2>
              {conversations.length === 0 ? (
                <p className="mt-3 rounded-card bg-surface-sunken p-4 text-caption leading-5 text-content-muted">
                  {t("messages.noChats")}
                </p>
              ) : (
                /* Conversations as hairline-divided rows rather than one bordered
                   card each: a list of chats is a list, and the unread count is the
                   only thing that needs to stand out. */
                <div className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border">
                  {conversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      href={`/messages/${conversation.id}`}
                      className="flex items-center gap-3 bg-surface px-4 py-3.5 transition-colors duration-instant hover:bg-surface-sunken active:bg-surface-sunken"
                    >
                      <TFAvatar name={conversation.peer?.nickname} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ui font-semibold text-content">
                          {conversation.peer?.nickname ?? t("common.talkFirstUser")}
                          {conversation.unreadCount ? (
                            <span className="ml-1.5 font-normal text-brand-600">
                              （{t("messages.unreadCount", { n: conversation.unreadCount })}）
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate text-caption text-content-muted">
                          {conversation.lastMessage?.content ?? t("messages.startChat")}
                        </p>
                      </div>
                      <span className="shrink-0 text-overline text-content-subtle">
                        {new Date(conversation.updatedAt).toLocaleDateString()}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
      <TabBar active="/messages" />
    </PhoneShell>
  );
}
