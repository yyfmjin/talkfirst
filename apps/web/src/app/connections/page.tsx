"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { OutlineButton } from "@/components/ui";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { apiFetch } from "@/lib/api";

type ConnectionItem = {
  id: string;
  conversationId: string | null;
  createdAt: string;
  exchange: {
    id: string;
    status: string;
    platforms: string[];
    requesterId: string;
    receiverId: string;
    updatedAt: string;
  } | null;
  peer: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
    countryCode: string | null;
    bio: string | null;
    lastActiveAt: string | null;
    interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  };
};

export default function ConnectionsPage() {
  const [items, setItems] = useState<ConnectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ConnectionItem[]>("/connections");
      setItems(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "连接加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <h1 className="text-[22px] font-semibold">连接</h1>
        <p className="mt-1 text-[13px] text-muted">
          Connection 不是好友，而是双方愿意继续保持联系的人。双方同意后才会交换社交账号。
        </p>

        {loading ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-24 rounded-3xl bg-indigo-50" />
            <div className="h-24 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-6 rounded-3xl border border-red-100 bg-red-50 p-5 text-center">
            <p className="text-[13px] text-red-700">{error}</p>
            <OutlineButton className="mt-4 w-full" onClick={() => void load()}>
              重试
            </OutlineButton>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center">
            <p className="text-[15px] font-medium">还没有 Connection</p>
            <p className="mt-2 text-[13px] leading-6 text-muted">
              去 Discover Say Hello，对方接受后，这里会出现你们的连接。
            </p>
          </div>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <div className="mt-5 space-y-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-indigo-100 p-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setPreviewUserId(item.peer.id)} aria-label={`查看 ${item.peer.nickname ?? "用户"} 的资料`} className="shrink-0">
                    {item.peer.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.peer.avatarUrl}
                        alt={`${item.peer.nickname ?? "用户"} 的头像`}
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="tf-gradient grid h-14 w-14 shrink-0 place-items-center rounded-full text-xl font-semibold text-white">
                        {(item.peer.nickname ?? "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </button>
                  <button onClick={() => setPreviewUserId(item.peer.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[15px] font-semibold">
                      {item.peer.nickname ?? "TalkFirst 用户"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {item.peer.countryCode ?? "全球"} · 连接于{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                </div>
                {item.peer.bio ? (
                  <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-muted">{item.peer.bio}</p>
                ) : null}
                {item.peer.interests.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.peer.interests.slice(0, 4).map((interest) => (
                      <span
                        key={interest.slug}
                        className="rounded-full bg-[#F1F3FF] px-3 py-1 text-[11px] text-[#6572D8]"
                      >
                        {interest.nameZh ?? interest.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#F8F9FF] px-3 py-2 text-[11px] text-muted">
                  <span>
                    {item.exchange?.status === "ACCEPTED"
                      ? `✅ 已交换 ${item.exchange.platforms.join("、")}`
                      : item.exchange?.status === "PENDING"
                        ? "🔗 交换申请待处理"
                        : "🔒 社交账号隐藏"}
                  </span>
                  {item.conversationId ? (
                    <a href={`/messages/${item.conversationId}/connect`} className="text-[#6572D8] underline">
                      查看交换
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/connections" />
    </PhoneShell>
  );
}
