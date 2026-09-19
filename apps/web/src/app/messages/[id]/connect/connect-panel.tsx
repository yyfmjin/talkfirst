"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type PlatformOption = { id: string; label: string };
type ExchangeParty = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
};
type ExchangeItem = {
  id: string;
  requesterId: string;
  receiverId: string;
  platforms: Array<{ id: string; label: string }>;
  message: string | null;
  status: string;
  createdAt: string;
  requester?: ExchangeParty;
  receiver?: ExchangeParty;
};
type ExchangeEligibility = {
  conversationId: string;
  connectionId: string;
  messageCount: number;
  requiredMessages: number;
  eligible: boolean;
  pending: ExchangeItem[];
  exchanged: ExchangeItem[];
  myAccounts: Array<{ platform: string; label: string; handle: string }>;
};
type SharedContact = {
  userId: string;
  nickname: string | null;
  platform: string;
  label: string;
  handle: string;
};

export default function ConnectPanel({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<ExchangeEligibility | null>(null);
  const [contacts, setContacts] = useState<SharedContact[]>([]);
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [eligibility, options] = await Promise.all([
          apiFetch<ExchangeEligibility>(`/conversations/${conversationId}/exchange`),
          apiFetch<PlatformOption[]>("/exchange/platforms").catch(() => [] as PlatformOption[]),
        ]);
        setState(eligibility);
        setPlatforms(options);
        if (eligibility.exchanged.length > 0) {
          const shared = await apiFetch<{ exchanged: boolean; contacts: SharedContact[] }>(
            `/conversations/${conversationId}/exchange/contacts`,
          );
          setContacts(shared.contacts);
        } else {
          setContacts([]);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [conversationId]);

  async function refresh() {
    try {
      const eligibility = await apiFetch<ExchangeEligibility>(
        `/conversations/${conversationId}/exchange`,
      );
      setState(eligibility);
      if (eligibility.exchanged.length > 0) {
        const shared = await apiFetch<{ exchanged: boolean; contacts: SharedContact[] }>(
          `/conversations/${conversationId}/exchange/contacts`,
        );
        setContacts(shared.contacts);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "刷新失败");
    }
  }

  function toggle(platformId: string) {
    setSelected((current) => {
      if (current.includes(platformId)) return current.filter((id) => id !== platformId);
      if (current.length >= 3) return current;
      return [...current, platformId];
    });
  }

  async function submit() {
    if (selected.length === 0 || acting) return;
    setActing(true);
    setError("");
    try {
      await apiFetch(`/conversations/${conversationId}/exchange`, {
        method: "POST",
        body: { platforms: selected, message: message.trim() || undefined },
      });
      setSelected([]);
      setMessage("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "发送失败");
    } finally {
      setActing(false);
    }
  }

  async function respond(exchangeId: string, action: "accept" | "reject") {
    setActing(true);
    setError("");
    try {
      await apiFetch(`/exchange/${exchangeId}/respond`, { method: "POST", body: { action } });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  async function cancel(exchangeId: string) {
    setActing(true);
    setError("");
    try {
      await apiFetch(`/exchange/${exchangeId}/cancel`, { method: "POST" });
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "取消失败");
    } finally {
      setActing(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="Connect" backHref={`/messages/${conversationId}`} />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[13px] leading-5 text-muted">
          这还不是加好友，只是双方愿意继续保持联系。需要先聊天至少 {state?.requiredMessages ?? 5}{" "}
          条消息，才能申请交换。
        </p>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-24 rounded-3xl bg-indigo-50" />
            <div className="h-24 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && state ? (
          <>
            <div className="mt-5 rounded-3xl bg-[#F7F9FF] p-4 text-[12px] leading-5 text-muted">
              已聊天 {state.messageCount}/{state.requiredMessages} 条
              {state.eligible ? " · 已满足交换门槛" : " · 继续聊聊再交换"}
            </div>

            {state.exchanged.length > 0 ? (
              <section className="mt-5">
                <h2 className="text-[14px] font-semibold">已交换的联系方式</h2>
                <div className="mt-3 space-y-2">
                  {contacts.map((contact) => (
                    <div key={`${contact.userId}-${contact.platform}`} className="rounded-2xl border border-line p-3">
                      <p className="text-[13px] font-medium">
                        {contact.nickname ?? "对方"} · {contact.label}
                      </p>
                      <p className="mt-1 select-all text-[13px] text-muted">{contact.handle}</p>
                    </div>
                  ))}
                  {contacts.length === 0 ? (
                    <p className="text-[12px] text-muted">交换已完成，联系方式加载中。</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {state.pending.length > 0 ? (
              <section className="mt-5 space-y-3">
                <h2 className="text-[14px] font-semibold">待处理的交换请求</h2>
                {state.pending.map((item) => (
                  <article key={item.id} className="rounded-3xl border border-indigo-100 p-4">
                    <p className="text-[13px] font-medium">
                      {item.requester?.nickname ?? "对方"} 申请交换{" "}
                      {item.platforms.map((platform) => platform.label).join("、")}
                    </p>
                    {item.message ? (
                      <p className="mt-2 text-[12px] leading-5 text-muted">{item.message}</p>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      <OutlineButton className="w-1/3" onClick={() => void respond(item.id, "reject")}>
                        拒绝
                      </OutlineButton>
                      <GradientButton className="w-2/3" onClick={() => void respond(item.id, "accept")} disabled={acting}>
                        接受并交换
                      </GradientButton>
                    </div>
                    <button
                      onClick={() => void cancel(item.id)}
                      className="mt-2 w-full text-center text-[11px] text-muted underline"
                    >
                      取消我发起的请求
                    </button>
                  </article>
                ))}
              </section>
            ) : null}

            {state.exchanged.length === 0 && state.pending.length === 0 ? (
              <section className="mt-5">
                <h2 className="text-[14px] font-semibold">选择要交换的平台（最多 3 个）</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {platforms.map((platform) => {
                    const owned = state.myAccounts.some((account) => account.platform === platform.id);
                    const active = selected.includes(platform.id);
                    return (
                      <button
                        key={platform.id}
                        onClick={() => toggle(platform.id)}
                        className={cn(
                          "rounded-full border px-3 py-2 text-[12px]",
                          active ? "border-transparent tf-gradient text-white" : "border-line",
                          !owned ? "opacity-60" : "",
                        )}
                        title={owned ? platform.label : `${platform.label}（需先在 Me 绑定）`}
                      >
                        {platform.label}
                        {owned ? "" : " · 未绑定"}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={200}
                  rows={2}
                  placeholder="可选留言，最多 200 字"
                  className="mt-3 w-full rounded-2xl border border-line bg-[#F8FAFF] p-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <GradientButton className="mt-4" onClick={() => void submit()} disabled={selected.length === 0 || acting}>
                  {state.eligible ? "申请交换" : `还需 ${Math.max((state.requiredMessages ?? 5) - state.messageCount, 0)} 条消息`}
                </GradientButton>
                <p className="mt-2 text-[11px] leading-4 text-muted">
                  申请前请先在 Me 页面绑定对应平台账号，对方接受后双方互相可见。
                </p>
              </section>
            ) : null}
          </>
        ) : null}

        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
      </div>
    </PhoneShell>
  );
}
