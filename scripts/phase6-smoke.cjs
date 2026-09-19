const { io } = require("socket.io-client");

const BASE = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const SOCKET_BASE = process.env.SOCKET_BASE ?? "http://localhost:4000";

async function request(path, { method = "GET", body, cookies = [] } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookies.length ? { Cookie: cookies.join("; ") } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (!response.ok || !payload?.success) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }
  return { data: payload.data, cookies: [...cookies, ...setCookies.map((c) => c.split(";")[0])] };
}

function accessTokenOf(cookies) {
  const entry = cookies.find((c) => c.startsWith("tf_access="));
  return entry ? entry.slice("tf_access=".length) : null;
}

function waitFor(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for socket event ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function main() {
  const suffix = Date.now().toString(36);
  const alice = await request("/auth/register", {
    method: "POST",
    body: { email: `phase6-alice-${suffix}@test.dev`, password: "password123" },
  });
  await request("/users/me", {
    method: "PATCH",
    body: { nickname: "WS Alice", birthDate: "2000-01-01", countryCode: "CN" },
    cookies: alice.cookies,
  });

  const bob = await request("/auth/register", {
    method: "POST",
    body: { email: `phase6-bob-${suffix}@test.dev`, password: "password123" },
  });
  const bobProfile = await request("/users/me", {
    method: "PATCH",
    body: { nickname: "WS Bob", birthDate: "1999-05-05", countryCode: "US" },
    cookies: bob.cookies,
  });

  const sent = await request("/connections/requests", {
    method: "POST",
    body: { receiverId: bobProfile.data.id, message: "socket hello" },
    cookies: alice.cookies,
  });
  const accepted = await request(`/connections/requests/${sent.data.id}/respond`, {
    method: "POST",
    body: { action: "accept" },
    cookies: bob.cookies,
  });
  const conversationId = accepted.data.connection.conversationId;
  console.log("SETUP OK conversation=", conversationId);

  const aliceSocket = io(`${SOCKET_BASE}/chat`, {
    transports: ["websocket"],
    auth: { token: accessTokenOf(alice.cookies) },
  });
  const bobSocket = io(`${SOCKET_BASE}/chat`, {
    transports: ["websocket"],
    auth: { token: accessTokenOf(bob.cookies) },
  });

  aliceSocket.on("error", (payload) => console.log("ALICE_SOCKET_ERROR", JSON.stringify(payload)));
  bobSocket.on("error", (payload) => console.log("BOB_SOCKET_ERROR", JSON.stringify(payload)));

  await Promise.all([waitFor(aliceSocket, "ready"), waitFor(bobSocket, "ready")]);
  console.log("SOCKET_AUTH OK both clients ready");

  aliceSocket.emit("conversation.join", { conversationId });
  bobSocket.emit("conversation.join", { conversationId });
  const [aliceJoined, bobJoined] = await Promise.all([
    waitFor(aliceSocket, "conversation.joined"),
    waitFor(bobSocket, "conversation.joined"),
  ]);
  console.log("JOIN OK alicePeers=", aliceJoined.peers.length, "bobPeers=", bobJoined.peers.length);

  const bobTyping = waitFor(bobSocket, "typing");
  aliceSocket.emit("typing", { conversationId, typing: true });
  const typingEvent = await bobTyping;
  console.log("TYPING OK", typingEvent.userId ? "peer typing received" : "missing");

  const bobMessage = waitFor(bobSocket, "message.new");
  const payload = { conversationId, content: "realtime hello from Alice", clientMessageId: `smoke-${suffix}` };
  aliceSocket.emit("message.send", payload);
  const received = await bobMessage;
  console.log("REALTIME OK id=", received.id, "echo=", received.clientMessageId);

  const history = await request(`/conversations/${conversationId}/messages?limit=20`, {
    cookies: bob.cookies,
  });
  const persisted = history.data.items.some((item) => item.id === received.id);
  console.log("PERSISTED OK", persisted, "total=", history.data.items.length);
  if (!persisted) throw new Error("socket message was not persisted to REST history");

  aliceSocket.disconnect();
  bobSocket.disconnect();
}

main().catch((error) => {
  console.error("PHASE6_SMOKE_FAIL", error.message);
  process.exit(1);
});
