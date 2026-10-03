"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Link2, Unplug } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFBadge, TFButton, TFCard, TFEmptyState, TFErrorState, TFRowSkeleton, TFLoadingRegion } from "@/components/tf";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * 「社交账号」 — the member's platform connections.
 *
 * ## What this page was (audit finding)
 *
 * A dead end. It rendered one paragraph of prose — "管理已并入个人动态同步设置，
 * 请前往动态设置绑定平台" — and then **no link to that page**. The instruction told
 * the member where to go and gave them no way to get there, while the row that led
 * here sat under 「关系」 in 「我的」. The only way on was to guess that 「动态设置」
 * means the settings icon in the top-right of the feed, four taps away.
 *
 * ## What it is now
 *
 * A **status** view, which is what the entry point promises ("管理社交账号"):
 * every platform the product supports, whether it is bound, under which handle,
 * and whether syncing is on. Binding itself still lives in one place —
 * `/moments/settings` — because duplicating the bind form here would create the
 * second implementation of the same flow that this whole refactor exists to
 * remove. The difference is that this page now *takes you there*.
 *
 * Read-only on purpose: no writes, no API surface added.
 */

type Platform = { id: string; label: string; icon: string; color: string; connectedLabel: string };
type Binding = { platform: string; handle: string; displayName: string | null; syncEnabled: boolean };

export default function SocialAccountsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [platformList, bindingList] = await Promise.all([
        apiFetch<Platform[]>("/moments/platforms"),
        apiFetch<Binding[]>("/moments/bindings"),
      ]);
      setPlatforms(platformList);
      setBindings(bindingList);
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "加载失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bound = (id: string) => bindings.find((item) => item.platform === id);

  return (
    <PhoneShell>
      <ScreenHeader title="社交账号" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">
          绑定后可以把你在其他平台发布的内容同步到这里。账号默认对陌生人隐藏，只有双方同意交换后才会展示。
        </p>

        {loading ? (
          <TFLoadingRegion label="正在加载社交账号">
            <div className="mt-5 divide-y divide-border overflow-hidden rounded-card border border-border">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="px-4 py-4">
                  <TFRowSkeleton />
                </div>
              ))}
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error ? (
          <div className="mt-5">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading && !error && platforms.length === 0 ? (
          <div className="mt-5">
            <TFEmptyState
              icon={<Unplug size={26} />}
              title="暂无可绑定的平台"
              description="平台列表暂时不可用，请稍后再试。"
            />
          </div>
        ) : null}

        {!loading && !error && platforms.length > 0 ? (
          <TFCard flush className="mt-5">
            <ul className="divide-y divide-border">
              {platforms.map((platform) => {
                const current = bound(platform.id);
                return (
                  <li key={platform.id} className="flex items-center gap-3 px-4 py-3.5">
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-caption font-bold text-white"
                      style={{ background: platform.color }}
                    >
                      {platform.icon.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui font-medium text-content">{platform.label}</span>
                      <span className="mt-0.5 block truncate text-caption text-content-muted">
                        {current ? `@${current.handle}` : "未绑定"}
                      </span>
                    </span>
                    {current ? (
                      <TFBadge tone={current.syncEnabled ? "success" : "neutral"} dot={current.syncEnabled}>
                        {current.syncEnabled ? "同步中" : "已暂停"}
                      </TFBadge>
                    ) : (
                      <TFBadge tone="neutral">未绑定</TFBadge>
                    )}
                  </li>
                );
              })}
            </ul>
          </TFCard>
        ) : null}

        {/*
          The link that was missing. One primary action, and it goes to the page
          that actually owns binding — this screen never pretends to do the write.
        */}
        {!loading && !error ? (
          <div className="mt-6">
            <TFButton href="/moments/settings" variant="primary" fullWidth trailingIcon={<ArrowRight size={17} />}>
              去绑定或管理
            </TFButton>
          </div>
        ) : null}

        <p className="mt-4 flex items-start gap-1.5 text-caption leading-5 text-content-subtle">
          <Link2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>绑定只用于同步展示，TalkFirst 不会代你发布内容，也不会在未同意的情况下把账号展示给别人。</span>
        </p>
      </div>
    </PhoneShell>
  );
}
