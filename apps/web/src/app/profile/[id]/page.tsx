"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BadgeCheck, Flower2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { ScreenHeader } from "@/components/screen-header";
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
  // 送花（虚拟礼物）：服务端回答是权威 —— 切换后直接用响应里的数字。
  const [flowerSent, setFlowerSent] = useState(false);
  const [flowerCount, setFlowerCount] = useState(0);
  const [flowerSending, setFlowerSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<PublicProfile>(`/users/${id}`);
      setProfile(data);
      setFlowerSent(data.flowerFromViewer);
      setFlowerCount(data.flowerCount);
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
    setFlowerSent(false);
    setFlowerCount(0);
  }, [id]);

  /**
   * 送花 / 收回 —— 一个端点做 toggle，与动态的点赞同一形状。
   *
   * 计数以**响应**为准而不是本地 +1：同一对只有一条花，服务端才知道真实朵数
   * （别人也可能同时在送）。
   */
  async function toggleFlower() {
    if (!profile || flowerSending) return;
    setFlowerSending(true);
    setError("");
    try {
      const result = await apiFetch<{ sent: boolean; flowerCount: number }>(
        `/users/${profile.id}/flowers`,
        { method: "POST" },
      );
      setFlowerSent(result.sent);
      setFlowerCount(result.flowerCount);
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "送花失败，请稍后再试。"));
    } finally {
      setFlowerSending(false);
    }
  }

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
          <TFLoadingRegion label="正在加载资料">
            <div className="space-y-3">
              <TFSkeleton shape="block" className="h-32 w-full" />
              <TFSkeleton shape="block" className="h-24 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {!loading && error && !profile ? (
          <div>
            <TFErrorState description={error} onRetry={() => void load()} />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-control px-3 py-2 text-ui text-content-muted underline decoration-dotted"
              >
                返回上一页
              </button>
            </div>
          </div>
        ) : null}

        {profile ? (
          <>
            <section className="overflow-hidden rounded-card border border-border bg-surface">
              <div className="tf-gradient-soft h-20" />
              <div className="-mt-8 px-4 pb-5">
                <div className="flex items-end gap-3">
                  <TFAvatar
                    name={profile.nickname}
                    src={profile.avatarUrl}
                    size="lg"
                    ring
                    className="border-4 border-white"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-heading font-semibold text-content">
                      <span className="min-w-0 flex-1 truncate">{profile.nickname ?? "TalkFirst 用户"}</span>
                      <BadgeCheck size={16} className="shrink-0 text-brand-500" aria-hidden="true" />
                    </p>
                    {profile.age !== null || place ? (
                      <p className="mt-0.5 text-caption text-content-muted">
                        {profile.countryFlag ?? "🌎"} {place}
                        {profile.age !== null ? ` · ${profile.age} 岁` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                {profile.bio ? (
                  <p className="mt-3 whitespace-pre-line break-words text-ui leading-6 text-content-muted">
                    {profile.bio}
                  </p>
                ) : null}
              </div>
            </section>

            {/*
              IMPORTANT: `aboutVisible` / `lookingVisible` gate the whole SECTION.
              Nothing inside renders when the tier is withheld — no heading, no
              「暂无」 placeholder. `profile.spec.ts` asserts exactly that:
                await expect(page.getByText("暂无")).toHaveCount(0);
              so this must stay a render-or-nothing branch. The copy 「关于 TA」 is
              also asserted by text, so it is unchanged.
            */}
            {aboutVisible ? (
              <section data-testid="profile-about" className="mt-4 rounded-card border border-border bg-surface p-4">
                <p className="text-ui font-semibold text-content">关于 TA</p>

              {profile.attributes.aboutMe.length > 0 ? (
                <div className="mt-2">
                  <AttributeTagList attributes={profile.attributes.aboutMe} tone="about" />
                </div>
              ) : null}

              {profile.languages.length > 0 ? (
                <div className="mt-3">
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
                <div className="mt-3">
                  <p className="mb-2 text-caption font-medium text-content-muted">兴趣</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.interests.map((interest) => (
                      <TFBadge key={interest.slug} tone="brand">
                        {interest.nameZh ?? interest.name}
                      </TFBadge>
                    ))}
                  </div>
                </div>
              ) : null}
              </section>
            ) : null}

            {lookingVisible ? (
              <section data-testid="profile-looking" className="mt-4 rounded-card border border-border bg-surface p-4">
                <p className="text-ui font-semibold text-content">交友需求</p>

                {profile.attributes.lookingFor.length > 0 ? (
                  <div className="mt-2">
                    <AttributeTagList attributes={profile.attributes.lookingFor} tone="looking" />
                  </div>
                ) : null}

                {profile.purposes.length > 0 ? (
                  <div className="mt-3">
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

                {profile.preferredCountries.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-2 text-caption font-medium text-content-muted">想认识的国家/地区</p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.preferredCountries.map((country) => (
                        <TFBadge key={country.code} tone="success">
                          {country.flag ?? ""} {country.name}
                        </TFBadge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 break-words text-center text-caption text-danger-600">
                {error}
              </p>
            ) : null}

            {!isSelf ? (
              <>
                <div className="mt-6 flex gap-2">
                  <TFButton
                    variant="secondary"
                    href={`/moments/user/${profile.id}`}
                    className="flex-1"
                  >
                    查看动态
                  </TFButton>
                  {profile.relationship.isConnected ? (
                    <TFButton variant="secondary" className="flex-[2]" disabled>
                      已连接
                    </TFButton>
                  ) : (
                    <TFButton
                      className="flex-[2]"
                      onClick={() => void sayHello()}
                      disabled={helloSending || helloDone}
                      /* `aria-label` is how the suite finds this button. */
                      aria-label="打招呼"
                    >
                      {helloDone ? "已打招呼" : helloSending ? "发送中…" : "打招呼"}
                    </TFButton>
                  )}
                </div>
                {/*
                  送花（虚拟礼物）：点赞式的一次性动作，再点一次是收回。
                  它排在打招呼下面而不是并排：主位只有一个。
                */}
                <TFButton
                  variant={flowerSent ? "secondary" : "primary"}
                  fullWidth
                  className="mt-2"
                  loading={flowerSending}
                  loadingLabel="送出中…"
                  leadingIcon={<Flower2 size={18} aria-hidden="true" />}
                  onClick={() => void toggleFlower()}
                  aria-label="送花"
                  aria-pressed={flowerSent}
                >
                  {flowerSent ? "已送花" : "送一朵花"}
                </TFButton>
                <p className="mt-2 text-center text-caption text-content-muted">
                  {flowerCount > 0 ? `已收到 ${flowerCount} 朵花` : "还没有收到花"}
                </p>
              </>
            ) : (
              <div className="mt-6 space-y-2">
                <TFButton size="lg" fullWidth onClick={() => router.push("/me/edit")}>
                  编辑我的资料
                </TFButton>
                <TFButton variant="secondary" fullWidth onClick={() => router.push("/me/attributes")}>
                  管理交友属性
                </TFButton>
                <TFButton variant="secondary" fullWidth onClick={() => router.push("/me/visibility")}>
                  资料可见范围
                </TFButton>
              </div>
            )}
          </>
        ) : null}
      </div>
      <TabBar active="/discover" />
    </PhoneShell>
  );
}
