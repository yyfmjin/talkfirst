import { io, type Socket } from "socket.io-client";
import { PASSWORD } from "./profile";

/**
 * A second, headless chat participant.
 *
 * Several of the socket tests need *someone else* to message the browser under
 * test (a duplicate `message.new` render is the visible symptom of a listener
 * that was bound twice). Driving a second browser for that is slow and adds a
 * second source of flakiness, so the peer speaks the same protocol directly.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";
const SOCKET_BASE = process.env.NEXT_PUBLIC_SOCKET_BASE_URL ?? "http://localhost:4000";

/** `node:events`' `once` does not accept a socket.io client, so resolve it by hand. */
function waitFor(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve) => socket.once(event, resolve));
}

/** Logs in through the real endpoint and returns a `Cookie` header value. */
async function loginCookie(email: string): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`chat peer login failed for ${email}: ${response.status}`);
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((entry) => entry.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`chat peer login returned no cookie for ${email}`);
  return cookie;
}

export type ChatPeer = {
  /** Sends a text message and resolves once the server echoed it back. */
  send(content: string): Promise<void>;
  close(): void;
};

export async function connectChatPeer(
  email: string,
  conversationId: string,
): Promise<ChatPeer> {
  const cookie = await loginCookie(email);
  const socket: Socket = io(`${SOCKET_BASE}/chat`, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });

  await waitFor(socket, "connect");
  socket.emit("conversation.join", { conversationId });
  await waitFor(socket, "conversation.joined");

  return {
    async send(content: string) {
      const clientMessageId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const echoed = waitFor(socket, "message.new");
      socket.emit("message.send", { conversationId, content, clientMessageId });
      await echoed;
    },
    close() {
      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
