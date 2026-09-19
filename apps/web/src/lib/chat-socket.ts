"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { API_BASE_URL } from "./api";

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

type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export function useChatSocket(conversationId: string | undefined) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [socketError, setSocketError] = useState("");
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setTypingUserIds([]);
    setPeers([]);
    setSocketError("");
    setConnectionState("connecting");

    const next: Socket = io(`${SOCKET_BASE_URL}/chat`, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    setSocket(next);

    next.on("connect", () => {
      setConnectionState("live");
      setSocketError("");
      next.emit("conversation.join", { conversationId });
    });
    next.on("disconnect", (reason) => {
      setConnectionState(reason === "io server disconnect" ? "offline" : "reconnecting");
    });
    next.on("connect_error", () => setConnectionState("reconnecting"));
    next.on("reconnect_failed", () => setConnectionState("offline"));
    next.on("error", (payload: { code?: string; message?: string }) => {
      setSocketError(payload?.message ?? "实时连接失败");
      if (payload?.code === "UNAUTHORIZED") {
        fetch(`${API_BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" })
          .then((response) => {
            if (response.ok) next.connect();
            else setConnectionState("offline");
          })
          .catch(() => setConnectionState("offline"));
      }
      if (payload?.code === "USER_BANNED") setConnectionState("offline");
    });
    next.on("conversation.joined", (payload: { peers?: PeerPresence[]; typing?: string[] }) => {
      setPeers(payload.peers ?? []);
      setTypingUserIds(payload.typing ?? []);
    });
    next.on("message.new", (message: SocketMessage) => {
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
      if (payload.conversationId !== conversationId) return;
      setTypingUserIds((current) => {
        if (payload.typing) return current.includes(payload.userId) ? current : [...current, payload.userId];
        return current.filter((id) => id !== payload.userId);
      });
    });
    next.on("presence", (payload: PeerPresence) => {
      setPeers((current) => {
        const exists = current.some((peer) => peer.userId === payload.userId);
        if (!exists) return [...current, payload];
        return current.map((peer) => (peer.userId === payload.userId ? payload : peer));
      });
    });
    next.on("presence.list", (list: PeerPresence[]) => setPeers(list));

    return () => {
      next.emit("conversation.leave", { conversationId });
      next.disconnect();
      setSocket(null);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [conversationId]);

  function sendMessage(content: string) {
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
    if (!socket || !conversationId) return;
    socket.emit("typing", { conversationId, typing });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    if (typing) {
      typingTimeout.current = setTimeout(() => {
        socket.emit("typing", { conversationId, typing: false });
      }, 4000);
    }
  }

  return { socket, connectionState, messages, setMessages, typingUserIds, peers, socketError, sendMessage, sendTyping };
}
