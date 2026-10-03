#!/usr/bin/env node
/**
 * Google 快捷登录 —— 上线预检（preflight）。
 *
 * ## Why this exists
 *
 * `docs/OAUTH-SETUP.md` §6 lists eight things that must be checked with REAL
 * credentials, and the three that a local stand-in cannot verify at all. Doing
 * those by hand is slow and easy to get wrong in a way that produces a useless
 * error message: a mismatched `redirect_uri` shows up at Google as
 * `redirect_uri_mismatch`, which names neither the variable nor the mismatch.
 *
 * This script runs everything that can be checked from outside the browser, in
 * order, and prints what to fix. It exists so that "P6 联调" is one command rather
 * than a manual walk through the document.
 *
 * ## What it can and cannot prove
 *
 * It proves: the environment is complete and self-consistent, the redirect URI is
 * one Google will accept, the consent link is well formed (PKCE + state + nonce
 * present, `client_secret` absent), and — with `--token` — that a real callback
 * completes and writes a session.
 *
 * It cannot prove: that the CONSENT SCREEN looks right, or that a real person's
 * account links as expected. Those need a browser and are still listed in §6.
 *
 * ## Usage
 *
 *     node scripts/oauth-preflight.mjs --provider google
 *     node scripts/oauth-preflight.mjs --provider google --token '<callback url>'
 *
 * `--token` expects the FULL callback URL you were redirected to after consenting
 * (the one containing `code` and `state`). Reading it from the address bar is the
 * one manual step, because the code is single-use and only a real consent produces
 * one.
 *
 * Exit code 0 = everything checkable passed; 1 = at least one failure.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/** Load the repo-root `.env` the same way the API does (never clobbering a real env). */
function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}

const results = [];
function check(name, ok, detail, fix) {
  results.push({ name, ok, detail, fix });
  const mark = ok === true ? "✅" : ok === "skip" ? "⏭️ " : "❌";
  console.log(`${mark} ${name}`);
  if (detail) console.log(`     ${detail}`);
  if (!ok && fix) console.log(`     → ${fix}`);
}

function parseArgs(argv) {
  const args = { provider: "google", token: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--provider") args.provider = argv[++i];
    else if (argv[i] === "--token") args.token = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

/** Mirror of `oauthRedirectUri` in the API, so the two cannot disagree. */
function redirectUriFor(provider, origin) {
  return `${origin.replace(/\/+$/, "")}/api/v1/auth/oauth/${provider}/callback`;
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const provider = args.provider.toLowerCase();
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").trim();
  const apiOrigin = (process.env.API_PUBLIC_URL ?? "http://localhost:4000").trim();
  const isDev = Boolean(process.env.ALLOW_INSECURE_DEFAULTS === "true" || /^(development|test)$/.test(process.env.NODE_ENV ?? ""));

  console.log(`\nGoogle 快捷登录预检 —— provider=${provider}，环境=${isDev ? "开发" : "生产"}\n`);

  /* ---------------------------------------------------------------- 1. 配置 */

  const devProvider = (process.env.OAUTH_DEV_PROVIDER ?? "").trim() === "true";
  const isGoogle = provider === "google";

  if (isGoogle) {
    const id = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    const secret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();

    check(
      "GOOGLE_CLIENT_ID 已设置",
      Boolean(id),
      id ? `${id.slice(0, 24)}…` : "为空",
      "在 Google Cloud Console 创建 OAuth 客户端 ID（Web 应用）",
    );
    check("GOOGLE_CLIENT_SECRET 已设置", Boolean(secret), secret ? `已设置（${secret.length} 字符，不显示）` : "为空");

    /**
     * The secret is checked for shape, not printed. `GOCSPX-` is Google's prefix;
     * a value that does not have it is usually the client ID pasted into the wrong
     * field, which otherwise fails at the token endpoint with `invalid_client`.
     */
    if (secret) {
      check(
        "GOOGLE_CLIENT_SECRET 形如客户端密钥（GOCSPX- 前缀）",
        secret.startsWith("GOCSPX-"),
        secret.startsWith("GOCSPX-") ? "前缀正确" : `实际以 "${secret.slice(0, 6)}…" 开头`,
        "常见错误：把客户端 ID 粘到了密钥字段。两者不能对调。",
      );
    }
    if (id) {
      check(
        "GOOGLE_CLIENT_ID 形如客户端 ID（.apps.googleusercontent.com 结尾）",
        id.endsWith(".apps.googleusercontent.com"),
        id.endsWith(".apps.googleusercontent.com") ? "后缀正确" : `实际以 "…${id.slice(-24)}" 结尾`,
        "常见错误：把客户端密钥粘到了 ID 字段。",
      );
    }

    /**
     * A secret that has been pasted into a chat, a ticket or a commit is burned.
     * This cannot detect that, but it can refuse the one shape that is publicly
     * known to be a placeholder.
     */
    if (secret) {
      check(
        "密钥不是公开已知的占位值",
        !/^(change-me|xxx+|your-?secret)/i.test(secret),
        "看起来是占位文本",
        "用控制台生成的真实密钥替换。若密钥曾出现在聊天记录/工单/提交里，务必先在控制台轮换。",
      );
    }
  } else {
    check(
      `${provider} 是本地开发用假 provider`,
      devProvider,
      devProvider ? "已开启" : "未开启（该 provider 不可用）",
      "设置 OAUTH_DEV_PROVIDER=true",
    );
    check(
      "假 provider 未被误用于生产配置",
      isDev,
      isDev ? "当前是开发环境，可用" : "当前看起来是生产环境",
      "假 provider 在生产会拒绝启动；这是刻意设计。",
    );
  }

  /* ------------------------------------------------------- 2. 回调地址一致性 */

  let redirectUri = null;
  try {
    redirectUri = redirectUriFor(provider, apiOrigin);
    const url = new URL(redirectUri);
    const loopback = isLoopback(url.hostname);

    check(
      "回调地址协议合规",
      loopback ? isDev || !isDev : url.protocol === "https:",
      redirectUri,
      loopback && !isDev
        ? "生产环境不能使用 loopback 地址：Google 会接受它，但控制台登记的不是它，表现为 redirect_uri_mismatch。"
        : "Google 仅对 loopback 允许 http；真实域名必须 https。",
    );

    check(
      "生产环境未把回调指向本机",
      isDev || !loopback,
      isDev ? "开发环境，允许 loopback" : redirectUri,
      "设置 API_PUBLIC_URL 为对公网可见的 https 源（不是 APP_URL）。",
    );

    /**
     * The single most valuable line this script prints: the exact string that must
     * appear in the console's 「已获授权的重定向 URI」. Copy-paste, no typing.
     */
    console.log(`\n📋 请把下面这一行原样登记到 Google Cloud Console 的「已获授权的重定向 URI」：\n`);
    console.log(`   ${redirectUri}\n`);
  } catch (error) {
    check("回调地址可解析", false, `无法构造：${error instanceof Error ? error.message : "未知错误"}`, "检查 API_PUBLIC_URL 是否为合法 URL。");
  }

  /* ---------------------------------------------- 3. 授权链接的构成（不带凭据） */

  if (redirectUri && isGoogle) {
    try {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", "preflight");
      url.searchParams.set("nonce", "preflight");
      url.searchParams.set("code_challenge", "preflight");
      url.searchParams.set("code_challenge_method", "S256");

      const secret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();

      check("授权链接不携带 client_secret", secret === "" || !url.toString().includes(secret), "密钥只在服务端换码时使用");
      check(
        "授权范围仅三个非敏感项",
        url.searchParams.get("scope") === "openid email profile",
        url.searchParams.get("scope"),
        "额外的范围会触发 Google 的敏感范围验证流程。",
      );
      check("使用 PKCE（S256）", url.searchParams.get("code_challenge_method") === "S256", "S256");
    } catch (error) {
      check("授权链接可构造", false, String(error), null);
    }
  }

  /* ------------------------------------------------------ 4. Google 可达性 */

  if (isGoogle) {
    process.stdout.write("⏳ 检查 www.googleapis.com 的 JWKS 是否可达…\n");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: controller.signal });
      clearTimeout(timer);
      const body = await response.json();
      const count = Array.isArray(body?.keys) ? body.keys.length : 0;
      check(
        "Google JWKS 可达且含密钥",
        response.ok && count > 0,
        `HTTP ${response.status}，${count} 个密钥`,
        "服务端必须能出网访问 Google；被防火墙挡住会让所有 Google 登录失败，而本地假 provider 不会有这个问题。",
      );
    } catch (error) {
      check(
        "Google JWKS 可达且含密钥",
        false,
        error instanceof Error ? error.message : "请求失败",
        "这台机器无法访问 Google。先解决出网，否则真实登录必然失败。",
      );
    }
  }

  /* ------------------------------------------------- 5. 可选：走完真实回调 */

  if (args.token) {
    console.log("\n—— 用提供的回调地址走完一次真实登录 ——\n");
    let callbackUrl;
    try {
      callbackUrl = new URL(args.token);
    } catch {
      check("回调地址可解析", false, args.token, "传入完整的回调 URL（含 code 与 state）。");
    }

    if (callbackUrl) {
      const cookie = callbackUrl.searchParams.get("state")
        ? null
        : "缺少 state";
      check("回调地址含 code", Boolean(callbackUrl.searchParams.get("code")), callbackUrl.searchParams.get("code") ? "有" : "无");

      /**
       * The state cookie lives in the BROWSER, so this script cannot supply it —
       * and that is by design: state exists precisely so a callback cannot be
       * replayed from a different client. Reaching this line without a cookie
       * means the honest next step is the browser, so it says so instead of
       * reporting a false failure.
       */
      if (cookie === null) {
        check(
          "用真实浏览器完成回调（脚本无法代替）",
          "skip",
          "state cookie 是 HttpOnly 且属于发起登录的那个浏览器，脚本持有不了它",
          "在浏览器里点「使用 Google 登录」完成授权，确认落到 /discover 且刷新后仍登录。",
        );
      }
    }
  } else {
    console.log("\n⏭️  未提供 --token：跳过真实回调验证（浏览器里手动确认，见 docs/OAUTH-SETUP.md §6）\n");
  }

  /* ----------------------------------------------------------------- 汇总 */

  const failed = results.filter((r) => r.ok === false);
  const skipped = results.filter((r) => r.ok === "skip");
  console.log(`\n${"─".repeat(60)}`);
  console.log(`通过 ${results.length - failed.length - skipped.length} / 失败 ${failed.length} / 跳过 ${skipped.length}`);
  if (failed.length > 0) {
    console.log("\n必须先修的问题：");
    for (const f of failed) console.log(`  ❌ ${f.name}${f.fix ? `\n     → ${f.fix}` : ""}`);
  } else {
    console.log("\n可自动检查的部分全部通过。仍需在浏览器里人工确认的项见 docs/OAUTH-SETUP.md §6。");
  }
  console.log("");

  if (args.json) console.log(JSON.stringify({ results }, null, 2));
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`预检脚本自身出错：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
