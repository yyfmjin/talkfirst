"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFChip, TFInput, TFTextarea, TFButton } from "@/components/tf";
import { AvatarActionSheet, ClickableAvatar } from "@/components/avatar-actions";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { useSession, type SessionUser } from "@/lib/session";

const genders = [
  { label: "男", value: "MALE" },
  { label: "女", value: "FEMALE" },
  { label: "其他", value: "OTHER" },
  { label: "不想说", value: "UNKNOWN" },
];

type Country = { code: string; name: string; flag: string | null };

/** The subset of `GET /users/me` this form edits. */
type FullCard = {
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  gender: string;
  bio: string | null;
};

const NICKNAME_MAX = 20;
const REGION_MAX = 80;
const CITY_MAX = 80;
const BIO_MAX = 500;

function ageOf(date: string) {
  const birth = new Date(date);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const month = now.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export default function EditProfilePage() {
  const { user, setUser } = useSession();
  const [countries, setCountries] = useState<Country[]>([]);
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("UNKNOWN");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);
  const loadedOnce = useRef(false);

  useEffect(() => {
    apiFetch<Country[]>("/meta/countries")
      .then((items) => setCountries(items))
      .catch(() => undefined);
  }, []);

  /**
   * Prefill from the server, never from `user` — the session cache can be older
   * than the database, and this form must start from what is actually stored.
   */
  const prefill = useCallback(async () => {
    setPrefilling(true);
    setError("");
    try {
      const profile = await apiFetch<FullCard>("/users/me");
      setNickname(profile.nickname ?? "");
      setAvatarUrl(profile.avatarUrl ?? "");
      setBirthDate(profile.birthDate ? profile.birthDate.slice(0, 10) : "");
      setCountryCode(profile.countryCode ?? "");
      setRegion(profile.region ?? "");
      setCity(profile.city ?? "");
      setGender(profile.gender || "UNKNOWN");
      setBio(profile.bio ?? "");
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "资料加载失败，请稍后再试。"));
    } finally {
      setPrefilling(false);
    }
  }, []);

  useEffect(() => {
    if (!user || loadedOnce.current) return;
    loadedOnce.current = true;
    void prefill();
  }, [user, prefill]);

  async function handleSave() {
    setError("");
    setSaved("");
    const trimmedNickname = nickname.trim();
    const trimmedRegion = region.trim();
    const trimmedCity = city.trim();
    if (trimmedNickname.length < 2) {
      setError("昵称至少 2 个字符。");
      return;
    }
    if (trimmedNickname.length > NICKNAME_MAX) {
      setError(`昵称最多 ${NICKNAME_MAX} 个字符。`);
      return;
    }
    const age = ageOf(birthDate);
    if (age === null) {
      setError("请填写有效的出生日期。");
      return;
    }
    if (age < 18) {
      setError("需要年满 18 岁才能使用 TalkFirst。");
      return;
    }
    if (!countryCode) {
      setError("请选择所在国家。");
      return;
    }
    if (trimmedRegion.length > REGION_MAX) {
      setError(`地区最多 ${REGION_MAX} 个字符。`);
      return;
    }
    if (trimmedCity.length > CITY_MAX) {
      setError(`城市最多 ${CITY_MAX} 个字符。`);
      return;
    }

    setLoading(true);
    try {
      await apiFetch<FullCard>("/users/me", {
        method: "PATCH",
        body: {
          nickname: trimmedNickname,
          birthDate,
          countryCode,
          region: trimmedRegion,
          city: trimmedCity,
          gender,
          bio: bio.trim(),
        },
      });
      // Re-read instead of trusting the PATCH response: this is what proves the
      // change really landed and that the form now shows stored state.
      await prefill();
      const session = await apiFetch<SessionUser>("/users/me");
      setUser(session);
      setSaved("已保存。刷新页面或换设备登录后依然生效。");
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, "保存失败，请稍后再试。"));
    } finally {
      setLoading(false);
    }
  }

  const age = birthDate ? ageOf(birthDate) : null;

  return (
    <PhoneShell>
      <ScreenHeader title="编辑资料" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {prefilling ? (
          <div className="animate-pulse space-y-4">
            <div className="h-16 rounded-2xl bg-indigo-50" />
            <div className="h-16 rounded-2xl bg-indigo-50" />
            <div className="h-16 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <>
            {/* Clickable Avatar with bottom sheet and local file upload */}
            <div className="mb-6 flex flex-col items-center justify-center">
              <ClickableAvatar
                avatarUrl={avatarUrl || null}
                name={nickname || user?.nickname || null}
                size="xl"
                onClick={() => setAvatarSheetOpen(true)}
              />
              <p className="mt-2 text-caption text-content-muted">点击头像查看或更换</p>
            </div>

            {/*
              Every label string below is load-bearing. `profile.spec.ts` reads
              this page with:
                getByLabel("昵称") · getByLabel("出生日期") · getByLabel("所在国家")
                getByLabel(/^地区/) · getByLabel(/^城市/) · getByLabel(/^简介/)
              Three of those are PREFIX matches, so the labels must keep their
              exact leading text — 「地区 / 省 / 州（…）」 and 「城市（…）」 and
              「简介（…）」 are not cosmetic and must not be shortened.
            */}

            <div className="mt-4">
              <label htmlFor="edit-nickname" className="mb-1.5 block text-caption font-medium text-content-muted">
                昵称
              </label>
              <TFInput
                id="edit-nickname"
                autoComplete="nickname"
                placeholder="大家怎么称呼你"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="edit-birthdate" className="mb-1.5 block text-caption font-medium text-content-muted">
                出生日期
              </label>
              <TFInput
                id="edit-birthdate"
                type="date"
                autoComplete="bday"
                value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)}
              />
              {age !== null ? (
                <p className={cn("mt-1.5 text-caption", age >= 18 ? "text-content-muted" : "text-danger-600")}>
                  {age >= 18 ? `已满 ${age} 岁` : "需要年满 18 岁才能使用 TalkFirst"}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <label htmlFor="edit-country" className="mb-1.5 block text-caption font-medium text-content-muted">
                所在国家
              </label>
              <select
                id="edit-country"
                value={countryCode}
                autoComplete="country"
                onChange={(event) => setCountryCode(event.target.value)}
                className="h-11 w-full min-w-0 rounded-control border border-border bg-surface-sunken px-3.5 text-ui text-content transition-colors duration-instant ease-out focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              >
                <option value="">请选择…</option>
                {countries.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.flag ?? ""} {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label htmlFor="edit-region" className="mb-1.5 block text-caption font-medium text-content-muted">
                {`地区 / 省 / 州（可选，最多 ${REGION_MAX} 字）`}
              </label>
              <TFInput
                id="edit-region"
                autoComplete="address-level1"
                placeholder="东京 / 加州"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="edit-city" className="mb-1.5 block text-caption font-medium text-content-muted">
                {`城市（可选，最多 ${CITY_MAX} 字）`}
              </label>
              <TFInput
                id="edit-city"
                autoComplete="address-level2"
                placeholder="上海"
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>

            {/* `TFChip` in a real fieldset: the old buttons carried `aria-pressed`
                but no group label, so a screen reader announced six unlabelled
                toggles with no indication of what they belonged to. */}
            <fieldset className="mt-5">
              <legend className="mb-2 text-caption font-medium text-content-muted">性别（可选）</legend>
              <div className="grid grid-cols-2 gap-2">
                {genders.map((item) => (
                  <TFChip
                    key={item.value}
                    selected={gender === item.value}
                    onClick={() => setGender(item.value)}
                    className="w-full justify-center"
                  >
                    {item.label}
                  </TFChip>
                ))}
              </div>
            </fieldset>

            <div className="mt-4">
              <label htmlFor="edit-bio" className="mb-1.5 block text-caption font-medium text-content-muted">
                {`简介（最多 ${BIO_MAX} 字）`}
              </label>
              <TFTextarea
                id="edit-bio"
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                maxLength={BIO_MAX}
                rows={4}
                placeholder="介绍一下自己…"
              />
              <p className="mt-1 text-right text-caption text-content-subtle">
                {bio.length}/{BIO_MAX}
              </p>
            </div>

            {saved ? (
              <p data-testid="profile-saved" role="status" className="mt-4 text-caption text-success-600">
                {saved}
              </p>
            ) : null}
            {error ? (
              <p data-testid="profile-error" role="alert" className="mt-4 break-words text-caption text-danger-600">
                {error}
              </p>
            ) : null}

            <div className="mt-8">
              {/* `aria-label="保存资料"` is how the suite clicks this button —
                  keep it on the control, not on a wrapper. */}
              <TFButton
                size="lg"
                fullWidth
                onClick={() => void handleSave()}
                loading={loading}
                loadingLabel="保存中…"
                aria-label="保存资料"
              >
                保存资料
              </TFButton>
            </div>

            <div className="mt-6 rounded-card bg-surface-sunken p-4">
              <p className="text-ui font-medium text-content">还能继续完善</p>
              <div className="mt-3 space-y-2">
                {[
                  { href: "/me/interests", label: "语言 · 兴趣 · 交友目的 · 想认识的国家" },
                  { href: "/me/attributes", label: "交友属性（我的介绍 / 交友需求）" },
                  { href: "/me/visibility", label: "资料可见范围" },
                ].map((entry) => (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    className="flex items-center justify-between gap-3 rounded-row bg-surface px-3.5 py-3 text-ui text-brand-600 transition-colors duration-instant hover:bg-brand-50"
                  >
                    <span className="min-w-0">{entry.label}</span>
                    <span aria-hidden="true" className="shrink-0">→</span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <AvatarActionSheet
        open={avatarSheetOpen}
        onClose={() => setAvatarSheetOpen(false)}
        avatarUrl={avatarUrl || null}
        name={nickname || user?.nickname || null}
        onAvatarUpdated={(newUrl) => {
          setAvatarUrl(newUrl);
          setSaved("头像已更新。");
        }}
      />
    </PhoneShell>
  );
}
