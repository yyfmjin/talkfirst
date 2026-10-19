"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

  useEffect(() => {
    void refresh();
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
