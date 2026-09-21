"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Image as ImageIcon, Send } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { connectionLabel, useChatSocket } from "@/lib/chat-socket";
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
  const [keyboardInset, setKeyboardInset] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

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

  /**
   * Grow the composer with its content, up to a bounded number of lines. The
   * height is reset to `auto` first so the box can also shrink again — a
   * `scrollHeight` read on an already-tall element never reports a smaller
   * value.
   */
  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [draft]);

  /**
   * Keep the composer above the on-screen keyboard. `100dvh` does not shrink
   * for the keyboard on mobile browsers, so the visual viewport is the only
   * reliable signal for how much of the shell it covers.
   */
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setKeyboardInset(covered > 0 ? Math.round(covered) : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

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
        reader.onerror = () => reject(new Error("读取图片失败"));
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
  const connectionText = connectionLabel(connectionState);

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
      <div
        className="flex min-h-0 flex-1 flex-col px-5 pb-3"
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
      >
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
            {connectionText}
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
              🔗 交换联系方式
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
              ⚠️ 小心外部链接。请通过「交换联系方式」交换账号，不要直接在聊天里发送。
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

        <div className="mt-3 flex shrink-0 items-end gap-2 border-t border-line/70 bg-white pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3" data-testid="chat-composer">
          <label
            data-testid="chat-attach"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-[#F8FAFF] text-[#6572D8]"
            aria-label="发送图片"
            title="发送图片"
          >
            <ImageIcon className="h-[18px] w-[18px]" aria-hidden="true" />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="选择图片"
              onChange={(event) => void sendImage(event.target.files?.[0])}
            />
          </label>
          <textarea
            ref={composerRef}
            value={draft}
            rows={1}
            onChange={(event) => {
              setDraft(event.target.value);
              sendTyping(event.target.value.length > 0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="输入消息…"
            aria-label="输入聊天消息"
            data-testid="chat-input"
            maxLength={2000}
            className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-[#F8FAFF] px-4 py-2.5 text-[13px] leading-5 outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="发送"
            title="发送"
            data-testid="chat-send"
            className="tf-gradient grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-md shadow-indigo-200 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
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
