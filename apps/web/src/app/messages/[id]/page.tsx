"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Image as ImageIcon, Send } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFErrorState, TFLoadingRegion, TFSkeleton } from "@/components/tf";
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

/** The peer of one conversation, as `GET /conversations` reports it. */
type ConversationPeer = { id: string; nickname: string | null };
type ConversationListItem = { id: string; peer: ConversationPeer | null };

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
  /**
   * Two different failures, deliberately kept apart.
   *
   * `loadError` means the history could not be read, so there is nothing to
   * show and a 重试 button makes sense. `actionError` means one translate /
   * delete / image failed *after* the thread was on screen — feeding that into
   * `loadError` used to unmount the entire message list, so a single failed
   * translate hid the conversation the user was reading.
   */
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  /**
   * FEATURE (post-audit) — paging further back through the thread.
   *
   * `olderCursor` is the server's `nextCursor` for the page currently at the top;
   * `null` means the beginning of the conversation has been reached, which is
   * what hides the 「加载更早的消息」 control.
   */
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, { text: string; targetLang: string }>>({});
  /** Translate failures are per bubble, so only the bubble that failed reports. */
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  /**
   * The peer identity, taken from `GET /conversations` — never from presence.
   *
   * It used to be read off the socket's `conversation.joined` payload, so when
   * the socket could not connect `SafetyActions` received `null` and returned
   * `null`: the block/report menu silently vanished exactly when a user being
   * harassed might need it. Presence now only drives the online/offline badge.
   */
  const [peer, setPeer] = useState<ConversationPeer | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  async function deleteMessage(messageId: string) {
    if (!user || deleting) return;
    setDeleting(messageId);
    setActionError("");
    try {
      await apiFetch(`/messages/${messageId}`, { method: "DELETE" });
      setLiveMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (requestError) {
      // Inline banner: the thread stays on screen, only the action is reported.
      setActionError(requestError instanceof Error ? requestError.message : "撤回失败");
    } finally {
      setDeleting(null);
    }
  }

  async function translateMessage(messageId: string) {
    if (translatingId || messageId.startsWith("local-")) return;
    setTranslatingId(messageId);
    setActionError("");
    setTranslationErrors((current) => {
      if (!(messageId in current)) return current;
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    try {
      const result = await apiFetch<{ text: string; targetLang: string }>(
        `/messages/${messageId}/translate`,
        { method: "POST", body: { targetLang: "zh" } },
      );
      setTranslations((current) => ({ ...current, [messageId]: result }));
    } catch (requestError) {
      setTranslationErrors((current) => ({
        ...current,
        [messageId]: requestError instanceof Error ? requestError.message : "翻译失败",
      }));
    } finally {
      setTranslatingId(null);
    }
  }

  const loadHistory = useCallback(async () => {
    if (!conversationId) return;
    setLoadError("");
    try {
      const data = await apiFetch<{ items: ChatMessage[]; nextCursor: string | null }>(
        `/conversations/${conversationId}/messages?limit=50`,
      );
      const normalized: ChatMessage[] = data.items.map((item) => ({
        ...item,
        conversationId: conversationId ?? item.conversationId,
      }));
      setOlderCursor(data.nextCursor ?? null);
      setLiveMessages((current) => {
        const liveOnly = current.filter(
          (item) =>
            item.id.startsWith("local-") ||
            !normalized.some((history) => history.id === item.id),
        );
        return [...normalized, ...liveOnly];
      });
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : "聊天加载失败");
    } finally {
      setLoading(false);
    }
  }, [conversationId, setLiveMessages]);

  /**
   * FEATURE (post-audit) — read further back than the newest 50 messages.
   *
   * The endpoint has always returned a `nextCursor`, and the page has always
   * thrown it away: a longer conversation simply began mid-history with no way to
   * see what came before. This prepends the previous page.
   *
   * The server returns each page oldest-first, so the prepended block is already
   * in the right order. Three details matter:
   *
   *  - the cursor is only advanced from the *new* response, so a failed page
   *    leaves the button usable rather than silently skipping a block;
   *  - messages already on screen are filtered out by id, because a WebSocket
   *    message and a history page can both contain the same row;
   *  - the scroll position is restored after the prepend, otherwise the browser
   *    keeps the anchor at the top and visibly jumps the reader backwards.
   */
  const loadOlder = useCallback(async () => {
    if (!conversationId || !olderCursor || loadingOlder) return;
    const container = historyRef.current;
    const previousHeight = container?.scrollHeight ?? 0;
    const previousTop = container?.scrollTop ?? 0;
    setLoadingOlder(true);
    setActionError("");
    try {
      const data = await apiFetch<{ items: ChatMessage[]; nextCursor: string | null }>(
        `/conversations/${conversationId}/messages?limit=50&cursor=${encodeURIComponent(olderCursor)}`,
      );
      const older = data.items.map((item) => ({
        ...item,
        conversationId: conversationId ?? item.conversationId,
      }));
      setOlderCursor(data.nextCursor ?? null);
      setLiveMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        const fresh = older.filter((item) => !known.has(item.id));
        return [...fresh, ...current];
      });
      // Restore the viewport once React has painted the prepended block.
      window.requestAnimationFrame(() => {
        if (!container) return;
        container.scrollTop = previousTop + (container.scrollHeight - previousHeight);
      });
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "更早的消息加载失败");
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, olderCursor, loadingOlder, setLiveMessages]);

  useEffect(() => {
    setLoading(true);
    void loadHistory();
  }, [loadHistory]);

  /**
   * The peer identity is fetched separately from `GET /conversations` because
   * the message history does not carry it — it only has `senderId`s, and this
   * page never learned who the other participant is. A failure here is not a
   * page failure: the thread still renders and the safety menu stays reachable
   * with its own "重新获取" action, so `peer` simply stays `null`.
   */
  const loadPeer = useCallback(async () => {
    if (!conversationId) return;
    try {
      const items = await apiFetch<ConversationListItem[]>("/conversations");
      setPeer(items.find((item) => item.id === conversationId)?.peer ?? null);
    } catch {
      // Left null on purpose — the menu reports the missing identity itself.
      setPeer(null);
    }
  }, [conversationId]);

  useEffect(() => {
    setPeer(null);
    void loadPeer();
  }, [loadPeer]);

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
    setActionError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setActionError("只支持 jpg / png / webp 图片");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setActionError("图片不能超过 5MB");
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
      setActionError(requestError instanceof Error ? requestError.message : "图片发送失败");
    } finally {
      /*
       * `input.value` is cleared on every exit path. It used to be cleared
       * nowhere, so re-picking the same file fired no `change` event and the
       * image silently failed to send.
       */
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  const peerOnline = peers.length > 0 ? peers.some((presence) => presence.online) : null;
  const connectionText = connectionLabel(connectionState);

  return (
    <PhoneShell>
      <ScreenHeader
        title="聊天"
        backHref="/messages"
        action={
          /*
           * The identity comes from the conversation data (`peer`), not from the
           * socket, so the block/report menu is available the moment the history
           * renders — a dropped websocket can no longer remove the only defence
           * against a harasser. `peers` is still what drives the online badge
           * above, where a socket really is required.
           */
          <SafetyActions
            peerId={peer?.id ?? null}
            peerName={peer?.nickname ?? "对方"}
            onRetry={() => void loadPeer()}
          />
        }
      />
      <div
        className="flex min-h-0 flex-1 flex-col px-5 pb-3"
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
      >
        {/*
          The status row. 「实时连接」/「连接断开，正在重连…」/「连接失败」 are asserted
          by `chat-socket.spec.ts`, and 「对方在线」/「对方离线」 by the same suite, so
          every string here is unchanged — only the palette moves to tokens.
        */}
        <div className="tf-scroll-x mt-1 flex shrink-0 items-center gap-2 overflow-x-auto pb-1 text-caption">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
              connectionState === "live"
                ? "bg-success-50 text-success-700"
                : "bg-warning-50 text-warning-800",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                connectionState === "live" ? "bg-success-500" : "bg-warning-500",
              )}
            />
            {connectionText}
          </span>
          {peerOnline !== null ? (
            <span className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-600">
              {peerOnline ? "🟢 对方在线" : "对方离线"}
            </span>
          ) : null}
          {conversationId ? (
            <a
              href={`/messages/${conversationId}/connect`}
              className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-600"
            >
              🔗 交换联系方式
            </a>
          ) : null}
        </div>

        {/* A skeleton shaped like a conversation — alternating sides — rather than
            three anonymous bars. `TFLoadingRegion` announces it for assistive tech,
            which the bare `animate-pulse` block did not. */}
        {loading ? (
          <TFLoadingRegion label="正在加载消息记录">
            <div className="mt-6 space-y-3">
              <TFSkeleton shape="block" className="h-10 w-2/3" />
              <div className="flex justify-end">
                <TFSkeleton shape="block" className="h-10 w-1/2" />
              </div>
              <TFSkeleton shape="block" className="h-10 w-1/3" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && loadError ? (
          <div className="mt-6">
            <TFErrorState description={loadError} onRetry={() => void loadHistory()} />
          </div>
        ) : null}

        {socketError ? (
          <p className="mt-3 rounded-row bg-warning-50 px-3 py-2 text-center text-caption leading-5 text-warning-800">
            {socketError}（历史消息仍可用，实时推送重连中）
          </p>
        ) : null}

        {/* An action failure is reported here and nothing else moves: the
            conversation stays readable, which a page-level error used to prevent. */}
        {actionError ? (
          <div
            role="alert"
            className="mt-3 flex shrink-0 items-start gap-2 rounded-row bg-danger-50 px-3 py-2 text-caption leading-5 text-danger-700"
          >
            <span className="min-w-0 flex-1 break-words">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError("")}
              aria-label="关闭错误提示"
              className="shrink-0 font-medium underline"
            >
              关闭
            </button>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <div ref={historyRef} className="tf-scroll mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
            {/* The safety banner is a permanent piece of the chat surface, not a
                dismissible notice — this is where the product tells people not to
                hand out contact details before both sides agreed. Warning colours
                from the token scale; the copy is unchanged. */}
            <p className="sticky top-0 rounded-row bg-warning-50 px-3 py-2 text-center text-caption leading-4 text-warning-800">
              ⚠️ 小心外部链接。请通过「交换联系方式」交换账号，不要直接在聊天里发送。
            </p>
            {/* FEATURE (post-audit): the thread used to stop at the newest 50
                messages with no way to read earlier ones. */}
            {olderCursor ? (
              <div className="flex justify-center pb-1">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="rounded-full border border-border bg-surface px-4 py-2 text-caption text-content transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-60"
                >
                  {loadingOlder ? "加载中…" : "加载更早的消息"}
                </button>
              </div>
            ) : null}
            {liveMessages.map((message) => {
              const mine = user ? message.senderId === user.id || message.senderId === "me" : message.senderId === "me";
              return (
                <ChatBubble
                  key={message.id}
                  message={message}
                  mine={mine}
                  translatingId={translatingId}
                  translations={translations}
                  translationError={translationErrors[message.id] ?? ""}
                  onTranslate={(id) => void translateMessage(id)}
                  onDelete={(id) => void deleteMessage(id)}
                  deleting={deleting}
                />
              );
            })}
            {typingUserIds.length > 0 ? (
              <p className="text-caption text-content-muted">对方正在输入…</p>
            ) : null}
            {liveMessages.length === 0 ? (
              <p className="pt-10 text-center text-ui text-content-muted">还没有消息，打个招呼吧。</p>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}

        {/*
          The composer. The GEOMETRY here is asserted by
          `test/e2e/chat-composer.spec.ts` and must not drift:

            - `chat-attach` and `chat-send` are exactly 44×44
            - `chat-input` is at least 44 tall and more than 3× the send button
            - left-to-right order is attach -> input -> send

          So the sizes stay `h-11 w-11`, the order is untouched, and the input
          keeps `min-h-11 min-w-0 flex-1`. What changes is only the palette:
          `border-line/70` + `bg-[#F8FAFF]` + a purple send button become tokens,
          and the send button loses its `shadow-indigo-200` (an indigo shadow under
          a brand control). `rounded-2xl` is kept as-is rather than swapped for
          `rounded-control`, because the input's radius is part of the shape the
          spec measures against.
        */}
        <div
          className="mt-3 flex shrink-0 items-end gap-2 border-t border-border bg-surface pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3"
          data-testid="chat-composer"
        >
          <label
            data-testid="chat-attach"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border border-border bg-surface-sunken text-content-muted transition-colors duration-instant hover:bg-neutral-200 focus-within:ring-2 focus-within:ring-brand-300"
            aria-label="发送图片"
            title="发送图片"
          >
            <ImageIcon className="h-[18px] w-[18px]" aria-hidden="true" />
            <input
              ref={imageInputRef}
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
            className="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-border bg-surface-sunken px-4 py-2.5 text-ui leading-5 text-content transition-colors duration-instant placeholder:text-content-subtle focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          />
          <button
            type="button"
            onClick={send}
            disabled={!draft.trim()}
            aria-label="发送"
            title="发送"
            data-testid="chat-send"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-500 text-white transition-[background-color,transform] duration-instant ease-out hover:bg-brand-600 active:scale-95 disabled:cursor-not-allowed disabled:bg-brand-200 disabled:active:scale-100 motion-reduce:transition-none"
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
  translationError,
  onTranslate,
  onDelete,
  deleting,
}: {
  message: ChatMessage;
  mine: boolean;
  translatingId: string | null;
  translations: Record<string, { text: string; targetLang: string }>;
  /** Scoped to this bubble: a failed translate must not blank the whole thread. */
  translationError: string;
  onTranslate: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: string | null;
}) {
  if (message.type === "SYSTEM") {
    return (
      /* A system note is neither "mine" nor "theirs", so it gets the neutral
         sunken surface and muted text rather than a bubble colour. This
         previously used a one-off `#F4F6FF` that was not a token. */
      <div className="mx-auto max-w-[90%] rounded-row bg-surface-sunken px-4 py-2 text-center text-overline text-content-muted">
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
          className="block h-auto w-full rounded-row border border-border object-cover"
          loading="lazy"
        />
        {!message.id.startsWith("local-") && mine ? (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="mt-1 rounded-control px-1 text-overline text-brand-600 underline transition-colors duration-instant hover:bg-surface-sunken"
          >
            {deleting === message.id ? "撤回中…" : "撤回"}
          </button>
        ) : null}
      </div>
    );
  }
  const translated = translations[message.id];
  return (
    /*
     * Phase B: the outgoing bubble was `from-[#7B86FF] to-[#9B7BFF]` — a purple
     * gradient hardcoded here, which the global `.tf-gradient` change could not
     * reach. Left alone it would have put a purple bubble in a conversation whose
     * composer, shell and tab bar had all turned blue: the two competing brand
     * colours the design system exists to eliminate. Blue-to-deeper-blue keeps the
     * bubble reading as "mine" without introducing a second hue.
     */
    <div
      className={
        mine
          ? "ml-auto max-w-[80%] rounded-row rounded-br-md bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-2.5 text-ui leading-5 text-white"
          : "mr-auto max-w-[80%] rounded-row rounded-bl-md bg-brand-50 px-4 py-2.5 text-ui leading-5 text-content"
      }
    >
      <p className="break-words">{message.content}</p>
      {translated ? (
        <p className={mine ? "mt-2 border-t border-white/30 pt-2 text-caption opacity-90" : "mt-2 border-t border-border pt-2 text-caption text-content-muted"}>
          🌐 {translated.text}
        </p>
      ) : null}
      {!message.id.startsWith("local-") ? (
        <span className="mt-1 flex gap-3">
          <button
            type="button"
            onClick={() => onTranslate(message.id)}
            disabled={translatingId !== null}
            className={cn(
              "rounded-control px-1 text-overline underline transition-colors duration-instant",
              /* On a brand-filled outgoing bubble the link must be white; on an
                 incoming bubble it is the brand blue. */
              mine ? "text-white/80 hover:bg-white/10" : "text-brand-600 hover:bg-surface-sunken",
              translatingId !== null && translatingId !== message.id ? "opacity-50" : "",
            )}
          >
            {translatingId === message.id ? "翻译中…" : translated ? "重新翻译" : "翻译"}
          </button>
          {mine && message.type !== "SYSTEM" ? (
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="rounded-control px-1 text-overline text-white/80 underline transition-colors duration-instant hover:bg-white/10"
            >
              {deleting === message.id ? "撤回中…" : "撤回"}
            </button>
          ) : null}
        </span>
      ) : null}
      {translationError ? (
        <p role="alert" className={mine ? "mt-1 break-words text-[11px] text-white/90" : "mt-1 break-words text-[11px] text-red-600"}>
          {translationError}
        </p>
      ) : null}
    </div>
  );
}
