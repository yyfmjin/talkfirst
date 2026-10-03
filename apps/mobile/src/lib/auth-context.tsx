import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, ApiRequestError, tryRefresh } from "./api";
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

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await apiFetch<AuthSession>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await saveTokens(session.accessToken, session.refreshToken);
    setUser(session.data);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const session = await apiFetch<AuthSession>("/auth/register", {
      method: "POST",
      body: { email, password },
    });
    await saveTokens(session.accessToken, session.refreshToken);
    setUser(session.data);
  }, []);

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
