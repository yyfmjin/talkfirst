#!/usr/bin/env node
/**
 * 实时消息的端到端验证（真实后端 + 真实 socket.io）。
 *
 * ```bash
 * node scripts/verify-chat-realtime.mjs                       # 默认打生产域名
 * node scripts/verify-chat-realtime.mjs --base http://127.0.0.1:4000
 * ```
 *
 * ## 它验证什么
 *
 * 两个脚本账号（见 `scripts/seed-chat-test-accounts.cjs`）各开一条 socket：
 *
 *   1. **打开会话时**（A 加入房间）：B 发消息，A 应当同时收到 `message.new`（会话房间）
 *      与 `conversation.activity`（A 自己的房间）；
 *   2. **只在列表页时**（A 不加入任何房间）：B 发消息，A 应当**只**收到
 *      `conversation.activity` —— 这正是「列表也能实时更新」那条设计，
 *      而它不能靠 `message.new` 实现（那条只发给会话房间）。
 *
 * ## 为什么要有它
 *
 * App 端的单测能证明客户端行为，证明不了服务端真的把事件发到了对的房间；
 * 而模拟器/真机验证只能看「消息出现了」，分不清是广播还是重新拉取。
 * 这个脚本把两条通道分开断言。
 */

import { io } from "socket.io-client";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = readArg("base", "https://api.talkfirst.ccwu.cc");
const API = `${BASE}/api/v1`;
const PASSWORD = readArg("password", "TfChat2026!");
const ACCOUNT_A = readArg("a", "tfrt-a@example.invalid");
const ACCOUNT_B = readArg("b", "tfrt-b@example.invalid");
const WAIT_MS = Number(readArg("timeout", "12000"));
/**
 * 传输方式。默认与 App 一致（先 websocket）；本机或某个网络链路屏蔽 wss 时
 * 可以用 `--transports polling` 单独验证**服务端契约**（事件通路与传输无关）。
 * 区分「服务端没发」与「我这里连不上」靠的就是这个开关。
 */
const TRANSPORTS = (readArg("transports", "websocket,polling") || "polling")
  .split(",")
  .map((row) => row.trim())
  .filter(Boolean);

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `（${detail}）`}`);
}

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function signIn(email) {
  const { status, payload } = await call("/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  if (status !== 200 || !payload?.accessToken) {
    throw new Error(`登录失败 ${email}（${status}）：${JSON.stringify(payload)?.slice(0, 160)}`);
  }
  return { token: payload.accessToken, userId: payload.data.id };
}

/**
 * 确保 A、B 之间有一条**人类**会话；返回 conversationId。
 *
 * 必须按类型挑：`GET /conversations` 会把 A 的 AI 朋友会话一并返回（`type: "AI"`），
 * 而它通常就排在第一条 —— 直接取 `data[0]` 会拿到 AI 会话，然后用 REST 往里发消息
 * 得到 404（AI 会话只走 `/ai-companion/messages`）。2026-10-20 跑这个脚本时就是这么
 * 失败的：socket 两条都连上了，消息却全 404，看着像实时坏了，其实是挑错了会话。
 */
function humanConversationOf(list, peerId) {
  const rows = list.payload?.data ?? [];
  return rows.find((row) => row.type !== "AI" && (!peerId || row.peer?.id === peerId)) ?? null;
}

async function ensureConversation(a, b) {
  const list = await call("/conversations", { token: a.token });
  const existing = humanConversationOf(list, b.userId) ?? humanConversationOf(list, null);
  if (existing) return existing.id;

  const created = await call("/connections/requests", {
    method: "POST",
    token: a.token,
    body: { receiverId: b.userId, message: "你好，我是阿明" },
  });
  if (created.status !== 201) {
    throw new Error(`打招呼失败（${created.status}）：${JSON.stringify(created.payload)?.slice(0, 160)}`);
  }
  const accepted = await call(`/connections/requests/${created.payload.data.id}/respond`, {
    method: "POST",
    token: b.token,
    body: { action: "accept" },
  });
  if (accepted.status !== 201) {
    throw new Error(`接受失败（${accepted.status}）：${JSON.stringify(accepted.payload)?.slice(0, 160)}`);
  }
  const after = await call("/conversations", { token: a.token });
  const conversation = humanConversationOf(after, b.userId) ?? humanConversationOf(after, null);
  if (!conversation) throw new Error("接受后仍没有人类会话");
  return conversation.id;
}

function waitFor(collector, predicate, label) {
  return new Promise((resolve) => {
    const deadline = Date.now() + WAIT_MS;
    const timer = setInterval(() => {
      const hit = collector.find(predicate);
      if (hit || Date.now() > deadline) {
        clearInterval(timer);
        resolve(hit ?? null);
      }
    }, 120);
  });
}

function openSocket(token) {
  const socket = io(`${BASE}/chat`, {
    auth: { token },
    transports: TRANSPORTS,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 3,
  });
  const received = { messages: [], activities: [], errors: [], state: "connecting" };
  socket.on("connect", () => {
    received.state = "live";
  });
  socket.on("connect_error", (error) => {
    received.errors.push(String(error?.message ?? error));
  });
  socket.on("message.new", (message) => received.messages.push(message));
  socket.on("conversation.activity", (activity) => received.activities.push(activity));
  socket.on("error", (payload) => received.errors.push(JSON.stringify(payload)));
  socket.connect();
  return { socket, received };
}

async function main() {
  console.log(`\n== 实时消息端到端验证（${API}）==\n`);

  const a = await signIn(ACCOUNT_A);
  const b = await signIn(ACCOUNT_B);
  const conversationId = await ensureConversation(a, b);
  console.log(`账号：A=${ACCOUNT_A} B=${ACCOUNT_B}\n会话：${conversationId}\n`);

  // A 连上并进入会话房间；B 只连上（用来发消息）。
  const peerA = openSocket(a.token);
  const peerB = openSocket(b.token);
  await new Promise((resolve) => setTimeout(resolve, 3000));

  check(
    "两条 socket 都连上了（握手负载里的 token 被接受）",
    peerA.received.state === "live" && peerB.received.state === "live",
    `A=${peerA.received.state} B=${peerB.received.state} transports=${TRANSPORTS.join("+")} errors=${
      peerA.received.errors.join(" | ") || "（无）"
    }`,
  );

  peerA.socket.emit("conversation.join", { conversationId });
  await new Promise((resolve) => setTimeout(resolve, 800));

  // ① 打开会话：两条通道都该到
  const text1 = `实时验证-打开会话 ${Date.now()}`;
  const sent1 = await call(`/conversations/${conversationId}/messages`, {
    method: "POST",
    token: b.token,
    body: { content: text1 },
  });
  check("B 通过 REST 发出消息（201）", sent1.status === 201, `status=${sent1.status}`);

  const message1 = await waitFor(peerA.received.messages, (row) => row?.content === text1);
  check("打开会话时收到 message.new", Boolean(message1));
  const activity1 = await waitFor(peerA.received.activities, (row) => row?.preview === text1);
  check("打开会话时也收到 conversation.activity（列表用）", Boolean(activity1));

  // ② 只在列表页：离开房间后只该收到 activity
  peerA.socket.emit("conversation.leave", { conversationId });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const beforeCount = peerA.received.messages.length;

  const text2 = `实时验证-只在列表 ${Date.now()}`;
  const sent2 = await call(`/conversations/${conversationId}/messages`, {
    method: "POST",
    token: b.token,
    body: { content: text2 },
  });
  check("B 发出第二条消息（201）", sent2.status === 201, `status=${sent2.status}`);

  const activity2 = await waitFor(peerA.received.activities, (row) => row?.preview === text2);
  check("未加入房间时收到 conversation.activity", Boolean(activity2));
  await new Promise((resolve) => setTimeout(resolve, 600));
  check(
    "未加入房间时不会收到 message.new（这条只发给会话房间）",
    peerA.received.messages.length === beforeCount,
    `多出 ${peerA.received.messages.length - beforeCount} 条`,
  );

  // ③ 事件负载的形状：App 直接依赖这几个字段
  const activity = activity2 ?? activity1;
  check(
    "activity 负载字段齐全（会话 id / 消息 id / 发送者 / 类型 / 预览 / 时间）",
    Boolean(
      activity?.conversationId &&
        activity?.messageId &&
        activity?.senderId &&
        activity?.type &&
        typeof activity?.preview === "string" &&
        activity?.createdAt,
    ),
    JSON.stringify(activity)?.slice(0, 160),
  );
  check("activity 的发送者是 B", activity?.senderId === b.userId);

  peerA.socket.disconnect();
  peerB.socket.disconnect();

  const failed = results.filter((row) => !row.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n验证中断：${error.message}`);
  process.exitCode = 1;
});
