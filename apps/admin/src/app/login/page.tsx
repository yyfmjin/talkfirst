"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import type { AdminRole, Permission } from "@/lib/permissions";

type AdminIdentity = {
  user: { id: string; email: string; status: string };
  role: AdminRole;
  permissions: Permission[];
  legacy: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await apiSend("/auth/login", "POST", { email, password });
      // Phase A: /admin/me resolves role + permissions. A non-admin, an
      // inactive admin, or a non-ACTIVE user is rejected here by the backend
      // with 403 — we never grant access based on a client-side flag.
      const me = await apiFetch<AdminIdentity>("/admin/me");
      if (!me?.role) {
        setError("该账号没有管理员角色，已拒绝进入后台。");
        await apiSend("/auth/logout", "POST").catch(() => undefined);
        return;
      }
      router.replace("/");
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.code === "ADMIN_INACTIVE") {
        setError("该管理员账号已被停用，请联系超级管理员。");
        await apiSend("/auth/logout", "POST").catch(() => undefined);
        return;
      }
      if (requestError instanceof ApiRequestError && requestError.code === "ADMIN_REQUIRED") {
        setError("该账号不是管理员，已拒绝进入后台。");
        await apiSend("/auth/logout", "POST").catch(() => undefined);
        return;
      }
      const message = requestError instanceof ApiRequestError ? `${requestError.code}：${requestError.message}` : "登录失败";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h1 className="text-[20px] font-semibold">TalkFirst 管理后台</h1>
        <p className="mt-1 text-[13px] text-muted">独立后台 · http://localhost:3001</p>
        <label className="mt-5 block text-[12px] text-muted">
          管理员邮箱
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@example.com"
            autoComplete="username"
            className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
        <label className="mt-3 block text-[12px] text-muted">
          密码
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            className="mt-1 h-11 w-full rounded-xl border border-line px-3 text-[14px] text-ink outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </label>
        {error ? <p className="mt-3 text-[12px] text-red-500">{error}</p> : null}
        <button
          onClick={() => void submit()}
          disabled={busy || !email || !password}
          className="mt-5 h-11 w-full rounded-xl bg-[#16213A] text-[14px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "登录中…" : "进入后台"}
        </button>
        <p className="mt-4 text-[12px] leading-5 text-muted">
          普通用户即使登录成功也会被 /admin/me 拦截。首次开通请先用种子数据或数据库把账号设为 isAdmin。
        </p>
      </div>
    </div>
  );
}
