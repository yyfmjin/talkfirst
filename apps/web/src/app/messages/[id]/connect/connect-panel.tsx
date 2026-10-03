"use client";

import { useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import {
  TFButton,
  TFCard,
  TFChip,
  TFLoadingRegion,
  TFRowSkeleton,
  TFTextarea,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
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
  // Who the viewer is decides whether a pending request is theirs to withdraw or
  // theirs to answer (see the pending list below).
  const { user } = useSession();
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
      <ScreenHeader title="交换联系方式" backHref={`/messages/${conversationId}`} />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        <p className="text-ui leading-6 text-content-muted">
          这还不是加好友，只是双方愿意继续保持联系。需要先聊天至少 {state?.requiredMessages ?? 5}{" "}
          条消息，才能申请交换。
        </p>

        {loading ? (
          <TFLoadingRegion label="正在加载交换状态">
            <div className="mt-5 space-y-3">
              <TFRowSkeleton avatar={false} />
              <TFRowSkeleton avatar={false} />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && state ? (
          <>
            {/* The eligibility counter. A progress bar would overstate it — the
                server's own `eligible` flag is the source of truth, so this states
                the numbers and lets the flag decide the wording. */}
            <TFCard tone="quiet" className="mt-5">
              <p className="text-caption leading-5 text-content-muted">
                已聊天 {state.messageCount}/{state.requiredMessages} 条
                {state.eligible ? " · 已满足交换门槛" : " · 继续聊聊再交换"}
              </p>
            </TFCard>

            {state.exchanged.length > 0 ? (
              <section className="mt-5">
                <h2 className="text-ui font-semibold text-content">已交换的联系方式</h2>
                <div className="mt-3 space-y-2">
                  {contacts.map((contact) => (
                    <div
                      key={`${contact.userId}-${contact.platform}`}
                      className="rounded-row border border-border bg-surface p-3.5"
                    >
                      <p className="text-ui font-medium text-content">
                        {contact.nickname ?? "对方"} · {contact.label}
                      </p>
                      {/* `select-all` so a long-press selects the whole handle
                          instead of a character — this is the one string on the
                          screen the member is meant to copy elsewhere. */}
                      <p className="mt-1 select-all text-ui text-content-muted">{contact.handle}</p>
                    </div>
                  ))}
                  {contacts.length === 0 ? (
                    <p className="text-caption text-content-muted">交换已完成，联系方式加载中。</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {state.pending.length > 0 ? (
              <section className="mt-5 space-y-3">
                <h2 className="text-ui font-semibold text-content">待处理的交换请求</h2>
                {state.pending.map((item) => {
                  /**
                   * FIX (audit): 「取消我发起的请求」 was rendered for EVERY
                   * pending item, including ones the peer had started — so the
                   * label lied about who did what, and the control that appeared
                   * was the wrong one (a recipient should 接受/拒绝, which is the
                   * row above; only the sender may cancel).
                   *
                   * The list carries `requesterId`/`receiverId`, so the direction
                   * is known without another request. When it is not the viewer's
                   * request, a plain explanatory line is shown instead of an
                   * action the server would reject.
                   */
                  const mine = item.requesterId === user?.id;
                  return (
                    <TFCard key={item.id}>
                      <p className="text-ui font-medium text-content">
                        {mine ? "你" : (item.requester?.nickname ?? "对方")} 申请交换{" "}
                        {item.platforms.map((platform) => platform.label).join("、")}
                      </p>
                      {item.message ? (
                        <p className="mt-2 text-caption leading-5 text-content-muted">{item.message}</p>
                      ) : null}
                      {mine ? (
                        <>
                          <p className="mt-3 text-caption leading-5 text-content-muted">
                            等待对方确认，你可以先撤回。
                          </p>
                          <TFButton
                            variant="ghost"
                            size="sm"
                            fullWidth
                            className="mt-1 text-content-muted"
                            onClick={() => void cancel(item.id)}
                            disabled={acting}
                            loading={acting}
                            loadingLabel="撤回中…"
                          >
                            撤回我发起的请求
                          </TFButton>
                        </>
                      ) : (
                        <>
                          <div className="mt-3 flex gap-2">
                            <TFButton
                              variant="secondary"
                              className="flex-1"
                              disabled={acting}
                              onClick={() => void respond(item.id, "reject")}
                            >
                              拒绝
                            </TFButton>
                            <TFButton
                              className="flex-[2]"
                              disabled={acting}
                              onClick={() => void respond(item.id, "accept")}
                            >
                              接受并交换
                            </TFButton>
                          </div>
                          <p className="mt-2 text-caption leading-4 text-content-subtle">
                            只有发起方可以撤回；对方发起的请求由你决定接受或拒绝。
                          </p>
                        </>
                      )}
                    </TFCard>
                  );
                })}
              </section>
            ) : null}

            {state.exchanged.length === 0 && state.pending.length === 0 ? (
              <section className="mt-5">
                <h2 className="text-ui font-semibold text-content">选择要交换的平台（最多 3 个）</h2>
                <fieldset className="mt-3 flex flex-wrap gap-2">
                  <legend className="sr-only">选择要交换的平台</legend>
                  {platforms.map((platform) => {
                    const owned = state.myAccounts.some((account) => account.platform === platform.id);
                    return (
                      <TFChip
                        key={platform.id}
                        selected={selected.includes(platform.id)}
                        onClick={() => toggle(platform.id)}
                        className={cn("max-w-full", !owned && "opacity-60")}
                        title={owned ? platform.label : `${platform.label}（需先在「我的」绑定）`}
                      >
                        <span className="truncate">{platform.label}</span>
                        {owned ? null : <span className="shrink-0 text-overline">· 未绑定</span>}
                      </TFChip>
                    );
                  })}
                </fieldset>

                <div className="mt-3">
                  <label htmlFor="exchange-message" className="mb-1.5 block text-caption font-medium text-content-muted">
                    留言（可选）
                  </label>
                  <TFTextarea
                    id="exchange-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="可选留言，最多 200 字"
                  />
                </div>

                {/* FIX (audit): `disabled` omitted `!state.eligible`, so a button
                    that reads 「还需 N 条消息」 was actually clickable and only
                    failed after a round trip. The label and the disabled state
                    now agree, and the user gets the server's reason inline if
                    eligibility changes underneath them. The disabled expression is
                    unchanged by this migration — it is the security-relevant part. */}
                <TFButton
                  size="lg"
                  fullWidth
                  className="mt-4"
                  onClick={() => void submit()}
                  disabled={selected.length === 0 || acting || !state.eligible}
                  loading={acting && state.eligible && selected.length > 0}
                  loadingLabel="申请中…"
                >
                  {state.eligible
                    ? "申请交换"
                    : `还需 ${Math.max((state.requiredMessages ?? 5) - state.messageCount, 0)} 条消息`}
                </TFButton>
                <p className="mt-2 text-caption leading-4 text-content-subtle">
                  申请前请先在「我的」里绑定对应平台账号，对方接受后双方互相可见。
                </p>
              </section>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 break-words text-caption text-danger-600">
            {error}
          </p>
        ) : null}
      </div>
    </PhoneShell>
  );
}
