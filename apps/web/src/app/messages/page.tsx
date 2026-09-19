"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
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
      setError(requestError instanceof Error ? requestError.message : "消息加载失败");
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
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setActingId(null);
    }
  }

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <h1 className="text-[22px] font-semibold">
          消息{unreadTotal > 0 ? `（${unreadTotal} 未读通知）` : ""}
        </h1>
        <p className="mt-1 text-[13px] text-muted">先处理认识请求，再开始实时聊天。</p>
        {!loading && !error ? <NotificationsPanel onRead={() => setUnreadTotal(0)} /> : null}

        {loading ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-28 rounded-3xl bg-indigo-50" />
            <div className="h-20 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-6 rounded-3xl border border-red-100 bg-red-50 p-5 text-center">
            <p className="text-[13px] text-red-700">{error}</p>
            <OutlineButton className="mt-4 w-full" onClick={() => void load()}>
              重试
            </OutlineButton>
          </div>
        ) : null}

        {!loading && !error ? (
          <>
            <section className="mt-6">
              <h2 className="text-[14px] font-semibold">认识请求（{incoming.length}）</h2>
              {incoming.length === 0 ? (
                <p className="mt-3 rounded-3xl bg-[#F7F9FF] p-4 text-[12px] leading-5 text-muted">
                  暂时没有新的 Say Hello。去 Discover 看看吧。
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {incoming.map((request) => (
                    <article key={request.id} className="rounded-3xl border border-indigo-100 p-4">
                      <div className="flex items-center gap-3">
                        <div className="tf-gradient grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-semibold text-white">
                          {(request.sender?.nickname ?? "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">
                            {request.sender?.nickname ?? "TalkFirst 用户"}
                          </p>
                          <p className="truncate text-[12px] text-muted">
                            {request.sender?.countryCode ?? "全球"} · {request.message ?? "Say hello!"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <OutlineButton
                          className="w-1/2"
                          onClick={() => void respond(request.id, "reject")}
                          ariaLabel={`拒绝 ${request.sender?.nickname ?? "对方"}`}
                        >
                          {actingId === request.id ? "处理中…" : "拒绝"}
                        </OutlineButton>
                        <GradientButton
                          className="w-1/2"
                          onClick={() => void respond(request.id, "accept")}
                          disabled={actingId === request.id}
                        >
                          接受并聊天
                        </GradientButton>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <SentRequestsPanel />

            <section className="mt-7">
              <h2 className="text-[14px] font-semibold">聊天（{conversations.length}）</h2>
              {conversations.length === 0 ? (
                <p className="mt-3 rounded-3xl bg-[#F7F9FF] p-4 text-[12px] leading-5 text-muted">
                  接受认识请求后，这里会出现实时聊天。
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {conversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      href={`/messages/${conversation.id}`}
                      className="block rounded-3xl border border-line p-4 transition active:scale-[0.99]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="tf-gradient grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-semibold text-white">
                          {(conversation.peer?.nickname ?? "?").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold">
                            {conversation.peer?.nickname ?? "TalkFirst 用户"}
                            {conversation.unreadCount ? `（${conversation.unreadCount} 未读）` : ""}
                          </p>
                          <p className="truncate text-[12px] text-muted">
                            {conversation.lastMessage?.content ?? "开始聊天吧"}
                          </p>
                        </div>
                        <span className="text-[11px] text-muted">
                          {new Date(conversation.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
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
