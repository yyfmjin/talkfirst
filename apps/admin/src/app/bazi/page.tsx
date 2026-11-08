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
 * 灵游空间（起名/排盘站）后台 —— 2026-11-08 重建。
 *
 * 原来那套后台长在起名站自己的前端里（同一个 WebView 里点「管理」），带来的问题
 * 是两套管理员概念：谁能在哪里删数据、密码怎么重置，都得在两个系统里各解释一遍。
 * 现在把入口收进 TalkFirst 后台，运营只在一个地方操作。
 *
 * ## 数据在哪
 *
 * 起名站是独立进程（容器 :3100 + SQLite）。这页所有请求都走
 * `POST /admin/bazi/action`，由后端带共享密钥转发给它自己的管理动作 ——
 * 统计口径、字段校验、权限判断全部留在那侧，这里不做第二份实现。
 *
 * ## 为什么用「动作名」而不是十几个接口
 *
 * 动作集合在起名站里由 zod schema 定义。在这一侧再镜像一遍类型和校验，
 * 两边迟早会不一致；白名单（后端两份）才是安全边界。
 */

type Tab = "overview" | "users" | "chats" | "data" | "settings";

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

type Conversation = {
  id: number;
  candidateName: string;
  ownerName: string;
  messageCount: number;
  lastMessage: string | null;
};

type ChatMessage = { id: number; sender: string; content: string; createdAt: string };
type Candidate = { id: number; name: string; ownerName: string; gender: string; birthDate: string };
type Binding = { id: number; relationType: string; targetName: string; ownerName: string };
type DmConversation = {
  id: number;
  userAName: string;
  userBName: string;
  lastMessage: string | null;
  messageCount: number;
};
type DmMessage = { id: number; senderName: string; content: string; createdAt: string };

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "users", label: "账号" },
  { key: "chats", label: "会话" },
  { key: "data", label: "数据" },
  { key: "settings", label: "设置" },
];

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

  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<BaziUser[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openConversation, setOpenConversation] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 真实用户之间的私聊（2026-11-08 补上）：与排盘会话是两套表。 */
  const [dmConversations, setDmConversations] = useState<DmConversation[]>([]);
  const [openDm, setOpenDm] = useState<number | null>(null);
  const [dmMessages, setDmMessages] = useState<DmMessage[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  /** 调起名站的白名单动作。返回值就是该动作的 `data`（后端已拆包）。 */
  const call = useCallback(async <T,>(action: string, args: Record<string, unknown> = {}): Promise<T> => {
    return apiSend<T>("/admin/bazi/action", "POST", { action, args });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "overview") setOverview(await call<Overview>("adminOverview"));
      if (tab === "users") {
        const data = await call<{ users: BaziUser[] }>("adminListUsers");
        setUsers(data.users);
      }
      if (tab === "chats") {
        const [data, dm] = await Promise.all([
          call<{ conversations: Conversation[] }>("adminListAllConversations"),
          call<{ conversations: DmConversation[] }>("adminListDmConversations"),
        ]);
        setConversations(data.conversations);
        setDmConversations(dm.conversations);
        setOpenConversation(null);
        setMessages([]);
        setOpenDm(null);
        setDmMessages([]);
      }
      if (tab === "data") {
        const [c, b] = await Promise.all([
          call<{ candidates: Candidate[] }>("adminListAllCandidates"),
          call<{ bindings: Binding[] }>("adminListAllBindings"),
        ]);
        setCandidates(c.candidates);
        setBindings(b.bindings);
      }
      if (tab === "settings") {
        const data = await call<{ settings: Settings }>("adminGetSettings");
        setSettings(data.settings);
      }
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [tab, call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: string, args: Record<string, unknown>, success: string) {
    if (!canWrite) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await call<{ ok?: boolean; message?: string }>(action, args);
      if (result && result.ok === false) {
        setError(result.message ?? "操作未完成");
      } else {
        setNotice(success);
        await load();
      }
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function openMessages(conversationId: number) {
    setOpenConversation(conversationId);
    setMessages([]);
    try {
      const data = await call<{ messages: ChatMessage[] }>("adminListMessages", { conversationId });
      setMessages(data.messages);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "消息读取失败");
    }
  }

  async function openDmMessages(conversationId: number) {
    setOpenDm(conversationId);
    setDmMessages([]);
    try {
      const data = await call<{ messages: DmMessage[] }>("adminListDmMessages", { conversationId });
      setDmMessages(data.messages);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "私聊读取失败");
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none";

  return (
    <div className="space-y-6">
      <PageHeader
        title="灵游空间"
        description="排盘、起名与匹配站的账号、内容与站点设置。数据存在它自己的容器里，这里通过服务间调用管理。"
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

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={
              tab === item.key
                ? "rounded-full bg-neutral-900 px-3 py-1.5 text-sm text-white"
                : "rounded-full border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>
      ) : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!canWrite ? (
        <p className="text-xs text-neutral-500">当前角色只能查看，不能修改。</p>
      ) : null}

      {loading ? <p className="text-sm text-neutral-500">加载中…</p> : null}

      {!loading && tab === "overview" && overview ? (
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
      ) : null}

      {!loading && tab === "users" ? (
        <section className="rounded-xl border border-neutral-200 bg-white">
          <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
            账号（{users.length}）
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
                  <th className="px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-t border-neutral-100 align-top">
                    <td className="px-4 py-2">{user.username}</td>
                    <td className="px-4 py-2">{user.role === "admin" ? "管理员" : "用户"}</td>
                    <td className="px-4 py-2">{user.status === "active" ? "正常" : "已停用"}</td>
                    <td className="px-4 py-2">{user.profileName ?? "—"}</td>
                    <td className="px-4 py-2">{user.candidateCount}</td>
                    <td className="px-4 py-2">{user.messageCount}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          disabled={!canWrite || busy}
                          onClick={() =>
                            void run(
                              "adminSetUserStatus",
                              { userId: user.id, status: user.status === "active" ? "disabled" : "active" },
                              user.status === "active" ? "已停用该账号" : "已启用该账号",
                            )
                          }
                          className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                        >
                          {user.status === "active" ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || busy}
                          onClick={() =>
                            void run(
                              "adminSetUserRole",
                              { userId: user.id, role: user.role === "admin" ? "user" : "admin" },
                              "角色已更新",
                            )
                          }
                          className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                        >
                          {user.role === "admin" ? "取消管理员" : "设为管理员"}
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || busy}
                          onClick={() => {
                            const password = window.prompt(`给「${user.username}」设置新密码（至少 6 位）`);
                            if (!password) return;
                            void run(
                              "adminResetUserPassword",
                              { userId: user.id, newPassword: password },
                              "密码已重置，该账号的旧会话已失效",
                            );
                          }}
                          className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50 disabled:opacity-40"
                        >
                          重置密码
                        </button>
                        <button
                          type="button"
                          disabled={!canWrite || busy}
                          onClick={() => {
                            if (!window.confirm(`删除「${user.username}」及其全部数据？不可撤销。`)) return;
                            void run("adminDeleteUser", { userId: user.id }, "账号已删除");
                          }}
                          className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && tab === "chats" ? (
        <section className="space-y-4">
          <div className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
              会话（{conversations.length}）
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">用户</th>
                    <th className="px-4 py-2 font-medium">候选人</th>
                    <th className="px-4 py-2 font-medium">消息数</th>
                    <th className="px-4 py-2 font-medium">最近一条</th>
                    <th className="px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((item) => (
                    <tr key={item.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2">{item.ownerName}</td>
                      <td className="px-4 py-2">{item.candidateName}</td>
                      <td className="px-4 py-2">{item.messageCount}</td>
                      <td className="max-w-[280px] truncate px-4 py-2 text-neutral-600">
                        {item.lastMessage ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => void openMessages(item.id)}
                            className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                          >
                            查看消息
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite || busy}
                            onClick={() => {
                              if (!window.confirm("删除这个会话及其全部消息？")) return;
                              void run("adminDeleteConversation", { conversationId: item.id }, "会话已删除");
                            }}
                            className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            删除会话
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {openConversation !== null ? (
            <div className="rounded-xl border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
                会话 #{openConversation} 的消息（{messages.length}）
              </h2>
              <ul className="divide-y divide-neutral-100">
                {messages.map((message) => (
                  <li key={message.id} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
                    <div>
                      <span className="mr-2 text-xs text-neutral-500">
                        {message.sender === "me" ? "用户" : "AI"}
                      </span>
                      <span className="break-words">{message.content}</span>
                    </div>
                    <button
                      type="button"
                      disabled={!canWrite || busy}
                      onClick={() => {
                        if (!window.confirm("删除这条消息？")) return;
                        void run("adminDeleteMessage", { messageId: message.id }, "消息已删除");
                      }}
                      className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </li>
                ))}
                {messages.length === 0 ? (
                  <li className="px-4 py-4 text-center text-sm text-neutral-500">没有消息</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
              私聊（{dmConversations.length}）
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">双方</th>
                    <th className="px-4 py-2 font-medium">消息数</th>
                    <th className="px-4 py-2 font-medium">最近一条</th>
                    <th className="px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dmConversations.map((item) => (
                    <tr key={item.id} className="border-t border-neutral-100">
                      <td className="px-4 py-2">
                        {item.userAName} ↔ {item.userBName}
                      </td>
                      <td className="px-4 py-2">{item.messageCount}</td>
                      <td className="max-w-[260px] truncate px-4 py-2 text-neutral-600">
                        {item.lastMessage ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => void openDmMessages(item.id)}
                            className="rounded border border-neutral-200 px-2 py-1 hover:bg-neutral-50"
                          >
                            查看消息
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite || busy}
                            onClick={() => {
                              if (!window.confirm("删除这个私聊会话及其全部消息？")) return;
                              void run(
                                "adminDeleteDmConversation",
                                { conversationId: item.id },
                                "私聊已删除",
                              );
                            }}
                            className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            删除会话
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dmConversations.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-neutral-500">
                        还没有私聊
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {openDm !== null ? (
            <div className="rounded-xl border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
                私聊 #{openDm} 的消息（{dmMessages.length}）
              </h2>
              <ul className="divide-y divide-neutral-100">
                {dmMessages.map((message) => (
                  <li key={message.id} className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
                    <div>
                      <span className="mr-2 text-xs text-neutral-500">{message.senderName}</span>
                      <span className="break-words">{message.content}</span>
                    </div>
                    <button
                      type="button"
                      disabled={!canWrite || busy}
                      onClick={() => {
                        if (!window.confirm("删除这条私聊消息？")) return;
                        void run("adminDeleteDmMessage", { messageId: message.id }, "消息已删除");
                      }}
                      className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </li>
                ))}
                {dmMessages.length === 0 ? (
                  <li className="px-4 py-4 text-center text-sm text-neutral-500">没有消息</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {!loading && tab === "data" ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
              候选人（{candidates.length}）
            </h2>
            <ul className="divide-y divide-neutral-100 text-sm">
              {candidates.slice(0, 50).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span>{item.name}</span>
                  <span className="flex items-center gap-3 text-xs text-neutral-500">
                    {item.ownerName} · {item.birthDate}
                    <button
                      type="button"
                      disabled={!canWrite || busy}
                      onClick={() => {
                        if (!window.confirm(`删除候选人「${item.name}」及其绑定与聊天？`)) return;
                        void run(
                          "adminDeleteCandidate",
                          { candidateId: item.id },
                          "候选人已删除",
                        );
                      }}
                      className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </span>
                </li>
              ))}
              {candidates.length === 0 ? (
                <li className="px-4 py-4 text-center text-neutral-500">暂无</li>
              ) : null}
            </ul>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white">
            <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold">
              绑定（{bindings.length}）
            </h2>
            <ul className="divide-y divide-neutral-100 text-sm">
              {bindings.slice(0, 50).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <span>
                    {item.ownerName} → {item.targetName}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-neutral-500">
                    {item.relationType}
                    <button
                      type="button"
                      disabled={!canWrite || busy}
                      onClick={() => {
                        if (!window.confirm("解除这条绑定？")) return;
                        void run("adminDeleteBinding", { bindingId: item.id }, "绑定已解除");
                      }}
                      className="rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      解绑
                    </button>
                  </span>
                </li>
              ))}
              {bindings.length === 0 ? (
                <li className="px-4 py-4 text-center text-neutral-500">暂无</li>
              ) : null}
            </ul>
          </div>
        </section>
      ) : null}

      {!loading && tab === "settings" && settings ? (
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
                onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })}
              />
              允许新用户注册（关掉后只有已有账号能登录）
            </label>
          </div>
          <div className="mt-3">
            <button
              type="button"
              disabled={!canWrite || busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    const data = await call<{ settings: Settings }>("adminSaveSettings", settings);
                    setSettings(data.settings);
                    setNotice("已保存，灵游空间立即生效。");
                  } catch (requestError) {
                    setError(
                      requestError instanceof ApiRequestError ? requestError.message : "保存失败",
                    );
                  } finally {
                    setBusy(false);
                  }
                })()
              }
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
