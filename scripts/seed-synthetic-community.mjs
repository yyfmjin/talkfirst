#!/usr/bin/env node
/**
 * 合成社区种子 —— 造一批「**身份虚构、内容形态真实**」的演示用户与动态。
 *
 * ```bash
 * # 预演：只说会做什么，不写库
 * ALLOW_SEED_SYNTHETIC=1 node scripts/seed-synthetic-community.mjs --dry-run
 *
 * # 在测试库上造 8 个账号
 * ALLOW_SEED_SYNTHETIC=1 node scripts/seed-synthetic-community.mjs --base http://127.0.0.1:4000 --count 8
 *
 * # 用完清掉（逐个登录后 DELETE /users/me，级联删除动态/会话）
 * ALLOW_SEED_SYNTHETIC=1 node scripts/seed-synthetic-community.mjs --clean
 * ```
 *
 * ## 这个脚本**不做**什么，以及为什么
 *
 * 它**不抓取**任何真实用户、真实动态、真实头像。把别家 App 里真人的资料与内容搬过来、
 * 再发布成「虚拟账号」，是未经同意处理个人信息（国内 PIPL / 欧盟 GDPR 都管），
 * 通常也违反对方平台条款；而且这个产品的卖点就是「和真人聊天」，用真人外壳的假账号
 * 会直接污染可信度和留存数据。
 *
 * 所以这里的人和话都是**写出来的**：昵称是常见名，动态是按「产品里真实会发生的内容」
 * 手写的（找语伴、纠正发音、分享城市日常）。它们形态真实、来源虚构。
 *
 * ## 可识别、可回收
 *
 * - 邮箱一律落在 `.invalid` 顶级域（RFC 2606 保留，**永远不可能**是一个真实可投递的
 *   地址），前缀统一 `synth-`，一眼能看出是合成账号；
 * - 账号密码来自同一个常量，便于 `--clean` 逐个登录删除；**不要在正式库里长期保留**；
 * - 删除走 `DELETE /users/me`（与用户自助注销同一条路径，级联清理动态与会话）。
 * - `--base` **缺省指向本机** `127.0.0.1:4000`，要写远端必须显式传；
 * - `--clean` 不接受 `--count`：要么全清，要么不清（部分清理最容易留下几个假人在社区里）。
 *
 * ## 幂等
 *
 * 邮箱已存在就登录；动态按正文去重，重复执行不会堆出重复内容。
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

/**
 * 默认只指向**本机** API。
 *
 * 这个脚本会创建**可登录**的账号，默认写生产很危险：真用户会开始在社区里看到一批假人，
 * 而密码就写在文件里。所以远端必须显式传 `--base`。
 */
const BASE = readArg("base", "http://127.0.0.1:4000");
const API = `${BASE}/api/v1`;
const COUNT = Number(readArg("count", "8"));
const CLEAN = hasFlag("clean");
const DRY_RUN = hasFlag("dry-run");

/** 合成账号的密码。清库时要能登录进来，所以必须固定、可复现。 */
const PASSWORD = process.env.SYNTHETIC_PASSWORD || "SynthDemo2026!";

/**
 * 人设池。
 *
 * 每个人设只描述「一个会说这两种语言、住在这个城市的人会发什么」，**不映射任何真人**。
 * `moments` 是手写的通用内容：够具体（能看出生活痕迹），又不属于任何具体个人。
 */
const PERSONAS = [
  {
    slug: "lin-hangzhou",
    nickname: "林小满",
    locale: "zh",
    countryCode: "CN",
    region: "浙江",
    city: "杭州",
    gender: "FEMALE",
    birthDate: "1997-03-18",
    bio: "在杭州做平面设计，喜欢逛旧书店和沿着运河走路。想把英语口语练到能开会不紧张。",
    native: "zh",
    learning: "en",
    moments: [
      "沿着运河从拱宸桥走到小河直街，桂花味一路跟着。有人也在杭州吗，周末可以一起徒步。",
      "今天把「th」的音练顺了一点，录音回放还是像在漏气。有没有人能帮我听听哪里不对？",
    ],
  },
  {
    slug: "marco-berlin",
    nickname: "Marco",
    locale: "en",
    countryCode: "DE",
    region: "Berlin",
    city: "Berlin",
    gender: "MALE",
    birthDate: "1994-11-02",
    bio: "Product designer in Berlin. Learning Mandarin so I can order breakfast without pointing at the menu.",
    native: "en",
    learning: "zh",
    moments: [
      "Spent an hour at the language café near Tempelhofer Feld. Learned that 四 and 十 are going to be the end of me.",
      "Looking for someone to swap German for Mandarin, 30 minutes each, twice a week. I bring the coffee.",
    ],
  },
  {
    slug: "yuki-osaka",
    nickname: "Yuki",
    locale: "en",
    countryCode: "JP",
    region: "Osaka",
    city: "Osaka",
    gender: "FEMALE",
    birthDate: "1999-07-24",
    bio: "Osaka → somewhere else one day. Currently: coffee, film photos, and a very slow attempt at Spanish.",
    native: "ja",
    learning: "en",
    moments: [
      "Shot a roll of film around Nakazakicho and half the frames are just cats. No regrets.",
      "Trying to describe my week in English without translating from Japanese first. It takes me four minutes.",
    ],
  },
  {
    slug: "clara-lyon",
    nickname: "Clara",
    locale: "en",
    countryCode: "FR",
    region: "Auvergne-Rhône-Alpes",
    city: "Lyon",
    gender: "FEMALE",
    birthDate: "1995-01-09",
    bio: "PhD student in Lyon. I read too much and speak too little — trying to fix the second part.",
    native: "fr",
    learning: "en",
    moments: [
      "My advisor said my English is fine and my sentences are just too long. Fair. Very long, in fact.",
      "Anyone in Lyon want to meet at a market and narrate what we see in English? Best vocabulary drill I know.",
    ],
  },
  {
    slug: "diego-saopaulo",
    nickname: "Diego",
    locale: "en",
    countryCode: "BR",
    region: "São Paulo",
    city: "São Paulo",
    gender: "MALE",
    birthDate: "1993-05-30",
    bio: "Backend dev, weekend cook. Portuguese is easy until you meet a verb tense you didn't know existed.",
    native: "pt",
    learning: "en",
    moments: [
      "Made feijoada for six people. Nobody left. I'm counting that as a language victory too, since we talked for four hours.",
      "Does anyone actually enjoy shadowing practice, or do you all just tolerate it like I do?",
    ],
  },
  {
    slug: "chen-chengdu",
    nickname: "陈默",
    locale: "zh",
    countryCode: "CN",
    region: "四川",
    city: "成都",
    gender: "MALE",
    birthDate: "1998-09-14",
    bio: "在成都写代码，养了一只很胖的橘猫。正在准备雅思，最怕口语第二部分。",
    native: "zh",
    learning: "en",
    moments: [
      "猫把我的耳机线咬断了，第三根。今天不写代码，写一篇关于它的英语小作文。",
      "复盘：口语卡壳不是因为词汇，是因为想说的那句中文太漂亮，翻不出来。开始学着说简单句。",
    ],
  },
  {
    slug: "ana-madrid",
    nickname: "Ana",
    locale: "en",
    countryCode: "ES",
    region: "Madrid",
    city: "Madrid",
    gender: "FEMALE",
    birthDate: "1996-12-05",
    bio: "Teach Spanish in the mornings, study English at night. Rooftop terraces are my reward system.",
    native: "es",
    learning: "en",
    moments: [
      "Today a student corrected my English. That's a good day, actually. It means she stopped being shy.",
      "Sunset on a rooftop in Lavapiés. I understood three whole jokes in English tonight.",
    ],
  },
  {
    slug: "noah-toronto",
    nickname: "Noah",
    locale: "en",
    countryCode: "CA",
    region: "Ontario",
    city: "Toronto",
    gender: "MALE",
    birthDate: "1992-08-21",
    bio: "Nurse, night shifts, learning Mandarin between them. My pronunciation is better than my sleep schedule.",
    native: "en",
    learning: "zh",
    moments: [
      "Night shift done. Practice plan for today: order food in Mandarin without switching to English halfway.",
      "Anyone else find tones easier when you say them annoyed? I sound rude but apparently correct.",
    ],
  },
  {
    slug: "mina-seoul",
    nickname: "Mina",
    locale: "en",
    countryCode: "KR",
    region: "Seoul",
    city: "Seoul",
    gender: "FEMALE",
    birthDate: "2000-02-11",
    bio: "Illustrator in Seoul. Learning Japanese because of the music I like.",
    native: "ko",
    learning: "ja",
    moments: [
      "Drew the same cat six times today. Each one a little less wrong. Same goes for sentences, honestly.",
      "Trying Japanese subtitles off this week. My progress is measured in seconds of not squinting.",
    ],
  },
  {
    slug: "sam-london",
    nickname: "Sam",
    locale: "en",
    countryCode: "GB",
    region: "Greater London",
    city: "London",
    gender: "UNKNOWN",
    birthDate: "1991-06-16",
    bio: "Cyclist, language nerd, terrible at small talk — which is the whole point of practising, right?",
    native: "en",
    learning: "fr",
    moments: [
      "Commute in French. Every cyclist I passed got a very French apology under my breath.",
      "Milestone: I stopped translating 'how are you' in my head before answering. Two years for that one.",
    ],
  },
];

const SLEEP_MS = 180;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const emailFor = (persona) => `synth-${persona.slug}@demo.talkfirst.invalid`;

async function signIn(email) {
  const result = await call("/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  if (result.status !== 200 || !result.payload?.accessToken) {
    throw new Error(`登录失败 ${email}（${result.status}）：${JSON.stringify(result.payload)?.slice(0, 160)}`);
  }
  return { token: result.payload.accessToken, user: result.payload.data };
}

/** 已存在就登录，不存在就注册。两种都返回同一形状。 */
async function ensureAccount(persona) {
  const email = emailFor(persona);
  const register = await call("/auth/register", { method: "POST", body: { email, password: PASSWORD } });
  if (register.status === 201 && register.payload?.accessToken) {
    return { email, token: register.payload.accessToken, user: register.payload.data, created: true };
  }
  const session = await signIn(email);
  return { email, ...session, created: false };
}

async function fillProfile(persona, token) {
  const profile = await call("/users/me", {
    method: "PATCH",
    token,
    body: {
      nickname: persona.nickname,
      bio: persona.bio,
      city: persona.city,
      region: persona.region,
      countryCode: persona.countryCode,
      gender: persona.gender,
      birthDate: persona.birthDate,
    },
  });
  const languages = await call("/users/me/languages", {
    method: "PUT",
    token,
    body: {
      items: [
        { code: persona.native, type: "NATIVE", level: "NATIVE" },
        { code: persona.learning, type: "LEARNING", level: "INTERMEDIATE" },
      ],
    },
  });
  return { profile: profile.status, languages: languages.status };
}

/** 已经发过的正文，用来保证重复执行不堆内容。 */
async function existingContents(userId, token) {
  const listed = await call(`/moments/user/${userId}?limit=50`, { token });
  const items = listed.payload?.data?.items ?? [];
  return new Set(items.map((item) => item.content));
}

async function postMoments(persona, userId, token) {
  const already = await existingContents(userId, token);
  let posted = 0;
  for (const content of persona.moments) {
    if (already.has(content)) continue;
    const created = await call("/moments", { method: "POST", token, body: { content, images: [] } });
    if (created.status === 201) posted += 1;
    await sleep(SLEEP_MS);
  }
  return posted;
}

async function clean() {
  /**
   * 清理**不**服从 `--count`：它要么把所有合成账号清干净，要么就不清。
   *
   * 部分清理是最糟的结果 —— 你以为自己只留了 2 个，其实还剩下 6 个在社区里发着帖子，
   * 而它们看起来和真人一样。所以这里宁可和 `--count` 无关，并在日志里把总数说清楚。
   */
  log(`\n== 清理合成账号（${API}）==`);
  log(`共 ${PERSONAS.length} 个（--count 对清理不生效）\n`);
  let removed = 0;
  for (const persona of PERSONAS) {
    const email = emailFor(persona);
    if (DRY_RUN) {
      log(`·  将删除 ${email}`);
      continue;
    }
    const session = await signIn(email).catch(() => null);
    if (!session) {
      log(`·  ${email} 不存在，跳过`);
      continue;
    }
    const deleted = await call("/users/me", { method: "DELETE", token: session.token });
    log(`${deleted.status < 300 ? "✓" : "✗"} ${email}（${deleted.status}）`);
    if (deleted.status < 300) removed += 1;
    await sleep(SLEEP_MS);
  }
  log(`\n共删除 ${removed} 个。级联清理动态与会话由 API 负责。`);
}

async function main() {
  if (process.env.ALLOW_SEED_SYNTHETIC !== "1") {
    console.error(
      "拒绝执行：这会往目标库写入可登录的演示账号。确认目标库（建议测试库）后，\n" +
        "加 ALLOW_SEED_SYNTHETIC=1 再跑。",
    );
    process.exit(2);
  }

  if (CLEAN) {
    await clean();
    return;
  }

  const personas = PERSONAS.slice(0, Math.max(1, Math.min(COUNT, PERSONAS.length)));
  log(`\n== 合成社区种子（${API}）==`);
  log(`人设：${personas.length} / ${PERSONAS.length}　${DRY_RUN ? "（预演，不写库）" : ""}\n`);

  let created = 0;
  let reused = 0;
  let posts = 0;

  for (const persona of personas) {
    const email = emailFor(persona);
    if (DRY_RUN) {
      log(`·  ${persona.nickname.padEnd(6)} ${persona.city.padEnd(12)} ${email}　动态 ${persona.moments.length} 条`);
      continue;
    }
    try {
      const account = await ensureAccount(persona);
      account.created ? (created += 1) : (reused += 1);
      await fillProfile(persona, account.token);
      const posted = await postMoments(persona, account.user.id, account.token);
      posts += posted;
      log(
        `${account.created ? "＋" : "＝"} ${persona.nickname.padEnd(6)} ${persona.city.padEnd(12)} ` +
          `动态 +${posted}${account.created ? "" : "（账号已存在）"}`,
      );
    } catch (error) {
      log(`✗ ${persona.nickname}：${error.message}`);
    }
    await sleep(SLEEP_MS);
  }

  if (DRY_RUN) {
    log("\n预演结束。去掉 --dry-run 才会真正写库。");
    return;
  }

  log(`\n完成：新建 ${created}，复用 ${reused}，新增动态 ${posts} 条。`);
  log("用完请执行 --clean 清理（正式库里不要长期保留合成账号）。");
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`);
  process.exitCode = 1;
});
