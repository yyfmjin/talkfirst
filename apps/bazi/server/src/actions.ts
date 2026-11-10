// Actions for 星座八字匹配.
// 排盘与评分在服务端用确定性历法算法完成（见 bazi.ts）。
// 账号体系：注册/登录发会话令牌，客户端每次调用带 token；
// 档案、候选人、绑定、会话全部按 user_id 隔离，只查自己的数据。
// 首个注册账号成为管理员并继承此前原型期的存量数据（user_id=0）。

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { scrypt, timingSafeEqual } from "node:crypto";
import * as schema from "./schema";
import { ageOf, computeChart, scorePair, type Lang, type RelationType } from "./bazi";
import { generateChineseNames } from "./naming";
import { computeDailyFortune, fetchOnThisDay } from "./daily";

const langField = { lang: z.enum(["zh", "en"]).default("zh") };
const L = (lang: Lang, zh: string, en: string) => (lang === "en" ? en : zh);

const genderEnum = z.enum(["male", "female"]);
const relationEnum = z.enum(["friend", "lover", "partner"]);
const tokenField = { token: z.string().default("") };

/**
 * TalkFirst 后端地址（单点登录校验用）。
 *
 * 用环境变量可覆盖，方便本地联调；生产留空即默认值。
 */
const TALKFIRST_API_BASE =
  process.env.TALKFIRST_API_BASE ?? "https://api.talkfirst.ccwu.cc/api/v1";

const pillarSchema = z.object({
  stem: z.string(),
  branch: z.string(),
  element: z.string(),
  label: z.string(),
});

const chartSchema = z.object({
  pillars: z.object({
    year: pillarSchema,
    month: pillarSchema,
    day: pillarSchema,
    hour: pillarSchema.nullable(),
  }),
  zodiacSign: z.string(),
  zodiacElement: z.string(),
  zodiacAnimal: z.string(),
  dayMaster: z.string(),
  dayMasterElement: z.string(),
  elements: z.array(z.number()),
  favorable: z.array(z.string()),
  avoid: z.array(z.string()),
  strength: z.enum(["强", "弱", "中和"]),
  chartComplete: z.boolean(),
});
type ChartOut = z.infer<typeof chartSchema>;

const profileOutSchema = z.object({
  id: z.number(),
  name: z.string(),
  gender: genderEnum,
  birthDate: z.string(),
  birthTime: z.string().nullable(),
  age: z.number(),
  chart: chartSchema,
});
const candidateOutSchema = profileOutSchema.extend({
  traits: z.array(z.string()),
  notes: z.string(),
});

type ProfileRow = typeof schema.profiles.$inferSelect;
type CandidateRow = typeof schema.candidates.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

function profileOut(row: ProfileRow) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    birthDate: row.birthDate,
    birthTime: row.birthTime,
    age: ageOf(row.birthDate),
    chart: computeChart({ birthDate: row.birthDate, birthTime: row.birthTime }) as ChartOut,
  };
}

function candidateOut(row: CandidateRow) {
  let traits: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.traits);
    if (Array.isArray(parsed)) traits = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    traits = [];
  }
  return {
    ...profileOut({
      id: row.id,
      userId: row.userId,
      name: row.name,
      gender: row.gender,
      birthDate: row.birthDate,
      birthTime: row.birthTime,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    }),
    traits,
    notes: row.notes,
  };
}

const personInput = z.object({
  name: z.string().min(1).max(20),
  gender: genderEnum,
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

const REL_LABEL: Record<RelationType, string> = { friend: "朋友", lover: "恋人", partner: "伴侣" };
const REL_LABEL_EN: Record<RelationType, string> = { friend: "Friend", lover: "Lover", partner: "Partner" };
const relLabel = (lang: Lang, rel: RelationType) => (lang === "en" ? REL_LABEL_EN[rel] : REL_LABEL[rel]);

/* ---------------- 站点设置 ---------------- */

const settingsOutSchema = z.object({
  siteTitle: z.string(),
  siteSubtitle: z.string(),
  announcement: z.string(),
  friendLimit: z.number(),
  loverLimit: z.number(),
  partnerLimit: z.number(),
  enforceExclusivity: z.boolean(),
  allowRegistration: z.boolean(),
  adminNote: z.string(),
  updatedAt: z.string().nullable(),
});
type SettingsOut = z.infer<typeof settingsOutSchema>;

const DEFAULT_SETTINGS: SettingsOut = {
  siteTitle: "Destiny Atlas",
  siteSubtitle: "星座 · 八字 · 五行 —— 遇见合拍的人",
  announcement: "",
  friendLimit: 10,
  loverLimit: 1,
  partnerLimit: 1,
  enforceExclusivity: true,
  allowRegistration: true,
  adminNote: "",
  updatedAt: null,
};

async function getSettings(ctx: Ctx): Promise<SettingsOut> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.siteSettings).limit(1);
  const r = rows[0];
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    siteTitle: r.siteTitle,
    siteSubtitle: r.siteSubtitle,
    announcement: r.announcement,
    friendLimit: r.friendLimit,
    loverLimit: r.loverLimit,
    partnerLimit: r.partnerLimit,
    enforceExclusivity: r.enforceExclusivity === 1,
    allowRegistration: r.allowRegistration === 1,
    adminNote: r.adminNote,
    updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  };
}

async function getLimits(ctx: Ctx): Promise<Record<RelationType, number>> {
  const s = await getSettings(ctx);
  return { friend: s.friendLimit, lover: s.loverLimit, partner: s.partnerLimit };
}

/* ---------------- 账号与会话 ---------------- */

const userOutSchema = z.object({
  id: z.number(),
  username: z.string(),
  /** 从 TalkFirst 同步来的展示信息；老账号可能为空。 */
  nickname: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.enum(["admin", "user"]),
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
type UserOut = z.infer<typeof userOutSchema>;

function userOut(u: UserRow): UserOut {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname ?? null,
    email: u.email ?? null,
    avatarUrl: u.avatarUrl ?? null,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* 密码哈希：新账号/改密一律用 scrypt 慢哈希（格式 s2$<hex>，盐仍存 salt 列）；
   旧版 SHA-256×1000 哈希仅保留校验路径，老账号登录成功后自动平滑升级为 scrypt。 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await scryptAsync(password, salt);
  return `s2$${key.toString("hex")}`;
}

async function legacyHashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  let data = enc.encode(`${salt}:${password}`);
  for (let i = 0; i < 1000; i++) {
    data = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  }
  return [...data].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function verifyPassword(password: string, salt: string, stored: string): Promise<boolean> {
  if (stored.startsWith("s2$")) {
    const key = await scryptAsync(password, salt);
    return safeEqualHex(`s2$${key.toString("hex")}`, stored);
  }
  return safeEqualHex(await legacyHashPassword(password, salt), stored);
}

function isLegacyHash(stored: string): boolean {
  return !stored.startsWith("s2$");
}

/* 登录限流（进程内计数，单实例部署适用）：同一用户名 10 分钟内连续失败 5 次，锁定 10 分钟。 */
const LOGIN_FAIL_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_FAIL_MAX = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const loginFails = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();

function loginLockRemainingMs(username: string): number {
  const rec = loginFails.get(username);
  if (!rec) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}

function recordLoginFailure(username: string): void {
  const now = Date.now();
  const rec = loginFails.get(username);
  if (!rec || now - rec.windowStart > LOGIN_FAIL_WINDOW_MS) {
    loginFails.set(username, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= LOGIN_FAIL_MAX) rec.lockedUntil = now + LOGIN_LOCK_MS;
}

function clearLoginFailures(username: string): void {
  loginFails.delete(username);
}

/**
 * 服务身份（2026-11-08）：TalkFirst 后台的 `serviceAdmin` 用它调管理动作。
 *
 * 为什么不「临时建一个管理员账号」：`adminOverview` / `adminListUsers` 会把那个
 * 账号算进用户数 —— 空库时后台会显示「1 个用户」，是假的。这个身份的 id 固定为
 * 0，不对应任何行；「不能删除/停用自己」那类自检也不会误伤真实用户。
 */
const SERVICE_TOKEN = "service:talkfirst-admin";
const SERVICE_USER = {
  id: 0,
  username: "talkfirst-service",
  passwordHash: "",
  salt: "",
  role: "admin" as const,
  status: "active" as const,
  createdAt: new Date(0),
  lastLoginAt: null,
  lastActiveAt: null,
} as unknown as UserRow;

async function userByToken(ctx: Ctx, token: string): Promise<UserRow | null> {
  if (!token) return null;
  if (token === SERVICE_TOKEN) {
    const flag = ctx as unknown as { serviceAdmin?: boolean };
    return flag.serviceAdmin ? SERVICE_USER : null;
  }
  const db = ctx.db<typeof schema>();
  const sRows = await db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).limit(1);
  const s = sRows[0];
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  const uRows = await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
  const u = uRows[0];
  if (!u || u.status !== "active") return null;
  return u;
}

async function requireUser(ctx: Ctx, token: string): Promise<UserRow> {
  const u = await userByToken(ctx, token);
  if (!u) throw new Error("登录已失效，请重新登录。");
  return u;
}

async function requireAdmin(ctx: Ctx, token: string): Promise<UserRow> {
  const u = await requireUser(ctx, token);
  if (u.role !== "admin") throw new Error("需要管理员权限。");
  return u;
}

/** 记录真实活跃时间（节流：距上次记录超过 60 秒才写库），在线状态据此计算。 */
async function touchActivity(ctx: Ctx, user: UserRow): Promise<void> {
  const last = user.lastActiveAt?.getTime() ?? 0;
  if (Date.now() - last < 60_000) return;
  const db = ctx.db<typeof schema>();
  await db.update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, user.id));
}

async function createSession(ctx: Ctx, userId: number): Promise<string> {
  const db = ctx.db<typeof schema>();
  const token = `${randomHex(24)}${randomHex(24)}`;
  await db.insert(schema.sessions).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  });
  return token;
}

const namingResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  basis: z
    .object({
      dayMaster: z.string(),
      dayMasterElement: z.string(),
      strength: z.string(),
      favorable: z.array(z.string()),
      avoid: z.array(z.string()),
      weakest: z.string(),
      weakestValue: z.number(),
      missing: z.array(z.string()),
      zodiacSign: z.string(),
      explanation: z.string(),
    })
    .nullable(),
  names: z.array(
    z.object({
      fullName: z.string(),
      pinyin: z.string(),
      score: z.number(),
      surnameNote: z.string(),
      chars: z.array(
        z.object({
          char: z.string(),
          pinyin: z.string(),
          element: z.string(),
          strokes: z.number(),
          meaning: z.string(),
          role: z.string(),
          reason: z.string(),
        }),
      ),
      elementSummary: z.string(),
      meaningSummary: z.string(),
      wuge: z.object({
        tian: z.number(),
        ren: z.number(),
        di: z.number(),
        wai: z.number(),
        zong: z.number(),
        lucky: z.array(z.string()),
      }),
      toneNote: z.string(),
    }),
  ),
});

const authResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
  token: z.string().nullable(),
  user: userOutSchema.nullable(),
});

export const Actions = {
  /* ================= 账号 ================= */

  register: defineAction({
    description: "已停用：本应用不提供独立注册，账号只来自 TalkFirst 单点登录。",
    request: z.object({
      username: z.string().min(3).max(20),
      password: z.string().min(6).max(64),
      ...langField,
    }),
    response: authResponse,
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      /* 2026-11-10：不再提供独立注册。账号只来自 TalkFirst 单点登录。 */
      return {
        ok: false,
        message: L(
          lang,
          "灵游空间已并入 TalkFirst，不再单独注册。请在 TalkFirst App 里打开：我的 → 灵游空间。",
          "Lingyou Space now signs in through TalkFirst. Open it from the TalkFirst app: Me → Lingyou Space.",
        ),
        token: null,
        user: null,
      };
      const db = ctx.db<typeof schema>();
      const username = args.username.trim();
      if (!/^[\w\u4e00-\u9fa5-]+$/.test(username)) {
        return { ok: false, message: L(lang, "用户名只能用中文、字母、数字、下划线或短横线。", "Usernames may use Chinese characters, letters, digits, underscores or hyphens only."), token: null, user: null };
      }
      const settings = await getSettings(ctx);
      const existing = await db.select().from(schema.users);
      if (!settings.allowRegistration && existing.length > 0) {
        return { ok: false, message: L(lang, "当前已关闭注册，请联系管理员。", "Registration is currently closed. Please contact the admin."), token: null, user: null };
      }
      if (existing.some((u) => u.username === username)) {
        return { ok: false, message: L(lang, "这个用户名已被注册，换一个试试。", "That username is taken — try another one."), token: null, user: null };
      }
      const isFirst = existing.length === 0;
      const salt = randomHex(16);
      const passwordHash = await hashPassword(args.password, salt);
      const inserted = await db
        .insert(schema.users)
        .values({ username, passwordHash, salt, role: isFirst ? "admin" : "user", status: "active", lastLoginAt: new Date(), lastActiveAt: new Date() })
        .returning();
      const user = inserted[0];
      if (!user) throw new Error("register: insert returned no rows");
      if (isFirst) {
        // 首个账号继承原型期存量数据（user_id=0）
        await db.batch([
          db.update(schema.profiles).set({ userId: user.id }).where(eq(schema.profiles.userId, 0)),
          db.update(schema.candidates).set({ userId: user.id }).where(eq(schema.candidates.userId, 0)),
          db.update(schema.bindings).set({ userId: user.id }).where(eq(schema.bindings.userId, 0)),
          db.update(schema.conversations).set({ userId: user.id }).where(eq(schema.conversations.userId, 0)),
        ]);
      }
      const token = await createSession(ctx, user.id);
      ctx.invalidateQueries();
      return {
        ok: true,
        message: isFirst
          ? L(lang, "注册成功！你是第一个账号，已设为管理员，并继承了此前已有的全部数据。", "Welcome! As the first account, you are the admin and have inherited all existing data.")
          : L(lang, "注册成功，欢迎来到 Destiny Atlas。", "Account created — welcome to Destiny Atlas."),
        token,
        user: userOut(user),
      };
    },
  }),

  login: defineAction({
    description: "用用户名和密码登录，返回会话令牌（30 天有效）。",
    request: z.object({ username: z.string().min(1).max(20), password: z.string().min(1).max(64), ...langField }),
    response: authResponse,
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      /* 2026-11-10：不再提供用户名密码登录。旧账号仍可用 TalkFirst 身份进来。 */
      return {
        ok: false,
        message: L(
          lang,
          "灵游空间已并入 TalkFirst，不再单独登录。请在 TalkFirst App 里打开：我的 → 灵游空间。",
          "Lingyou Space now signs in through TalkFirst. Open it from the TalkFirst app: Me → Lingyou Space.",
        ),
        token: null,
        user: null,
      };
      const db = ctx.db<typeof schema>();
      const uname = args.username.trim();
      const rows = await db.select().from(schema.users).where(eq(schema.users.username, uname)).limit(1);
      const u = rows[0];
      if (!u) return { ok: false, message: L(lang, "用户名或密码不正确。", "Incorrect username or password."), token: null, user: null };
      if (u.status !== "active") return { ok: false, message: L(lang, "该账号已被停用，请联系管理员。", "This account has been disabled. Please contact the admin."), token: null, user: null };
      const lockMs = loginLockRemainingMs(uname);
      if (lockMs > 0) {
        const mins = Math.max(1, Math.ceil(lockMs / 60000));
        return { ok: false, message: L(lang, `尝试次数过多，该账号已临时锁定，请 ${mins} 分钟后再试。`, `Too many failed attempts. This account is temporarily locked — try again in ${mins} minute(s).`), token: null, user: null };
      }
      const okPw = await verifyPassword(args.password, u.salt, u.passwordHash);
      if (!okPw) {
        recordLoginFailure(uname);
        const remain = loginLockRemainingMs(uname);
        if (remain > 0) {
          const mins = Math.max(1, Math.ceil(remain / 60000));
          return { ok: false, message: L(lang, `尝试次数过多，该账号已临时锁定，请 ${mins} 分钟后再试。`, `Too many failed attempts. This account is temporarily locked — try again in ${mins} minute(s).`), token: null, user: null };
        }
        return { ok: false, message: L(lang, "用户名或密码不正确。", "Incorrect username or password."), token: null, user: null };
      }
      clearLoginFailures(uname);
      if (isLegacyHash(u.passwordHash)) {
        // 老账号平滑升级：登录成功后把旧哈希换成 scrypt
        const newSalt = randomHex(16);
        const newHash = await hashPassword(args.password, newSalt);
        await db.update(schema.users).set({ passwordHash: newHash, salt: newSalt }).where(eq(schema.users.id, u.id));
      }
      await db.update(schema.users).set({ lastLoginAt: new Date(), lastActiveAt: new Date() }).where(eq(schema.users.id, u.id));
      const token = await createSession(ctx, u.id);
      ctx.invalidateQueries();
      return { ok: true, message: L(lang, `欢迎回来，${u.username}。`, `Welcome back, ${u.username}.`), token, user: userOut({ ...u, lastLoginAt: new Date() }) };
    },
  }),

  /**
   * TalkFirst 单点登录（2026-11-08）。
   *
   * App 的 WebView 打开本页时，把 TalkFirst 的访问令牌放在 URL fragment 里带进来
   * （fragment 不会进服务端访问日志）。这里拿它去 TalkFirst 的 `/users/me` 验明身份，
   * **不信任客户端传来的任何 id / 用户名**；验过之后按 talkfirst_id 找本地账号，
   * 没有就自动建一个，然后发本应用自己的 30 天会话令牌。
   *
   * 这样用户从 TalkFirst App 点进来就是已登录状态，不需要在这里再注册一次。
   */
  loginWithTalkFirst: defineAction({
    description: "用 TalkFirst 的访问令牌登录或自动建号（App 内 WebView 用）。",
    request: z.object({ tfToken: z.string().min(10).max(4096), ...langField }),
    response: authResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const lang = args.lang as Lang;

      type TalkFirstMe = {
        id?: string;
        email?: string;
        nickname?: string;
        avatarUrl?: string | null;
        birthDate?: string | null;
        gender?: string | null;
      };
      let me: TalkFirstMe | null = null;
      try {
        const res = await fetch(`${TALKFIRST_API_BASE}/users/me`, {
          headers: { Authorization: `Bearer ${args.tfToken}`, Accept: "application/json" },
        });
        if (res.ok) {
          const body = (await res.json()) as { data?: TalkFirstMe };
          me = body.data ?? null;
        }
      } catch {
        return {
          ok: false,
          message: L(lang, "连不上 TalkFirst，请检查网络后重试。", "Couldn't reach TalkFirst. Check your connection and try again."),
          token: null,
          user: null,
        };
      }
      if (!me?.id) {
        return {
          ok: false,
          message: L(lang, "TalkFirst 登录状态已失效，请回到 App 重新打开这一页。", "Your TalkFirst session has expired — reopen this page from the app."),
          token: null,
          user: null,
        };
      }

      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.talkfirstId, me.id))
        .limit(1);
      let user = existing[0];

      if (!user) {
        /*
         * 用户名取 TalkFirst 的昵称（没昵称就用邮箱前缀），冲突就加序号。
         * 密码字段存一个随机哈希：这个账号只走 SSO，没有可用的密码。
         */
        const raw = (me.nickname ?? me.email ?? "TalkFirst").toString().trim();
        const base = (raw.split("@")[0] || "TalkFirst").replace(/[^\w\u4e00-\u9fa5-]/g, "").slice(0, 16) || "TalkFirst";
        const existingUsers = await db
          .select({ username: schema.users.username })
          .from(schema.users);
        const taken = new Set(existingUsers.map((row) => row.username));
        /*
         * 清空后第一个进来的人就是管理员 —— 与 register 的规则一致。
         * 否则库里永远没有 admin，后台的 serviceAdmin 只能靠临时账号撑着。
         */
        const isFirst = existingUsers.length === 0;
        let username = base;
        let suffix = 1;
        while (username.length < 3 || taken.has(username)) {
          username = `${base.slice(0, 12)}_${suffix++}`;
          if (suffix > 999) break;
        }
        const salt = randomHex(16);
        const inserted = await db
          .insert(schema.users)
          .values({
            username,
            salt,
            passwordHash: await hashPassword(randomHex(32), salt),
            role: isFirst ? "admin" : "user",
            status: "active",
            talkfirstId: me.id,
            nickname: me.nickname ?? null,
            email: me.email ?? null,
            avatarUrl: me.avatarUrl ?? null,
            tfBirthDate: me.birthDate ?? null,
            tfGender: me.gender ?? null,
            lastLoginAt: new Date(),
            lastActiveAt: new Date(),
          })
          .returning();
        user = inserted[0];
      }

      if (!user) {
        return {
          ok: false,
          message: L(lang, "创建账号失败，请稍后再试。", "Couldn't create your account. Please try again."),
          token: null,
          user: null,
        };
      }
      if (user.status !== "active") {
        return {
          ok: false,
          message: L(lang, "该账号已被停用，请联系管理员。", "This account has been disabled. Please contact the admin."),
          token: null,
          user: null,
        };
      }

      /*
       * 每次登录都从 TalkFirst 重新同步一次展示信息：昵称/头像在 App 里改过，
       * 这里要跟着变。以 TalkFirst 为准，本地不提供修改入口。
       */
      const synced = {
        nickname: me.nickname ?? user.nickname ?? null,
        email: me.email ?? user.email ?? null,
        avatarUrl: me.avatarUrl ?? user.avatarUrl ?? null,
        tfBirthDate: me.birthDate ?? user.tfBirthDate ?? null,
        tfGender: me.gender ?? user.tfGender ?? null,
      };
      await db
        .update(schema.users)
        .set({ ...synced, lastLoginAt: new Date(), lastActiveAt: new Date() })
        .where(eq(schema.users.id, user.id));
      user = { ...user, ...synced };
      const token = await createSession(ctx, user.id);
      ctx.invalidateQueries();
      return {
        ok: true,
        message: L(lang, `已用 TalkFirst 账号登录，${user.username}。`, `Signed in with TalkFirst as ${user.username}.`),
        token,
        user: userOut({ ...user, lastLoginAt: new Date() }),
      };
    },
  }),

  logout: defineAction({
    description: "退出登录，注销当前会话令牌。",
    request: z.object({ ...tokenField }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      if (args.token) await db.delete(schema.sessions).where(eq(schema.sessions.token, args.token));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  me: defineAction({
    description: "根据会话令牌返回当前登录账号，未登录或已失效时 user 为 null。",
    request: z.object({ ...tokenField }),
    response: z.object({ user: userOutSchema.nullable() }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (u) await touchActivity(ctx, u);
      return { user: u ? userOut(u) : null };
    },
  }),

  heartbeat: defineAction({
    description: "活跃心跳：更新当前登录账号的最近活跃时间（供真实在线状态计算），未登录时静默忽略。",
    request: z.object({ ...tokenField }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const u = await userByToken(ctx, args.token);
      if (u) {
        const db = ctx.db<typeof schema>();
        await db.update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, u.id));
      }
      return { ok: true };
    },
  }),

  changeMyPassword: defineAction({
    description: "修改本人密码：校验旧密码后设置新密码，其余会话全部注销。",
    request: z.object({
      ...tokenField,
      oldPassword: z.string().min(1).max(64),
      newPassword: z.string().min(6).max(64),
    }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await requireUser(ctx, args.token);
      const okOld = await verifyPassword(args.oldPassword, u.salt, u.passwordHash);
      if (!okOld) return { ok: false, message: "旧密码不正确。" };
      const salt = randomHex(16);
      const passwordHash = await hashPassword(args.newPassword, salt);
      await db.update(schema.users).set({ passwordHash, salt }).where(eq(schema.users.id, u.id));
      const mySessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
      const others = mySessions.filter((s) => s.token !== args.token).map((s) => s.id);
      if (others.length) await db.delete(schema.sessions).where(inArray(schema.sessions.id, others));
      ctx.invalidateQueries();
      return { ok: true, message: "密码已修改，其他设备上的登录已退出。" };
    },
  }),

  deleteMyAccount: defineAction({
    description: "注销本人账号并删除其全部数据（档案、候选人、绑定、聊天、会话），不可恢复；管理员账号不可自注销。",
    request: z.object({ ...tokenField, password: z.string().min(1).max(64) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const u = await requireUser(ctx, args.token);
      if (u.role === "admin") return { ok: false, message: "管理员账号不能自注销，请先把管理员转给其他账号。" };
      const okPw2 = await verifyPassword(args.password, u.salt, u.passwordHash);
      if (!okPw2) return { ok: false, message: "密码不正确。" };
      await deleteUserData(ctx, u.id);
      await db.delete(schema.users).where(eq(schema.users.id, u.id));
      ctx.invalidateQueries();
      return { ok: true, message: "账号已注销，全部数据已删除。" };
    },
  }),

  getSiteSettings: defineAction({
    description: "读取公开站点设置（标题、副标题、公告、是否开放注册），登录页与前台共用。",
    request: z.object({}),
    response: z.object({ settings: settingsOutSchema }),
    async handler(ctx) {
      const s = await getSettings(ctx);
      return { settings: { ...s, adminNote: "" } };
    },
  }),

  /* ================= 我的档案 ================= */

  getMyProfile: defineAction({
    description: "读取当前登录账号的命理档案（含排盘结果），未建档时返回 null。",
    request: z.object({ ...tokenField }),
    response: z.object({ profile: profileOutSchema.nullable() }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { profile: null };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
      const row = rows[0];
      return { profile: row ? profileOut(row) : null };
    },
  }),

  saveMyProfile: defineAction({
    description: "保存或更新当前账号的出生档案，并返回重新排盘的命盘。",
    request: personInput.extend({ ...tokenField }),
    response: z.object({ profile: profileOutSchema }),
    async handler(ctx, args) {
      const u = await requireUser(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
      const ex = existing[0];
      if (ex) {
        await db.update(schema.profiles).set({
          name: args.name, gender: args.gender, birthDate: args.birthDate, birthTime: args.birthTime ?? null, updatedAt: new Date(),
        }).where(eq(schema.profiles.id, ex.id));
      } else {
        await db.insert(schema.profiles).values({
          userId: u.id, name: args.name, gender: args.gender, birthDate: args.birthDate, birthTime: args.birthTime ?? null,
        });
      }
      const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
      const row = rows[0];
      if (!row) throw new Error("saveMyProfile: profile missing after save");
      ctx.invalidateQueries();
      return { profile: profileOut(row) };
    },
  }),

  suggestChineseNames: defineAction({
    description:
      "根据当前账号本人命盘（八字喜用、五行缺补）为外国朋友生成中文名：可选指定姓氏与风格，每批 6 个，每个名字附逐字解析（拼音、五行、笔画、字义、选字理由）、五行依据、整体寓意与五格数理。",
    request: z.object({
      ...tokenField,
      surname: z.string().max(1).default(""),
      style: z.enum(["any", "文雅", "大气", "清新", "稳重", "灵动"]).default("any"),
      batch: z.number().int().min(0).max(50).default(0),
      ...langField,
    }),
    response: namingResponseSchema,
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: L(lang, "请先登录。", "Please sign in first."), basis: null, names: [] };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
      const row = rows[0];
      if (!row) return { ok: false, message: L(lang, "请先建立你的命盘档案，再来起名。", "Create your birth chart first, then get your name."), basis: null, names: [] };
      const chart = computeChart({ birthDate: row.birthDate, birthTime: row.birthTime });
      const { basis, names } = generateChineseNames(chart, row.gender, {
        surname: args.surname || undefined,
        style: args.style,
        batch: args.batch,
        lang,
      });
      return { ok: true, message: "", basis, names };
    },
  }),

  /* ================= 访客试用（免注册，不写库） ================= */

  guestChart: defineAction({
    description: "访客试用：仅凭出生信息即时排盘（星座、四柱八字、五行、喜忌），不写数据库、不需要登录，结果只回给调用方保存在本机。",
    request: personInput,
    response: z.object({ profile: profileOutSchema }),
    async handler(_ctx, args) {
      const now = new Date();
      return {
        profile: profileOut({
          id: 0,
          userId: 0,
          name: args.name,
          gender: args.gender,
          birthDate: args.birthDate,
          birthTime: args.birthTime ?? null,
          createdAt: now,
          updatedAt: now,
        }),
      };
    },
  }),

  guestNames: defineAction({
    description: "访客试用：按访客填写的出生信息即时排盘并生成中文名（含逐字英文/中文解释），不写数据库、不需要登录。",
    request: z.object({
      gender: genderEnum,
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      birthTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      surname: z.string().max(1).default(""),
      style: z.enum(["any", "文雅", "大气", "清新", "稳重", "灵动"]).default("any"),
      batch: z.number().int().min(0).max(50).default(0),
      ...langField,
    }),
    response: namingResponseSchema,
    async handler(_ctx, args) {
      const chart = computeChart({ birthDate: args.birthDate, birthTime: args.birthTime ?? null });
      const { basis, names } = generateChineseNames(chart, args.gender, {
        surname: args.surname || undefined,
        style: args.style,
        batch: args.batch,
        lang: args.lang as Lang,
      });
      return { ok: true, message: "", basis, names };
    },
  }),

  guestMatch: defineAction({
    description: "访客试用：两人出生信息即时合盘试算（总分、三项子分、判定与逐条理由），不写数据库、不需要登录；traits 为对方特质、wants 为期望特质。",
    request: z.object({
      relationType: relationEnum,
      wants: z.array(z.string().max(10)).max(12).default([]),
      ...langField,
      me: personInput,
      them: personInput.extend({
        traits: z.array(z.string().max(10)).max(12).default([]),
      }),
    }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      me: profileOutSchema,
      them: candidateOutSchema,
      total: z.number(),
      subScores: z.object({ zodiac: z.number(), bazi: z.number(), detail: z.number() }),
      verdict: z.string(),
      reasons: z.array(z.string()),
      concerns: z.array(z.string()),
    }),
    async handler(_ctx, args) {
      const lang = args.lang as Lang;
      const now = new Date();
      const me = profileOut({
        id: 0, userId: 0, name: args.me.name, gender: args.me.gender,
        birthDate: args.me.birthDate, birthTime: args.me.birthTime ?? null,
        createdAt: now, updatedAt: now,
      });
      const them = candidateOut({
        id: 0, userId: 0, name: args.them.name, gender: args.them.gender,
        birthDate: args.them.birthDate, birthTime: args.them.birthTime ?? null,
        traits: JSON.stringify(args.them.traits), notes: "",
        createdAt: now,
      });
      const s = scorePair(me.chart, them.chart, {
        relationType: args.relationType as RelationType,
        myAge: me.age,
        theirAge: them.age,
        wants: args.wants,
        theirTraits: them.traits,
        lang,
      });
      return {
        ok: true,
        message: L(lang, "试算完成。注册后可以把对方存入候选库，长期跟踪、绑定关系并聊天。", "Trial complete. Register to save them to your candidate library, bind relationships and chat."),
        me,
        them,
        ...s,
      };
    },
  }),

  /* ================= 每日运势 ================= */

  dailyFortune: defineAction({
    description: "每日运势：个人命盘（日主、喜用神、四柱地支）× 指定日期干支，算出契合度评分与逐条理由、今日宜忌、幸运数字、幸运色、每日一句话、今日相配星座与属相。登录用户用本人档案；访客传出生信息即时计算，不写数据库。",
    request: z.object({
      ...tokenField,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      birthTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      ...langField,
    }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      fortune: z.object({
        date: z.string(),
        todayPillar: pillarSchema,
        todayStemElement: z.string(),
        todayBranchElement: z.string(),
        shiShen: z.string(),
        shiShenKey: z.string(),
        score: z.number(),
        band: z.string(),
        reasons: z.array(z.object({ delta: z.number(), text: z.string() })),
        yi: z.array(z.string()),
        ji: z.array(z.string()),
        luckyNumbers: z.array(z.number()),
        luckyColors: z.array(z.object({ name: z.string(), hex: z.string() })),
        dailyWord: z.string(),
        matchSign: z.object({ sign: z.string(), group: z.string(), reason: z.string() }),
        matchAnimal: z.object({ primary: z.string(), alternatives: z.array(z.string()), reason: z.string() }),
      }).nullable(),
    }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const date = args.date ?? new Date().toISOString().slice(0, 10);
      let birthDate = args.birthDate;
      let birthTime = args.birthTime ?? null;
      if (!birthDate && args.token) {
        const u = await userByToken(ctx, args.token);
        if (u) {
          const db = ctx.db<typeof schema>();
          const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
          const row = rows[0];
          if (row) {
            birthDate = row.birthDate;
            birthTime = row.birthTime;
          }
        }
      }
      if (!birthDate) {
        return { ok: false, message: L(lang, "请先建立你的命盘档案，再来看每日运势。", "Create your birth chart first, then check your daily fortune."), fortune: null };
      }
      const chart = computeChart({ birthDate, birthTime });
      const fortune = computeDailyFortune(chart, birthDate, date, lang);
      return { ok: true, message: "", fortune };
    },
  }),

  onThisDay: defineAction({
    description: "历史上的今天：按月日从维基百科 onthisday 官方接口取重大事件与历史人物生日（服务端按日缓存），无命理内容，纯趣味资讯。",
    request: z.object({
      mmdd: z.string().regex(/^\d{2}-\d{2}$/),
      ...langField,
    }),
    response: z.object({
      events: z.array(z.object({ year: z.number(), text: z.string(), url: z.string() })),
      births: z.array(z.object({ year: z.number(), text: z.string(), url: z.string() })),
    }),
    async handler(_ctx, args) {
      return fetchOnThisDay(args.mmdd, args.lang as Lang);
    },
  }),

  /* ================= 候选人 ================= */

  listCandidates: defineAction({
    description: "列出当前账号候选人库的全部档案（含各自排盘），按添加时间倒序。",
    request: z.object({ ...tokenField }),
    response: z.object({ candidates: z.array(candidateOutSchema) }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { candidates: [] };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.candidates).where(eq(schema.candidates.userId, u.id)).orderBy(desc(schema.candidates.id));
      return { candidates: rows.map(candidateOut) };
    },
  }),

  addCandidate: defineAction({
    description: "向当前账号的候选人库添加一位候选人（姓名、性别、出生日期时间、性格特质、备注）。",
    request: personInput.extend({
      ...tokenField,
      traits: z.array(z.string().max(10)).max(12).default([]),
      notes: z.string().max(200).default(""),
    }),
    response: z.object({ candidate: candidateOutSchema }),
    async handler(ctx, args) {
      const u = await requireUser(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const result = await db.insert(schema.candidates).values({
        userId: u.id,
        name: args.name,
        gender: args.gender,
        birthDate: args.birthDate,
        birthTime: args.birthTime ?? null,
        traits: JSON.stringify(args.traits),
        notes: args.notes,
      }).returning();
      const row = result[0];
      if (!row) throw new Error("addCandidate: insert returned no rows");
      ctx.invalidateQueries();
      return { candidate: candidateOut(row) };
    },
  }),

  deleteCandidate: defineAction({
    description: "从当前账号的候选人库删除一位候选人，并解除其全部关系绑定、删除其会话与消息。",
    request: z.object({ ...tokenField, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const u = await requireUser(ctx, args.token);
      await deleteCandidateCascade(ctx, u.id, args.id);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /* ================= 匹配 ================= */

  match: defineAction({
    description:
      "按关系类型与指定要求筛选当前账号的候选人：期望特质、姓氏、名字含字、年龄范围均为硬性条件；无完全符合者时返回最接近的人选并标注 exact=false。",
    request: z.object({
      ...tokenField,
      relationType: relationEnum,
      wants: z.array(z.string().max(10)).max(12).default([]),
      surname: z.string().max(1).default(""),
      nameContains: z.string().max(4).default(""),
      ageMin: z.number().int().min(0).max(120).nullable().default(null),
      ageMax: z.number().int().min(0).max(120).nullable().default(null),
      candidateId: z.number().int().positive().nullable().default(null),
      ...langField,
    }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      exact: z.boolean(),
      results: z.array(
        z.object({
          candidate: candidateOutSchema,
          total: z.number(),
          subScores: z.object({ zodiac: z.number(), bazi: z.number(), detail: z.number() }),
          verdict: z.string(),
          reasons: z.array(z.string()),
          concerns: z.array(z.string()),
        }),
      ),
    }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: L(lang, "请先登录。", "Please sign in first."), exact: false, results: [] };
      const db = ctx.db<typeof schema>();
      const profRows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1);
      const prof = profRows[0];
      if (!prof) return { ok: false, message: L(lang, "请先建立你的命理档案，再开始匹配。", "Create your birth chart first, then start matching."), exact: false, results: [] };
      let rows = await db.select().from(schema.candidates).where(eq(schema.candidates.userId, u.id)).orderBy(asc(schema.candidates.id));
      if (args.candidateId != null) rows = rows.filter((r) => r.id === args.candidateId);
      if (rows.length === 0) {
        return { ok: true, message: L(lang, "候选人库还是空的，先添加想了解的人，再来匹配。", "Your candidate library is empty — add someone first, then match."), exact: false, results: [] };
      }
      const me = profileOut(prof);
      const scored = rows.map((row) => {
        const cand = candidateOut(row);
        const s = scorePair(me.chart, cand.chart, {
          relationType: args.relationType as RelationType,
          myAge: me.age,
          theirAge: cand.age,
          wants: args.wants,
          theirTraits: cand.traits,
          lang,
        });
        return { candidate: cand, ...s };
      });
      const passes = (c: (typeof scored)[number]) => {
        if (args.surname && !c.candidate.name.startsWith(args.surname)) return false;
        if (args.nameContains && !c.candidate.name.includes(args.nameContains)) return false;
        if (args.ageMin != null && c.candidate.age < args.ageMin) return false;
        if (args.ageMax != null && c.candidate.age > args.ageMax) return false;
        if (args.wants.some((w) => !c.candidate.traits.includes(w))) return false;
        return true;
      };
      const filtered = scored.filter(passes);
      if (filtered.length > 0) {
        const exactSorted = [...filtered].sort((a, b) => b.total - a.total);
        return { ok: true, message: L(lang, `共 ${exactSorted.length} 位符合全部指定要求，按契合度排序。`, `${exactSorted.length} candidate(s) meet all your requirements, ranked by compatibility.`), exact: true, results: exactSorted.slice(0, 20) };
      }
      const sorted = [...scored].sort((a, b) => b.total - a.total);
      return {
        ok: true,
        message: L(lang, "暂无完全符合指定要求的人选，以下是放宽条件后最接近的几位（已按契合度排序）。", "No one meets every requirement yet — here are the closest matches with the filters relaxed, ranked by compatibility."),
        exact: false,
        results: sorted.slice(0, 3),
      };
    },
  }),

  /* ================= 绑定 ================= */

  listBindings: defineAction({
    description: "列出当前账号的全部关系绑定（含站点设置中的各关系上限），按绑定时间正序。",
    request: z.object({ ...tokenField }),
    response: z.object({
      bindings: z.array(
        z.object({
          id: z.number(),
          relationType: relationEnum,
          targetId: z.number().nullable(),
          targetName: z.string(),
          createdAt: z.string(),
        }),
      ),
      limits: z.object({ friend: z.number(), lover: z.number(), partner: z.number() }),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      const limits = await getLimits(ctx);
      if (!u) return { bindings: [], limits };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.bindings).where(eq(schema.bindings.userId, u.id)).orderBy(asc(schema.bindings.id));
      return {
        bindings: rows.map((r) => ({
          id: r.id,
          relationType: r.relationType,
          targetId: r.targetId,
          targetName: r.targetName,
          createdAt: r.createdAt.toISOString(),
        })),
        limits,
      };
    },
  }),

  bind: defineAction({
    description: "把当前账号的一位候选人绑定为朋友/恋人/伴侣：上限与互斥规则读站点设置，超限或冲突时返回 ok=false 与原因。",
    request: z.object({ ...tokenField, relationType: relationEnum, candidateId: z.number().int().positive(), ...langField }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: L(lang, "请先登录。", "Please sign in first.") };
      const db = ctx.db<typeof schema>();
      const candRows = await db.select().from(schema.candidates)
        .where(and(eq(schema.candidates.id, args.candidateId), eq(schema.candidates.userId, u.id))).limit(1);
      const cand = candRows[0];
      if (!cand) return { ok: false, message: L(lang, "这位候选人已不在你的候选库中。", "This person is no longer in your candidate library.") };
      const all = await db.select().from(schema.bindings).where(eq(schema.bindings.userId, u.id));
      const rel = args.relationType as RelationType;
      if (all.some((b) => b.relationType === rel && b.targetId === cand.id)) {
        return { ok: false, message: L(lang, `${cand.name} 已经是你的${REL_LABEL[rel]}了。`, `${cand.name} is already your ${relLabel(lang, rel)}.`) };
      }
      const limits = await getLimits(ctx);
      const settings = await getSettings(ctx);
      if ((rel === "lover" || rel === "partner") && settings.enforceExclusivity) {
        const other: RelationType = rel === "lover" ? "partner" : "lover";
        const existingOther = all.find((b) => b.relationType === other);
        if (existingOther) {
          return { ok: false, message: L(lang, `你已绑定${REL_LABEL[other]}「${existingOther.targetName}」，按专一原则，需先解除后才能绑定新的${REL_LABEL[rel]}。`, `You already have a ${relLabel(lang, other)} ("${existingOther.targetName}"). By the exclusivity rule, unbind them first before binding a new ${relLabel(lang, rel)}.`) };
        }
      }
      const sameList = all.filter((b) => b.relationType === rel);
      if (sameList.length >= limits[rel]) {
        return {
          ok: false,
          message: rel === "friend"
            ? L(lang, `朋友最多绑定 ${limits[rel]} 人，已达上限，请先解除一位。`, `You can bind at most ${limits[rel]} friends — the limit is reached. Unbind one first.`)
            : L(lang, `${REL_LABEL[rel]}最多绑定 ${limits[rel]} 人，你已绑定「${sameList[0]?.targetName ?? ""}」，请先解除。`, `You can bind at most ${limits[rel]} ${relLabel(lang, rel)}(s); "${sameList[0]?.targetName ?? ""}" is already bound. Unbind first.`),
        };
      }
      await db.insert(schema.bindings).values({ userId: u.id, relationType: rel, targetType: "candidate", targetId: cand.id, targetName: cand.name });
      ctx.invalidateQueries();
      return { ok: true, message: L(lang, `已把「${cand.name}」绑定为你的${REL_LABEL[rel]}。`, `"${cand.name}" is now bound as your ${relLabel(lang, rel)}.`) };
    },
  }),

  unbind: defineAction({
    description: "解除当前账号的一条关系绑定。",
    request: z.object({ ...tokenField, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const u = await requireUser(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.bindings).where(and(eq(schema.bindings.id, args.id), eq(schema.bindings.userId, u.id)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /* ================= 聊天 ================= */

  listConversations: defineAction({
    description: "列出当前账号的全部聊天会话（含对方姓名、星座、最近一条消息与时间），按最近消息倒序。",
    request: z.object({ ...tokenField }),
    response: z.object({
      conversations: z.array(
        z.object({
          id: z.number(),
          candidateId: z.number(),
          candidateName: z.string(),
          zodiacSign: z.string(),
          lastMessage: z.string().nullable(),
          lastSender: z.enum(["me", "them"]).nullable(),
          lastAt: z.string().nullable(),
          messageCount: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { conversations: [] };
      const db = ctx.db<typeof schema>();
      const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.userId, u.id));
      const cands = await db.select().from(schema.candidates).where(eq(schema.candidates.userId, u.id));
      const candMap = new Map(cands.map((c) => [c.id, c]));
      const out = [];
      for (const conv of convs) {
        const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(desc(schema.messages.id));
        const last = msgs[0];
        const cand = candMap.get(conv.candidateId);
        out.push({
          id: conv.id,
          candidateId: conv.candidateId,
          candidateName: conv.candidateName,
          zodiacSign: cand ? computeChart({ birthDate: cand.birthDate, birthTime: cand.birthTime }).zodiacSign : "",
          lastMessage: last ? last.content : null,
          lastSender: last ? last.sender : null,
          lastAt: last ? last.createdAt.toISOString() : conv.updatedAt.toISOString(),
          messageCount: msgs.length,
        });
      }
      out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
      return { conversations: out };
    },
  }),

  openConversation: defineAction({
    description: "打开（或新建）当前账号与某位候选人的聊天会话，并返回全部历史消息。",
    request: z.object({ ...tokenField, candidateId: z.number().int().positive() }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      conversationId: z.number().nullable(),
      candidateName: z.string(),
      messages: z.array(z.object({ id: z.number(), sender: z.enum(["me", "them"]), content: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: "请先登录。", conversationId: null, candidateName: "", messages: [] };
      const db = ctx.db<typeof schema>();
      const candRows = await db.select().from(schema.candidates)
        .where(and(eq(schema.candidates.id, args.candidateId), eq(schema.candidates.userId, u.id))).limit(1);
      const cand = candRows[0];
      if (!cand) return { ok: false, message: "这位候选人已不在你的候选库中。", conversationId: null, candidateName: "", messages: [] };
      let convRows = await db.select().from(schema.conversations)
        .where(and(eq(schema.conversations.userId, u.id), eq(schema.conversations.candidateId, cand.id))).limit(1);
      let conv = convRows[0];
      if (!conv) {
        const inserted = await db.insert(schema.conversations).values({ userId: u.id, candidateId: cand.id, candidateName: cand.name }).returning();
        conv = inserted[0];
        if (!conv) throw new Error("openConversation: insert returned no rows");
      }
      const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(asc(schema.messages.id));
      ctx.invalidateQueries();
      return {
        ok: true,
        message: "",
        conversationId: conv.id,
        candidateName: cand.name,
        messages: msgs.map((m) => ({ id: m.id, sender: m.sender, content: m.content, createdAt: m.createdAt.toISOString() })),
      };
    },
  }),

  listMessages: defineAction({
    description: "按会话 id 拉取当前账号的消息（供聊天界面实时轮询），按时间正序；会话不属于本人时返回空。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({
      messages: z.array(z.object({ id: z.number(), sender: z.enum(["me", "them"]), content: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { messages: [] };
      const db = ctx.db<typeof schema>();
      const convRows = await db.select().from(schema.conversations)
        .where(and(eq(schema.conversations.id, args.conversationId), eq(schema.conversations.userId, u.id))).limit(1);
      if (!convRows[0]) return { messages: [] };
      const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, args.conversationId)).orderBy(asc(schema.messages.id));
      return { messages: msgs.map((m) => ({ id: m.id, sender: m.sender, content: m.content, createdAt: m.createdAt.toISOString() })) };
    },
  }),

  sendMessage: defineAction({
    description: "（已停用）旧模拟聊天不再产生任何回复：候选人是手动录入的档案、不是真人，消息仅保存为历史，不再生成模拟回复。真实聊天请用站内用户私聊。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive(), content: z.string().min(1).max(500) }),
    response: z.object({ ok: z.boolean(), message: z.string(), reply: z.string().nullable() }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: "请先登录。", reply: null };
      const db = ctx.db<typeof schema>();
      const convRows = await db.select().from(schema.conversations)
        .where(and(eq(schema.conversations.id, args.conversationId), eq(schema.conversations.userId, u.id))).limit(1);
      const conv = convRows[0];
      if (!conv) return { ok: false, message: "会话不存在，请重新打开聊天。", reply: null };
      // 只保存用户自己写下的这条消息作为历史，不再生成任何模拟回复。
      await db.insert(schema.messages).values({ conversationId: conv.id, sender: "me", content: args.content });
      await db.update(schema.conversations).set({ updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
      ctx.invalidateQueries();
      return { ok: true, message: "", reply: null };
    },
  }),

  clearConversation: defineAction({
    description: "清空当前账号与某位候选人的全部聊天记录（会话本身保留）。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const u = await requireUser(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const convRows = await db.select().from(schema.conversations)
        .where(and(eq(schema.conversations.id, args.conversationId), eq(schema.conversations.userId, u.id))).limit(1);
      if (convRows[0]) {
        await db.delete(schema.messages).where(eq(schema.messages.conversationId, args.conversationId));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  /* ================= 真实用户聊天（注册用户之间） ================= */

  searchUsers: defineAction({
    description: "按用户名搜索站内其他注册用户（真实账号）：返回用户名、角色、真实最近活跃时间、是否已建命盘与星座、双方拉黑状态，供发起真实对话。",
    request: z.object({ ...tokenField, query: z.string().max(20).default("") }),
    response: z.object({
      users: z.array(
        z.object({
          id: z.number(),
          username: z.string(),
          role: z.enum(["admin", "user"]),
          lastActiveAt: z.string().nullable(),
          hasProfile: z.boolean(),
          profileName: z.string().nullable(),
          zodiacSign: z.string().nullable(),
          iBlocked: z.boolean(),
          blockedMe: z.boolean(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { users: [] };
      await touchActivity(ctx, u);
      const db = ctx.db<typeof schema>();
      const q = args.query.trim().toLowerCase();
      const all = await db.select().from(schema.users).orderBy(asc(schema.users.id));
      const others = all.filter(
        (x) => x.id !== u.id && x.status === "active" && (!q || x.username.toLowerCase().includes(q)),
      ).slice(0, 30);
      const profs = await db.select().from(schema.profiles);
      const profMap = new Map(profs.map((p) => [p.userId, p]));
      const blocks = await db.select().from(schema.userBlocks);
      return {
        users: others.map((x) => {
          const prof = profMap.get(x.id);
          return {
            id: x.id,
            username: x.username,
            role: x.role,
            lastActiveAt: (x.lastActiveAt ?? x.lastLoginAt)?.toISOString() ?? null,
            hasProfile: !!prof,
            profileName: prof?.name ?? null,
            zodiacSign: prof ? computeChart({ birthDate: prof.birthDate, birthTime: prof.birthTime }).zodiacSign : null,
            iBlocked: blocks.some((b) => b.blockerId === u.id && b.blockedId === x.id),
            blockedMe: blocks.some((b) => b.blockerId === x.id && b.blockedId === u.id),
          };
        }),
      };
    },
  }),

  listDmConversations: defineAction({
    description: "列出当前账号与站内真实用户的全部私聊会话：对方用户名、真实最近活跃时间、最近一条消息、未读数与拉黑状态，按最近消息倒序。",
    request: z.object({ ...tokenField }),
    response: z.object({
      conversations: z.array(
        z.object({
          id: z.number(),
          otherUserId: z.number(),
          otherUsername: z.string(),
          otherLastActiveAt: z.string().nullable(),
          lastMessage: z.string().nullable(),
          lastSenderId: z.number().nullable(),
          lastAt: z.string().nullable(),
          unread: z.number(),
          messageCount: z.number(),
          iBlocked: z.boolean(),
          blockedMe: z.boolean(),
        }),
      ),
      totalUnread: z.number(),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { conversations: [], totalUnread: 0 };
      await touchActivity(ctx, u);
      const db = ctx.db<typeof schema>();
      const convs = await db.select().from(schema.directConversations);
      const mine = convs.filter((c) => c.userAId === u.id || c.userBId === u.id);
      const users = await db.select().from(schema.users);
      const userMap = new Map(users.map((x) => [x.id, x]));
      const blocks = await db.select().from(schema.userBlocks);
      const reads = await db.select().from(schema.directReads).where(eq(schema.directReads.userId, u.id));
      const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadMessageId]));
      const out = [];
      for (const conv of mine) {
        const otherId = conv.userAId === u.id ? conv.userBId : conv.userAId;
        const other = userMap.get(otherId);
        if (!other) continue;
        const msgs = await db.select().from(schema.directMessages)
          .where(eq(schema.directMessages.conversationId, conv.id)).orderBy(desc(schema.directMessages.id));
        const last = msgs[0];
        const lastRead = readMap.get(conv.id) ?? 0;
        out.push({
          id: conv.id,
          otherUserId: otherId,
          otherUsername: other.username,
          otherLastActiveAt: (other.lastActiveAt ?? other.lastLoginAt)?.toISOString() ?? null,
          lastMessage: last ? last.content : null,
          lastSenderId: last ? last.senderId : null,
          lastAt: last ? last.createdAt.toISOString() : conv.updatedAt.toISOString(),
          unread: msgs.filter((m) => m.id > lastRead && m.senderId !== u.id).length,
          messageCount: msgs.length,
          iBlocked: blocks.some((b) => b.blockerId === u.id && b.blockedId === otherId),
          blockedMe: blocks.some((b) => b.blockerId === otherId && b.blockedId === u.id),
        });
      }
      out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
      return { conversations: out, totalUnread: out.reduce((s, c) => s + c.unread, 0) };
    },
  }),

  openDmConversation: defineAction({
    description: "打开（或新建）与某位站内注册用户的真实私聊会话；对方已拉黑我时返回 ok=false。",
    request: z.object({ ...tokenField, otherUserId: z.number().int().positive(), ...langField }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      conversationId: z.number().nullable(),
      otherUserId: z.number(),
      otherUsername: z.string(),
      otherLastActiveAt: z.string().nullable(),
      iBlocked: z.boolean(),
      blockedMe: z.boolean(),
    }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const fail = (message: string) => ({
        ok: false, message, conversationId: null, otherUserId: args.otherUserId,
        otherUsername: "", otherLastActiveAt: null, iBlocked: false, blockedMe: false,
      });
      const u = await userByToken(ctx, args.token);
      if (!u) return fail(L(lang, "请先登录。", "Please sign in first."));
      if (args.otherUserId === u.id) return fail(L(lang, "不能和自己聊天。", "You can't chat with yourself."));
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, args.otherUserId)).limit(1);
      const other = rows[0];
      if (!other || other.status !== "active") return fail(L(lang, "这位用户不存在或已停用。", "This user doesn't exist or has been disabled."));
      const blocks = await db.select().from(schema.userBlocks);
      const blockedMe = blocks.some((b) => b.blockerId === other.id && b.blockedId === u.id);
      const iBlocked = blocks.some((b) => b.blockerId === u.id && b.blockedId === other.id);
      if (blockedMe) return { ...fail(L(lang, "对方已将你拉黑，无法发起对话。", "This user has blocked you, so you can't start a conversation.")), blockedMe: true, otherUsername: other.username };
      const [a, b] = u.id < other.id ? [u.id, other.id] : [other.id, u.id];
      const existing = await db.select().from(schema.directConversations)
        .where(and(eq(schema.directConversations.userAId, a), eq(schema.directConversations.userBId, b))).limit(1);
      let conv = existing[0];
      if (!conv) {
        const inserted = await db.insert(schema.directConversations).values({ userAId: a, userBId: b }).returning();
        conv = inserted[0];
        if (!conv) throw new Error("openDmConversation: insert returned no rows");
      }
      await touchActivity(ctx, u);
      ctx.invalidateQueries();
      return {
        ok: true,
        message: "",
        conversationId: conv.id,
        otherUserId: other.id,
        otherUsername: other.username,
        otherLastActiveAt: (other.lastActiveAt ?? other.lastLoginAt)?.toISOString() ?? null,
        iBlocked,
        blockedMe: false,
      };
    },
  }),

  listDmMessages: defineAction({
    description: "拉取某个真实私聊会话的全部消息（仅对话双方可读），并把会话标记为已读；同时返回对方用户名、真实活跃时间与拉黑状态。供聊天界面数秒级轮询。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({
      messages: z.array(
        z.object({ id: z.number(), senderId: z.number(), mine: z.boolean(), content: z.string(), createdAt: z.string() }),
      ),
      other: z
        .object({
          userId: z.number(),
          username: z.string(),
          lastActiveAt: z.string().nullable(),
          iBlocked: z.boolean(),
          blockedMe: z.boolean(),
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      const u = await userByToken(ctx, args.token);
      if (!u) return { messages: [], other: null };
      const db = ctx.db<typeof schema>();
      const convRows = await db.select().from(schema.directConversations).where(eq(schema.directConversations.id, args.conversationId)).limit(1);
      const conv = convRows[0];
      if (!conv || (conv.userAId !== u.id && conv.userBId !== u.id)) return { messages: [], other: null };
      const otherId = conv.userAId === u.id ? conv.userBId : conv.userAId;
      const otherRows = await db.select().from(schema.users).where(eq(schema.users.id, otherId)).limit(1);
      const other = otherRows[0];
      const msgs = await db.select().from(schema.directMessages)
        .where(eq(schema.directMessages.conversationId, conv.id)).orderBy(asc(schema.directMessages.id));
      const maxId = msgs.length ? (msgs[msgs.length - 1]?.id ?? 0) : 0;
      const readRows = await db.select().from(schema.directReads)
        .where(and(eq(schema.directReads.conversationId, conv.id), eq(schema.directReads.userId, u.id))).limit(1);
      const readRow = readRows[0];
      if (readRow) {
        if (readRow.lastReadMessageId < maxId) {
          await db.update(schema.directReads).set({ lastReadMessageId: maxId }).where(eq(schema.directReads.id, readRow.id));
        }
      } else if (maxId > 0) {
        await db.insert(schema.directReads).values({ conversationId: conv.id, userId: u.id, lastReadMessageId: maxId });
      }
      const blocks = await db.select().from(schema.userBlocks);
      return {
        messages: msgs.map((m) => ({
          id: m.id, senderId: m.senderId, mine: m.senderId === u.id,
          content: m.content, createdAt: m.createdAt.toISOString(),
        })),
        other: other
          ? {
              userId: otherId,
              username: other.username,
              lastActiveAt: (other.lastActiveAt ?? other.lastLoginAt)?.toISOString() ?? null,
              iBlocked: blocks.some((b) => b.blockerId === u.id && b.blockedId === otherId),
              blockedMe: blocks.some((b) => b.blockerId === otherId && b.blockedId === u.id),
            }
          : null,
      };
    },
  }),

  sendDmMessage: defineAction({
    description: "在真实私聊会话中发送一条消息：仅对话双方可见；任一方拉黑对方时发送被拒绝并说明原因。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive(), content: z.string().min(1).max(1000), ...langField }),
    response: z.object({ ok: z.boolean(), message: z.string(), messageId: z.number().nullable() }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await userByToken(ctx, args.token);
      if (!u) return { ok: false, message: L(lang, "请先登录。", "Please sign in first."), messageId: null };
      const db = ctx.db<typeof schema>();
      const convRows = await db.select().from(schema.directConversations).where(eq(schema.directConversations.id, args.conversationId)).limit(1);
      const conv = convRows[0];
      if (!conv || (conv.userAId !== u.id && conv.userBId !== u.id)) {
        return { ok: false, message: L(lang, "会话不存在，请重新打开聊天。", "Conversation not found — please reopen the chat."), messageId: null };
      }
      const otherId = conv.userAId === u.id ? conv.userBId : conv.userAId;
      const blocks = await db.select().from(schema.userBlocks);
      if (blocks.some((b) => b.blockerId === otherId && b.blockedId === u.id)) {
        return { ok: false, message: L(lang, "对方已将你拉黑，消息无法发送。", "This user has blocked you — the message can't be sent."), messageId: null };
      }
      if (blocks.some((b) => b.blockerId === u.id && b.blockedId === otherId)) {
        return { ok: false, message: L(lang, "你已拉黑对方，先解除拉黑才能发送消息。", "You've blocked this user — unblock them before sending."), messageId: null };
      }
      const content = args.content.trim();
      if (!content) return { ok: false, message: L(lang, "消息不能为空。", "The message can't be empty."), messageId: null };
      const inserted = await db.insert(schema.directMessages)
        .values({ conversationId: conv.id, senderId: u.id, content }).returning();
      const msg = inserted[0];
      await db.update(schema.directConversations).set({ updatedAt: new Date() }).where(eq(schema.directConversations.id, conv.id));
      await touchActivity(ctx, u);
      ctx.invalidateQueries();
      return { ok: true, message: "", messageId: msg?.id ?? null };
    },
  }),

  setBlock: defineAction({
    description: "拉黑或解除拉黑一位站内注册用户：拉黑后对方不能再向我发起对话或发送消息。",
    request: z.object({ ...tokenField, userId: z.number().int().positive(), blocked: z.boolean(), ...langField }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await requireUser(ctx, args.token);
      if (args.userId === u.id) return { ok: false, message: L(lang, "不能拉黑自己。", "You can't block yourself.") };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, args.userId)).limit(1);
      const target = rows[0];
      if (!target) return { ok: false, message: L(lang, "这位用户不存在。", "This user doesn't exist.") };
      const existing = await db.select().from(schema.userBlocks)
        .where(and(eq(schema.userBlocks.blockerId, u.id), eq(schema.userBlocks.blockedId, args.userId))).limit(1);
      if (args.blocked) {
        if (!existing[0]) await db.insert(schema.userBlocks).values({ blockerId: u.id, blockedId: args.userId });
        ctx.invalidateQueries();
        return { ok: true, message: L(lang, `已拉黑 ${target.username}，对方将不能再给你发消息。`, `${target.username} is blocked — they can no longer message you.`) };
      }
      if (existing[0]) await db.delete(schema.userBlocks).where(eq(schema.userBlocks.id, existing[0].id));
      ctx.invalidateQueries();
      return { ok: true, message: L(lang, `已解除对 ${target.username} 的拉黑。`, `${target.username} is unblocked.`) };
    },
  }),

  /* ================= AI 命理助手 ================= */

  listAiMessages: defineAction({
    description: "读取当前身份（登录账号或访客本机键）与 AI 命理助手的对话记录，按时间正序。",
    request: z.object({ ...tokenField, guestKey: z.string().max(64).default("") }),
    response: z.object({
      messages: z.array(z.object({ id: z.number(), role: z.enum(["user", "assistant"]), content: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      const key = await aiUserKey(ctx, args.token, args.guestKey);
      if (!key) return { messages: [] };
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.aiMessages)
        .where(eq(schema.aiMessages.userKey, key)).orderBy(asc(schema.aiMessages.id));
      return {
        messages: rows.slice(-100).map((m) => ({
          id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  clearAiMessages: defineAction({
    description: "清空当前身份与 AI 命理助手的全部对话记录。",
    request: z.object({ ...tokenField, guestKey: z.string().max(64).default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const key = await aiUserKey(ctx, args.token, args.guestKey);
      if (key) {
        const db = ctx.db<typeof schema>();
        await db.delete(schema.aiMessages).where(eq(schema.aiMessages.userKey, key));
      }
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  askAiAssistant: defineAction({
    description:
      "向 AI 命理助手提问：登录用户会结合本人命盘（四柱、五行、日主强弱喜忌、星座生肖）、起名结果与候选人合盘结果作答；访客只能问通用问题。回答末尾固定附娱乐参考免责说明，跟随界面语言。",
    request: z.object({
      ...tokenField,
      guestKey: z.string().max(64).default(""),
      question: z.string().min(1).max(500),
      ...langField,
    }),
    response: z.object({ ok: z.boolean(), message: z.string(), answer: z.string(), hasProfile: z.boolean() }),
    async handler(ctx, args) {
      const lang = args.lang as Lang;
      const u = await userByToken(ctx, args.token);
      const key = await aiUserKey(ctx, args.token, args.guestKey);
      if (!key) {
        return { ok: false, message: L(lang, "助手暂时不可用，请刷新后重试。", "The assistant is unavailable — please refresh and retry."), answer: "", hasProfile: false };
      }
      const db = ctx.db<typeof schema>();
      const question = args.question.trim();
      if (!question) return { ok: false, message: L(lang, "先写下你的问题。", "Write your question first."), answer: "", hasProfile: false };

      // 组装提问者本人的命盘 / 起名 / 合盘上下文（仅登录用户且已建档时有）
      let contextText = "";
      let hasProfile = false;
      let chartSummaryZh = "";
      if (u) {
        const built = await buildAiContext(ctx, u, lang);
        contextText = built.contextText;
        hasProfile = built.hasProfile;
        chartSummaryZh = built.chartSummaryZh;
      }

      const historyRows = await db.select().from(schema.aiMessages)
        .where(eq(schema.aiMessages.userKey, key)).orderBy(desc(schema.aiMessages.id)).limit(8);
      const historyText = [...historyRows].reverse()
        .map((m) => `${m.role === "user" ? (lang === "en" ? "User" : "用户") : (lang === "en" ? "Assistant" : "助手")}：${m.content}`)
        .join("\n");

      const disclaimer = L(
        lang,
        "（以上解读基于传统命理文化，仅供娱乐参考，不是对命运的断言；重要决定请结合现实情况判断。）",
        "(This reading draws on traditional Chinese metaphysics culture and is for entertainment only — not a claim about your fate. For important decisions, rely on real-world judgment.)",
      );

      let answer = "";
      try {
        const appFacts = lang === "en"
          ? `Facts about this app (only state these; never invent features or fields):
- Chart tab: enter name, gender, birth date and birth time (NO birthplace field) to cast a chart — zodiac sign, Four Pillars, five-element strengths, Day Master strength, favorable/avoided elements.
- Chinese naming: names are generated from the user's own chart (favorable elements, weakest element replenished), with per-character explanations.
- Match tab: screen candidates as Friend / Lover / Partner; desired traits, family name, name character and age range are hard filters; if nobody fits, the closest matches are shown relaxed.
- Binding rules: Friends up to the site setting (default 10), Lover 1, Partner 1; Lover and Partner are mutually exclusive; unbinding frees the slot.
- Candidates tab: manually added profiles of real-life acquaintances (not accounts); they have no chat and no online status.
- Chat tab: real direct messages between registered users (search by username, messages stored server-side, unread counts, blocking); plus this AI assistant, pinned at the top.
- Guests can try charts, naming and one compatibility trial without registering; saving data, candidates, bindings and real chat need an account.`
          : `这个 app 的功能事实（只能说这些，不要编造不存在的功能或字段）：
- 「命盘」页签：填姓名、性别、出生日期与出生时间排盘（没有出生地字段），得出星座、四柱八字、五行力量、日主强弱与喜忌。
- 中文起名：按本人命盘生成（喜用、补最弱一行、避忌神），每个名字有逐字解释。
- 「匹配」页签：按朋友 / 恋人 / 伴侣筛选候选人；期望特质、指定姓氏、名字含字、年龄范围是硬性条件；无人完全符合时展示放宽后的最接近人选。
- 绑定规则：朋友上限以站点设置为准（默认 10 人），恋人 1 人、伴侣 1 人，恋人与伴侣互斥；解除绑定立即释放名额。
- 「候选」页签：手动录入的现实熟人档案（不是注册账号），没有聊天入口、没有在线状态。
- 「聊天」页签：注册用户之间的真实私聊（按用户名搜索、消息存服务端、未读提醒、可拉黑），以及置顶的 AI 命理助手（就是你）。
- 访客免注册可试用排盘、起名与一次合盘试算；保存档案、候选库、绑定与真实聊天需要注册账号。`;
        const prompt = lang === "en"
          ? `You are the "AI BaZi Assistant" inside the Destiny Atlas app — clearly an AI, never a real person. Answer the user's question helpfully and specifically.

${appFacts}
What you know about this user (from their own data in the app; empty means they have no chart yet):
${contextText || "(No chart data — the user hasn't created a birth chart, or is a guest.)"}

Recent conversation:
${historyText || "(none)"}

User's question: ${question}

Rules:
- Answer in English. Ground your answer in the data above: cite their actual pillars, element strengths, Day Master, favorable/avoided elements, name suggestions or match scores when relevant. Never invent chart data that isn't provided.
- You may also answer questions about how to use this app (charts, Chinese naming, matching, binding rules, real-user chat, blocking, admin features).
- If they have no chart data and the question needs it, first guide them to create their chart in the Chart tab, then answer the general part.
- Do NOT make fate assertions ("you will definitely…", "this person is your destined…"). Use "traditionally interpreted as", "tends to", "for reference".
- Keep it focused: 2–5 short paragraphs or a short list. Plain text only, no markdown headings.`
          : `你是「Destiny Atlas」里的「AI 命理助手」，身份是 AI（不是真人）。请结合下面这位用户在应用内的真实数据，具体、有依据地回答问题。

${appFacts}

这位用户的数据（为空表示还没建档，或是访客）：
${contextText || "（暂无命盘数据：用户尚未建立命盘档案，或是未登录访客。）"}

最近的对话：
${historyText || "（无）"}

用户的问题：${question}

要求：
- 用中文回答。回答要有依据：引用他本人的四柱、五行力量、日主强弱与喜忌、星座生肖、起名结果或合盘分数，不要编造数据里没有的命盘信息。
- 也可以回答 app 使用类问题（排盘、起名、匹配筛选、绑定规则、真实用户聊天、拉黑、后台功能等）。
- 如果对方没有命盘数据而问题又需要命盘，先引导他去「命盘」页签建立档案，再回答能通用的部分。
- 不要做命运断言（不说「你一定会」「注定」之类），用「传统解读里」「倾向于」「供参考」这类表述。
- 篇幅 2–5 个短段落或短列表即可，纯文本，不要用 markdown 标题。`;
        const result = await ctx.inference.complete(prompt, {
          schema: z.object({ answer: z.string().min(1).max(4000) }),
        });
        answer = result.answer.trim();
      } catch {
        answer = "";
      }
      if (!answer) {
        // 模型不可用时的兜底：直接用用户自己的命盘数据做一段确定性解读
        answer = hasProfile
          ? L(
              lang,
              `助手这会儿没能生成完整回答，先把你的命盘要点摆出来供参考：${chartSummaryZh}。你可以换个问法再问我，比如「我的喜用神对起名有什么影响」或「我和候选人的合盘该怎么看」。`,
              `The assistant couldn't compose a full answer just now — here are the key points of your own chart for reference: ${chartSummaryZh}. Try asking again, e.g. "How do my favorable elements affect naming?" or "How should I read my match scores?"`,
            )
          : L(
              lang,
              "助手这会儿没能生成完整回答。先给你一个通用建议：到「命盘」页签填入出生日期与时间建立你的命盘，之后再问我，我就能结合你的四柱、五行与喜忌来具体回答了。",
              "The assistant couldn't compose a full answer just now. A good first step: open the Chart tab and enter your birth date and time to cast your chart — after that I can answer using your actual pillars, elements and favorable elements.",
            );
      }
      if (!answer.includes("娱乐参考") && !answer.includes("entertainment")) {
        answer = `${answer}\n\n${disclaimer}`;
      }

      await db.batch([
        db.insert(schema.aiMessages).values({ userKey: key, role: "user", content: question }),
        db.insert(schema.aiMessages).values({ userKey: key, role: "assistant", content: answer }),
      ]);
      if (u) await touchActivity(ctx, u);
      ctx.invalidateQueries();
      return { ok: true, message: "", answer, hasProfile };
    },
  }),

  /* ================= 后台管理（仅管理员） ================= */

  /**
   * 服务间管理调用（2026-11-08）。
   *
   * TalkFirst 后台用它读起名站的数据、改站点设置。鲉权是一条**共享密钥**
   * （BAZI_SERVICE_SECRET，只存在于两台服务器的环境变量里，不进客户端）。
   * 校验通过后临时借一个管理员会话去跑白名单动作 —— 不绕过 requireAdmin，
   * 也不给服务调用开任何后门；会话用完即删。
   */
  serviceAdmin: defineAction({
    description: "服务间管理调用（仅 TalkFirst 后台）。",
    request: z.object({
      secret: z.string(),
      action: z.string(),
      args: z.record(z.string(), z.unknown()).default({}),
    }),
    response: z.object({ ok: z.boolean(), message: z.string().optional(), data: z.unknown() }),
    async handler(ctx, args) {
      const expected = process.env.BAZI_SERVICE_SECRET ?? "";
      if (!expected || args.secret !== expected) {
        return { ok: false, message: "forbidden", data: null };
      }
      /*
       * 白名单：TalkFirst 后台需要哪些就开哪些（账号管理 → 内容管理 → 设置）。
       * 没列的仍然走不通 —— 这是「服务调用能干什么」的唯一边界。
       */
      const allowed = new Set([
        "adminOverview",
        "adminGetSettings",
        "adminSaveSettings",
        "adminListUsers",
        "adminGetUserDetail",
        "adminSetUserStatus",
        "adminSetUserRole",
        "adminResetUserPassword",
        "adminDeleteUser",
        "adminListAllCandidates",
        "adminUpdateCandidate",
        "adminDeleteCandidate",
        "adminDeleteProfile",
        "adminListAllBindings",
        "adminDeleteBinding",
        "adminListAllConversations",
        "adminListMessages",
        "adminDeleteConversation",
        "adminDeleteMessage",
        "adminListDmConversations",
        "adminListDmMessages",
        "adminDeleteDmMessage",
        "adminDeleteDmConversation",
      ]);
      if (!allowed.has(args.action)) {
        return { ok: false, message: "action not allowed", data: null };
      }

      /*
       * 用服务身份跑，不建临时账号：后台概览在空库时就是 0 个用户，不会把自己算进去。
       * 标记只对这一轮调用有效，结束就撤掉。
       */
      const sharedCtx = ctx as unknown as { serviceAdmin?: boolean };
      sharedCtx.serviceAdmin = true;
      try {
        const action = (Actions as unknown as Record<
          string,
          { handler: (ctx: Ctx, input: Record<string, unknown>) => Promise<unknown> }
        >)[args.action];
        if (!action?.handler) return { ok: false, message: "unknown action", data: null };
        const data = await action.handler(ctx, {
          ...(args.args as Record<string, unknown>),
          token: SERVICE_TOKEN,
        });
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "failed",
          data: null,
        };
      } finally {
        sharedCtx.serviceAdmin = false;
      }
    },
  }),

  adminGetSettings: defineAction({
    description: "后台：读取完整站点设置（含管理员备忘、注册开关），仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({ settings: settingsOutSchema }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      return { settings: await getSettings(ctx) };
    },
  }),

  adminSaveSettings: defineAction({
    description: "后台：保存站点设置（标题、公告、绑定上限、互斥与注册开关），即时对全站生效，仅管理员。",
    request: z.object({
      ...tokenField,
      siteTitle: z.string().min(1).max(40),
      siteSubtitle: z.string().max(80),
      announcement: z.string().max(300),
      friendLimit: z.number().int().min(1).max(50),
      loverLimit: z.number().int().min(1).max(10),
      partnerLimit: z.number().int().min(1).max(10),
      enforceExclusivity: z.boolean(),
      allowRegistration: z.boolean(),
      adminNote: z.string().max(500),
    }),
    response: z.object({ settings: settingsOutSchema }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const values = {
        id: 1,
        siteTitle: args.siteTitle,
        siteSubtitle: args.siteSubtitle,
        announcement: args.announcement,
        friendLimit: args.friendLimit,
        loverLimit: args.loverLimit,
        partnerLimit: args.partnerLimit,
        enforceExclusivity: args.enforceExclusivity ? 1 : 0,
        allowRegistration: args.allowRegistration ? 1 : 0,
        adminNote: args.adminNote,
      };
      await db.insert(schema.siteSettings).values(values).onConflictDoUpdate({
        target: schema.siteSettings.id,
        set: { ...values, updatedAt: new Date() },
      });
      ctx.invalidateQueries();
      return { settings: await getSettings(ctx) };
    },
  }),

  adminOverview: defineAction({
    description: "后台：全站概览统计——注册用户数、各表计数、性别/星座/生肖/日主分布、特质热度、年龄段、绑定与聊天分布、最近动态，仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      hasProfile: z.boolean(),
      profileName: z.string().nullable(),
      totalUsers: z.number(),
      activeUsers: z.number(),
      disabledUsers: z.number(),
      adminUsers: z.number(),
      newUsersToday: z.number(),
      totalCandidates: z.number(),
      totalBindings: z.number(),
      bindingsByType: z.object({ friend: z.number(), lover: z.number(), partner: z.number() }),
      totalConversations: z.number(),
      totalMessages: z.number(),
      messagesBySender: z.object({ me: z.number(), them: z.number() }),
      messagesToday: z.number(),
      candidatesToday: z.number(),
      genderCounts: z.object({ male: z.number(), female: z.number() }),
      zodiacCounts: z.array(z.object({ name: z.string(), count: z.number() })),
      animalCounts: z.array(z.object({ name: z.string(), count: z.number() })),
      dayMasterCounts: z.array(z.object({ name: z.string(), count: z.number() })),
      traitCounts: z.array(z.object({ name: z.string(), count: z.number() })),
      ageBuckets: z.array(z.object({ name: z.string(), count: z.number() })),
      completeCharts: z.number(),
      incompleteCharts: z.number(),
      recentCandidates: z.array(z.object({ id: z.number(), name: z.string(), zodiacSign: z.string(), age: z.number(), createdAt: z.string() })),
      recentMessages: z.array(z.object({ id: z.number(), conversationId: z.number(), candidateName: z.string(), sender: z.enum(["me", "them"]), content: z.string(), createdAt: z.string() })),
      recentBindings: z.array(z.object({ id: z.number(), relationType: relationEnum, targetName: z.string(), createdAt: z.string() })),
      avgMessagesPerConversation: z.number(),
      boundCandidateCount: z.number(),
      chattedCandidateCount: z.number(),
    }),
    async handler(ctx, args) {
      const admin = await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [users, profs, cands, binds, convs, msgs, dmConvs, dmMsgs] = await Promise.all([
        db.select().from(schema.users),
        db.select().from(schema.profiles),
        db.select().from(schema.candidates).orderBy(desc(schema.candidates.id)),
        db.select().from(schema.bindings).orderBy(desc(schema.bindings.id)),
        db.select().from(schema.conversations),
        db.select().from(schema.messages).orderBy(desc(schema.messages.id)),
        db.select().from(schema.directConversations),
        db.select().from(schema.directMessages),
      ]);
      const todayStr = new Date().toDateString();
      const countMap = (names: string[]) => {
        const m = new Map<string, number>();
        names.forEach((n) => m.set(n, (m.get(n) ?? 0) + 1));
        return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      };
      const charts = cands.map((c) => computeChart({ birthDate: c.birthDate, birthTime: c.birthTime }));
      const convName = new Map(convs.map((c) => [c.id, c.candidateName]));
      const ages = cands.map((c) => ageOf(c.birthDate));
      const bucket = (a: number) => (a < 20 ? "20岁以下" : a < 25 ? "20-24岁" : a < 30 ? "25-29岁" : a < 35 ? "30-34岁" : a < 40 ? "35-39岁" : "40岁以上");
      const myProf = profs.find((p) => p.userId === admin.id);
      return {
        hasProfile: !!myProf,
        profileName: myProf?.name ?? null,
        totalUsers: users.length,
        activeUsers: users.filter((x) => x.status === "active").length,
        disabledUsers: users.filter((x) => x.status === "disabled").length,
        adminUsers: users.filter((x) => x.role === "admin").length,
        newUsersToday: users.filter((x) => x.createdAt.toDateString() === todayStr).length,
        totalCandidates: cands.length,
        totalBindings: binds.length,
        bindingsByType: {
          friend: binds.filter((b) => b.relationType === "friend").length,
          lover: binds.filter((b) => b.relationType === "lover").length,
          partner: binds.filter((b) => b.relationType === "partner").length,
        },
        totalConversations: convs.length + dmConvs.length,
        totalMessages: msgs.length + dmMsgs.length,
        messagesBySender: { me: msgs.filter((m) => m.sender === "me").length + dmMsgs.length, them: msgs.filter((m) => m.sender === "them").length },
        messagesToday: msgs.filter((m) => m.createdAt.toDateString() === todayStr).length + dmMsgs.filter((m) => m.createdAt.toDateString() === todayStr).length,
        candidatesToday: cands.filter((c) => c.createdAt.toDateString() === todayStr).length,
        genderCounts: { male: cands.filter((c) => c.gender === "male").length, female: cands.filter((c) => c.gender === "female").length },
        zodiacCounts: countMap(charts.map((c) => c.zodiacSign)),
        animalCounts: countMap(charts.map((c) => `属${c.zodiacAnimal}`)),
        dayMasterCounts: countMap(charts.map((c) => `${c.dayMaster}${c.dayMasterElement}`)),
        traitCounts: countMap(cands.flatMap((c) => { try { const p: unknown = JSON.parse(c.traits); return Array.isArray(p) ? p.filter((t): t is string => typeof t === "string") : []; } catch { return []; } })),
        ageBuckets: countMap(ages.map(bucket)),
        completeCharts: charts.filter((c) => c.chartComplete).length,
        incompleteCharts: charts.filter((c) => !c.chartComplete).length,
        recentCandidates: cands.slice(0, 8).map((c, i) => ({ id: c.id, name: c.name, zodiacSign: charts[i]?.zodiacSign ?? "", age: ageOf(c.birthDate), createdAt: c.createdAt.toISOString() })),
        recentMessages: msgs.slice(0, 10).map((m) => ({ id: m.id, conversationId: m.conversationId, candidateName: convName.get(m.conversationId) ?? "—", sender: m.sender, content: m.content.slice(0, 120), createdAt: m.createdAt.toISOString() })),
        recentBindings: binds.slice(0, 8).map((b) => ({ id: b.id, relationType: b.relationType, targetName: b.targetName, createdAt: b.createdAt.toISOString() })),
        avgMessagesPerConversation: convs.length + dmConvs.length ? Math.round(((msgs.length + dmMsgs.length) / (convs.length + dmConvs.length)) * 10) / 10 : 0,
        boundCandidateCount: new Set(binds.map((b) => b.targetId).filter((x) => x != null)).size,
        chattedCandidateCount: new Set(convs.map((c) => c.candidateId)).size,
      };
    },
  }),

  adminListUsers: defineAction({
    description: "后台：列出全部注册用户及每人的数据量（档案名、候选人/绑定/会话/消息数），仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      users: z.array(
        userOutSchema.extend({
          profileName: z.string().nullable(),
          candidateCount: z.number(),
          bindingCount: z.number(),
          conversationCount: z.number(),
          messageCount: z.number(),
        }),
      ),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [users, profs, cands, binds, convs, msgs, dmConvs, dmMsgs] = await Promise.all([
        db.select().from(schema.users).orderBy(asc(schema.users.id)),
        db.select().from(schema.profiles),
        db.select().from(schema.candidates),
        db.select().from(schema.bindings),
        db.select().from(schema.conversations),
        db.select().from(schema.messages),
        db.select().from(schema.directConversations),
        db.select().from(schema.directMessages),
      ]);
      const convOwner = new Map(convs.map((c) => [c.id, c.userId]));
      return {
        users: users.map((u) => ({
          ...userOut(u),
          profileName: profs.find((p) => p.userId === u.id)?.name ?? null,
          candidateCount: cands.filter((c) => c.userId === u.id).length,
          bindingCount: binds.filter((b) => b.userId === u.id).length,
          conversationCount: convs.filter((c) => c.userId === u.id).length + dmConvs.filter((c) => c.userAId === u.id || c.userBId === u.id).length,
          messageCount: msgs.filter((m) => convOwner.get(m.conversationId) === u.id).length + dmMsgs.filter((m) => m.senderId === u.id).length,
        })),
      };
    },
  }),

  adminGetUserDetail: defineAction({
    description: "后台：查看某个注册用户的明细——命理档案摘要、候选人名单、绑定名单、会话数，仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive() }),
    response: z.object({
      ok: z.boolean(),
      message: z.string(),
      user: userOutSchema.nullable(),
      profile: profileOutSchema.nullable(),
      candidates: z.array(candidateOutSchema),
      bindings: z.array(z.object({ id: z.number(), relationType: relationEnum, targetName: z.string(), createdAt: z.string() })),
      conversationCount: z.number(),
      messageCount: z.number(),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const uRows = await db.select().from(schema.users).where(eq(schema.users.id, args.userId)).limit(1);
      const u = uRows[0];
      if (!u) return { ok: false, message: "用户不存在。", user: null, profile: null, candidates: [], bindings: [], conversationCount: 0, messageCount: 0 };
      const [profs, cands, binds, convs, dmConvs, dmMsgs] = await Promise.all([
        db.select().from(schema.profiles).where(eq(schema.profiles.userId, u.id)).limit(1),
        db.select().from(schema.candidates).where(eq(schema.candidates.userId, u.id)).orderBy(desc(schema.candidates.id)),
        db.select().from(schema.bindings).where(eq(schema.bindings.userId, u.id)).orderBy(asc(schema.bindings.id)),
        db.select().from(schema.conversations).where(eq(schema.conversations.userId, u.id)),
        db.select().from(schema.directConversations),
        db.select().from(schema.directMessages),
      ]);
      const convIds = convs.map((c) => c.id);
      const msgs = convIds.length ? await db.select().from(schema.messages).where(inArray(schema.messages.conversationId, convIds)) : [];
      const myDmConvs = dmConvs.filter((c) => c.userAId === u.id || c.userBId === u.id);
      const myDmMsgs = dmMsgs.filter((m) => m.senderId === u.id);
      const prof = profs[0];
      return {
        ok: true,
        message: "",
        user: userOut(u),
        profile: prof ? profileOut(prof) : null,
        candidates: cands.map(candidateOut),
        bindings: binds.map((b) => ({ id: b.id, relationType: b.relationType, targetName: b.targetName, createdAt: b.createdAt.toISOString() })),
        conversationCount: convs.length + myDmConvs.length,
        messageCount: msgs.length + myDmMsgs.length,
      };
    },
  }),

  adminSetUserStatus: defineAction({
    description: "后台：启用或停用一个注册用户（停用后立即无法登录、现有会话失效），不能停用自己，仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive(), status: z.enum(["active", "disabled"]) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const admin = await requireAdmin(ctx, args.token);
      if (admin.id === args.userId) return { ok: false, message: "不能停用自己的账号。" };
      const db = ctx.db<typeof schema>();
      await db.update(schema.users).set({ status: args.status }).where(eq(schema.users.id, args.userId));
      if (args.status === "disabled") {
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, args.userId));
      }
      ctx.invalidateQueries();
      return { ok: true, message: args.status === "disabled" ? "已停用该用户，其登录会话已注销。" : "已启用该用户。" };
    },
  }),

  adminSetUserRole: defineAction({
    description: "后台：把用户设为管理员或普通用户，不能修改自己的角色，仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive(), role: z.enum(["admin", "user"]) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const admin = await requireAdmin(ctx, args.token);
      if (admin.id === args.userId) return { ok: false, message: "不能修改自己的角色。" };
      const db = ctx.db<typeof schema>();
      await db.update(schema.users).set({ role: args.role }).where(eq(schema.users.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true, message: args.role === "admin" ? "已设为管理员。" : "已设为普通用户。" };
    },
  }),

  adminResetUserPassword: defineAction({
    description: "后台：为指定用户重置密码并注销其全部会话，仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive(), newPassword: z.string().min(6).max(64) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const salt = randomHex(16);
      const passwordHash = await hashPassword(args.newPassword, salt);
      await db.update(schema.users).set({ passwordHash, salt }).where(eq(schema.users.id, args.userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, args.userId));
      ctx.invalidateQueries();
      return { ok: true, message: "密码已重置，该用户的全部登录会话已注销。" };
    },
  }),

  adminDeleteUser: defineAction({
    description: "后台：删除一个注册用户及其全部数据（档案、候选人、绑定、聊天、会话），不能删除自己，仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const admin = await requireAdmin(ctx, args.token);
      if (admin.id === args.userId) return { ok: false, message: "不能删除自己的账号。" };
      const db = ctx.db<typeof schema>();
      /* 先确认目标存在：否则对一个不存在的 id 也会回「已删除」，后台看着像成功了。 */
      const target = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, args.userId))
        .limit(1);
      if (!target[0]) return { ok: false, message: "用户不存在（可能已被删除）。" };
      await deleteUserData(ctx, args.userId);
      await db.delete(schema.users).where(eq(schema.users.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true, message: "用户及其全部数据已删除。" };
    },
  }),

  adminUpdateCandidate: defineAction({
    description: "后台：编辑任意一位候选人的全部档案，并同步其所属用户的会话与绑定中的姓名，仅管理员。",
    request: personInput.extend({
      ...tokenField,
      id: z.number().int().positive(),
      traits: z.array(z.string().max(10)).max(12).default([]),
      notes: z.string().max(200).default(""),
    }),
    response: z.object({ candidate: candidateOutSchema }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const rows0 = await db.select().from(schema.candidates).where(eq(schema.candidates.id, args.id)).limit(1);
      const owner = rows0[0];
      if (!owner) throw new Error("候选人不存在。");
      await db.update(schema.candidates).set({
        name: args.name, gender: args.gender, birthDate: args.birthDate, birthTime: args.birthTime ?? null,
        traits: JSON.stringify(args.traits), notes: args.notes,
      }).where(eq(schema.candidates.id, args.id));
      await db.update(schema.conversations).set({ candidateName: args.name })
        .where(and(eq(schema.conversations.candidateId, args.id), eq(schema.conversations.userId, owner.userId)));
      await db.update(schema.bindings).set({ targetName: args.name })
        .where(and(eq(schema.bindings.targetId, args.id), eq(schema.bindings.userId, owner.userId)));
      const rows = await db.select().from(schema.candidates).where(eq(schema.candidates.id, args.id)).limit(1);
      const row = rows[0];
      if (!row) throw new Error("adminUpdateCandidate: candidate missing");
      ctx.invalidateQueries();
      return { candidate: candidateOut(row) };
    },
  }),

  adminListAllCandidates: defineAction({
    description: "后台：列出全站所有用户的候选人（含所属用户名），供后台统一管理，仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      candidates: z.array(candidateOutSchema.extend({ ownerId: z.number(), ownerName: z.string() })),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [rows, users] = await Promise.all([
        db.select().from(schema.candidates).orderBy(desc(schema.candidates.id)),
        db.select().from(schema.users),
      ]);
      const nameMap = new Map(users.map((u) => [u.id, u.username]));
      return {
        candidates: rows.map((r) => ({ ...candidateOut(r), ownerId: r.userId, ownerName: nameMap.get(r.userId) ?? (r.userId === 0 ? "（未归属）" : "未知用户") })),
      };
    },
  }),

  adminListAllBindings: defineAction({
    description: "后台：列出全站所有绑定（含所属用户名），仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      bindings: z.array(z.object({
        id: z.number(), relationType: relationEnum, targetId: z.number().nullable(), targetName: z.string(),
        ownerId: z.number(), ownerName: z.string(), createdAt: z.string(),
      })),
      limits: z.object({ friend: z.number(), lover: z.number(), partner: z.number() }),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [rows, users] = await Promise.all([
        db.select().from(schema.bindings).orderBy(asc(schema.bindings.id)),
        db.select().from(schema.users),
      ]);
      const nameMap = new Map(users.map((u) => [u.id, u.username]));
      return {
        bindings: rows.map((r) => ({
          id: r.id, relationType: r.relationType, targetId: r.targetId, targetName: r.targetName,
          ownerId: r.userId, ownerName: nameMap.get(r.userId) ?? "（未归属）", createdAt: r.createdAt.toISOString(),
        })),
        limits: await getLimits(ctx),
      };
    },
  }),

  adminListAllConversations: defineAction({
    description: "后台：列出全站所有会话（含所属用户名、消息数与最近消息），仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      conversations: z.array(z.object({
        id: z.number(), candidateId: z.number(), candidateName: z.string(),
        ownerId: z.number(), ownerName: z.string(),
        lastMessage: z.string().nullable(), lastAt: z.string().nullable(), messageCount: z.number(),
      })),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [convs, users] = await Promise.all([
        db.select().from(schema.conversations),
        db.select().from(schema.users),
      ]);
      const nameMap = new Map(users.map((u) => [u.id, u.username]));
      const out = [];
      for (const conv of convs) {
        const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(desc(schema.messages.id));
        const last = msgs[0];
        out.push({
          id: conv.id, candidateId: conv.candidateId, candidateName: conv.candidateName,
          ownerId: conv.userId, ownerName: nameMap.get(conv.userId) ?? "（未归属）",
          lastMessage: last ? last.content : null,
          lastAt: last ? last.createdAt.toISOString() : conv.updatedAt.toISOString(),
          messageCount: msgs.length,
        });
      }
      out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
      return { conversations: out };
    },
  }),

  adminListMessages: defineAction({
    description: "后台：查看任意会话的全部消息（可按关键词在客户端过滤），仅管理员。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({
      messages: z.array(z.object({ id: z.number(), sender: z.enum(["me", "them"]), content: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, args.conversationId)).orderBy(asc(schema.messages.id));
      return { messages: msgs.map((m) => ({ id: m.id, sender: m.sender, content: m.content, createdAt: m.createdAt.toISOString() })) };
    },
  }),

  /**
   * 后台：删除任意用户的候选人（连带其绑定、会话与消息），2026-11-08。
   *
   * 与用户自己调 `deleteCandidate` 走同一个级联函数 —— 后台不应该有一套自己的
   * 「删除顺序」，否则两边很容易出现删到一半的孤儿数据。
   */
  adminDeleteCandidate: defineAction({
    description: "后台：删除任意用户的候选人及其绑定、会话与消息，仅管理员。",
    request: z.object({ ...tokenField, candidateId: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.candidates)
        .where(eq(schema.candidates.id, args.candidateId))
        .limit(1);
      const candidate = rows[0];
      if (!candidate) return { ok: false, message: "候选人不存在（可能已被删除）。" };
      await deleteCandidateCascade(ctx, candidate.userId, candidate.id);
      ctx.invalidateQueries();
      return { ok: true, message: "候选人及其绑定、聊天已删除。" };
    },
  }),

  /** 后台：解除任意一条关系绑定，2026-11-08。 */
  adminDeleteBinding: defineAction({
    description: "后台：解除任意一条关系绑定，仅管理员。",
    request: z.object({ ...tokenField, bindingId: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.bindings)
        .where(eq(schema.bindings.id, args.bindingId))
        .limit(1);
      if (!rows[0]) return { ok: false, message: "绑定不存在（可能已被解除）。" };
      await db.delete(schema.bindings).where(eq(schema.bindings.id, args.bindingId));
      ctx.invalidateQueries();
      return { ok: true, message: "已解除绑定。" };
    },
  }),

  adminDeleteProfile: defineAction({
    description: "后台：删除指定用户的命理档案（其候选人/绑定/聊天不受影响），仅管理员。",
    request: z.object({ ...tokenField, userId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.profiles).where(eq(schema.profiles.userId, args.userId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminDeleteConversation: defineAction({
    description: "后台：删除任意一个会话及其全部消息，仅管理员。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.batch([
        db.delete(schema.messages).where(eq(schema.messages.conversationId, args.conversationId)),
        db.delete(schema.conversations).where(eq(schema.conversations.id, args.conversationId)),
      ]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminDeleteMessage: defineAction({
    description: "后台：删除任意单条聊天消息，仅管理员。",
    request: z.object({ ...tokenField, messageId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.messages).where(eq(schema.messages.id, args.messageId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminListDmConversations: defineAction({
    description: "后台：列出全站真实用户私聊会话（双方用户名、消息数与最近消息），供聊天管理，仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      conversations: z.array(z.object({
        id: z.number(), userAId: z.number(), userAName: z.string(), userBId: z.number(), userBName: z.string(),
        lastMessage: z.string().nullable(), lastAt: z.string().nullable(), messageCount: z.number(),
      })),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [convs, users] = await Promise.all([
        db.select().from(schema.directConversations),
        db.select().from(schema.users),
      ]);
      const nameMap = new Map(users.map((u) => [u.id, u.username]));
      const out = [];
      for (const conv of convs) {
        const msgs = await db.select().from(schema.directMessages).where(eq(schema.directMessages.conversationId, conv.id)).orderBy(desc(schema.directMessages.id));
        const last = msgs[0];
        out.push({
          id: conv.id,
          userAId: conv.userAId, userAName: nameMap.get(conv.userAId) ?? "（已注销）",
          userBId: conv.userBId, userBName: nameMap.get(conv.userBId) ?? "（已注销）",
          lastMessage: last ? last.content : null,
          lastAt: last ? last.createdAt.toISOString() : conv.updatedAt.toISOString(),
          messageCount: msgs.length,
        });
      }
      out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
      return { conversations: out };
    },
  }),

  adminListDmMessages: defineAction({
    description: "后台：查看某个真实用户私聊会话的全部消息（含发送者用户名），仅管理员。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({
      messages: z.array(z.object({ id: z.number(), senderId: z.number(), senderName: z.string(), content: z.string(), createdAt: z.string() })),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [msgs, users] = await Promise.all([
        db.select().from(schema.directMessages).where(eq(schema.directMessages.conversationId, args.conversationId)).orderBy(asc(schema.directMessages.id)),
        db.select().from(schema.users),
      ]);
      const nameMap = new Map(users.map((u) => [u.id, u.username]));
      return {
        messages: msgs.map((m) => ({
          id: m.id, senderId: m.senderId, senderName: nameMap.get(m.senderId) ?? "（已注销）",
          content: m.content, createdAt: m.createdAt.toISOString(),
        })),
      };
    },
  }),

  adminDeleteDmMessage: defineAction({
    description: "后台：删除真实用户私聊中的任意单条消息，仅管理员。",
    request: z.object({ ...tokenField, messageId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.directMessages).where(eq(schema.directMessages.id, args.messageId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminDeleteDmConversation: defineAction({
    description: "后台：删除一个真实用户私聊会话及其全部消息与已读记录，仅管理员。",
    request: z.object({ ...tokenField, conversationId: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.batch([
        db.delete(schema.directMessages).where(eq(schema.directMessages.conversationId, args.conversationId)),
        db.delete(schema.directReads).where(eq(schema.directReads.conversationId, args.conversationId)),
        db.delete(schema.directConversations).where(eq(schema.directConversations.id, args.conversationId)),
      ]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminUnbind: defineAction({
    description: "后台：解除任意一条绑定，仅管理员。",
    request: z.object({ ...tokenField, id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      await db.delete(schema.bindings).where(eq(schema.bindings.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  adminBulkDeleteCandidates: defineAction({
    description: "后台：批量删除候选人，并连带删除其所属用户的相关绑定、会话与消息，仅管理员。",
    request: z.object({ ...tokenField, ids: z.array(z.number().int().positive()).min(1).max(100) }),
    response: z.object({ ok: z.literal(true), deleted: z.number() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.candidates).where(inArray(schema.candidates.id, args.ids));
      for (const r of rows) {
        await deleteCandidateCascade(ctx, r.userId, r.id);
      }
      ctx.invalidateQueries();
      return { ok: true as const, deleted: rows.length };
    },
  }),

  adminExportData: defineAction({
    description: "后台：导出全站数据（用户名单不含密码、档案、候选人、绑定、会话、消息、设置）为 JSON 文本，供备份，仅管理员。",
    request: z.object({ ...tokenField }),
    response: z.object({
      json: z.string(),
      exportedAt: z.string(),
      counts: z.object({ users: z.number(), candidates: z.number(), bindings: z.number(), conversations: z.number(), messages: z.number() }),
    }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      const [users, profs, cands, binds, convs, msgs, dmConvs, dmMsgs] = await Promise.all([
        db.select().from(schema.users), db.select().from(schema.profiles), db.select().from(schema.candidates),
        db.select().from(schema.bindings), db.select().from(schema.conversations), db.select().from(schema.messages),
        db.select().from(schema.directConversations), db.select().from(schema.directMessages),
      ]);
      const settings = await getSettings(ctx);
      const payload = {
        app: "星座八字匹配 Destiny Atlas",
        exportedAt: new Date().toISOString(),
        settings,
        users: users.map((u) => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt.toISOString(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null })),
        profiles: profs.map((p) => ({ userId: p.userId, name: p.name, gender: p.gender, birthDate: p.birthDate, birthTime: p.birthTime })),
        candidates: cands.map((c) => ({ id: c.id, userId: c.userId, name: c.name, gender: c.gender, birthDate: c.birthDate, birthTime: c.birthTime, traits: c.traits, notes: c.notes, createdAt: c.createdAt.toISOString() })),
        bindings: binds.map((b) => ({ id: b.id, userId: b.userId, relationType: b.relationType, targetId: b.targetId, targetName: b.targetName, createdAt: b.createdAt.toISOString() })),
        conversations: convs.map((c) => ({ id: c.id, userId: c.userId, candidateId: c.candidateId, candidateName: c.candidateName, createdAt: c.createdAt.toISOString() })),
        messages: msgs.map((m) => ({ id: m.id, conversationId: m.conversationId, sender: m.sender, content: m.content, createdAt: m.createdAt.toISOString() })),
        directConversations: dmConvs.map((c) => ({ id: c.id, userAId: c.userAId, userBId: c.userBId, createdAt: c.createdAt.toISOString() })),
        directMessages: dmMsgs.map((m) => ({ id: m.id, conversationId: m.conversationId, senderId: m.senderId, content: m.content, createdAt: m.createdAt.toISOString() })),
      };
      return {
        json: JSON.stringify(payload, null, 2),
        exportedAt: payload.exportedAt,
        counts: { users: users.length, candidates: cands.length, bindings: binds.length, conversations: convs.length + dmConvs.length, messages: msgs.length + dmMsgs.length },
      };
    },
  }),

  adminClearData: defineAction({
    description: "后台：按范围清空全站业务数据——chat 清空全部会话与消息，bindings 清空全部绑定，candidates 清空候选人及其关联，all 清空除用户账号与设置外的全部数据，仅管理员。",
    request: z.object({ ...tokenField, scope: z.enum(["chat", "bindings", "candidates", "all"]) }),
    response: z.object({ ok: z.literal(true), message: z.string() }),
    async handler(ctx, args) {
      await requireAdmin(ctx, args.token);
      const db = ctx.db<typeof schema>();
      if (args.scope === "chat" || args.scope === "all") {
        await db.batch([
          db.delete(schema.messages), db.delete(schema.conversations),
          db.delete(schema.directMessages), db.delete(schema.directReads), db.delete(schema.directConversations),
          db.delete(schema.aiMessages),
        ]);
      }
      if (args.scope === "bindings" || args.scope === "all") await db.delete(schema.bindings);
      if (args.scope === "candidates" || args.scope === "all") {
        if (args.scope === "candidates") {
          await db.batch([db.delete(schema.messages), db.delete(schema.conversations), db.delete(schema.bindings), db.delete(schema.candidates)]);
        } else {
          await db.delete(schema.candidates);
        }
      }
      if (args.scope === "all") await db.delete(schema.profiles);
      ctx.invalidateQueries();
      const labels: Record<string, string> = {
        chat: "全站聊天记录已清空。",
        bindings: "全站绑定已解除。",
        candidates: "全站候选库已清空（关联绑定与聊天一并删除）。",
        all: "全站业务数据已清空（用户账号与站点设置保留）。",
      };
      return { ok: true as const, message: labels[args.scope] ?? "已清空。" };
    },
  }),
} satisfies ActionsModule;

/* ---------------- 内部级联删除 ---------------- */

/** AI 助手身份键：登录用户按账号隔离；访客按本机随机键（guestKey）隔离。 */
async function aiUserKey(ctx: Ctx, token: string, guestKey: string): Promise<string | null> {
  const u = await userByToken(ctx, token);
  if (u) return `u${u.id}`;
  const g = (guestKey ?? "").trim();
  if (/^[A-Za-z0-9-]{8,64}$/.test(g)) return `guest:${g}`;
  return null;
}

const ELEM_ORDER_ZH = ["木", "火", "土", "金", "水"];

/** 组装 AI 助手的上下文：本人命盘要点 + 起名结果（前 3）+ 各关系下最佳合盘。 */
async function buildAiContext(
  ctx: Ctx,
  user: UserRow,
  lang: Lang,
): Promise<{ contextText: string; hasProfile: boolean; chartSummaryZh: string }> {
  const db = ctx.db<typeof schema>();
  const profRows = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).limit(1);
  const prof = profRows[0];
  if (!prof) return { contextText: "", hasProfile: false, chartSummaryZh: "" };
  const me = profileOut(prof);
  const ch = me.chart;
  const pillarsText = [ch.pillars.year.label, ch.pillars.month.label, ch.pillars.day.label, ch.pillars.hour?.label ?? "（时辰未知）"].join(" ");
  const elemsText = ELEM_ORDER_ZH.map((e, i) => `${e}${(ch.elements[i] ?? 0).toFixed(1)}`).join("、");
  const summaryZh =
    `${prof.name}，${prof.gender === "female" ? "女" : "男"}，${me.age} 岁，${ch.zodiacSign}（${ch.zodiacElement}），属${ch.zodiacAnimal}；` +
    `四柱 ${pillarsText}；日主 ${ch.dayMaster}${ch.dayMasterElement}，身${ch.strength}；五行力量 ${elemsText}；` +
    `喜用 ${ch.favorable.join("、") || "无"}，忌 ${ch.avoid.join("、") || "无"}${ch.chartComplete ? "" : "；未填出生时辰，时柱缺失"}`;
  const lines = [lang === "en" ? `User's own chart: ${summaryZh}` : `本人命盘：${summaryZh}`];

  // 起名结果（按当前命盘现算一批，取前 3 个）
  try {
    const { names } = generateChineseNames(ch, prof.gender, { batch: 0, lang });
    const top = names.slice(0, 3);
    if (top.length) {
      lines.push(
        (lang === "en" ? "Chinese name suggestions for this chart: " : "按此命盘生成的中文名（前 3）：") +
          top.map((n) => `${n.fullName}（${n.pinyin}）— ${n.meaningSummary}`).join("；"),
      );
    }
  } catch {
    /* 起名上下文可选，失败不影响问答 */
  }

  // 候选人合盘：每种关系取总分最高的一位
  const candRows = await db.select().from(schema.candidates).where(eq(schema.candidates.userId, user.id));
  if (candRows.length) {
    const cands = candRows.map(candidateOut);
    lines.push((lang === "en" ? "Candidates in their library: " : "候选库里的人：") +
      cands.slice(0, 12).map((c) => `${c.name}（${c.chart.zodiacSign}，属${c.chart.zodiacAnimal}，${c.age} 岁）`).join("、"));
    const rels: RelationType[] = ["friend", "lover", "partner"];
    for (const rel of rels) {
      let best: { name: string; total: number; verdict: string } | null = null;
      for (const c of cands) {
        const s = scorePair(ch, c.chart, {
          relationType: rel, myAge: me.age, theirAge: c.age,
          wants: [], theirTraits: c.traits, lang,
        });
        if (!best || s.total > best.total) best = { name: c.name, total: s.total, verdict: s.verdict };
      }
      if (best) {
        lines.push(
          lang === "en"
            ? `Best ${rel} match: ${best.name}, score ${best.total} — ${best.verdict}`
            : `按${REL_LABEL[rel]}测算最合拍：${best.name}，总分 ${best.total} — ${best.verdict}`,
        );
      }
    }
  }
  return { contextText: lines.join("\n"), hasProfile: true, chartSummaryZh: summaryZh };
}

async function deleteCandidateCascade(ctx: Ctx, userId: number, candidateId: number) {
  const db = ctx.db<typeof schema>();
  const convRows = await db.select().from(schema.conversations)
    .where(and(eq(schema.conversations.candidateId, candidateId), eq(schema.conversations.userId, userId)));
  const convIds = convRows.map((c) => c.id);
  if (convIds.length) {
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, convIds));
  }
  await db.batch([
    db.delete(schema.conversations).where(and(eq(schema.conversations.candidateId, candidateId), eq(schema.conversations.userId, userId))),
    db.delete(schema.bindings).where(and(eq(schema.bindings.targetId, candidateId), eq(schema.bindings.userId, userId))),
    db.delete(schema.candidates).where(and(eq(schema.candidates.id, candidateId), eq(schema.candidates.userId, userId))),
  ]);
}

async function deleteUserData(ctx: Ctx, userId: number) {
  const db = ctx.db<typeof schema>();
  const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.userId, userId));
  const convIds = convs.map((c) => c.id);
  if (convIds.length) {
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, convIds));
  }
  // 真实私聊：删掉与该用户相关的会话、消息、已读与拉黑记录
  const dmConvs = await db.select().from(schema.directConversations);
  const myDmIds = dmConvs.filter((c) => c.userAId === userId || c.userBId === userId).map((c) => c.id);
  if (myDmIds.length) {
    await db.batch([
      db.delete(schema.directMessages).where(inArray(schema.directMessages.conversationId, myDmIds)),
      db.delete(schema.directReads).where(inArray(schema.directReads.conversationId, myDmIds)),
      db.delete(schema.directConversations).where(inArray(schema.directConversations.id, myDmIds)),
    ]);
  }
  await db.batch([
    db.delete(schema.directReads).where(eq(schema.directReads.userId, userId)),
    db.delete(schema.userBlocks).where(eq(schema.userBlocks.blockerId, userId)),
    db.delete(schema.userBlocks).where(eq(schema.userBlocks.blockedId, userId)),
    db.delete(schema.aiMessages).where(eq(schema.aiMessages.userKey, `u${userId}`)),
    db.delete(schema.conversations).where(eq(schema.conversations.userId, userId)),
    db.delete(schema.bindings).where(eq(schema.bindings.userId, userId)),
    db.delete(schema.candidates).where(eq(schema.candidates.userId, userId)),
    db.delete(schema.profiles).where(eq(schema.profiles.userId, userId)),
    db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)),
  ]);
}
