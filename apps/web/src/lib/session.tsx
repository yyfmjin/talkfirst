"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UNAUTHORIZED_EVENT, apiFetch } from "@/lib/api";

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
  // Password recovery is reached *because* the user cannot sign in, so a 401
  // here is the expected state rather than an expiry to react to.
  "/reset",
]);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<SessionUser>("/users/me");
      setUser(data);
    } catch (requestError) {
      setUser(null);
      setError(requestError instanceof Error ? requestError.message : "登录状态检查失败，请重新登录。");
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
      if (pathname && PUBLIC_PATHS.has(pathname)) return;
      setUser(null);
      router.replace("/login");
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [loading, pathname, router]);

  const value = useMemo(
    () => ({ user, loading, error, refresh, setUser }),
    [user, loading, error, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
