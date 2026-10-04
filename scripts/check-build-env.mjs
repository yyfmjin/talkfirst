#!/usr/bin/env node
/**
 * check-build-env.mjs — 拒绝产出一个「连不上 API」的前端产物。
 *
 * ## 为什么需要它
 *
 * `NEXT_PUBLIC_*` 是**构建期**注入的：值在 `next build` 那一刻被写死进 JS 产物，
 * 之后改环境变量、重启容器都不起作用。两个 Dockerfile 的 ARG 默认值又恰好是
 * `http://localhost:4000/api/v1` —— 于是「一次忘记传参」不会报任何错，只会安静地
 * 生成一个浏览器去连自己 localhost 的产物。
 *
 * 这正是 2026-10-04 生产上那个「HTTPS 页面请求 http://<服务器IP>:4000」的成因：
 * 源码树里根本没有那个 IP（实测出现 0 次），它只存在于**构建产物**里。
 *
 * ## 为什么用「调用点」而不是环境变量当开关
 *
 * 不能像其他守卫那样用 `NODE_ENV`：`next build` 无论本地还是交付都会把它设成
 * `production`，本机做生产模式自测时用 localhost 基址是完全正当的。
 * 所以判定「这是不是交付构建」的开关就是**谁来调用**：
 *   - `apps/web/Dockerfile`、`apps/admin/Dockerfile` 的构建阶段
 *   - `scripts/deploy-pull.sh` 的构建步骤之前
 * 本机直接 `npm run build` 不会经过这里，行为一行不变。
 *
 * ## 用法
 *
 *   node scripts/check-build-env.mjs              # 只校验 NEXT_PUBLIC_API_BASE_URL
 *   node scripts/check-build-env.mjs --socket     # 额外校验 NEXT_PUBLIC_SOCKET_BASE_URL
 *
 * 退出码 0 = 这两个值可以进交付产物；1 = 不能，且已打印该怎么改。
 */
import process from "node:process";

/** 回环 / 通配地址。带 `[...]` 的 IPv6 与裸 `::1` 都算。 */
const LOOPBACK = /(^|[./@])(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)([:/]|$)/i;

/** 逃生舱：确实要在内网 http 环境下交付时显式开启，并接受一条警告。 */
const ESCAPE_HATCH = (process.env.ALLOW_INSECURE_API_BASE_URL ?? "").trim().toLowerCase();
const ALLOWED_INSECURE = ESCAPE_HATCH === "true" || ESCAPE_HATCH === "1";

const findings = [];
const warnings = [];

/**
 * 校验一个「会被烘进产物」的基址。
 *
 * @param {string} name  环境变量名
 * @param {string} value 它的值
 * @param {{ httpsOnly?: boolean }} options  Socket.IO 也接受 wss://，普通 REST 基址不接受
 */
function check(name, value, { httpsOnly = true } = {}) {
  const raw = (value ?? "").trim();

  if (raw === "") {
    findings.push(
      `${name} 未设置。\n` +
        `    产物会退回代码里的兜底值（${name === "NEXT_PUBLIC_SOCKET_BASE_URL" ? "http://localhost:4000" : "http://localhost:4000/api/v1"}），\n` +
        `    而浏览器里的 localhost 是**访客自己的机器**，不是服务器。`,
    );
    return;
  }

  // 同源相对路径（例如 `/api/v1`）永远不是回环，也不会有 mixed content。
  if (raw.startsWith("/")) return;

  if (LOOPBACK.test(raw)) {
    findings.push(
      `${name}=${raw} 指向本机地址。\n` +
        `    它对服务器自己成立，但对浏览器不成立：访客的 localhost 是他们自己的电脑。`,
    );
    return;
  }

  const ok = httpsOnly ? /^https:\/\//i.test(raw) : /^(https|wss):\/\//i.test(raw);
  if (!ok) {
    const scheme = httpsOnly ? "https://" : "https:// 或 wss://";
    const message =
      `${name}=${raw} 不是 ${scheme}。\n` +
      `    HTTPS 页面请求 http:// 会被浏览器以 Mixed Content 拦下（这正是生产上注册页失灵的形态）。`;
    if (ALLOWED_INSECURE) warnings.push(`${message}\n    （ALLOW_INSECURE_API_BASE_URL 已开启，降级为警告。）`);
    else findings.push(message);
  }
}

check("NEXT_PUBLIC_API_BASE_URL", process.env.NEXT_PUBLIC_API_BASE_URL, { httpsOnly: true });

if (process.argv.includes("--socket")) {
  check("NEXT_PUBLIC_SOCKET_BASE_URL", process.env.NEXT_PUBLIC_SOCKET_BASE_URL, { httpsOnly: false });
}

const show = (name) => `${name}=${(process.env[name] ?? "").trim() || "<未设置>"}`;

if (findings.length > 0) {
  console.error("\n交付构建被拒绝 —— 这两个值会被写死进前端产物，改不了也不该猜：\n");
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(
    `\n  当前值：${show("NEXT_PUBLIC_API_BASE_URL")}` +
      (process.argv.includes("--socket") ? `\n          ${show("NEXT_PUBLIC_SOCKET_BASE_URL")}` : "") +
      `\n\n  正确的做法：在交付环境里把它们设成对外地址，例如\n` +
      `    NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1\n` +
      `    NEXT_PUBLIC_SOCKET_BASE_URL=https://api.example.com\n` +
      `  然后在**同一个环境里重新构建**（只改配置不重建是无效的）。\n` +
      `  确实要在内网 http 下交付时才用 ALLOW_INSECURE_API_BASE_URL=true 降级为警告。\n`,
  );
  process.exit(1);
}

for (const w of warnings) console.error(`  ! ${w}`);
console.log(`OK — ${show("NEXT_PUBLIC_API_BASE_URL")}${process.argv.includes("--socket") ? ` / ${show("NEXT_PUBLIC_SOCKET_BASE_URL")}` : ""}`);
