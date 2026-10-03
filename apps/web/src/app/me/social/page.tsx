"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Link2, Lock, RefreshCw, Unplug } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import {
  TFBadge,
  TFButton,
  TFCard,
  TFEmptyState,
  TFErrorState,
  TFRowSkeleton,
  TFLoadingRegion,
} from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * 「社交账号」 — connect external accounts and sync recent posts.
 *
 * ## Why there are two sections
 *
 * The product has two different ideas that both sound like "social accounts":
 *
 *   1. **Content sync** (`SocialSyncAccount`) — an OAuth connection that lets TalkFirst read
 *      the member's recent posts. This is what the top section manages.
 *   2. **The handle-sharing model** (`SocialAccount` + `SharedSocialAccount`) — the older
 *      feature where a member lists a handle and chooses which connections may see it. That
 *      lives on and is rendered below, read-only, with a link to where it is edited.
 *
 * They are deliberately separate tables with separate lifecycles, so merging them into one
 * list would make "已绑定" ambiguous — bound for reading, or bound for sharing? Both are shown,
 * labelled by what they actually do.
 *
 * ## Why a platform that needs approval is listed rather than hidden
 *
 * The brief's answer for an unreadable platform is to tell the member so, and offer the
 * alternative. Hiding it would make the product look like it does not support the platform at
 * all, and a member would have no way to learn why.
 *
 * ## Why the redirect leaves this page entirely
 *
 * Connecting is a full-page navigation to the provider, not a fetch: the OAuth flow must run
 * in the top-level browsing context so the provider's own consent screen and redirect work.
 * The API returns the URL and this screen assigns `location.href`.
 */

type ProviderAvailability = "AVAILABLE" | "REQUIRES_APPROVAL" | "NOT_CONFIGURED";

type Provider = {
  provider: string;
  label: string;
  availability: ProviderAvailability;
  canReadPosts: boolean;
};

type SyncAccount = {
  id: string;
  provider: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  syncLimit: number;
  syncEnabled: boolean;
  status: "ACTIVE" | "NEEDS_REAUTH" | "REVOKED";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

/** The legacy handle-sharing rows, read-only here. */
type SharedBinding = { platform: string; handle: string; displayName: string | null; syncEnabled: boolean };

const AVAILABILITY_HINT: Record<ProviderAvailability, string> = {
  AVAILABLE: "",
  REQUIRES_APPROVAL: "该平台需要开发者审批，目前无法读取动态。你可以把内容直接发布到 TalkFirst。",
  NOT_CONFIGURED: "本部署尚未配置该平台，请联系管理员。",
};

const SYNC_LIMITS = [1, 2, 3];

export default function SocialAccountsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [accounts, setAccounts] = useState<SyncAccount[]>([]);
  const [bindings, setBindings] = useState<SharedBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      /**
       * The legacy bindings are fetched independently and a failure there does not fail the
       * screen: the sync connections are the primary content, and an unrelated endpoint being
       * down should not hide them.
       */
      const [catalogue, syncAccounts, legacy] = await Promise.all([
        apiFetch<{ providers: Provider[] }>("/social-sync/providers"),
        apiFetch<{ accounts: SyncAccount[] }>("/social-sync/accounts"),
        apiFetch<SharedBinding[]>("/moments/bindings").catch(() => [] as SharedBinding[]),
      ]);
      setProviders(catalogue.providers);
      setAccounts(syncAccounts.accounts);
      setBindings(legacy);
    } catch (requestError) {
      setError(friendlyError(requestError, "加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Reads the `social_sync` result the callback appended, then clears it from the URL. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("social_sync");
    if (!result) return;

    if (result === "connected") setNotice("已连接并完成首次同步");
    else if (result === "connected_sync_failed") {
      setNotice("已连接，但首次同步失败。可以稍后点「立即同步」重试。");
    }
    const socialError = params.get("social_error");
    if (socialError) setError(translateSyncError(socialError));

    // Removed so a refresh does not re-show a message about an action already taken.
    params.delete("social_sync");
    params.delete("social_error");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const accountFor = (provider: string) => accounts.find((row) => row.provider === provider);

  async function connect(provider: string) {
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<{ authorizationUrl: string }>(`/social-sync/${provider.toLowerCase()}/start`);
      // Full-page navigation: the consent screen must run in the top-level context.
      window.location.href = data.authorizationUrl;
    } catch (requestError) {
      setError(friendlyError(requestError, "无法开始授权，请稍后重试"));
      setBusy(null);
    }
  }

  async function updateAccount(account: SyncAccount, patch: { syncLimit?: number; syncEnabled?: boolean }) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/social-sync/accounts/${account.id}`, { method: "PATCH", body: patch });
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError, "保存失败，请稍后重试"));
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(account: SyncAccount) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ fetched: number }>(`/social-sync/accounts/${account.id}/sync`, {
        method: "POST",
      });
      setNotice(`已同步 ${result.fetched} 条`);
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError, "同步失败，请稍后重试"));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(account: SyncAccount) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/social-sync/accounts/${account.id}`, { method: "DELETE" });
      setNotice("已解除绑定");
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError, "解绑失败，请稍后重试"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="社交账号" backHref="/me" />

      <TFLoadingRegion label="正在加载社交账号">
        {loading ? (
          <div className="space-y-3 px-4 pb-8 pt-2">
            <TFRowSkeleton />
            <TFRowSkeleton />
            <TFRowSkeleton />
          </div>
        ) : error && accounts.length === 0 && providers.length === 0 ? (
          <TFErrorState title="加载失败" description={error} onRetry={() => void load()} />
        ) : (
          <div className="space-y-5 px-4 pb-8 pt-2">
            {notice ? (
              <p data-testid="social-sync-notice" className="text-caption text-success-600">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p data-testid="social-sync-error" role="alert" className="text-caption text-danger-600">
                {error}
              </p>
            ) : null}

            <section>
              <h2 className="mb-2 text-caption font-medium text-content-muted">同步外部动态</h2>
              <p className="mb-3 text-overline leading-4 text-content-subtle">
                授权后 TalkFirst 会读取你最近 1~3 条公开动态并展示在个人主页。我们只读取，不会发布或修改任何内容。
              </p>

              {providers.length === 0 ? (
                <TFEmptyState
                  icon={<Link2 size={20} />}
                  title="暂无可同步的平台"
                  description="本部署还没有配置任何可读取的平台。"
                />
              ) : (
                <ul className="space-y-2" data-testid="social-sync-providers">
                  {providers.map((provider) => {
                    const account = accountFor(provider.provider);
                    return (
                      <li key={provider.provider}>
                        <TFCard className="p-4" data-testid={`social-provider-${provider.provider}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-ui font-medium text-content">{provider.label}</span>
                            {account ? (
                              <TFBadge
                                tone={account.status === "ACTIVE" ? "success" : "warning"}
                                dot={account.status === "ACTIVE"}
                              >
                                {account.status === "ACTIVE"
                                  ? "已绑定"
                                  : account.status === "NEEDS_REAUTH"
                                    ? "需要重新授权"
                                    : "已解绑"}
                              </TFBadge>
                            ) : (
                              <span className="text-overline text-content-subtle">未绑定</span>
                            )}
                          </div>

                          {provider.availability !== "AVAILABLE" ? (
                            <p
                              data-testid={`social-unavailable-${provider.provider}`}
                              className="mt-2 flex items-start gap-1.5 text-overline leading-4 text-content-muted"
                            >
                              <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                              {AVAILABILITY_HINT[provider.availability]}
                            </p>
                          ) : account ? (
                            <>
                              {account.handle || account.displayName ? (
                                <p className="mt-1 text-caption text-content-muted">
                                  {account.displayName ?? account.handle}
                                  {account.handle && account.displayName ? ` · @${account.handle}` : ""}
                                </p>
                              ) : null}

                              {account.status === "NEEDS_REAUTH" ? (
                                <p className="mt-2 flex items-start gap-1.5 text-overline leading-4 text-warning-600">
                                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                  授权已失效（{translateSyncError(account.lastSyncError)}），请重新授权。
                                </p>
                              ) : null}

                              {/* Sync count. The three values are the product's promise, and the
                                  API validates them again — this is the control, not the rule. */}
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-overline text-content-muted">同步</span>
                                {SYNC_LIMITS.map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    data-testid={`social-limit-${provider.provider}-${value}`}
                                    aria-pressed={account.syncLimit === value}
                                    disabled={busy === account.id}
                                    onClick={() => void updateAccount(account, { syncLimit: value })}
                                    className={
                                      account.syncLimit === value
                                        ? "h-8 w-8 rounded-full bg-brand-500 text-caption font-medium text-white"
                                        : "h-8 w-8 rounded-full border border-border text-caption text-content-muted"
                                    }
                                  >
                                    {value}
                                  </button>
                                ))}
                                <span className="text-overline text-content-muted">条</span>
                                <button
                                  type="button"
                                  data-testid={`social-toggle-${provider.provider}`}
                                  disabled={busy === account.id}
                                  onClick={() => void updateAccount(account, { syncEnabled: !account.syncEnabled })}
                                  className="ml-1 text-overline text-content-muted underline"
                                >
                                  {account.syncEnabled ? "暂停自动同步" : "开启自动同步"}
                                </button>
                              </div>

                              <p className="mt-2 text-overline text-content-subtle">
                                最近同步：
                                {account.lastSyncedAt
                                  ? new Date(account.lastSyncedAt).toLocaleString()
                                  : "尚未同步"}
                              </p>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <TFButton
                                  size="sm"
                                  variant="secondary"
                                  data-testid={`social-sync-now-${provider.provider}`}
                                  disabled={busy === account.id}
                                  leadingIcon={<RefreshCw size={14} />}
                                  onClick={() => void syncNow(account)}
                                >
                                  立即同步
                                </TFButton>
                                {account.status === "NEEDS_REAUTH" ? (
                                  <TFButton
                                    size="sm"
                                    variant="primary"
                                    data-testid={`social-reconnect-${provider.provider}`}
                                    disabled={busy === account.id}
                                    onClick={() => void connect(provider.provider)}
                                  >
                                    重新授权
                                  </TFButton>
                                ) : null}
                                <TFButton
                                  size="sm"
                                  variant="ghost"
                                  data-testid={`social-disconnect-${provider.provider}`}
                                  disabled={busy === account.id}
                                  leadingIcon={<Unplug size={14} />}
                                  onClick={() => void disconnect(account)}
                                >
                                  解除绑定
                                </TFButton>
                              </div>
                            </>
                          ) : (
                            <div className="mt-3">
                              <TFButton
                                size="sm"
                                variant="primary"
                                data-testid={`social-connect-${provider.provider}`}
                                disabled={busy === provider.provider}
                                trailingIcon={<ArrowRight size={14} />}
                                onClick={() => void connect(provider.provider)}
                              >
                                绑定 {provider.label}
                              </TFButton>
                            </div>
                          )}
                        </TFCard>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/*
              The legacy handle-sharing rows. Shown read-only with a link to where they are
              edited, because duplicating that form here would create the second
              implementation the earlier refactor removed.
            */}
            {bindings.length > 0 ? (
              <section>
                <h2 className="mb-2 text-caption font-medium text-content-muted">展示给好友的账号</h2>
                <TFCard className="p-4">
                  <ul className="space-y-2">
                    {bindings.map((binding) => (
                      <li key={binding.platform} className="flex items-center justify-between gap-2">
                        <span className="text-ui text-content">{binding.handle}</span>
                        <TFBadge tone={binding.syncEnabled ? "success" : "neutral"}>
                          {binding.syncEnabled ? "展示中" : "已暂停"}
                        </TFBadge>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-overline leading-4 text-content-subtle">
                    这部分是「好友之间互相查看的账号」，与上面的动态同步是两件事。
                  </p>
                  <div className="mt-2">
                    <TFButton size="sm" variant="ghost" href="/moments/settings" trailingIcon={<ArrowRight size={14} />}>
                      前往管理
                    </TFButton>
                  </div>
                </TFCard>
              </section>
            ) : null}
          </div>
        )}
      </TFLoadingRegion>
    </PhoneShell>
  );
}

/**
 * Turns a provider-neutral code into something a member can act on.
 *
 * The server never sends a provider's own message, so every string here is written for this
 * screen. The fallback is deliberately vague rather than echoing input.
 */
function translateSyncError(code: string | null): string {
  switch (code) {
    case "SOCIAL_AUTH_REQUIRED":
      return "授权已失效";
    case "SOCIAL_TOKEN_REFRESH_FAILED":
      return "无法续期授权";
    case "SOCIAL_PERMISSION_DENIED":
      return "缺少读取权限";
    case "SOCIAL_RATE_LIMITED":
      return "平台访问频率受限，请稍后再试";
    case "SOCIAL_PROVIDER_NOT_SUPPORTED":
      return "该平台暂不支持";
    case "SOCIAL_PROVIDER_REQUIRES_APPROVAL":
      return "该平台需要开发者审批";
    case "SOCIAL_AUTH_FAILED":
      return "授权失败";
    case "SOCIAL_SYNC_FAILED":
      return "同步失败";
    case "SOCIAL_PROVIDER_ERROR":
      return "平台暂时不可用";
    default:
      return "未知错误";
  }
}

function friendlyError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError)) return fallback;
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return fallback;
  }
  return message;
}
