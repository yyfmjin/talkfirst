"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { Field, GradientButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";

const genders = [
  { label: "男", value: "MALE" },
  { label: "女", value: "FEMALE" },
  { label: "其他", value: "OTHER" },
  { label: "不想说", value: "UNKNOWN" },
];

type Country = { code: string; name: string; flag: string | null };

export default function BasicInfoPage() {
  const router = useRouter();
  const { user, setUser } = useSession();
  const [countries, setCountries] = useState<Country[]>([]);
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("UNKNOWN");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);

  useEffect(() => {
    apiFetch<Country[]>("/meta/countries")
      .then((items) => setCountries(items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname ?? "");
    setBirthDate(user.birthDate ? user.birthDate.slice(0, 10) : "");
    setCountryCode(user.countryCode ?? "");
    setCity(user.city ?? "");
    setGender(user.gender || "UNKNOWN");
    setPrefilling(false);
  }, [user]);

  function ageOf(date: string) {
    const birth = new Date(date);
    if (Number.isNaN(birth.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const month = now.getMonth() - birth.getMonth();
    if (month < 0 || (month === 0 && now.getDate() < birth.getDate())) age -= 1;
    return age;
  }

  async function handleNext() {
    setError("");
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      setError("昵称至少 2 个字符。");
      return;
    }
    if (trimmed.length > 20) {
      setError("昵称最多 20 个字符。");
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
    setLoading(true);
    try {
      const updated = await apiFetch<Record<string, unknown>>("/users/me", {
        method: "PATCH",
        body: {
          nickname: trimmed,
          birthDate,
          countryCode,
          city: city.trim() || undefined,
          gender,
        },
      });
      setUser({ ...(user as object), ...updated } as typeof user);
      router.push("/onboarding/interests");
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError ? requestError.message : "保存失败，请稍后再试",
      );
    } finally {
      setLoading(false);
    }
  }

  const age = birthDate ? ageOf(birthDate) : null;

  return (
    <PhoneShell>
      <ScreenHeader title="基本信息" backHref="/onboarding/avatar" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        {prefilling ? (
          <div className="animate-pulse space-y-4">
            <div className="h-16 rounded-2xl bg-indigo-50" />
            <div className="h-16 rounded-2xl bg-indigo-50" />
            <div className="h-16 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <>
            <Field label="昵称" placeholder="大家怎么称呼你" value={nickname} onChange={setNickname} />
            <div className="mt-4">
              <Field
                label="出生日期"
                type="date"
                value={birthDate}
                onChange={setBirthDate}
              />
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
              <Field label="城市（可选）" placeholder="上海" value={city} onChange={setCity} />
            </div>
            <p className="mb-2 mt-5 text-[13px] text-muted">性别（可选）</p>
            <div className="grid grid-cols-2 gap-2">
              {genders.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setGender(item.value)}
                  className={cn(
                    "h-10 rounded-full border border-line text-[13px]",
                    gender === item.value && "border-transparent tf-gradient text-white",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
            <div className="mb-1 mt-8">
              <GradientButton onClick={handleNext} disabled={loading}>
                {loading ? "保存中…" : "下一步"}
              </GradientButton>
            </div>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
