#!/usr/bin/env node
/**
 * AI 回复的**实时**投递验证（真实后端 + 真实 socket.io）。
 *
 * ```bash
 * node scripts/verify-ai-realtime.mjs                          # 默认打生产域名
 * node scripts/verify-ai-realtime.mjs --base http://127.0.0.1:4000
 * ```
 *
 * ## 它验证什么
 *
 * 打开着 AI 会话的客户端，在用户发出消息后应当**立刻**收到 `message.new`（AI 那条），
 * 而不是等用户退出重进。
 *
 * ## 为什么需要它
 *
 * 2026-10-21 运营方反馈「AI 能回了，但要退出聊天再进才看得到」。真因：AI 会话只能走
 * `/ai-companion`，回复只写在 HTTP 响应里；如果客户端是在**普通会话界面**里打开这个
 * 会话（旧包就是这样），它只拿到自己那条消息，回复只能靠重新拉取。
 *
 * 现在服务端把 AI 回复广播进会话房间 —— 任何已打开该会话的客户端都能实时收到。
 * 这个脚本就是钉住那条广播：两条断言（`message.new` 与 `conversation.activity`）分开看，
 * 因为前者服务会话界面、后者服务会话列表。
 */

import { io } from "socket.io-client";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = readArg("base", "https://api.talkfirst.ccwu.cc");
const API = `${BASE}/api/v1`;
const EMAIL = readArg("a", "tfrt-a@example.invalid");
const PASSWORD = readArg("password", "TfChat2026!");
const WAIT_MS = Number(readArg("timeout", "60000"));

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? `（${detail}）` : ""}`);
}

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(WAIT_MS),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function main() {
  console.log(`\n== AI 回复实时投递验证（${API}）==\n`);

  const login = await call("/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = login.payload?.accessToken;
  if (login.status !== 200 || !token) {
    throw new Error(`登录失败（${login.status}）：${JSON.stringify(login.payload)?.slice(0, 160)}`);
  }

  const conversations = await call("/conversations", { token });
  const ai = (conversations.payload?.data ?? []).find((row) => row.type === "AI");
  if (!ai) throw new Error("这个账号没有 AI 会话（先在 App/网页里创建 AI 朋友）");
  console.log(`AI 会话：${ai.id}（${ai.aiCompanionName ?? "未命名"}）\n`);

  /* 一条 socket，像客户端那样先 join 房间 —— 不 join 就不会收到 message.new。 */
  const socket = io(`${BASE}/chat`, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: false,
  });

  const received = { messages: [], activities: [], errors: [] };
  socket.on("message.new", (payload) => received.messages.push(payload));
  socket.on("conversation.activity", (payload) => received.activities.push(payload));
  socket.on("error", (payload) => received.errors.push(payload));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket 10 秒内没连上")), 10_000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  check("socket 连上（/chat 命名空间）", socket.connected);

  socket.emit("conversation.join", { conversationId: ai.id });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const sent = await call(`/conversations/${ai.id}/messages`, {
    method: "POST",
    token,
    body: { content: `实时投递验证 ${Date.now() % 100000}` },
  });
  check("发送成功（普通会话接口对 AI 会话也放行）", sent.status === 201, `status=${sent.status}`);

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const reply = received.messages.find((row) => row?.senderId === null);
    if (reply) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const reply = received.messages.find((row) => row?.senderId === null);
  check(
    "AI 回复通过 message.new 实时到达（senderId 为 null）",
    Boolean(reply),
    reply ? `${String(reply.content).length} 字` : "超时未收到",
  );
  check(
    "会话列表事件 conversation.activity 也到了",
    received.activities.some((row) => row?.conversationId === ai.id),
  );
  if (reply) console.log(`\n回复：${String(reply.content).slice(0, 80)}…\n`);

  socket.close();
  const failed = results.filter((row) => !row.ok);
  console.log(`结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n验证中断：${error.message}`);
  process.exitCode = 1;
});
