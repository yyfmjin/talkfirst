import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";
import type {
  CountryOption,
  InterestOption,
  LanguageOption,
  ProfileFullCard,
  PurposeOption,
} from "../lib/types";

const INTEREST_MIN = 3;
const INTEREST_MAX = 20;
const PURPOSE_MAX = 7;
const COUNTRY_MAX = 10;
const LANGUAGE_MAX = 8;

/**
 * 「语言 · 兴趣 · 交友目的」编辑（移动端）。
 *
 * 对齐 web 的 `/me/interests`：四个 section（语言 / 兴趣 / 交友目的 / 想认识的国家），
 * 每个独立保存，走各自的既有端点。读取时并发拉 meta（可选项）与 `GET /users/me`（当前选择）。
 *
 * 母语是单选（`type: NATIVE`），学习语言是多选（`type: LEARNING`）；兴趣/目的/国家都是
 * chip 多选。约束与 web 一致：母语必选、学习 ≥1（合计 ≤8）；兴趣 3–20；目的 ≤7；国家 ≤10。
 */
export function InterestsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();

  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [interests, setInterests] = useState<InterestOption[]>([]);
  const [purposes, setPurposes] = useState<PurposeOption[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);

  const [nativeCode, setNativeCode] = useState("");
  const [learningCodes, setLearningCodes] = useState<string[]>([]);
  const [interestSlugs, setInterestSlugs] = useState<string[]>([]);
  const [purposeSlugs, setPurposeSlugs] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<"languages" | "interests" | "purposes" | "countries" | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [langMeta, interestMeta, purposeMeta, countryMeta, me] = await Promise.all([
        apiFetch<LanguageOption[]>("/meta/languages"),
        apiFetch<InterestOption[]>("/meta/interests"),
        apiFetch<PurposeOption[]>("/meta/purposes"),
        apiFetch<CountryOption[]>("/meta/countries"),
        apiFetch<ProfileFullCard>("/users/me"),
      ]);
      setLanguages(langMeta);
      setInterests(interestMeta);
      setPurposes(purposeMeta);
      setCountries(countryMeta);
      setNativeCode(me.languages.find((item) => item.type === "NATIVE")?.code ?? "");
      setLearningCodes(
        me.languages.filter((item) => item.type === "LEARNING").map((item) => item.code),
      );
      setInterestSlugs(me.interests.map((item) => item.slug));
      setPurposeSlugs(me.purposes.map((item) => item.slug));
      setCountryCodes(me.preferredCountries.map((item) => item.code));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.loadingFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    section: "languages" | "interests" | "purposes" | "countries",
    action: () => Promise<unknown>,
  ) {
    if (saving) return;
    setSaving(section);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(t("me.saved"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  function saveLanguages() {
    if (!nativeCode) {
      setError(t("me.interestsHintNative"));
      return;
    }
    const learningClean = learningCodes.filter((code) => code !== nativeCode);
    if (learningClean.length === 0) {
      setError(t("me.interestsHintLearning"));
      return;
    }
    void save("languages", () =>
      apiFetch("/users/me/languages", {
        method: "PUT",
        body: {
          items: [
            { code: nativeCode, type: "NATIVE", level: "NATIVE" },
            ...learningClean.map((code) => ({ code, type: "LEARNING", level: "INTERMEDIATE" })),
          ],
        },
      }),
    );
  }

  function saveInterests() {
    if (interestSlugs.length < INTEREST_MIN) {
      setError(t("me.interestsHintInterests"));
      return;
    }
    void save("interests", () =>
      apiFetch("/users/me/interests", { method: "PUT", body: { slugs: interestSlugs } }),
    );
  }

  function savePurposes() {
    if (purposeSlugs.length === 0) {
      setError(t("me.interestsHintPurposes"));
      return;
    }
    void save("purposes", () =>
      apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: purposeSlugs } }),
    );
  }

  function saveCountries() {
    void save("countries", () =>
      apiFetch("/users/me/preferred-countries", { method: "PUT", body: { codes: countryCodes } }),
    );
  }

  function toggleInterest(slug: string) {
    setInterestSlugs((current) => {
      if (current.includes(slug)) return current.filter((s) => s !== slug);
      if (current.length >= INTEREST_MAX) return current;
      return [...current, slug];
    });
  }

  function togglePurpose(slug: string) {
    setPurposeSlugs((current) => {
      if (current.includes(slug)) return current.filter((s) => s !== slug);
      if (current.length >= PURPOSE_MAX) return current;
      return [...current, slug];
    });
  }

  function toggleCountry(code: string) {
    setCountryCodes((current) => {
      if (current.includes(code)) return current.filter((c) => c !== code);
      if (current.length >= COUNTRY_MAX) return current;
      return [...current, code];
    });
  }

  function toggleLearning(code: string) {
    setLearningCodes((current) => {
      if (current.includes(code)) return current.filter((c) => c !== code);
      if (current.length >= LANGUAGE_MAX - 1) return current;
      return [...current, code];
    });
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <SubHeader title={t("me.interests")} onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("me.interests")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {notice ? <Text style={styles.okText}>{notice}</Text> : null}

        {/* 语言 */}
        <SectionTitle>{t("me.interestsSectionLanguages")}</SectionTitle>
        <Text style={styles.sectionHint}>{t("me.interestsNative")}</Text>
        <View style={styles.chipWrap}>
          {languages.map((lang) => (
            <Chip
              key={lang.code}
              label={lang.nativeName ?? lang.name}
              selected={nativeCode === lang.code}
              onPress={() => setNativeCode(lang.code)}
            />
          ))}
        </View>
        <Text style={styles.sectionHint}>{t("me.interestsLearning")}</Text>
        <View style={styles.chipWrap}>
          {languages
            .filter((lang) => lang.code !== nativeCode)
            .map((lang) => (
              <Chip
                key={lang.code}
                label={lang.nativeName ?? lang.name}
                selected={learningCodes.includes(lang.code)}
                onPress={() => toggleLearning(lang.code)}
              />
            ))}
        </View>
        <SaveButton
          label={t("me.save")}
          loading={saving === "languages"}
          onPress={saveLanguages}
        />

        {/* 兴趣 */}
        <SectionTitle>{t("me.interestsSectionInterests")}</SectionTitle>
        <Text style={styles.sectionHint}>{t("me.interestsHintInterests")}</Text>
        <View style={styles.chipWrap}>
          {interests.map((interest) => (
            <Chip
              key={interest.slug}
              label={interest.nameZh ?? interest.name}
              selected={interestSlugs.includes(interest.slug)}
              onPress={() => toggleInterest(interest.slug)}
            />
          ))}
        </View>
        <SaveButton
          label={t("me.save")}
          loading={saving === "interests"}
          onPress={saveInterests}
        />

        {/* 交友目的 */}
        <SectionTitle>{t("me.interestsSectionPurposes")}</SectionTitle>
        <Text style={styles.sectionHint}>{t("me.interestsHintPurposes")}</Text>
        <View style={styles.chipWrap}>
          {purposes.map((purpose) => (
            <Chip
              key={purpose.slug}
              label={purpose.nameZh ?? purpose.name}
              selected={purposeSlugs.includes(purpose.slug)}
              onPress={() => togglePurpose(purpose.slug)}
            />
          ))}
        </View>
        <SaveButton
          label={t("me.save")}
          loading={saving === "purposes"}
          onPress={savePurposes}
        />

        {/* 想认识的国家/地区 */}
        <SectionTitle>{t("me.interestsSectionCountries")}</SectionTitle>
        <Text style={styles.sectionHint}>{t("me.interestsHintCountries")}</Text>
        <View style={styles.chipWrap}>
          {countries.map((country) => (
            <Chip
              key={country.code}
              label={country.name}
              selected={countryCodes.includes(country.code)}
              onPress={() => toggleCountry(country.code)}
            />
          ))}
        </View>
        <SaveButton
          label={t("me.save")}
          loading={saving === "countries"}
          onPress={saveCountries}
        />
      </ScrollView>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      {selected ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
      <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function SaveButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.saveRow}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Button label={label} onPress={onPress} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  body: { padding: 20, paddingBottom: 40, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 8 },
  sectionHint: { fontSize: 12, color: colors.muted },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { fontSize: 13, color: colors.ink },
  chipLabelSelected: { color: colors.white, fontWeight: "600" },
  saveRow: { marginTop: 4, alignItems: "flex-start" },
  errorText: { fontSize: 13, color: colors.danger },
  okText: { fontSize: 13, color: colors.primary },
});
