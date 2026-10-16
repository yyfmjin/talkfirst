#!/usr/bin/env node
/**
 * AI 回复的端到端验证（真实后端 + 真实模型）。
 *
 * ```bash
 * node scripts/verify-ai-reply.mjs                         # 默认打生产域名
 * node scripts/verify-ai-reply.mjs --base http://127.0.0.1:4000
 * ```
 *
 * 账号见 `scripts/seed-chat-test-accounts.cjs`（`--a` / `--password` 可覆盖）。
 *
 * ## 为什么需要它
 *
 * 2026-10-16 用户报「AI 聊天一开始能用、现在不能用了」，真因是服务端的降级链在
 * **超时抛异常**时直接崩掉整次请求（见 `ai.service.ts` 的注释）。单测能证明
 * 「抛错后继续降级」，但证明不了「真实模型 + 真实网络下确实回得来」——
 * 而这个功能的失败形态恰恰是**慢**，不是报错。
 *
 * 所以这里量的是**耗时**：每一段都打出来，超时就明确失败。
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = readArg("base", "https://api.talkfirst.ccwu.cc");
const API = `${BASE}/api/v1`;
const EMAIL = readArg("a", "tfrt-a@example.invalid");
const PASSWORD = readArg("password", "TfChat2026!");
/** 单次请求的上限：与服务端预算（2×30s + 退避）留出的余量一致。 */
const REQUEST_TIMEOUT_MS = Number(readArg("timeout", "75000"));

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? `（${detail}）` : ""}`);
}

async function call(path, { method = "GET", body, token } = {}) {
  const startedAt = Date.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, ms: Date.now() - startedAt };
}

async function main() {
  console.log(`\n== AI 回复端到端验证（${API}）==\n`);

  const login = await call("/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200 || !login.payload?.accessToken) {
    throw new Error(`登录失败（${login.status}）：${JSON.stringify(login.payload)?.slice(0, 160)}`);
  }
  const token = login.payload.accessToken;
  console.log(`账号：${EMAIL}（登录 ${login.ms}ms）\n`);

  // 有就复用，没有就建一个最小人设。
  const existing = await call("/ai-companion", { token });
  if (existing.status === 200 && existing.payload?.data) {
    console.log(`已有 AI 朋友：${existing.payload.data.companion?.name ?? "(未命名)"}，消息 ${existing.payload.data.messages?.length ?? 0} 条\n`);
  } else {
    const created = await call("/ai-companion", {
      method: "PUT",
      token,
      body: { name: "小暖", userNickname: "阿明", stylePreset: "gentle" },
    });
    check("创建 AI 朋友（PUT /ai-companion 2xx）", created.status === 200 || created.status === 201, `status=${created.status}`);
  }

  const content = `验证一下你还在不在，第 ${Date.now() % 100000} 号。`;
  const sent = await call("/ai-companion/messages", { method: "POST", token, body: { content } });

  check(
    "发消息并拿到回复（POST /ai-companion/messages 2xx）",
    sent.status === 200 || sent.status === 201,
    `status=${sent.status} ${sent.ms}ms`,
  );

  const reply = sent.payload?.data?.reply;
  check("回复非空且是文本", typeof reply?.content === "string" && reply.content.trim().length > 0,
    reply ? `${reply.content.length} 字` : "没有 reply 字段");
  check("回复在服务端预算内返回（< 65 秒）", sent.ms < 65_000, `${sent.ms}ms`);
  check("用户那条也落库了（同一次请求里返回 message）", Boolean(sent.payload?.data?.message?.id));

  if (reply?.content) {
    console.log(`\n模型回复：${reply.content.slice(0, 80)}${reply.content.length > 80 ? "…" : ""}\n`);
  }

  const failed = results.filter((row) => !row.ok);
  console.log(`结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n验证中断：${error.message}`);
  process.exitCode = 1;
});
