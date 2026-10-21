import { randomBytes } from "node:crypto";

/**
 * 一次性交换码：浏览器里登完，把会话交给 App。
 *
 * ## 为什么需要它
 *
 * OAuth 只能在系统浏览器里完成（Google/Facebook 都会拒绝内嵌 WebView）。回调落在
 * 我们的域名上，会话本来是写 cookie 的 —— 但 App 读不到浏览器的 cookie，所以
 * 必须有一个**只属于这一次登录**的凭据，让 App 换回 token。
 *
 * ## 规则
 *
 *   - 32 字节随机，URL 安全；
 *   - **一次性**：`consume()` 取走即删，重放拿到 `null`；
 *   - **120 秒**过期：够 App 从浏览器切回来，又不足以被翻出来复用；
 *   - 存在进程内存里：单实例部署（pm2 现在就是一个进程）足够，重启即全部失效
 *     —— 那正是我们想要的行为（重启时进行中的登录本来就该重来）。
 *
 * 这里刻意不落库：一次登录的凭据没有审计价值，写库只会多一张需要清理的表。
 */

export type ExchangedSession = {
  accessToken: string;
  refreshToken: string;
  user: unknown;
};

type Entry = ExchangedSession & { expiresAt: number; provider: string };

const TTL_MS = 120_000;
/** 上限只是防止有人狂点登录把内存撑爆；正常用户不会有第二个同时在途的码。 */
const MAX_ENTRIES = 500;

const entries = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [code, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(code);
  }
}

/** 签发一个码，返回给浏览器跳转用。 */
export function issueExchangeCode(provider: string, session: ExchangedSession): string {
  const now = Date.now();
  sweep(now);
  if (entries.size >= MAX_ENTRIES) {
    // 先删最老的：`Map` 保持插入顺序。
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  const code = randomBytes(32).toString("base64url");
  entries.set(code, { ...session, provider: provider.toLowerCase(), expiresAt: now + TTL_MS });
  return code;
}

/**
 * 取走一个码。
 *
 * 校验提供方：`google` 签发的码不能拿去打 `facebook` 的交换接口 —— 两者密码学上
 * 没有区别，但限定住能缩小“拿到一个码就能换任意 provider 会话”的面。
 */
export function consumeExchangeCode(provider: string, code: string): ExchangedSession | null {
  const entry = entries.get(code);
  if (!entry) return null;
  // 无论校验是否通过都作废：一个用错的码不应该还能再试一次。
  entries.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  if (entry.provider !== provider.toLowerCase()) return null;
  return { accessToken: entry.accessToken, refreshToken: entry.refreshToken, user: entry.user };
}

/** 仅供测试：清空内存表。 */
export function resetExchangeCodes(): void {
  entries.clear();
}
