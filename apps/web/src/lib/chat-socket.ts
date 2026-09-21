"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { tryRefresh } from "./api";

export const SOCKET_BASE_URL =
  process.env.NEXT_PUBLIC_SOCKET_BASE_URL ?? "http://localhost:4000";

export type SocketMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  type: string;
  createdAt: string;
  clientMessageId?: string | null;
};

export type PeerPresence = { userId: string; online: boolean; lastSeen: string | null };

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

/** The one place the four connection states are turned into user-facing text. */
export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: "正在连接…",
  live: "实时连接",
  reconnecting: "连接断开，正在重连…",
  offline: "连接失败",
};

export function connectionLabel(state: ConnectionState) {
  return CONNECTION_LABELS[state];
}

/**
 * Reconnect budget.
 *
 * These are handed to Socket.IO's own Manager rather than driven by hand: its
 * retry loop already backs off exponentially (`delay * 2^n`, capped at
 * `reconnectionDelayMax`) and jitters each attempt (`randomizationFactor`), and
 * — importantly — it unwinds its internal `_readyState` correctly between
 * attempts. A hand-rolled loop that called `socket.connect()` again left the
 * Manager wedged in `opening`, which stranded the socket in "reconnecting"
 * forever.
 */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 8000;
/** Backoff used for the one class of retry the Manager refuses to make itself. */
const SERVER_KICK_DELAY_MS = 1000;

/**
 * How the chat screen used to reconnect ~50 times a second.
 *
 * The client's `error` handler refreshed the access token and called
 * `connect()` again immediately — no delay, no attempt limit, no coordination
 * with the Manager's own retry loop. One spurious rejection therefore became an
 * infinite loop that also rotated the refresh token on every pass (measured at
 * ~650 handshakes and ~650 refresh calls per 12 seconds). The rejection was
 * itself a server bug: `handleConnection` is `async`, so the
 * `conversation.join` the client sends on `connect` could be handled before the
 * authenticated user was stored, and the socket was force-disconnected with
 * `UNAUTHORIZED` despite holding a perfectly valid token.
 *
 * The rules that keep it from coming back:
 *  - one Socket instance per mounted page, listeners bound exactly once;
 *  - `connect()` is never called while the socket is connected or connecting;
 *  - retrying is bounded and jittered (delegated to the Manager);
 *  - at most **one** token refresh per established session.
 */
export function useChatSocket(conversationId: string | undefined) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [socketError, setSocketError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setTypingUserIds([]);
    setPeers([]);
    setSocketError("");
    setConnectionState("connecting");

    let disposed = false;
    // Latched once the budget is spent or the session is unrecoverable. It is
    // the single thing that makes the old infinite loop impossible.
    let stopped = false;
    // Which state to fall back to after a failure: a socket that has never been
    // live is still "connecting"; one that dropped is "reconnecting".
    let wasLive = false;
    // One token refresh per *established* session — not per attempt.
    let refreshUsed = false;
    // Set while the `error` handler owns the next reconnect, so the kick's own
    // `disconnect` event does not try to reconnect a second time.
    let authFlow = false;
    let serverKicks = 0;
    let kickTimer: ReturnType<typeof setTimeout> | null = null;

    function stop() {
      stopped = true;
      authFlow = false;
      setConnectionState("offline");
    }

    /**
     * The one explicit reconnect we ever make ourselves. The Manager does not
     * retry an `io server disconnect`, so it has to come from here — and only
     * when nothing else is already in flight.
     */
    function reconnectOnce() {
      if (disposed || stopped) return;
      if (next.connected || next.active) return;
      next.connect();
    }

    // `autoConnect: false` guarantees every listener below is bound before the
    // first packet leaves, which removes our half of the handshake race.
    const next: Socket = io(`${SOCKET_BASE_URL}/chat`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: MAX_ATTEMPTS,
      reconnectionDelay: BASE_DELAY_MS,
      reconnectionDelayMax: MAX_DELAY_MS,
      randomizationFactor: 0.5,
    });
    socketRef.current = next;

    next.on("connect", () => {
      if (disposed) return;
      wasLive = true;
      authFlow = false;
      setConnectionState("live");
      setSocketError("");
      next.emit("conversation.join", { conversationId });
    });

    next.on("disconnect", (reason) => {
      if (disposed || stopped) return;
      // Our own teardown, not a failure.
      if (reason === "io client disconnect") return;
      if (authFlow) {
        // The `error` handler already owns the reconnect for this kick.
        return;
      }
      if (reason === "io server disconnect") {
        // The Manager will not retry a server-initiated disconnect, so this is
        // the only way back — bounded by the same attempt budget.
        if (serverKicks >= MAX_ATTEMPTS) {
          stop();
          return;
        }
        serverKicks += 1;
        setConnectionState("reconnecting");
        kickTimer = setTimeout(reconnectOnce, SERVER_KICK_DELAY_MS * serverKicks);
        return;
      }
      setConnectionState("reconnecting");
    });

    next.on("connect_error", () => {
      if (disposed || stopped) return;
      setConnectionState(wasLive ? "reconnecting" : "connecting");
    });

    next.on("reconnect_failed", () => {
      if (disposed || stopped) return;
      stop();
    });

    next.on("error", (payload: { code?: string; message?: string }) => {
      if (disposed || stopped) return;
      setSocketError(payload?.message ?? "实时连接失败");
      if (payload?.code === "USER_BANNED" || payload?.code === "USER_DISABLED") {
        stop();
        return;
      }
      if (payload?.code !== "UNAUTHORIZED") return;
      if (refreshUsed) {
        // The one refresh this session gets is spent: never loop again.
        stop();
        return;
      }
      refreshUsed = true;
      authFlow = true;
      void tryRefresh().then((ok) => {
        if (disposed || stopped) return;
        if (!ok) {
          stop();
          return;
        }
        reconnectOnce();
      });
    });

    next.on("conversation.joined", (payload: { peers?: PeerPresence[]; typing?: string[] }) => {
      if (disposed) return;
      // The session is genuinely established — the server accepted the join,
      // not merely the transport. Only now are the budgets restored; the old
      // code treated `connect` as success even when the join was rejected.
      refreshUsed = false;
      serverKicks = 0;
      setPeers(payload.peers ?? []);
      setTypingUserIds(payload.typing ?? []);
    });

    next.on("message.new", (message: SocketMessage) => {
      if (disposed) return;
      if (message.conversationId !== conversationId) return;
      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) return current;
        if (message.clientMessageId) {
          const optimisticIndex = current.findIndex(
            (item) => item.id === `local-${message.clientMessageId}`,
          );
          if (optimisticIndex >= 0) {
            const replaced = [...current];
            replaced[optimisticIndex] = message;
            return replaced;
          }
        }
        return [...current, message];
      });
      setTypingUserIds((current) => current.filter((id) => id !== message.senderId));
    });

    next.on("typing", (payload: { conversationId: string; userId: string; typing: boolean }) => {
      if (disposed) return;
      if (payload.conversationId !== conversationId) return;
      setTypingUserIds((current) => {
        if (payload.typing) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((id) => id !== payload.userId);
      });
    });

    // Peer presence is written *only* from presence events — never derived from
    // `connectionState` — so a reconnect on our side cannot flip the other
    // person's badge.
    next.on("presence", (payload: PeerPresence) => {
      if (disposed) return;
      setPeers((current) => {
        const exists = current.some((peer) => peer.userId === payload.userId);
        if (!exists) return [...current, payload];
        return current.map((peer) => (peer.userId === payload.userId ? payload : peer));
      });
    });

    next.on("presence.list", (list: PeerPresence[]) => {
      if (disposed) return;
      setPeers(list);
    });

    next.connect();

    return () => {
      disposed = true;
      stopped = true;
      if (kickTimer) clearTimeout(kickTimer);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      next.emit("conversation.leave", { conversationId });
      // Listeners first, then disconnect: teardown must not re-enter the
      // reconnect path, and a remount must not inherit a listener.
      next.removeAllListeners();
      next.disconnect();
      socketRef.current = null;
    };
  }, [conversationId]);

  function sendMessage(content: string) {
    const socket = socketRef.current;
    if (!socket || !conversationId) return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: SocketMessage = {
      id: `local-${clientMessageId}`,
      conversationId,
      senderId: "me",
      content: trimmed,
      type: "TEXT",
      createdAt: new Date().toISOString(),
      clientMessageId,
    };
    setMessages((current) => [...current, optimistic]);
    socket.emit("message.send", { conversationId, content: trimmed, clientMessageId });
    socket.emit("typing", { conversationId, typing: false });
    return optimistic;
  }

  function sendTyping(typing: boolean) {
    const socket = socketRef.current;
    if (!socket || !conversationId) return;
    socket.emit("typing", { conversationId, typing });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    if (typing) {
      typingTimeout.current = setTimeout(() => {
        socketRef.current?.emit("typing", { conversationId, typing: false });
      }, 4000);
    }
  }

  return { connectionState, messages, setMessages, typingUserIds, peers, socketError, sendMessage, sendTyping };
}
