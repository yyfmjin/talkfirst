"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { ScreenHeader } from "@/components/screen-header";
import { AttributeTagList } from "@/components/attribute-tags";
import { GradientButton, OutlineButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { avatarInitial, type PublicProfile } from "@/lib/profile";

/**
 * PC-1.4 §16-§18: the full profile page.
 *
 * Everything here comes from `GET /users/:id`, which applies the block check
 * and per-field visibility before responding. Sections whose data the viewer
 * may not see render nothing at all — no empty heading, no "暂无" — so the page
 * never discloses that a field exists but is hidden.
 */
export default function ProfileDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [helloSending, setHelloSending] = useState(false);
  const [helloDone, setHelloDone] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<PublicProfile>(`/users/${id}`);
      setProfile(data);
    } catch (requestError) {
      setProfile(null);
      setError(friendlyErrorMessage(requestError, "资料加载失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setHelloDone(false);
  }, [id]);

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

  const isSelf = profile?.relationship.isSelf ?? false;
  const aboutVisible = Boolean(
    profile &&
      (profile.attributes.aboutMe.length > 0 ||
        profile.languages.length > 0 ||
        profile.interests.length > 0),
  );
  const lookingVisible = Boolean(
    profile &&
      (profile.attributes.lookingFor.length > 0 ||
        profile.purposes.length > 0 ||
        profile.preferredCountries.length > 0),
  );
  const place = profile
    ? [profile.city, profile.region, profile.countryName ?? profile.countryCode].filter(Boolean).join(" · ")
    : "";

  return (
    <PhoneShell>
      <ScreenHeader title="个人资料" backHref="/discover" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-32 rounded-3xl bg-indigo-50" />
            <div className="h-24 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error && !profile ? (
          <div className="rounded-2xl bg-red-50 p-4 text-center">
            <p className="text-[12px] text-red-700">{error}</p>
            <OutlineButton className="mt-3 min-h-[2.5rem] w-full text-[12px]" onClick={() => void load()}>
              重试
            </OutlineButton>
            <button onClick={() => router.back()} className="mt-3 text-[12px] text-muted underline">
              返回上一页
            </button>
          </div>
        ) : null}

        {profile ? (
          <>
            <section className="overflow-hidden rounded-3xl border border-line bg-white">
              <div className="tf-gradient-soft h-20" />
              <div className="-mt-8 px-4 pb-5">
                <div className="flex items-end gap-3">
                  {profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatarUrl}
                      alt={`${profile.nickname ?? "用户"} 的头像`}
                      className="h-16 w-16 shrink-0 rounded-full border-4 border-white object-cover shadow"
                    />
                  ) : (
                    <div className="tf-gradient grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-white text-xl font-semibold text-white shadow">
                      {avatarInitial(profile.nickname)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-[17px] font-semibold">
                      <span className="min-w-0 flex-1 truncate">{profile.nickname ?? "TalkFirst 用户"}</span>
                      <BadgeCheck size={15} className="shrink-0 text-[#6572D8]" />
                    </p>
                    {profile.age !== null || place ? (
                      <p className="mt-0.5 text-[12px] text-muted">
                        {profile.countryFlag ?? "🌎"} {place}
                        {profile.age !== null ? ` · ${profile.age} 岁` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                {profile.bio ? (
                  <p className="mt-3 whitespace-pre-line break-words text-[13px] leading-5 text-muted">
                    {profile.bio}
                  </p>
                ) : null}
              </div>
            </section>

            {aboutVisible ? (
              <section data-testid="profile-about" className="mt-4 rounded-3xl border border-line bg-white p-4">
                <p className="text-[13px] font-semibold">关于 TA</p>

              {profile.attributes.aboutMe.length > 0 ? (
                <div className="mt-2">
                  <AttributeTagList attributes={profile.attributes.aboutMe} tone="about" />
                </div>
              ) : null}

              {profile.languages.length > 0 ? (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] text-muted">语言</p>
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
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] text-muted">兴趣</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.interests.map((interest) => (
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
              </section>
            ) : null}

            {lookingVisible ? (
              <section data-testid="profile-looking" className="mt-4 rounded-3xl border border-line bg-white p-4">
                <p className="text-[13px] font-semibold">交友需求</p>

                {profile.attributes.lookingFor.length > 0 ? (
                  <div className="mt-2">
                    <AttributeTagList attributes={profile.attributes.lookingFor} tone="looking" />
                  </div>
                ) : null}

                {profile.purposes.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] text-muted">交友目的</p>
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

                {profile.preferredCountries.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] text-muted">想认识的国家/地区</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.preferredCountries.map((country) => (
                        <span
                          key={country.code}
                          className="rounded-full bg-[#EAFBF1] px-3 py-1 text-[11px] text-[#0E9F6E]"
                        >
                          {country.flag ?? ""} {country.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {error ? <p className="mt-3 text-center text-[12px] text-red-500">{error}</p> : null}

            {!isSelf ? (
              <div className="mt-6 flex gap-2">
                <OutlineButton href={`/moments/user/${profile.id}`} className="min-h-[2.75rem] flex-1 text-[12px]">
                  查看动态
                </OutlineButton>
                {profile.relationship.isConnected ? (
                  <GradientButton className="min-h-[2.75rem] flex-[2] text-[12px]" disabled>
                    已连接
                  </GradientButton>
                ) : (
                  <GradientButton
                    className="min-h-[2.75rem] flex-[2] text-[12px]"
                    onClick={() => void sayHello()}
                    disabled={helloSending || helloDone}
                    aria-label="打招呼"
                  >
                    {helloDone ? "已打招呼" : helloSending ? "发送中…" : "打招呼"}
                  </GradientButton>
                )}
              </div>
            ) : (
              <div className="mt-6 space-y-2">
                <GradientButton onClick={() => router.push("/me/edit")}>编辑我的资料</GradientButton>
                <GradientButton onClick={() => router.push("/me/attributes")}>管理交友属性</GradientButton>
                <GradientButton onClick={() => router.push("/me/visibility")}>资料可见范围</GradientButton>
              </div>
            )}
          </>
        ) : null}
      </div>
      <TabBar active="/discover" />
    </PhoneShell>
  );
}
