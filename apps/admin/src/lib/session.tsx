"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError, apiFetch } from "@/lib/api";
import type { AdminRole, Permission } from "@/lib/permissions";

export type AdminIdentity = {
  user: {
    id: string;
    email: string;
    nickname: string | null;
    avatarUrl: string | null;
    status: string;
    isAdmin: boolean;
  };
  role: AdminRole;
  permissions: Permission[];
  legacy: boolean;
};

type SessionState = {
  identity: AdminIdentity | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  can: (permission: Permission) => boolean;
};

const AdminSessionContext = createContext<SessionState>({
  identity: null,
  loading: true,
  error: "",
  reload: async () => undefined,
  can: () => false,
});

/**
 * Loads the current admin's role and permissions once, and shares them with the
 * console. Redirects to /login when the caller is not an administrator or their
 * admin profile has been deactivated — the backend returns 403 for both, and
 * the console should not render a shell it cannot use.
 */
export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<AdminIdentity>("/admin/me");
      setIdentity(data);
    } catch (requestError) {
      const code = requestError instanceof ApiRequestError ? requestError.code : "";
      if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "加载管理员信息失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const can = useCallback(
    (permission: Permission) => Boolean(identity?.permissions?.includes(permission)),
    [identity],
  );

  return (
    <AdminSessionContext.Provider value={{ identity, loading, error, reload: load, can }}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  return useContext(AdminSessionContext);
}
