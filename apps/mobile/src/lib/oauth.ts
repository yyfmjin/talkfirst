import { Linking } from "react-native";
import { apiBaseUrl } from "./config";
import { apiFetch, apiFetchEnvelope } from "./api";
import type { AuthSession } from "./types";

/**
 * Google / Facebook 登录（App 端）。
 *
 * ## 为什么走系统浏览器
 *
 * Google 明确拒绝在内嵌 WebView 里做 OAuth（安全策略），Facebook 同样不推荐。
 * 所以流程是：打开系统浏览器 → 用户在 provider 那边确认 → 回调落在我们的域名上
 * → 服务端签发一个**一次性码** → 302 到 `talkfirst://oauth?code=…` → App 拿码
 * 调 `/auth/oauth/:provider/exchange` 换 token。
 *
 * ## 为什么必须先挂监听再打开浏览器
 *
 * 用户可能几秒内就点完同意并跳回来。先 `openURL` 再 `addEventListener`，那次
 * 深链就会被漏掉 —— 表现是「点了登录，浏览器关掉后 App 毫无反应」。
 *
 * ## 失败不抛给界面
 *
 * 用户在浏览器里点了取消、或者干脆没回来，都返回 `null`：这不是错误，是放弃。
 * 只有「回来了但换不出 token」才算失败，交给调用方提示。
 */
const REDIRECT_PREFIX = "talkfirst://oauth";
/** 用户在浏览器里慢慢看条款是正常的；三分钟没回来就当放弃。 */
const WAIT_MS = 180_000;

/** 这个部署实际支持哪些 provider（后端没配就不显示按钮，与网页同一条规则）。 */
export async function fetchOAuthProviders(): Promise<string[]> {
  try {
    const data = await apiFetch<{ providers: string[] }>("/auth/oauth/providers");
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    // 拉不到列表 = 不知道能不能用，那就当作不能用（邮箱登录不受影响）。
    return [];
  }
}

function codeFromUrl(url: string): string | null {
  try {
    const match = /[?&]code=([^&]+)/.exec(url);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * 启动一次 OAuth。
 *
 * @returns 成功 → 会话；用户放弃 / 超时 → null；服务端拒绝 → 抛 `ApiRequestError`
 */
export async function startOAuth(provider: "google" | "facebook"): Promise<AuthSession | null> {
  const startUrl = `${apiBaseUrl()}/auth/oauth/${provider}/start?client=native`;

  const code = await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      resolve(value);
    };

    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (!url.startsWith(REDIRECT_PREFIX)) return;
      finish(codeFromUrl(url));
    });
    const timer = setTimeout(() => finish(null), WAIT_MS);

    Linking.openURL(startUrl).catch(() => finish(null));
  });

  if (!code) return null;

  return apiFetchEnvelope(`/auth/oauth/${provider}/exchange`, {
    method: "POST",
    body: { code },
  });
}
