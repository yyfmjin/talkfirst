"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFChip, TFInput, TFButton, TFRowSkeleton, TFLoadingRegion } from "@/components/tf";
import { cn } from "@/lib/cn";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

const genders = [
  { key: "onboarding.profile.genderMale", value: "MALE" },
  { key: "onboarding.profile.genderFemale", value: "FEMALE" },
  { key: "onboarding.profile.genderOther", value: "OTHER" },
  { key: "onboarding.profile.genderUnknown", value: "UNKNOWN" },
] as const;

type Country = { code: string; name: string; flag: string | null };

export default function BasicInfoPage() {
  const router = useRouter();
  const { locale, t } = useT();
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
      setError(t("onboarding.profile.nicknameTooShort"));
      return;
    }
    if (trimmed.length > 20) {
      setError(t("onboarding.profile.nicknameTooLong"));
      return;
    }
    const age = ageOf(birthDate);
    if (age === null) {
      setError(t("onboarding.profile.birthDateInvalid"));
      return;
    }
    if (age < 18) {
      setError(t("onboarding.profile.ageTooYoungLong"));
      return;
    }
    if (!countryCode) {
      setError(t("onboarding.profile.countryRequired"));
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
      router.push(localePath(locale, "/onboarding/interests"));
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : t("onboarding.common.saveFailed"),
      );
    } finally {
      setLoading(false);
    }
  }

  const age = birthDate ? ageOf(birthDate) : null;

  return (
    <PhoneShell>
      <ScreenHeader title={t("onboarding.profile.title")} backHref={localePath(locale, "/onboarding/avatar")} />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {prefilling ? (
          <TFLoadingRegion label={t("onboarding.profile.loading")}>
            <div className="space-y-4">
              <TFRowSkeleton />
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : (
          <>
            <div>
              {/* The label is 「昵称」, which `test/fixtures/browser.ts` and
                  `profile.spec.ts` both target with `getByLabel("昵称")` on
                  `/me/edit`. The two pages share the string, so renaming it here
                  would break those specs. */}
              <label htmlFor="ob-nickname" className="mb-1.5 block text-caption font-medium text-content-muted">
                {t("onboarding.profile.nicknameLabel")}
              </label>
              <TFInput
                id="ob-nickname"
                autoComplete="nickname"
                placeholder={t("onboarding.profile.nicknamePlaceholder")}
                value={nickname}
                invalid={Boolean(error)}
                describedBy={error ? "ob-error" : undefined}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>

            <div className="mt-4">
              <label htmlFor="ob-birthdate" className="mb-1.5 block text-caption font-medium text-content-muted">
                {t("onboarding.profile.birthDateLabel")}
              </label>
              {/* `autoComplete="bday"` is what lets a browser fill a date of birth
                  from the saved profile instead of making the member hunt for it in
                  a native date picker. */}
              <TFInput
                id="ob-birthdate"
                type="date"
                autoComplete="bday"
                value={birthDate}
                invalid={Boolean(error) && age !== null && age < 18}
                describedBy="ob-age"
                onChange={(event) => setBirthDate(event.target.value)}
              />
              {age !== null ? (
                <p
                  id="ob-age"
                  className={cn(
                    "mt-1.5 text-caption",
                    age >= 18 ? "text-content-muted" : "text-danger-600",
                  )}
                >
                  {age >= 18
                    ? t("onboarding.profile.ageOk", { age })
                    : t("onboarding.profile.ageTooYoung")}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              {/* A real `<label for>` replaced a `<label>` that *wrapped* the
                  select while also carrying `aria-label`. Two labelling
                  mechanisms on one control is ambiguous; this is the standard one. */}
              <label htmlFor="ob-country" className="mb-1.5 block text-caption font-medium text-content-muted">
                {t("onboarding.profile.countryLabel")}
              </label>
              <select
                id="ob-country"
                value={countryCode}
                autoComplete="country"
                onChange={(event) => setCountryCode(event.target.value)}
                className="h-11 w-full min-w-0 rounded-control border border-border bg-surface-sunken px-3.5 text-ui text-content transition-colors duration-instant ease-out focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              >
                <option value="">{t("onboarding.profile.countryPlaceholder")}</option>
                {countries.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.flag ?? ""} {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label htmlFor="ob-city" className="mb-1.5 block text-caption font-medium text-content-muted">
                {t("onboarding.profile.cityLabel")}
              </label>
              <TFInput
                id="ob-city"
                autoComplete="address-level2"
                placeholder={t("onboarding.profile.cityPlaceholder")}
                value={city}
                onChange={(event) => setCity(event.target.value)}
              />
            </div>

            {/* `TFChip` carries `aria-pressed`, so a screen reader can tell which
                gender is selected. The old buttons only differed by a fill colour
                — exactly the "never colour alone" rule. */}
            <fieldset className="mt-5">
              <legend className="mb-2 text-caption font-medium text-content-muted">
                {t("onboarding.profile.genderLabel")}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {genders.map((item) => (
                  <TFChip
                    key={item.value}
                    selected={gender === item.value}
                    onClick={() => setGender(item.value)}
                    className="w-full justify-center"
                  >
                    {t(item.key)}
                  </TFChip>
                ))}
              </div>
            </fieldset>

            {error ? (
              <p id="ob-error" role="alert" className="mt-4 break-words text-caption text-danger-600">
                {error}
              </p>
            ) : null}

            <div className="mt-8">
              <TFButton
                size="lg"
                fullWidth
                onClick={() => void handleNext()}
                loading={loading}
                loadingLabel={t("onboarding.common.saving")}
              >
                {t("onboarding.common.next")}
              </TFButton>
            </div>
          </>
        )}
      </div>
    </PhoneShell>
  );
}
