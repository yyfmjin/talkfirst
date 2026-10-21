#!/usr/bin/env node
/**
 * Play 审核用的**演示账号**（一个干净的账号，带完整资料与内容）。
 *
 * ```bash
 * ALLOW_SEED_DEMO_ACCOUNT=1 node scripts/seed-demo-account.mjs --base http://127.0.0.1:4000
 * ```
 *
 * ## 为什么需要它
 *
 * 我们的主功能登录后才可见。Play 的「App access」要求提供审核员可用的账号，
 * 否则审核直接以「无法评估」驳回。而这个账号还必须**看起来像真人在用**：
 * 资料填好、有动态、有会话、有 AI 朋友 —— 空白账号等于让审核员看一堆空状态。
 *
 * ## 它会改什么
 *
 * 只操作两个固定账号：`review@talkfirst.ccwu.cc`（演示账号）与已有的
 * `tfrt-b@example.invalid`（当「对方」，只用来产生一条真实会话）。
 * 重复执行是**幂等**的：账号已存在就登录，动态按内容去重。
 *
 * ## 收尾
 *
 * 上架后如果不想留它：`delete from "User" where email = 'review@talkfirst.ccwu.cc';`
 * （级联删除会话/消息/动态）。**删之前先确认 Play 审核已经通过** —— 审核员可能还在看。
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = readArg("base", "https://api.talkfirst.ccwu.cc");
const API = `${BASE}/api/v1`;

const DEMO_EMAIL = "review@talkfirst.ccwu.cc";
const DEMO_PASSWORD = "TalkFirst-Review-2026";
const PEER_EMAIL = "tfrt-b@example.invalid";
const PEER_PASSWORD = "TfChat2026!";

const MOMENTS = [
  "刚落地杭州，西湖边上的桂花已经开了。有没有人也在学中文？想找个人一起练口语。",
  "今天的咖啡是手冲的耶加雪菲，配一本旧书正好。周末打算去爬山，有人一起吗？",
];

function log(line) {
  console.log(line);
}

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function signIn(email, password) {
  const result = await call("/auth/login", { method: "POST", body: { email, password } });
  if (result.status !== 200 || !result.payload?.accessToken) {
    throw new Error(`登录失败 ${email}（${result.status}）：${JSON.stringify(result.payload)?.slice(0, 160)}`);
  }
  return { token: result.payload.accessToken, user: result.payload.data };
}

async function ensureDemoAccount() {
  const register = await call("/auth/register", {
    method: "POST",
    body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  if (register.status === 201 && register.payload?.accessToken) {
    log(`✓ 已创建演示账号 ${DEMO_EMAIL}`);
    return { token: register.payload.accessToken, user: register.payload.data, created: true };
  }

  // 已存在（EMAIL_TAKEN / REGISTER_FAILED）：直接登录，脚本可重复执行。
  const session = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
  log(`✓ 演示账号已存在，已登录 ${DEMO_EMAIL}`);
  return { ...session, created: false };
}

async function main() {
  if (process.env.ALLOW_SEED_DEMO_ACCOUNT !== "1") {
    console.error(
      "拒绝执行：这会往线上库写一个可登录的演示账号。确认目标库后加 ALLOW_SEED_DEMO_ACCOUNT=1 再跑。",
    );
    process.exit(2);
  }

  log(`\n== 准备 Play 审核演示账号（${API}）==\n`);

  const demo = await ensureDemoAccount();
  let token = demo.token;

  /* 1. 资料：昵称 + 生日是 profileCompleted 的两个条件。 */
  const profile = await call("/users/me", {
    method: "PATCH",
    token,
    body: {
      nickname: "Mia",
      bio: "在杭州做设计，喜欢咖啡、徒步和旧书店。想练英语口语，也想认识不同地方的人。",
      city: "杭州",
      region: "浙江",
      countryCode: "CN",
      gender: "FEMALE",
      birthDate: "1996-05-12",
    },
  });
  log(`✓ 资料已填（${profile.status}）`);

  /* 2. 语言：母语中文 + 在学英语。 */
  const languages = await call("/users/me/languages", {
    method: "PUT",
    token,
    body: {
      items: [
        { code: "zh", type: "NATIVE", level: "NATIVE" },
        { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
      ],
    },
  });
  log(`✓ 语言已设置（${languages.status}）`);

  /* 3. AI 朋友：带开场白，审核员点进 AI 屏就能看到一段对话。 */
  const ai = await call("/ai-companion", {
    method: "PUT",
    token,
    body: {
      name: "小暖",
      userNickname: "Mia",
      stylePreset: "gentle",
      personality: "温柔、会追问、记得住对方说过的事",
      greeting: "嗨 Mia，今天过得怎么样？杭州这几天是不是开始冷了？",
    },
  });
  log(`✓ AI 朋友已创建（${ai.status}）`);

  /* 4. 动态：两条文本动态（不引外部图片，避免审核时图片加载失败像坏了）。 */
  for (const content of MOMENTS) {
    const posted = await call("/moments", { method: "POST", token, body: { content, images: [] } });
    if (posted.status === 201) log(`✓ 已发动态：${content.slice(0, 18)}…`);
    else log(`·  动态已存在或未创建（${posted.status}）：${content.slice(0, 18)}…`);
  }

  /* 5. 一条真实会话：与 tfrt-b 互发几条，审核员打开「消息」能看到聊天记录。 */
  const peer = await signIn(PEER_EMAIL, PEER_PASSWORD).catch(() => null);
  if (!peer) {
    log("·  跳过会话：找不到对方测试账号 tfrt-b（不影响资料/动态）");
  } else {
    const existing = await call("/conversations", { token });
    const human = (existing.payload?.data ?? []).find((row) => row.type !== "AI");
    let conversationId = human?.id ?? null;

    if (!conversationId) {
      const request = await call("/connections/requests", {
        method: "POST",
        token,
        body: { receiverId: peer.user.id, templateId: "language" },
      });
      if (request.status === 201) {
        const requestId = request.payload?.data?.id;
        await call(`/connections/requests/${requestId}/respond`, {
          method: "POST",
          token: peer.token,
          body: { action: "accept" },
        });
      }
      const after = await call("/conversations", { token });
      conversationId = (after.payload?.data ?? []).find((row) => row.type !== "AI")?.id ?? null;
    }

    if (conversationId) {
      const thread = await call(`/conversations/${conversationId}/messages?limit=50`, { token });
      const count = thread.payload?.data?.items?.length ?? 0;
      if (count < 4) {
        await call(`/conversations/${conversationId}/messages`, {
          method: "POST",
          token,
          body: { content: "嗨，看到你也在学英语，要不要一起练口语？" },
        });
        await call(`/conversations/${conversationId}/messages`, {
          method: "POST",
          token: peer.token,
          body: { content: "好啊！我在学中文，正好互相帮忙。" },
        });
        await call(`/conversations/${conversationId}/messages`, {
          method: "POST",
          token,
          body: { content: "太好了，那我们从周末开始？" },
        });
      }
      log(`✓ 会话已就绪（${conversationId}）`);
    } else {
      log("·  会话没建起来（对方可能已连接但会话未生成）");
    }
  }

  /* 6. 复核：把审核员会看到的关键接口都读一遍。 */
  const me = await call("/users/me", { token });
  const moments = await call("/moments/feed?limit=5", { token });
  const conversations = await call("/conversations", { token });
  const companion = await call("/ai-companion", { token });

  log("\n== 复核 ==");
  log(`昵称：${me.payload?.data?.nickname}　资料完整：${me.payload?.data?.profileCompleted}`);
  log(`动态：${moments.payload?.data?.items?.length ?? 0} 条`);
  log(`会话：${conversations.payload?.data?.length ?? 0} 个`);
  log(`AI 朋友：${companion.payload?.data?.companion?.name ?? "无"}`);

  log("\n== 给 Play「App access」用的凭据 ==");
  log(`邮箱：${DEMO_EMAIL}`);
  log(`密码：${DEMO_PASSWORD}`);
  log("（在控制台填「所有功能都需要登录」，并附上这两行）");
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`);
  process.exitCode = 1;
});
