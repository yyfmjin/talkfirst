"use client";

import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import {
  TFAvatar,
  TFBadge,
  TFButton,
  TFEmptyState,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
} from "@/components/tf";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { apiFetch } from "@/lib/api";
import { localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

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
  const { locale, t } = useT();
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
      setError(requestError instanceof Error ? requestError.message : t("connections.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-6">
        <h1 className="text-title font-semibold text-content">{t("connections.title")}</h1>
        <p className="mt-1 text-caption leading-5 text-content-muted">
          {t("connections.subtitle")}
        </p>

        {loading ? (
          <TFLoadingRegion label={t("connections.loading")}>
            <div className="mt-6 divide-y divide-border">
              <TFRowSkeleton />
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error ? (
          <div className="mt-6">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <TFEmptyState
            icon={<Users size={26} />}
            title={t("connections.emptyTitle")}
            description={t("connections.emptyBody")}
            action={
              <TFButton href={localePath(locale, "/discover")} size="md" fullWidth>
                {t("connections.goDiscover")}
              </TFButton>
            }
          />
        ) : null}

        {!loading && !error && items.length > 0 ? (
          /* Hairline-divided rows, matching messages and the feed. */
          <div className="mt-5 divide-y divide-border overflow-hidden rounded-card border border-border">
            {items.map((item) => (
              <article key={item.id} className="bg-surface px-4 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(item.peer.id)}
                    aria-label={t("connections.viewProfile", { name: item.peer.nickname ?? t("common.user") })}
                    className="shrink-0"
                  >
                    <TFAvatar name={item.peer.nickname} src={item.peer.avatarUrl} size="lg" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(item.peer.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-body font-semibold text-content">
                      {item.peer.nickname ?? t("common.talkFirstUser")}
                    </p>
                    <p className="mt-0.5 text-caption text-content-muted">
                      {item.peer.countryCode ?? t("common.global")} · {t("connections.connectedOn")}{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                </div>
                {item.peer.bio ? (
                  <p className="mt-3 line-clamp-2 text-caption leading-5 text-content-muted">{item.peer.bio}</p>
                ) : null}
                {item.peer.interests.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.peer.interests.slice(0, 4).map((interest) => (
                      <TFBadge key={interest.slug} tone="brand">
                        {interest.nameZh ?? interest.name}
                      </TFBadge>
                    ))}
                  </div>
                ) : null}
                {/* The exchange state is the one thing on this row a member needs to
                    act on, so it gets its own strip rather than sitting in the
                    metadata line. The three strings are unchanged. */}
                <div className="mt-3 flex items-center justify-between gap-2 rounded-row bg-surface-sunken px-3 py-2 text-caption text-content-muted">
                  <span className="min-w-0">
                    {item.exchange?.status === "ACCEPTED"
                      ? t("connections.exchanged", { platforms: item.exchange.platforms.join("、") })
                      : item.exchange?.status === "PENDING"
                        ? t("connections.exchangePending")
                        : t("connections.hidden")}
                  </span>
                  {item.conversationId ? (
                    <a
                      href={`/messages/${item.conversationId}/connect`}
                      className="shrink-0 font-medium text-brand-600 underline decoration-dotted"
                    >
                      {t("connections.viewExchange")}
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
