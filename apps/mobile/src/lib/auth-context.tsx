import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, apiFetchEnvelope, ApiRequestError, tryRefresh } from "./api";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./storage";
import type { AuthSession, SessionUser } from "./types";

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
  setUser: () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const data = await apiFetch<SessionUser>("/users/me");
        if (!cancelled) setUser(data);
      } catch {
        // The access token may have expired; try a refresh before giving up.
        const refreshed = await tryRefresh();
        if (refreshed) {
          try {
            const data = await apiFetch<SessionUser>("/users/me");
            if (!cancelled) setUser(data);
          } catch {
            if (!cancelled) setUser(null);
          }
        } else {
          await clearTokens();
          if (!cancelled) setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 把一次登录 / 注册的结果落地：token 进 SecureStore，用户进状态。
   *
   * 用 `apiFetchEnvelope` 而不是 `apiFetch`：token 在响应信封的**顶层**，
   * 拆了信封就把它丢了（见 `api.ts` 里 `apiFetchEnvelope` 的注释）。
   * token 缺失由 `apiFetchEnvelope` 当场报错，不让 `undefined` 走到这一层。
   */
  const applySession = useCallback(async (session: AuthSession) => {
    await saveTokens(session.accessToken, session.refreshToken);
    setUser(session.data);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await applySession(
        await apiFetchEnvelope("/auth/login", { method: "POST", body: { email, password } }),
      );
    },
    [applySession],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await applySession(
        await apiFetchEnvelope("/auth/register", { method: "POST", body: { email, password } }),
      );
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      const refreshToken = await getRefreshToken();
      await apiFetch("/auth/logout", { method: "POST", body: { refreshToken } });
    } catch {
      // Best-effort: local sign-out must never be blocked by the server.
    } finally {
      await clearTokens();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, setUser }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

void ApiRequestError;
