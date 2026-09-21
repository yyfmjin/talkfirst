"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/brand";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { AttributeTagList } from "@/components/attribute-tags";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { type AttributeGroups } from "@/lib/profile";

type FullProfile = {
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  bio: string | null;
  isAdmin?: boolean;
  status?: string;
  languages: Array<{ code: string; name: string; nativeName: string | null; level: string }>;
  interests: Array<{ name: string; nameZh: string | null }>;
  attributes: AttributeGroups;
};

const EMPTY_ATTRIBUTES: AttributeGroups = { aboutMe: [], lookingFor: [] };

const ENTRIES = [
  { href: "/me/edit", label: "编辑基本资料" },
  { href: "/me/interests", label: "语言 · 兴趣 · 交友目的" },
  { href: "/me/attributes", label: "交友属性（我的介绍 / 交友需求）" },
  { href: "/me/visibility", label: "资料可见范围" },
  { href: "/me/social", label: "管理社交账号" },
  { href: "/me/safety", label: "安全中心 · 拉黑与举报" },
];

export default function MePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FullProfile>("/users/me");
      setProfile(data);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message.includes("Unauthorized")) {
        router.replace("/login");
        return;
      }
      setError(friendlyErrorMessage(requestError, "加载失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const attributes = profile?.attributes ?? EMPTY_ATTRIBUTES;
  const place = [profile?.city, profile?.region, profile?.countryCode].filter(Boolean).join(" · ");

  return (
    <PhoneShell>
      <div className="tf-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-6 pt-8">
        <LogoMark size={72} />
        <h1 className="mt-4 text-[20px] font-semibold">{profile?.nickname ?? (loading ? "加载中…" : "我的名片")}</h1>
        {place ? <p className="mt-1 text-[13px] text-muted">{place}</p> : null}
        {profile?.isAdmin ? (
          <span className="mt-2 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-medium text-amber-700">
            🛡️ 管理员
          </span>
        ) : null}
        {profile?.bio ? (
          <p className="mt-2 text-center text-[13px] leading-6 text-muted">{profile.bio}</p>
        ) : null}

        {profile && profile.interests.length > 0 ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {profile.interests.map((item) => (
              <span key={item.name} className="rounded-full bg-indigo-50 px-3 py-1 text-[12px] text-[#6B7CFF]">
                {item.nameZh ?? item.name}
              </span>
            ))}
          </div>
        ) : null}

        {attributes.aboutMe.length > 0 ? (
          <div className="mt-4 w-full">
            <p className="mb-1.5 text-center text-[11px] text-muted">我的介绍</p>
            <div className="flex justify-center">
              <AttributeTagList attributes={attributes.aboutMe} tone="about" limit={6} showRetired />
            </div>
          </div>
        ) : null}

        {attributes.lookingFor.length > 0 ? (
          <div className="mt-3 w-full">
            <p className="mb-1.5 text-center text-[11px] text-muted">交友需求</p>
            <div className="flex justify-center">
              <AttributeTagList attributes={attributes.lookingFor} tone="looking" limit={6} showRetired />
            </div>
          </div>
        ) : null}

        {profile ? (
          <p className="mt-4 text-center text-[12px] text-muted">
            语言：{profile.languages.map((item) => item.nativeName ?? item.name).join("、") || "—"}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 text-center text-[12px] text-red-500">
            {error}
            <button onClick={() => void load()} className="ml-2 underline">
              重试
            </button>
          </p>
        ) : null}

        <div className="mt-6 w-full space-y-2">
          {ENTRIES.map((entry) => (
            <GradientButton key={entry.href} onClick={() => router.push(entry.href)}>
              {entry.label}
            </GradientButton>
          ))}
          <GradientButton onClick={() => router.push("/me/password")}>修改密码</GradientButton>
          {profile?.isAdmin ? (
            <GradientButton onClick={() => router.push("/admin")}>🛡️ 管理后台</GradientButton>
          ) : (
            <p className="pt-1 text-center text-[11px] leading-4 text-muted">
              普通账号看不到后台入口。如需要，请联系管理员为你开通。
            </p>
          )}
        </div>
      </div>
      <TabBar active="/me" />
    </PhoneShell>
  );
}
