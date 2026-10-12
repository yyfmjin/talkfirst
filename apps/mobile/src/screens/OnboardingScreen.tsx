import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { CountryField, FieldHint, GenderField } from "../components/ProfileFields";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import {
  COUNTRY_MAX,
  INTEREST_MAX,
  INTEREST_MIN,
  LANGUAGE_MAX,
  MIN_AGE,
  PURPOSE_MAX,
  ageFromBirthDateInput,
  buildLanguageItems,
  toggleLimited,
  type GenderValue,
} from "../lib/profile-options";
import type {
  CountryOption,
  InterestOption,
  LanguageOption,
  ProfileFullCard,
  PurposeOption,
  SessionUser,
} from "../lib/types";
import { colors } from "../theme";
import { SocialScreen } from "./SocialScreen";

/**
 * 首次进入的引导流程 —— 对齐 web 的 `/onboarding/*`。
 *
 * ## 为什么要做这一套（web 已经有整段 `/me/*` 编辑页了）
 *
 * 「新用户第一次进来」和「老用户想改一下」是两件事。编辑页把四组字段平铺出来、每组
 * 各自保存，对一个已经知道自己要什么的人是效率；对一个刚注册、还不知道这个产品拿这些
 * 字段干什么的人，那是一张表格。所以 web 端两者都有，移动端现在补齐前者。
 *
 * ## 与 web 的步骤、校验、接口逐条对齐
 *
 *   1 头像      可选，`POST /uploads/avatar`（data URL）
 *   2 基本信息  昵称 2–20、生日有效且 ≥18 岁、国家必选；`PATCH /users/me`
 *   3 兴趣标签  ≥3 个（上限 20）；`PUT /users/me/interests`
 *   4 语言设置  母语必选 + 学习语言 ≥1（合计 ≤8）；`PUT /users/me/languages`
 *   5 交友目的  ≥1 个（上限 7）；`PUT /users/me/purposes`
 *   6 想认识谁  可多选，不选表示「全球」；`PUT /users/me/preferred-countries`
 *   7 社交账号  可跳过（`SocialScreen` 原样复用）
 *   8 完成      三条「接下来会发生什么」+ 两个出口
 *
 * ## 为什么生日是个文本框
 *
 * 原生日期选择器要新依赖（`@react-native-community/datetimepicker`），而这一步只值一个
 * `YYYY-MM-DD`。所以按 `YYYY-MM-DD` 收，并在**发请求之前**把格式与「≥18 岁」判掉
 * （见 `profile-options.ts` 的 `ageFromBirthDateInput`）—— 否则服务端只会回一个笼统的 400。
 *
 * ## 为什么退出入口只有一个
 *
 * 引导从「注册成功」进来，所以第 1 步的返回 = 直接进主界面（名片先放着，以后能补）。
 * 中途每一步的返回是「上一步」，不是「放弃」—— 半途退出去丢掉刚刚填的四步，才是真的坑。
 */
const STEPS = [
  "avatar",
  "profile",
  "interests",
  "languages",
  "purposes",
  "countries",
  "social",
  "done",
] as const;
type Step = (typeof STEPS)[number];

/** 完成页不计入「第 N 步」：它没有可填的东西。 */
const FORM_STEPS: Step[] = STEPS.filter((step) => step !== "done");

const STEP_TITLE_KEYS: Record<Step, MsgKey> = {
  avatar: "onboarding.stepAvatar",
  profile: "onboarding.stepProfile",
  interests: "onboarding.stepInterests",
  languages: "onboarding.stepLanguages",
  purposes: "onboarding.stepPurposes",
  countries: "onboarding.stepCountries",
  social: "onboarding.stepSocial",
  done: "onboarding.stepDone",
};

/** 与服务端 `POST /uploads/avatar` 的上限一致（`apps/api/src/uploads/uploads.controller.ts`）。 */
const AVATAR_MAX_CHARS = 7_000_000;

export type OnboardingTarget = "discover" | "profile";

export function OnboardingScreen({
  onExit,
  onFinish,
}: {
  /** 第 1 步的返回：退出引导，直接进主界面。 */
  onExit: () => void;
  /** 结束引导：`discover` = 去发现新朋友，`profile` = 先回去改名片。 */
  onFinish: (target: OnboardingTarget) => void;
}) {
  const { t } = useI18n();
  const { user, setUser } = useAuth();

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [interests, setInterests] = useState<InterestOption[]>([]);
  const [purposes, setPurposes] = useState<PurposeOption[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);

  const [avatar, setAvatar] = useState("");
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState<GenderValue>("UNKNOWN");

  const [nativeCode, setNativeCode] = useState("");
  const [learningCodes, setLearningCodes] = useState<string[]>([]);
  const [interestSlugs, setInterestSlugs] = useState<string[]>([]);
  const [purposeSlugs, setPurposeSlugs] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [langMeta, interestMeta, purposeMeta, countryMeta, me] = await Promise.all([
        apiFetch<LanguageOption[]>("/meta/languages"),
        apiFetch<InterestOption[]>("/meta/interests"),
        apiFetch<PurposeOption[]>("/meta/purposes"),
        apiFetch<CountryOption[]>("/meta/countries"),
        apiFetch<ProfileFullCard & Partial<SessionUser>>("/users/me"),
      ]);
      setLanguages(langMeta);
      setInterests(interestMeta);
      setPurposes(purposeMeta);
      setCountries(countryMeta);

      /* 预填：引导可能是「注册后马上走一遍」，也可能是老用户回来补名片，
         两种情况都以上一次存下的值为准，而不是空白。 */
      setAvatar(me.avatarUrl ?? "");
      setNickname(me.nickname ?? "");
      setBirthDate(me.birthDate ? me.birthDate.slice(0, 10) : "");
      setCountryCode(me.countryCode ?? "");
      setCity(me.city ?? "");
      setGender((me.gender as GenderValue | null) ?? "UNKNOWN");
      setNativeCode(me.languages.find((item) => item.type === "NATIVE")?.code ?? "");
      setLearningCodes(
        me.languages.filter((item) => item.type === "LEARNING").map((item) => item.code),
      );
      setInterestSlugs(me.interests.map((item) => item.slug));
      setPurposeSlugs(me.purposes.map((item) => item.slug));
      setCountryCodes(me.preferredCountries.map((item) => item.code));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("onboarding.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 每一步的「下一步」都经由这里：清错误 → 跑这一步的保存 → 前进。 */
  async function advance(action?: () => Promise<unknown>) {
    if (saving) return;
    if (!action) {
      setError("");
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await action();
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("onboarding.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function goPrev() {
    setError("");
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  async function pickAvatar() {
    if (picking) return;
    setPicking(true);
    setError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) {
        setError(t("onboarding.avatarReadFailed"));
        return;
      }
      const dataUrl = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
      if (dataUrl.length > AVATAR_MAX_CHARS) {
        setError(t("onboarding.avatarTooLarge"));
        return;
      }
      setAvatar(dataUrl);
    } catch {
      setError(t("onboarding.avatarReadFailed"));
    } finally {
      setPicking(false);
    }
  }

  /**
   * 头像这一步的保存：**没选图就是「跳过」**，不是错误。
   *
   * 已经存过的头像（`user.avatarUrl`）不重复上传 —— 否则老用户回来补名片时，
   * 每进一次这一步就把同一张图再传一次、再写一次随机文件名。
   */
  function saveAvatar() {
    if (!avatar || avatar === user?.avatarUrl) {
      setError("");
      setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
      return;
    }
    void advance(async () => {
      const updated = await apiFetch<{ avatarUrl: string }>("/uploads/avatar", {
        method: "POST",
        body: { image: avatar },
      });
      if (user) setUser({ ...user, avatarUrl: updated.avatarUrl });
    });
  }

  function saveProfile() {
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      setError(t("onboarding.errNicknameMin"));
      return;
    }
    if (trimmed.length > 20) {
      setError(t("onboarding.errNicknameMax"));
      return;
    }
    const age = ageFromBirthDateInput(birthDate);
    if (age === null) {
      setError(t("onboarding.errBirthDate"));
      return;
    }
    if (age < MIN_AGE) {
      setError(t("onboarding.errAge"));
      return;
    }
    if (!countryCode) {
      setError(t("onboarding.errCountry"));
      return;
    }
    void advance(async () => {
      const updated = await apiFetch<SessionUser>("/users/me", {
        method: "PATCH",
        body: {
          nickname: trimmed,
          birthDate: birthDate.trim(),
          countryCode,
          city: city.trim() || undefined,
          gender,
        },
      });
      if (user) setUser({ ...user, ...updated });
    });
  }

  function saveInterests() {
    if (interestSlugs.length < INTEREST_MIN) {
      setError(t("onboarding.errInterests", { n: interestSlugs.length }));
      return;
    }
    void advance(() =>
      apiFetch("/users/me/interests", { method: "PUT", body: { slugs: interestSlugs } }),
    );
  }

  function saveLanguages() {
    if (!nativeCode) {
      setError(t("onboarding.errNative"));
      return;
    }
    if (learningCodes.filter((code) => code !== nativeCode).length === 0) {
      setError(t("onboarding.errLearning"));
      return;
    }
    void advance(() =>
      apiFetch("/users/me/languages", {
        method: "PUT",
        body: { items: buildLanguageItems(nativeCode, learningCodes) },
      }),
    );
  }

  function savePurposes() {
    if (purposeSlugs.length === 0) {
      setError(t("onboarding.errPurposes"));
      return;
    }
    void advance(() =>
      apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: purposeSlugs } }),
    );
  }

  function saveCountries() {
    /* 不选 = 全球，web 上就是「全球，下一步」——空数组是合法取值。 */
    void advance(() =>
      apiFetch("/users/me/preferred-countries", { method: "PUT", body: { codes: countryCodes } }),
    );
  }

  /** 收尾：把服务端算好的 `profileCompleted` 拉回来，「我的」上的徽标才会跟着变。 */
  async function finish(target: OnboardingTarget) {
    try {
      const fresh = await apiFetch<SessionUser>("/users/me");
      if (user) setUser({ ...user, ...fresh });
    } catch {
      /* 拉不到就用旧的一份：名片已经存好了，不该因为这一次读失败而卡住收尾。 */
    }
    onFinish(target);
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <SubHeader title={t(STEP_TITLE_KEYS[step])} onBack={onExit} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const position = FORM_STEPS.indexOf(step);

  return (
    <View style={styles.root}>
      <SubHeader
        title={t(STEP_TITLE_KEYS[step])}
        onBack={stepIndex === 0 ? onExit : goPrev}
      />
      {position >= 0 ? (
        <View style={styles.progressWrap}>
          <Text style={styles.progressText}>
            {t("onboarding.progress", { n: position + 1, total: FORM_STEPS.length })}
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(((position + 1) / FORM_STEPS.length) * 100)}%` },
              ]}
            />
          </View>
        </View>
      ) : null}

      {step === "social" ? (
        /* 社交账号整段复用「我的 → 管理社交账号」：授权在系统浏览器里完成，
           这里只多一个由引导提供的「下一步」脚。 */
        <SocialScreen
          onBack={goPrev}
          footer={
            <Button label={t("onboarding.next")} onPress={() => void advance()} />
          }
        />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {step === "avatar" ? (
              <View style={styles.avatarStep}>
                <Pressable
                  onPress={() => void pickAvatar()}
                  accessibilityRole="button"
                  accessibilityLabel={t("onboarding.pickImage")}
                  style={styles.avatarTap}
                >
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarEmpty}>
                      <Icon name="person-outline" size={34} color={colors.muted} />
                    </View>
                  )}
                  <View style={styles.avatarBadge}>
                    {picking ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <Icon name="camera-outline" size={16} color={colors.white} />
                    )}
                  </View>
                </Pressable>
                <Text style={styles.hint}>{t("onboarding.avatarHint")}</Text>
              </View>
            ) : null}

            {step === "profile" ? (
              <>
                <Input
                  label={t("onboarding.nickname")}
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder={t("onboarding.nicknamePlaceholder")}
                  autoCapitalize="words"
                  maxLength={24}
                />
                <Input
                  label={t("onboarding.birthDate")}
                  value={birthDate}
                  onChangeText={setBirthDate}
                  placeholder={t("onboarding.birthDatePlaceholder")}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
                {(() => {
                  /* 边填边给年龄反馈：等到点「下一步」才说「不够 18 岁」太晚了。 */
                  const age = birthDate.trim() ? ageFromBirthDateInput(birthDate) : null;
                  if (age === null) return null;
                  return (
                    <FieldHint
                      text={
                        age >= MIN_AGE
                          ? t("onboarding.ageOk", { n: age })
                          : t("onboarding.errAge")
                      }
                      tone={age >= MIN_AGE ? "muted" : "danger"}
                    />
                  );
                })()}
                <CountryField
                  label={t("onboarding.country")}
                  countries={countries}
                  value={countryCode}
                  onChange={setCountryCode}
                />
                <Input
                  label={t("onboarding.city")}
                  value={city}
                  onChangeText={setCity}
                  placeholder={t("onboarding.cityPlaceholder")}
                  autoCapitalize="words"
                  maxLength={40}
                />
                <GenderField
                  label={t("onboarding.gender")}
                  value={gender}
                  onChange={setGender}
                />
              </>
            ) : null}

            {step === "interests" ? (
              <>
                <Text style={styles.hint}>
                  {t("onboarding.interestsHint", { n: interestSlugs.length })}
                </Text>
                <View style={styles.chipWrap}>
                  {interests.map((interest) => (
                    <Chip
                      key={interest.slug}
                      label={interest.nameZh ?? interest.name}
                      selected={interestSlugs.includes(interest.slug)}
                      onPress={() =>
                        setInterestSlugs((current) =>
                          toggleLimited(current, interest.slug, INTEREST_MAX),
                        )
                      }
                    />
                  ))}
                </View>
              </>
            ) : null}

            {step === "languages" ? (
              <>
                <Text style={styles.sectionTitle}>{t("onboarding.languagesNative")}</Text>
                <View style={styles.chipWrap}>
                  {languages.map((language) => (
                    <Chip
                      key={language.code}
                      label={language.nativeName ?? language.name}
                      selected={nativeCode === language.code}
                      onPress={() => setNativeCode(language.code)}
                    />
                  ))}
                </View>
                <Text style={styles.sectionTitle}>{t("onboarding.languagesLearning")}</Text>
                <View style={styles.chipWrap}>
                  {languages
                    .filter((language) => language.code !== nativeCode)
                    .map((language) => (
                      <Chip
                        key={language.code}
                        label={language.nativeName ?? language.name}
                        selected={learningCodes.includes(language.code)}
                        onPress={() =>
                          setLearningCodes((current) =>
                            toggleLimited(current, language.code, LANGUAGE_MAX - 1),
                          )
                        }
                      />
                    ))}
                </View>
              </>
            ) : null}

            {step === "purposes" ? (
              <>
                <Text style={styles.hint}>{t("onboarding.purposesHint")}</Text>
                <View style={styles.chipWrap}>
                  {purposes.map((purpose) => (
                    <Chip
                      key={purpose.slug}
                      label={purpose.nameZh ?? purpose.name}
                      selected={purposeSlugs.includes(purpose.slug)}
                      onPress={() =>
                        setPurposeSlugs((current) =>
                          toggleLimited(current, purpose.slug, PURPOSE_MAX),
                        )
                      }
                    />
                  ))}
                </View>
              </>
            ) : null}

            {step === "countries" ? (
              <>
                <Text style={styles.hint}>{t("onboarding.countriesHint")}</Text>
                <View style={styles.chipWrap}>
                  {countries.map((country) => (
                    <Chip
                      key={country.code}
                      label={country.name}
                      selected={countryCodes.includes(country.code)}
                      onPress={() =>
                        setCountryCodes((current) =>
                          toggleLimited(current, country.code, COUNTRY_MAX),
                        )
                      }
                    />
                  ))}
                </View>
              </>
            ) : null}

            {step === "done" ? (
              <View style={styles.doneBox}>
                <View style={styles.doneBadge}>
                  <Icon name="chatbubbles-outline" size={34} color={colors.white} />
                </View>
                <Text style={styles.doneTitle}>{t("onboarding.doneTitle")}</Text>
                <Text style={styles.doneSubtitle}>{t("onboarding.doneSubtitle")}</Text>
                <View style={styles.doneCard}>
                  {(["One", "Two", "Three"] as const).map((key) => (
                    <View key={key} style={styles.doneRow}>
                      <View style={styles.doneDot} />
                      <View style={styles.doneText}>
                        <Text style={styles.doneRowTitle}>
                          {t(`onboarding.donePoint${key}Title` as MsgKey)}
                        </Text>
                        <Text style={styles.doneRowBody}>
                          {t(`onboarding.donePoint${key}Body` as MsgKey)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            {step === "done" ? (
              <>
                <Button label={t("onboarding.goDiscover")} onPress={() => void finish("discover")} />
                <Button
                  label={t("onboarding.editLater")}
                  variant="ghost"
                  onPress={() => void finish("profile")}
                />
              </>
            ) : (
              <>
                {saving ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Button
                    label={t("onboarding.next")}
                    onPress={() => {
                      if (step === "avatar") saveAvatar();
                      else if (step === "profile") saveProfile();
                      else if (step === "interests") saveInterests();
                      else if (step === "languages") saveLanguages();
                      else if (step === "purposes") savePurposes();
                      else if (step === "countries") saveCountries();
                    }}
                  />
                )}
                {step === "avatar" ? (
                  <Pressable
                    /* 「稍后再说」= 不上传，直接下一步。选了图又改主意时，
                       不该反而把那张图传上去。 */
                    onPress={() => void advance()}
                    accessibilityRole="button"
                    accessibilityLabel={t("onboarding.skip")}
                    style={styles.skipRow}
                  >
                    <Text style={styles.skipLabel}>{t("onboarding.skip")}</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  progressWrap: { paddingHorizontal: 20, paddingTop: 12 },
  progressText: { fontSize: 12, color: colors.muted },
  progressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  body: { padding: 20, paddingBottom: 32 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 6 },
  hint: { fontSize: 12, color: colors.muted, marginBottom: 12, lineHeight: 18 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: colors.ink, marginTop: 8, marginBottom: 8 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  errorText: { fontSize: 13, color: colors.danger, marginBottom: 12 },
  avatarStep: { alignItems: "center", paddingTop: 24 },
  avatarTap: { width: 132, height: 132 },
  avatarImage: { width: 132, height: 132, borderRadius: 66 },
  avatarEmpty: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.bgSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBadge: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.white,
  },
  skipRow: { alignItems: "center", paddingVertical: 10 },
  skipLabel: { fontSize: 14, color: colors.muted },
  doneBox: { alignItems: "center", paddingTop: 12 },
  doneBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: { marginTop: 20, fontSize: 20, fontWeight: "600", color: colors.ink },
  doneSubtitle: { marginTop: 8, fontSize: 14, color: colors.muted, textAlign: "center" },
  doneCard: {
    alignSelf: "stretch",
    marginTop: 24,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 16,
    gap: 14,
  },
  doneRow: { flexDirection: "row", gap: 10 },
  doneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  doneText: { flex: 1 },
  doneRowTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  doneRowBody: { marginTop: 3, fontSize: 12, color: colors.muted, lineHeight: 18 },
});
