// standalone.ts — 独立运行时入口（不依赖 Muse 环境）
//
// 职责：
//   1. 静态托管 client/dist，SPA 回退到 index.html。
//   2. POST /actions 按 Muse 客户端协议分发到 server/src/actions.ts 的动作：
//      请求 {action, args}，成功返回 {data}，失败返回 {error}（HTTP 200）。
//   3. 为动作组装一个最小 Ctx shim（见下方说明）。
//
// 环境变量：
//   PORT   监听端口，默认 3000
//   DB_PATH SQLite 数据库文件路径，默认 ./app.db（部署时请把该文件所在目录挂成持久卷）

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { ACTION_BRAND } from "@hatch/space-sdk";
import { Actions } from "./server/src/actions";
import * as schema from "./server/src/schema";

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || "./app.db";
const DIST_DIR = join(import.meta.dir, "client", "dist");

// ---------------------------------------------------------------------------
// 数据库：libsql 文件库 + drizzle。ctx.db<T>() 每次返回同一个实例即可，
// 动作代码只用到 select/insert/update/delete/run/all/get/batch。
// ---------------------------------------------------------------------------
// 首次启动播种：DB_PATH 处还没有数据库、但包里带了现有 app.db 时，自动拷过去，
// 免去部署时手工往数据卷里放库；已有数据库则绝不覆盖。
const bundledDb = join(import.meta.dir, "app.db");
if (!existsSync(DB_PATH) && existsSync(bundledDb) && resolve(DB_PATH) !== resolve(bundledDb)) {
  mkdirSync(dirname(resolve(DB_PATH)), { recursive: true });
  copyFileSync(bundledDb, DB_PATH);
  console.log(`首次启动：已把包内现有数据库拷到 ${DB_PATH}`);
}

const libsql = createClient({ url: `file:${DB_PATH}` });
const db = drizzle(libsql, { schema });

// 平台数据卷（如 Railway Volume）多为 FUSE/网络挂载，不支持 WAL 依赖的共享内存
// 文件，WAL 模式下写读会卡死。启动时统一切回 DELETE 日志模式并设忙等待。
try {
  await libsql.execute("PRAGMA journal_mode=DELETE;");
  await libsql.execute("PRAGMA busy_timeout=5000;");
} catch (e) {
  console.error("设置 SQLite journal 模式失败（继续启动）：", e);
}

/*
 * 兼容旧库：TalkFirst 单点登录需要的列（2026-11-08）。
 *
 * 这个独立版不在启动时跑 drizzle 迁移（数据来自卷里已经存在的 app.db），
 * 所以新列必须在这里自己补 —— 幂等，已经有列就跳过。
 */
try {
  const info = await libsql.execute("PRAGMA table_info(users)");
  const columns = info.rows.map((row) => String((row as { name?: unknown }).name ?? ""));
  const ensure = async (name: string, ddl: string) => {
    if (columns.includes(name)) return;
    try {
      await libsql.execute(ddl);
      columns.push(name);
      console.log(`已为 users 表补上 ${name} 列`);
    } catch (error) {
      /* 并发启动时另一个进程可能刚加过：忽略，后面照常跑 */
      console.warn(`补 ${name} 列失败（可能已存在）：`, error);
    }
  };
  await ensure("talkfirst_id", "ALTER TABLE users ADD COLUMN talkfirst_id TEXT");
  // 2026-11-10：账号只认 TalkFirst，把它的资料一并带过来（昵称/邮箱/头像/生日/性别）。
  await ensure("nickname", "ALTER TABLE users ADD COLUMN nickname TEXT");
  await ensure("email", "ALTER TABLE users ADD COLUMN email TEXT");
  await ensure("avatar_url", "ALTER TABLE users ADD COLUMN avatar_url TEXT");
  await ensure("tf_birth_date", "ALTER TABLE users ADD COLUMN tf_birth_date TEXT");
  await ensure("tf_gender", "ALTER TABLE users ADD COLUMN tf_gender TEXT");
  await libsql.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_talkfirst_id_unique ON users(talkfirst_id)",
  );
} catch (e) {
  console.error("确保 users 表新列失败（单点登录可能不可用）：", e);
}

// ---------------------------------------------------------------------------
// Ctx shim —— 动作代码实际只用到 ctx.db、ctx.inference.complete、
// ctx.invalidateQueries 三样（已 grep 核对：60 / 1 / 33 处）。
// 其余 PortableCtx / Ctx 成员给最小 stub，被调用就抛错，避免静默假成功。
// ---------------------------------------------------------------------------
const notSupported = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is not supported in the standalone runtime`);
};

const ctx = {
  slug: "xing-zuo-ba-zi-pi-pei",
  invocationId: "",
  spaceDir: import.meta.dir,
  db: () => db,
  viewer: undefined,
  blobs: {
    put: notSupported("ctx.blobs.put"),
    getUrl: notSupported("ctx.blobs.getUrl"),
    delete: notSupported("ctx.blobs.delete"),
    head: notSupported("ctx.blobs.head"),
    list: notSupported("ctx.blobs.list"),
  },
  executePrivileged: notSupported("ctx.executePrivileged"),
  inference: {
    // 独立运行时默认不接推理服务：直接抛错，动作代码（AI 命理助手）里
    // 已有 try/catch 与确定性兜底文案，会优雅降级。
    // 以后要接真实 LLM：在这里改用环境变量里的 API Key 调目标厂商的
    // chat/completions 接口，按 options.schema 校验后返回结构化结果即可。
    complete: notSupported("ctx.inference.complete"),
  },
  agent: { spawnTask: notSupported("ctx.agent.spawnTask") },
  tool: {},
  emit: () => {},
  invalidateQueries: () => {}, // 独立运行时没有宿主查询缓存，no-op
};

// ---------------------------------------------------------------------------
// 动作分发表：扫描 Actions 导出里带 ACTION_BRAND 的定义。
// ---------------------------------------------------------------------------
type ActionDef = {
  __brand: string;
  request: { parse: (v: unknown) => unknown };
  response?: { parse: (v: unknown) => unknown };
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const dispatch = new Map<string, ActionDef>();
for (const [name, def] of Object.entries(Actions as Record<string, unknown>)) {
  if (def && typeof def === "object" && (def as ActionDef).__brand === ACTION_BRAND) {
    dispatch.set(name, def as ActionDef);
  }
}

async function handleAction(req: Request): Promise<Response> {
  let payload: { action?: unknown; args?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" });
  }
  const name = typeof payload.action === "string" ? payload.action : "";
  const def = dispatch.get(name);
  if (!def) {
    return Response.json({ error: `未知动作：${name || "(空)"}` });
  }
  let args: unknown;
  try {
    args = def.request.parse(payload.args ?? {});
  } catch (e) {
    return Response.json({ error: `参数校验失败：${e instanceof Error ? e.message : String(e)}` });
  }
  try {
    const invocationCtx = { ...ctx, invocationId: crypto.randomUUID() };
    const result = await def.handler(invocationCtx, args);
    // 响应 schema 只做宽松校验：解析失败时记录日志但仍返回原始结果，
    // 避免因为个别边界形状差异把可用功能整体打挂。
    if (def.response) {
      try {
        return Response.json({ data: def.response.parse(result) });
      } catch (e) {
        console.error(`[actions] ${name} 响应未通过 schema 校验，原样返回：`, e);
      }
    }
    return Response.json({ data: result });
  } catch (e) {
    console.error(`[actions] ${name} 执行出错：`, e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------------------------------------------------------------------
// 静态文件服务
// ---------------------------------------------------------------------------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function serveStatic(pathname: string): Response {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(DIST_DIR, rel);
  if (pathname === "/" || !existsSync(filePath)) {
    filePath = join(DIST_DIR, "index.html"); // SPA 回退
  }
  const file = Bun.file(filePath);
  return new Response(file, {
    headers: { "content-type": MIME[extname(filePath)] || "application/octet-stream" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/actions") {
      return handleAction(req);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return serveStatic(url.pathname);
    }
    return new Response("Method Not Allowed", { status: 405 });
  },
});

console.log(
  `星座八字匹配（独立版）已启动：http://localhost:${server.port}  数据库：${DB_PATH}  动作数：${dispatch.size}`,
);
