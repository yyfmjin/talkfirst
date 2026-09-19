"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { useChatSocket } from "@/lib/chat-socket";
import { useSession } from "@/lib/session";
import SafetyActions from "./safety-actions";
import { cn } from "@/lib/cn";

type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
};

export default function ChatDetailPage() {
  const params = useParams<{ id: string }>();
  const conversationId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useSession();
  const {
    connectionState,
    messages: liveMessages,
    setMessages: setLiveMessages,
    typingUserIds,
    peers,
    socketError,
    sendMessage,
    sendTyping,
  } = useChatSocket(conversationId);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, { text: string; targetLang: string }>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function deleteMessage(messageId: string) {
    if (!user || deleting) return;
    setDeleting(messageId);
    try {
      await apiFetch(`/messages/${messageId}`, { method: "DELETE" });
      setLiveMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "撤回失败");
    } finally {
      setDeleting(null);
    }
  }

  async function translateMessage(messageId: string) {
    if (translatingId || messageId.startsWith("local-")) return;
    setTranslatingId(messageId);
    try {
      const result = await apiFetch<{ text: string; targetLang: string }>(
        `/messages/${messageId}/translate`,
        { method: "POST", body: { targetLang: "zh" } },
      );
      setTranslations((current) => ({ ...current, [messageId]: result }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "翻译失败");
    } finally {
      setTranslatingId(null);
    }
  }

  const loadHistory = useCallback(async () => {
    if (!conversationId) return;
    setError("");
    try {
      const data = await apiFetch<{ items: ChatMessage[] }>(
        `/conversations/${conversationId}/messages?limit=50`,
      );
      const normalized: ChatMessage[] = data.items.map((item) => ({
        ...item,
        conversationId: conversationId ?? item.conversationId,
      }));
      setLiveMessages((current) => {
        const liveOnly = current.filter(
          (item) =>
            item.id.startsWith("local-") ||
            !normalized.some((history) => history.id === item.id),
        );
        return [...normalized, ...liveOnly];
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "聊天加载失败");
    } finally {
      setLoading(false);
    }
  }, [conversationId, setLiveMessages]);

  useEffect(() => {
    setLoading(true);
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveMessages.length]);

  function send() {
    const optimistic = sendMessage(draft);
    if (optimistic) setDraft("");
  }

  async function sendImage(file: File | undefined) {
    if (!file || !conversationId) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("只支持 jpg / png / webp 图片");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("图片不能超过 5MB");
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const uploaded = await apiFetch<{ imageUrl: string }>("/uploads/message-image", {
        method: "POST",
        body: { image: dataUrl },
      });
      await apiFetch(`/conversations/${conversationId}/messages/image`, {
        method: "POST",
        body: { imageUrl: uploaded.imageUrl },
      });
      await loadHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "图片发送失败");
    }
  }

  const peerOnline = peers.length > 0 ? peers.some((peer) => peer.online) : null;
  const connectionLabel =
    connectionState === "live"
      ? "实时连接 · Live"
      : connectionState === "connecting"
        ? "正在连接…"
        : connectionState === "reconnecting"
          ? "断线重连中…"
          : "已离线，将自动重连";

  return (
    <PhoneShell>
      <ScreenHeader
        title="聊天"
        backHref="/messages"
        action={
          <SafetyActions
            peerId={peers[0]?.userId ?? null}
            peerName="对方"
          />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-3">
        <div className="tf-scroll-x mt-1 flex shrink-0 items-center gap-2 overflow-x-auto pb-1 text-[11px]">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
              connectionState === "live" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connectionState === "live" ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            {connectionLabel}
          </span>
          {peerOnline !== null ? (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[#6B7CFF]">
              {peerOnline ? "🟢 对方在线" : "对方离线"}
            </span>
          ) : null}
          {conversationId ? (
            <a
              href={`/messages/${conversationId}/connect`}
              className="rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[#6572D8]"
            >
              🔗 Connect
            </a>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-10 w-2/3 rounded-2xl bg-indigo-50" />
            <div className="ml-auto h-10 w-1/2 rounded-2xl bg-indigo-50" />
            <div className="h-10 w-1/3 rounded-2xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-6 rounded-3xl border border-red-100 bg-red-50 p-5 text-center">
            <p className="text-[13px] text-red-700">{error}</p>
            <OutlineButton className="mt-4 w-full" onClick={() => void loadHistory()}>
              重试
            </OutlineButton>
          </div>
        ) : null}

        {socketError ? (
          <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-700">
            {socketError}（历史消息仍可用，实时推送重连中）
          </p>
        ) : null}

        {!loading && !error ? (
          <div className="tf-scroll mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
            <p className="sticky top-0 rounded-2xl bg-[#FFF7E6] px-3 py-2 text-center text-[11px] leading-4 text-[#9A6B1A]">
              ⚠️ Be careful with external links. 请通过 Connect 交换联系方式，不要直接发送账号。
            </p>
            {liveMessages.map((message) => {
              const mine = user ? message.senderId === user.id || message.senderId === "me" : message.senderId === "me";
              return (
                <ChatBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  translatingId={translatingId}
                  translations={translations}
                  onTranslate={(id) => void translateMessage(id)}
                  onDelete={(id) => void deleteMessage(id)}
                  deleting={deleting}
                />
              );
            })}
            {typingUserIds.length > 0 ? (
              <p className="text-[11px] text-muted">对方正在输入…</p>
            ) : null}
            {liveMessages.length === 0 ? (
              <p className="pt-10 text-center text-[12px] text-muted">还没有消息，打个招呼吧。</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}

        <div className="mt-3 flex shrink-0 gap-2 border-t border-line/70 bg-white pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3">
          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              sendTyping(event.target.value.length > 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder="Type a message…"
            aria-label="输入聊天消息"
            maxLength={2000}
            className="h-12 min-w-0 flex-1 rounded-full border border-line bg-[#F8FAFF] px-4 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <label className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-[#F8FAFF] text-[18px]">
            🖼️
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-label="发送图片"
              onChange={(event) => void sendImage(event.target.files?.[0])}
            />
          </label>
          <GradientButton className="w-20 shrink-0" onClick={send} disabled={!draft.trim()}>
            发送
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}

function ChatBubble({
  message,
  mine,
  translatingId,
  translations,
  onTranslate,
  onDelete,
  deleting,
}: {
  message: ChatMessage;
  mine: boolean;
  translatingId: string | null;
  translations: Record<string, { text: string; targetLang: string }>;
  onTranslate: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  if (message.type === "SYSTEM") {
    return (
      <div className="mx-auto max-w-[90%] rounded-2xl bg-[#F4F6FF] px-4 py-2 text-center text-[11px] text-muted">
        {message.content}
      </div>
    );
  }
  if (message.type === "IMAGE") {
    return (
      <div className={mine ? "ml-auto max-w-[80%]" : "mr-auto max-w-[80%]"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={message.content}
          alt="聊天图片"
          className="block h-auto w-full rounded-2xl border border-line object-cover"
          loading="lazy"
        />
        {!message.id.startsWith("local-") && mine ? (
          <button onClick={() => onDelete(message.id)} className="mt-1 text-[11px] text-[#6572D8] underline">
            {deleting === message.id ? "撤回中…" : "撤回"}
          </button>
        ) : null}
      </div>
    );
  }
  const translated = translations[message.id];
  return (
    <div
      className={
        mine
          ? "ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-gradient-to-r from-[#7B86FF] to-[#9B7BFF] px-4 py-2.5 text-[13px] leading-5 text-white"
          : "mr-auto max-w-[80%] rounded-2xl rounded-bl-md bg-[#F1F3FF] px-4 py-2.5 text-[13px] leading-5"
      }
    >
      <p className="break-words">{message.content}</p>
      {translated ? (
        <p className={mine ? "mt-2 border-t border-white/30 pt-2 text-[12px] opacity-90" : "mt-2 border-t border-indigo-100 pt-2 text-[12px] text-muted"}>
          🌐 {translated.text}
        </p>
      ) : null}
      {!message.id.startsWith("local-") ? (
        <span className="mt-1 flex gap-3">
          <button
            onClick={() => onTranslate(message.id)}
            className={mine ? "text-[11px] text-white/80 underline" : "text-[11px] text-[#6572D8] underline"}
          >
            {translatingId === message.id ? "翻译中…" : translated ? "重新翻译" : "翻译"}
          </button>
          {mine && message.type !== "SYSTEM" ? (
            <button
              onClick={() => onDelete(message.id)}
              className={mine ? "text-[11px] text-white/80 underline" : "text-[11px] text-[#6572D8] underline"}
            >
              {deleting === message.id ? "撤回中…" : "撤回"}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
