"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UNAUTHORIZED_EVENT, apiFetch } from "@/lib/api";
import { currentLocale, localePath, t, useLocale } from "@/lib/i18n";

export type SessionUser = {
  id: string;
  email: string;
  /**
   * P0-02 — the account name used to sign in. Distinct from `nickname` below,
   * which is the display name. It arrives with every session payload and is shown
   * on the account screen so a member can see which identifier is theirs —
   * including a member who registered by e-mail and does not remember the name the
   * system generated for them.
   */
  username: string;
  emailVerified: boolean;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: string | null;
  countryCode: string | null;
  city: string | null;
  /** PC-1.4: `region` was added to `GET /users/me` in PC-1.3. */
  region: string | null;
  gender: string;
  bio: string | null;
  profileCompleted: boolean;
  isAdmin?: boolean;
  status?: string;
};

type SessionState = {
  user: SessionUser | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const SessionContext = createContext<SessionState>({
  user: null,
  loading: true,
  error: "",
  refresh: async () => undefined,
  setUser: () => undefined,
});

/**
 * Routes that render without a signed-in user.
 *
 * The handler below must never bounce these to `/login`: a 401 on a public page
 * (say the landing page probing `/users/me` for an anonymous visitor) would
 * otherwise replace the very page that is already showing the correct thing,
 * and the redirect could ping-pong between the two.
 */
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/register/success",
  "/verify",
  "/legal",
  // The privacy policy has its own address because Google's OAuth consent screen
  // requires a publicly reachable policy URL. It must load for a signed-out
  // visitor — that is the whole point of the requirement.
  "/legal/privacy",
  // The two documents a member is asked to agree to are public for exactly the
  // same reason as the policy: the consent gate and the sign-up screen link them
  // while the visitor is still signed out.
  "/legal/terms",
  "/legal/rules",
  // Password recovery is reached *because* the user cannot sign in, so a 401
  // here is the expected state rather than an expiry to react to.
  "/reset",
]);

/**
 * 路径去掉英文前缀（`/en/verify` → `/verify`）。
 *
 * `PUBLIC_PATHS` 是按**中文**路径列的，而英文站在 `/en/...` 下（见
 * `lib/i18n/locales.ts`）。只认中文路径的话，英文站上的公开页会被当成「需要登录
 * 的页」：一个匿名访客在 `/en/reset` 上遇到 401，会被丢到中文 `/login` —— 而找回
 * 密码页恰恰是**因为**登不进去才会来的，这个 401 是预期状态，不是过期。
 * `/en` 本身等价于 `/`。
 */
function withoutLocalePrefix(pathname: string): string {
  if (pathname === "/en") return "/";
  return pathname.startsWith("/en/") ? pathname.slice("/en".length) : pathname;
}

/**
 * `requestIdleCallback` / `cancelIdleCallback` 在旧 Safari 与部分 WebView 里不存在。
 * lib.dom 在较新的 TS 里已经声明了它们，这里用交集只为了在缺失时能安全回退。
 */
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<SessionUser>("/users/me");
      setUser(data);
    } catch (requestError) {
      setUser(null);
      setError(requestError instanceof Error ? requestError.message : t(currentLocale(), "ss.sessionCheckFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 首屏探测 `/users/me` 的时机（2026-11-11，针对国内访问慢）。
   *
   * 公开页（官网首页、登录、条款…）不需要「用户是谁」就能渲染；而这次请求在国内线上
   * 实测要 2.6s，并且要另开一条到 API 域名的连接。首页 TTFB 1.3s 叠上它就是用户
   * 感受到的「打开很慢」。
   *
   * 所以公开页把它推到 **`load` 事件之后**：此刻首屏的 JS/CSS/字体都已下完，探测不会
   * 和它们抢带宽。不用 `requestIdleCallback` 当唯一条件 —— 页面空闲可能在首屏资源还
   * 在下载时就发生（实测本地 219ms 就发出去了），那等于没推迟。
   *
   * 只在**挂载时**判一次：原来的 `[refresh]` 就是「一次」的语义，若把 `pathname` 加进
   * 依赖，站内每跳一页都会重发这次探测 —— 那是把优化变成回退。
   */
  const initialPath = useRef(pathname);
  useEffect(() => {
    const firstPath = initialPath.current;
    const isPublicPage = firstPath ? PUBLIC_PATHS.has(withoutLocalePrefix(firstPath)) : false;
    if (!isPublicPage) {
      void refresh();
      return;
    }

    let cancelled = false;
    const probe = () => {
      if (cancelled) return;
      const idleWindow = window as IdleWindow;
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleWindow.requestIdleCallback(() => void refresh(), { timeout: 2000 });
        return;
      }
      void refresh();
    };

    if (document.readyState === "complete") {
      probe();
      return () => {
        cancelled = true;
      };
    }
    window.addEventListener("load", probe, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", probe);
    };
  }, [refresh]);

  /**
   * The single reaction to an expired session.
   *
   * `api.ts` broadcasts the event once a 401 has survived the refresh retry, so
   * this listener — not each page — decides to drop the cached user and send
   * them to `/login`. Two guards keep it from looping: nothing happens while the
   * initial `GET /users/me` is still in flight (every 401 it produces is
   * expected), and nothing happens on a public route, which has no session to
   * expire in the first place.
   */
  useEffect(() => {
    function onUnauthorized() {
      if (loading) return;
      if (pathname && PUBLIC_PATHS.has(withoutLocalePrefix(pathname))) return;
      setUser(null);
      /* 走 `localePath` 而不是写死 `/login`：英文站上的会话过期也该回英文登录页，
         否则用户刚在英文界面里操作，下一秒被丢进中文页。中文侧结果不变。 */
      router.replace(localePath(locale, "/login"));
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [loading, pathname, router, locale]);

  const value = useMemo(
    () => ({ user, loading, error, refresh, setUser }),
    [user, loading, error, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
