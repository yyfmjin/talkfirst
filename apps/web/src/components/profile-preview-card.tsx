"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { AttributeTagList } from "@/components/attribute-tags";
import {
  TFAvatar,
  TFBadge,
  TFButton,
  TFErrorState,
  TFLoadingRegion,
  TFSkeleton,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { type PublicProfile } from "@/lib/profile";

/**
 * PC-1.4 §14-§15: the single profile card.
 *
 * Every avatar / nickname entry point (Discover, Moments, Moments/User,
 * comments, Connections) opens this component — pages must not grow their own
 * copy, because a second copy is how a private field eventually leaks.
 *
 * What it renders comes only from `GET /users/:id`, which already applies block
 * checks and per-field visibility. `email`, `passwordHash`, tokens, OAuth data
 * and social handles are not part of `PublicProfile` at all, so they cannot be
 * shown even by accident. Hidden fields arrive as `null` / `[]`, and those rows
 * are omitted entirely rather than printed as "暂无".
 */
export function ProfilePreviewCard({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [helloSending, setHelloSending] = useState(false);
  const [helloDone, setHelloDone] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    setHelloDone(false);
    try {
      const data = await apiFetch<PublicProfile>(`/users/${userId}`);
      setProfile(data);
    } catch (requestError) {
      setProfile(null);
      setError(friendlyErrorMessage(requestError, "资料加载失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      setProfile(null);
      void load();
    }
  }, [userId, load]);

  useEffect(() => {
    if (!userId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [userId, onClose]);

  if (!userId) return null;

  async function sayHello() {
    if (!profile || helloSending) return;
    setHelloSending(true);
    setError("");
    try {
      await apiFetch("/connections/requests", {
        method: "POST",
        body: { receiverId: profile.id, templateId: "language" },
      });
      setHelloDone(true);
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "发送失败，请稍后再试。"));
    } finally {
      setHelloSending(false);
    }
  }

  const showActions = profile && !profile.relationship.isSelf;
  // One line, built from whatever survived visibility — never a placeholder.
  const place = profile
    ? [profile.city, profile.region, profile.countryName ?? profile.countryCode].filter(Boolean).join(" · ")
    : "";

  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-surface-scrim sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="个人资料卡"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-testid="profile-preview-card"
        className="tf-scroll max-h-[88%] w-full overflow-y-auto rounded-t-sheet bg-surface p-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:max-w-[390px] sm:rounded-sheet"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-heading font-semibold text-content">个人资料</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-sunken text-content-muted transition-colors duration-instant hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <TFLoadingRegion label="正在加载资料">
            <div className="mt-5 space-y-3">
              <div className="flex justify-center">
                <TFSkeleton shape="circle" className="h-20 w-20" />
              </div>
              <TFSkeleton shape="text" className="mx-auto h-5 w-1/2" />
              <TFSkeleton shape="text" className="mx-auto h-3 w-2/3" />
              <TFSkeleton shape="block" className="h-20 w-full" />
            </div>
          </TFLoadingRegion>
        ) : error && !profile ? (
          <TFErrorState description={error} onRetry={() => void load()} />
        ) : profile ? (
          <>
            <div className="mt-4 flex flex-col items-center text-center">
              <TFAvatar name={profile.nickname} src={profile.avatarUrl} size="xl" ring />
              <p className="mt-3 text-heading font-semibold text-content">
                {profile.nickname ?? "TalkFirst 用户"}
                {profile.age !== null ? (
                  <span className="ml-1 text-caption font-normal text-content-muted">{profile.age} 岁</span>
                ) : null}
              </p>
              {place ? (
                <p className="mt-0.5 text-caption text-content-muted">
                  {profile.countryFlag ?? "🌎"} {place}
                </p>
              ) : null}
            </div>

            {profile.bio ? (
              <p className="mt-4 whitespace-pre-line break-words rounded-row bg-surface-sunken px-3.5 py-2.5 text-ui leading-6 text-content-muted">
                {profile.bio}
              </p>
            ) : null}

            {profile.attributes.aboutMe.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-caption font-medium text-content-muted">我的介绍</p>
                <AttributeTagList attributes={profile.attributes.aboutMe} tone="about" limit={6} />
              </div>
            ) : null}

            {profile.attributes.lookingFor.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-caption font-medium text-content-muted">交友需求</p>
                <AttributeTagList attributes={profile.attributes.lookingFor} tone="looking" limit={6} />
              </div>
            ) : null}

            {profile.languages.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-caption font-medium text-content-muted">语言</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.languages.map((language) => (
                    <TFBadge key={`${language.code}-${language.type}`} tone="brand">
                      {language.nativeName ?? language.name}
                      <span className="opacity-70">
                        {language.type === "NATIVE" ? "母语" : "学习中"}
                      </span>
                    </TFBadge>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.interests.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-caption font-medium text-content-muted">兴趣</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.interests.slice(0, 8).map((interest) => (
                    <TFBadge key={interest.slug} tone="brand">
                      {interest.nameZh ?? interest.name}
                    </TFBadge>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.purposes.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-caption font-medium text-content-muted">交友目的</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.purposes.map((purpose) => (
                    <TFBadge key={purpose.slug} tone="warning">
                      {purpose.nameZh ?? purpose.name}
                    </TFBadge>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 break-words text-center text-caption text-danger-600">
                {error}
              </p>
            ) : null}

            {showActions ? (
              <div className="mt-6 flex gap-2">
                <TFButton
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push(`/profile/${profile.id}`);
                  }}
                >
                  查看完整资料
                </TFButton>
                {profile.relationship.isConnected ? (
                  /* A disabled 「已连接」 is the *correct* disabled control here —
                     there is no action left to take. It keeps `disabled` (and so
                     stays in the accessibility tree) rather than being hidden. */
                  <TFButton variant="secondary" className="flex-[2]" disabled>
                    已连接
                  </TFButton>
                ) : helloDone ? (
                  /**
                   * UX FIX (audit): the button used to become a disabled
                   * 「已打招呼」 and nothing else happened — the card stayed open
                   * with no indication of where the request had gone. The
                   * *acceptance* actually happens on the 消息 tab, which is a
                   * different tab from the one the user was looking at, so this
                   * now says so and offers to go there.
                   */
                  <TFButton
                    className="flex-[2]"
                    onClick={() => {
                      onClose();
                      router.push("/messages");
                    }}
                  >
                    已打招呼 · 去消息查看
                  </TFButton>
                ) : (
                  <TFButton
                    className="flex-[2]"
                    onClick={() => void sayHello()}
                    loading={helloSending}
                    loadingLabel="发送中…"
                    /* `label` is what the E2E suite matches on:
                       `getByRole("button", { name: "打招呼" })`. */
                    aria-label="打招呼"
                  >
                    打招呼
                  </TFButton>
                )}
              </div>
            ) : null}

            {profile.relationship.isSelf ? (
              <div className="mt-6 flex gap-2">
                <TFButton
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push("/me/edit");
                  }}
                >
                  编辑我的资料
                </TFButton>
                <TFButton
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push("/me/attributes");
                  }}
                >
                  管理标签
                </TFButton>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
