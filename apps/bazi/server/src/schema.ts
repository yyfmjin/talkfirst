// Drizzle schema for 星座八字匹配.
// profiles: the user's own birth profile (single row, id = 1).
// candidates: people the user wants to screen for compatibility.
// bindings: relationship bindings between the user and a candidate,
//           with per-relation limits enforced in the bind action.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  /**
   * TalkFirst 账号 id（2026-11-08 单点登录）。为空 = 本地用户名密码注册的账号。
   * 唯一性由启动时的 `CREATE UNIQUE INDEX` 保证（SQLite 允许多个 NULL）。
   */
  talkfirstId: text("talkfirst_id"),
  /**
   * 从 TalkFirst 同步过来的展示信息（2026-11-10）。
   *
   * 本应用不再有自己的注册/登录，账号只有 TalkFirst 一个来源；
   * 这四列只是把 App 那边已经填好的资料带过来显示，避免用户在这里再填一遍。
   * 每次 SSO 登录都会覆盖刷新 —— 以 TalkFirst 为准。
   */
  nickname: text("nickname"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  tfBirthDate: text("tf_birth_date"),
  tfGender: text("tf_gender"),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  // 最近活跃时间：登录、心跳与聊天动作更新，用于真实在线状态计算
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().default(0),
  name: text("name").notNull(),
  gender: text("gender", { enum: ["male", "female"] }).notNull(),
  birthDate: text("birth_date").notNull(), // YYYY-MM-DD (公历, Asia/Shanghai)
  birthTime: text("birth_time"), // HH:MM or null when the hour is unknown
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const candidates = sqliteTable("candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().default(0),
  name: text("name").notNull(),
  gender: text("gender", { enum: ["male", "female"] }).notNull(),
  birthDate: text("birth_date").notNull(),
  birthTime: text("birth_time"),
  traits: text("traits").notNull().default("[]"), // JSON array of trait tags
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().default(0),
  candidateId: integer("candidate_id").notNull().unique(),
  candidateName: text("candidate_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  sender: text("sender", { enum: ["me", "them"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  siteTitle: text("site_title").notNull().default("Destiny Atlas"),
  siteSubtitle: text("site_subtitle").notNull().default("星座 · 八字 · 五行 —— 遇见合拍的人"),
  announcement: text("announcement").notNull().default(""),
  friendLimit: integer("friend_limit").notNull().default(10),
  loverLimit: integer("lover_limit").notNull().default(1),
  partnerLimit: integer("partner_limit").notNull().default(1),
  enforceExclusivity: integer("enforce_exclusivity").notNull().default(1), // 1=恋人/伴侣互斥
  allowRegistration: integer("allow_registration").notNull().default(1), // 1=开放注册
  adminNote: text("allow_registration_note").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const bindings = sqliteTable("bindings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().default(0),
  relationType: text("relation_type", {
    enum: ["friend", "lover", "partner"],
  }).notNull(),
  targetType: text("target_type", { enum: ["candidate"] }).notNull(),
  targetId: integer("target_id"),
  targetName: text("target_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ---------------- 真实用户聊天（注册用户之间） ---------------- */

// 两位注册用户之间的私聊会话：user_a_id < user_b_id 规范化存储，唯一一对一条。
export const directConversations = sqliteTable("direct_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userAId: integer("user_a_id").notNull(),
  userBId: integer("user_b_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const directMessages = sqliteTable("direct_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// 每人每会话的已读位置：last_read_message_id 之后、且不是本人发的消息计未读。
export const directReads = sqliteTable("direct_reads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  userId: integer("user_id").notNull(),
  lastReadMessageId: integer("last_read_message_id").notNull().default(0),
});

// 拉黑：blocker 拉黑 blocked 后，blocked 不能再向 blocker 发起/发送消息。
export const userBlocks = sqliteTable("user_blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  blockerId: integer("blocker_id").notNull(),
  blockedId: integer("blocked_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/* ---------------- AI 命理助手 ---------------- */

// 助手对话记录：user_key 为 "u<用户id>"（登录用户）或 "guest:<本机随机键>"（访客）。
export const aiMessages = sqliteTable("ai_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userKey: text("user_key").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
