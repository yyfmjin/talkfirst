"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { AttributeTagList } from "@/components/attribute-tags";
import { SmallButton, GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { avatarInitial, type PublicProfile } from "@/lib/profile";

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
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="个人资料卡"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-testid="profile-preview-card"
        className="tf-scroll max-h-[88%] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:max-w-[390px] sm:rounded-[28px]"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-[16px] font-semibold">个人资料</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="grid h-8 w-8 place-items-center rounded-full bg-[#F1F3FF] text-[#6572D8]"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="mx-auto h-20 w-20 rounded-full bg-indigo-50" />
            <div className="h-5 w-1/2 rounded bg-indigo-50" />
            <div className="h-3 w-2/3 rounded bg-indigo-50" />
            <div className="h-20 rounded-2xl bg-indigo-50" />
          </div>
        ) : error && !profile ? (
          <div className="mt-5 rounded-2xl bg-red-50 p-4 text-center">
            <p className="text-[13px] text-red-700">{error}</p>
            <SmallButton className="mt-3 w-full" onClick={() => void load()}>
              重试
            </SmallButton>
          </div>
        ) : profile ? (
          <>
            <div className="mt-4 flex flex-col items-center text-center">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt={`${profile.nickname ?? "用户"} 的头像`}
                  className="h-20 w-20 rounded-full object-cover shadow"
                />
              ) : (
                <div className="tf-gradient grid h-20 w-20 place-items-center rounded-full text-2xl font-semibold text-white shadow">
                  {avatarInitial(profile.nickname)}
                </div>
              )}
              <p className="mt-3 text-[18px] font-semibold">
                {profile.nickname ?? "TalkFirst 用户"}
                {profile.age !== null ? (
                  <span className="ml-1 text-[13px] font-normal text-muted">{profile.age} 岁</span>
                ) : null}
              </p>
              {place ? (
                <p className="mt-0.5 text-[12px] text-muted">
                  {profile.countryFlag ?? "🌎"} {place}
                </p>
              ) : null}
            </div>

            {profile.bio ? (
              <p className="mt-4 whitespace-pre-line break-words rounded-2xl bg-[#F8F9FF] px-3 py-2 text-[12px] leading-5 text-muted">
                {profile.bio}
              </p>
            ) : null}

            {profile.attributes.aboutMe.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium text-muted">我的介绍</p>
                <AttributeTagList attributes={profile.attributes.aboutMe} tone="about" limit={6} />
              </div>
            ) : null}

            {profile.attributes.lookingFor.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium text-muted">交友需求</p>
                <AttributeTagList attributes={profile.attributes.lookingFor} tone="looking" limit={6} />
              </div>
            ) : null}

            {profile.languages.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium text-muted">语言</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.languages.map((language) => (
                    <span
                      key={`${language.code}-${language.type}`}
                      className="rounded-full bg-[#F1F3FF] px-3 py-1 text-[11px] text-[#6572D8]"
                    >
                      {language.nativeName ?? language.name}
                      <span className="ml-1 text-[10px] opacity-70">
                        {language.type === "NATIVE" ? "母语" : "学习中"}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.interests.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium text-muted">兴趣</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.interests.slice(0, 8).map((interest) => (
                    <span
                      key={interest.slug}
                      className="rounded-full bg-[#F1F3FF] px-3 py-1 text-[11px] text-[#6572D8]"
                    >
                      {interest.nameZh ?? interest.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {profile.purposes.length > 0 ? (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-medium text-muted">交友目的</p>
                <div className="flex flex-wrap gap-1.5">
                  {profile.purposes.map((purpose) => (
                    <span
                      key={purpose.slug}
                      className="rounded-full bg-[#FFF4E5] px-3 py-1 text-[11px] text-[#B26A00]"
                    >
                      {purpose.nameZh ?? purpose.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-3 text-center text-[12px] text-red-500">{error}</p> : null}

            {showActions ? (
              <div className="mt-6 flex gap-2">
                <SmallButton
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push(`/profile/${profile.id}`);
                  }}
                >
                  查看完整资料
                </SmallButton>
                {profile.relationship.isConnected ? (
                  <SmallButton variant="gradient" className="flex-[2]" disabled>
                    已连接
                  </SmallButton>
                ) : (
                  <GradientButton
                    className="min-h-[2.5rem] flex-[2] text-[13px]"
                    onClick={() => void sayHello()}
                    disabled={helloSending || helloDone}
                    aria-label="打招呼"
                  >
                    {helloDone ? "已打招呼" : helloSending ? "发送中…" : "打招呼"}
                  </GradientButton>
                )}
              </div>
            ) : null}

            {profile.relationship.isSelf ? (
              <div className="mt-6 flex gap-2">
                <SmallButton
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push("/me/edit");
                  }}
                >
                  编辑我的资料
                </SmallButton>
                <SmallButton
                  variant="gradient"
                  className="flex-1"
                  onClick={() => {
                    onClose();
                    router.push("/me/attributes");
                  }}
                >
                  管理标签
                </SmallButton>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
