#!/usr/bin/env node
/**
 * 把 AAB 上传到 Google Play（Play Developer API v3）。
 *
 * 为什么需要它：Play Console 只认人工点击，而这个脚本让「出包 → 上传到某个
 * 测试轨道」变成一条命令。**它不能替你做的事**：首次创建应用、填商店资料、
 * 数据安全表单、内容分级、选择国家/地区 —— 这些 Play 没有公开 API，必须在
 * Console 里点一次。详见 docs/PLAY-UPLOAD.md。
 *
 * 前置（一次性）：
 *   1. Google Cloud 项目里启用「Google Play Android Developer API」；
 *   2. 建服务账号，下载 JSON 密钥，放到 **仓库外**（例：D:/Android/play/service-account.json）；
 *   3. Play Console → 用户和权限 → 邀请该服务账号邮箱，授予「发布管理员」，
 *      并把要发布的应用加进它的权限范围。
 *
 * 用法：
 *   node scripts/upload-aab-to-play.mjs \
 *     --key D:/Android/play/service-account.json \
 *     --aab D:/Android/play/talkfirst-0.1.15.aab \
 *     --track internal            # internal | alpha | beta | production
 *     [--status draft|completed]  # 默认 draft：先落库里，人工确认再推
 *     [--notes "本次更新说明"]
 *     [--dry-run]                 # 只校验参数与包名，不联网
 *
 * 退出码：0 成功；非 0 失败（会把 Play 返回的错误原文打出来）。
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function parseArgs(argv) {
  const out = { track: "internal", status: "draft" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (name === "dry-run") {
      out.dryRun = true;
      continue;
    }
    out[name] = argv[i + 1];
    i += 1;
  }
  return out;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** 用服务账号私钥签一个 RS256 JWT，换 access_token（不引依赖）。 */
async function fetchAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(credentials.private_key);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    fail(`换 token 失败（${response.status}）：${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function api(token, method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    fail(`${method} ${url} 失败（${response.status}）：${text}`);
  }
  return payload;
}

const args = parseArgs(process.argv.slice(2));
if (!args.aab) fail("缺少 --aab");

const aab = readFileSync(args.aab);
const pkg = args.package ?? "com.talkfirst.app";
const aabMb = (aab.length / 1048576).toFixed(1);
console.log(`AAB: ${args.aab}（${aabMb} MB）`);
console.log(`包名: ${pkg} | 轨道: ${args.track} | 状态: ${args.status}`);

if (args.dryRun) {
  console.log("✓ dry-run：参数与文件都正常，未联网");
  process.exit(0);
}

if (!args.key) fail("缺少 --key（服务账号 JSON 路径）");
const credentials = JSON.parse(readFileSync(args.key, "utf8"));
if (!credentials.client_email || !credentials.private_key) {
  fail("服务账号 JSON 缺 client_email / private_key");
}

const token = await fetchAccessToken(credentials);
console.log(`✓ 已用 ${credentials.client_email} 换到 access token`);

const edit = await api(token, "POST", `${API}/applications/${pkg}/edits`, {});
console.log(`✓ 打开编辑事务 ${edit.id}`);

const uploadUrl = `${UPLOAD}/applications/${pkg}/edits/${edit.id}/bundles?uploadType=media`;
const upload = await fetch(uploadUrl, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/octet-stream",
  },
  body: aab,
});
const uploadText = await upload.text();
if (!upload.ok) fail(`上传 AAB 失败（${upload.status}）：${uploadText}`);
const versionCode = JSON.parse(uploadText).versionCode;
console.log(`✓ AAB 已上传，versionCode=${versionCode}`);

await api(token, "PUT", `${API}/applications/${pkg}/edits/${edit.id}/tracks/${args.track}`, {
  track: args.track,
  releases: [
    {
      versionCodes: [String(versionCode)],
      status: args.status,
      ...(args.notes ? { releaseNotes: [{ language: "zh-CN", text: args.notes }] } : {}),
    },
  ],
});
console.log(`✓ 已写入 ${args.track} 轨道（status=${args.status}）`);

await api(token, "POST", `${API}/applications/${pkg}/edits/${edit.id}:commit`);
console.log("✓ 编辑事务已提交");

if (args.status === "completed" && args.track === "production") {
  console.log("→ 生产版已提交审核；到 Console 的「发布概览」确认送审状态。");
} else {
  console.log("→ 到 Play Console 对应轨道确认版本已出现（draft 需要手动「发布」）。");
}
