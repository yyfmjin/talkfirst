"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ErrorState } from "@/components/error-state";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { useAdminSession } from "@/lib/session";

/**
 * 起名站（Destiny Atlas）后台 —— 2026-11-08。
 *
 * 数据在另一个进程里（容器 :3100，SQLite），所以这页所有请求都经
 * `GET/PATCH /admin/bazi/*` 转到那边，由它自己的管理员动作产出口径。
 * 这里不复制任何业务规则，也不缓存统计值。
 *
 * 只开放三类操作：看概览、看用户列表、改站点设置（标题/公告/注册开关/上限）。
 * 删用户、改密码、清聊天这类破坏性操作仍然只在起名站自己的后台里做 ——
 * 两台服务的账号体系本来就不在一起，把删除权限铺到这边只会多一条误操作路径。
 */

type Overview = {
  totalUsers: number;
  activeUsers: number;
  disabledUsers: number;
  newUsersToday: number;
  totalCandidates: number;
  totalBindings: number;
  totalConversations: number;
  totalMessages: number;
  messagesToday: number;
};

type Settings = {
  siteTitle: string;
  siteSubtitle: string;
  announcement: string;
  friendLimit: number;
  loverLimit: number;
  partnerLimit: number;
  enforceExclusivity: boolean;
  allowRegistration: boolean;
  adminNote: string;
};

type BaziUser = {
  id: number;
  username: string;
  role: string;
  status: string;
  profileName: string | null;
  candidateCount: number;
  bindingCount: number;
  conversationCount: number;
  messageCount: number;
};

export default function BaziAdminPage() {
  return (
    <Shell>
      <BaziScreen />
    </Shell>
  );
}

function BaziScreen() {
  const { identity } = useAdminSession();
  const canWrite = Boolean(identity && hasPermission(identity.role, "settings:write"));

  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<BaziUser[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, u, s] = await Promise.all([
        apiFetch<Overview>("/admin/bazi/overview"),
        apiFetch<{ users: BaziUser[] }>("/admin/bazi/users"),
        apiFetch<{ settings: Settings }>("/admin/bazi/settings"),
      ]);
      setOverview(o);
      setUsers(u.users);
      setSettings(s.settings);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "起名站数据读取失败",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!settings || !canWrite) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const result = await apiSend<{ settings: Settings }>(
        "/admin/bazi/settings",
        "PATCH",
        settings,
      );
      setSettings(result.settings);
      setNotice("已保存，起名站立即生效。");
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader
        title="起名站"
        description="Destiny Atlas（按生日排盘、起中文名）的数据与站点设置。数据存在它自己的容器里，这里通过服务间调用读取。"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            刷新
          </button>
        }
      />

      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <p className="text-sm text-neutral-500">加载中…</p>
      ) : overview ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="注册用户" value={String(overview.totalUsers)} />
            <StatCard label="今日新增" value={String(overview.newUsersToday)} />
            <StatCard label="排盘档案" value={String(overview.totalCandidates)} />
            <StatCard label="绑定关系" value={String(overview.totalBindings)} />
            <StatCard label="会话数" value={String(overview.totalConversations)} />
            <StatCard label="消息总数" value={String(overview.totalMessages)} />
            <StatCard label="今日消息" value={String(overview.messagesToday)} />
            <StatCard label="停用账号" value={String(overview.disabledUsers)} />
          </section>

          {settings ? (
            <section className="rounded-xl border border-neutral-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold">站点设置</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-neutral-600">站点标题</span>
                  <input
                    className={inputCls}
                    value={settings.siteTitle}
                    maxLength={40}
                    disabled={!canWrite}
                    onChange={(e) => setSettings({ ...settings, siteTitle: e.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-neutral-600">副标题</span>
                  <input
                    className={inputCls}
                    value={settings.siteSubtitle}
                    maxLength={80}
                    disabled={!canWrite}
                    onChange={(e) => setSettings({ ...settings, siteSubtitle: e.target.value })}
                  />
                </label>
                <label className="block text-sm md:col-span-2">
                  <span className="mb-1 block text-neutral-600">公告（显示在首页）</span>
                  <textarea
                    className={inputCls}
                    rows={2}
                    maxLength={300}
                    value={settings.announcement}
                    disabled={!canWrite}
                    onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    checked={settings.allowRegistration}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setSettings({ ...settings, allowRegistration: e.target.checked })
                    }
                  />
                  允许新用户注册（关掉后只有已有账号能登录）
                </label>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  disabled={!canWrite || saving}
                  onClick={() => void save()}
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
                {!canWrite ? (
                  <span className="text-xs text-neutral-500">当前角色只能查看，不能修改。</span>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
              起名站用户（{users.length}）
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">用户名</th>
                    <th className="px-4 py-2 font-medium">角色</th>
                    <th className="px-4 py-2 font-medium">状态</th>
                    <th className="px-4 py-2 font-medium">档案名</th>
                    <th className="px-4 py-2 font-medium">候选</th>
                    <th className="px-4 py-2 font-medium">消息</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2">{user.username}</td>
                      <td className="px-4 py-2">{user.role === "admin" ? "管理员" : "用户"}</td>
                      <td className="px-4 py-2">
                        {user.status === "active" ? "正常" : "已停用"}
                      </td>
                      <td className="px-4 py-2">{user.profileName ?? "—"}</td>
                      <td className="px-4 py-2">{user.candidateCount}</td>
                      <td className="px-4 py-2">{user.messageCount}</td>
                    </tr>
                  ))}
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                        还没有用户
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
