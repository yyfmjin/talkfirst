"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { Field, GradientButton } from "@/components/ui";
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
  const [initialAvatar, setInitialAvatar] = useState("");
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
      setInitialAvatar(profile.avatarUrl ?? "");
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
      const avatarChanged = avatarUrl.trim() !== initialAvatar;
      if (avatarChanged && avatarUrl.trim()) {
        await apiFetch("/users/me/avatar", { method: "PUT", body: { avatarUrl: avatarUrl.trim() } });
      }
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
            <Field label="头像链接（https://…，留空则不修改）" value={avatarUrl} onChange={setAvatarUrl} />
            <div className="mt-4">
              <Field label="昵称" placeholder="大家怎么称呼你" value={nickname} onChange={setNickname} />
            </div>
            <div className="mt-4">
              <Field label="出生日期" type="date" value={birthDate} onChange={setBirthDate} />
              {age !== null ? (
                <p className={cn("mt-1 text-[11px]", age >= 18 ? "text-muted" : "text-red-500")}>
                  {age >= 18 ? `${age} 岁` : "需要年满 18 岁"}
                </p>
              ) : null}
            </div>
            <div className="mt-4">
              <label className="block">
                <span className="mb-2 block text-[13px] text-muted">所在国家</span>
                <select
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                  aria-label="所在国家"
                  className="h-12 w-full min-w-0 rounded-2xl border border-line bg-[#F8FAFF] px-3 text-[14px] outline-none ring-indigo-200 focus:ring-2"
                >
                  <option value="">请选择…</option>
                  {countries.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.flag ?? ""} {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <Field
                label={`地区 / 省 / 州（可选，最多 ${REGION_MAX} 字）`}
                placeholder="东京 / 加州"
                value={region}
                onChange={setRegion}
              />
            </div>
            <div className="mt-4">
              <Field
                label={`城市（可选，最多 ${CITY_MAX} 字）`}
                placeholder="上海"
                value={city}
                onChange={setCity}
              />
            </div>
            <p className="mb-2 mt-5 text-[13px] text-muted">性别（可选）</p>
            <div className="grid grid-cols-2 gap-2">
              {genders.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setGender(item.value)}
                  aria-pressed={gender === item.value}
                  className={cn(
                    "h-10 rounded-full border border-line text-[13px]",
                    gender === item.value && "border-transparent tf-gradient text-white",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <label className="block">
                <span className="mb-2 block text-[13px] text-muted">简介（最多 {BIO_MAX} 字）</span>
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  maxLength={BIO_MAX}
                  rows={4}
                  placeholder="介绍一下自己…"
                  className="w-full rounded-2xl border border-line bg-[#F8FAFF] px-4 py-3 text-[14px] outline-none ring-indigo-200 placeholder:text-muted/70 focus:ring-2"
                />
              </label>
              <p className="mt-1 text-right text-[11px] text-muted">
                {bio.length}/{BIO_MAX}
              </p>
            </div>

            {saved ? (
              <p data-testid="profile-saved" className="mt-4 text-[12px] text-emerald-600">
                {saved}
              </p>
            ) : null}
            {error ? (
              <p data-testid="profile-error" className="mt-4 text-[12px] text-red-500">
                {error}
              </p>
            ) : null}
            <div className="mb-1 mt-8">
              <GradientButton onClick={handleSave} disabled={loading} aria-label="保存资料">
                {loading ? "保存中…" : "保存资料"}
              </GradientButton>
            </div>

            <div className="mt-6 rounded-3xl border border-line bg-[#F8F9FF] p-4">
              <p className="text-[13px] font-medium">还能继续完善</p>
              <div className="mt-3 space-y-2">
                <Link
                  href="/me/interests"
                  className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-[12px] text-[#6572D8] shadow-sm"
                >
                  <span>语言 · 兴趣 · 交友目的 · 想认识的国家</span>
                  <span>→</span>
                </Link>
                <Link
                  href="/me/attributes"
                  className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-[12px] text-[#6572D8] shadow-sm"
                >
                  <span>交友属性（我的介绍 / 交友需求）</span>
                  <span>→</span>
                </Link>
                <Link
                  href="/me/visibility"
                  className="flex items-center justify-between rounded-2xl bg-white px-3 py-3 text-[12px] text-[#6572D8] shadow-sm"
                >
                  <span>资料可见范围</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
