import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n-context";
import { GENDER_VALUES, type GenderValue } from "../lib/profile-options";
import type { CountryOption } from "../lib/types";
import { colors } from "../theme";

/**
 * 引导流程与「我的 → 编辑基本资料」共用的两个字段控件。
 *
 * ## 为什么国家不是一排胶囊
 *
 * web 那边国家是 `<select>`（两百多个选项交给浏览器）。移动端没有这个原生控件，
 * 而两百多个胶囊铺在页面上既选不出来也读不出来。这里用一个「一行 + 展开成可搜索列表」
 * 的控件：关闭时只占一行，展开后按输入过滤。
 *
 * 展开列表**刻意不用嵌套的 ScrollView** —— 外层页面本身就在滚，同方向嵌套滚动在
 * Android 上会把内层的手势吃掉。直接顺排进页面里，让页面自己滚。
 */

/** 展开后最多列出的候选数；再往下靠输入缩小，而不是让页面无限长。 */
const MAX_VISIBLE = 30;

export function CountryField({
  label,
  countries,
  value,
  onChange,
}: {
  label: string;
  countries: CountryOption[];
  value: string;
  onChange: (code: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = countries.find((country) => country.code === value) ?? null;
  const keyword = query.trim().toLowerCase();
  const matches = (
    keyword
      ? countries.filter(
          (country) =>
            country.name.toLowerCase().includes(keyword) ||
            country.code.toLowerCase() === keyword,
        )
      : countries
  ).slice(0, MAX_VISIBLE);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <Pressable
        onPress={() => setOpen((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        style={styles.selectRow}
      >
        <Text style={selected ? styles.selectValue : styles.selectPlaceholder}>
          {selected
            ? `${selected.flag ?? ""} ${selected.name}`.trim()
            : t("onboarding.countryPlaceholder")}
        </Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
      </Pressable>

      {open ? (
        <View style={styles.selectBody}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("onboarding.countrySearchPlaceholder")}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("onboarding.countrySearchPlaceholder")}
            style={styles.search}
          />
          {matches.map((country) => (
            <Pressable
              key={country.code}
              onPress={() => {
                onChange(country.code);
                setOpen(false);
                setQuery("");
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: country.code === value }}
              style={styles.optionRow}
            >
              <Text style={styles.optionLabel}>
                {`${country.flag ?? ""} ${country.name}`.trim()}
              </Text>
              {country.code === value ? (
                <Icon name="checkmark" size={16} color={colors.primary} />
              ) : null}
            </Pressable>
          ))}
          {matches.length === 0 ? (
            <Text style={styles.empty}>{t("onboarding.countryNoMatch")}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function GenderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: GenderValue;
  onChange: (next: GenderValue) => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipWrap}>
        {GENDER_VALUES.map((gender) => (
          <Chip
            key={gender}
            label={t(genderLabelKey(gender))}
            selected={value === gender}
            onPress={() => onChange(gender)}
          />
        ))}
      </View>
    </View>
  );
}

export function genderLabelKey(gender: GenderValue) {
  switch (gender) {
    case "MALE":
      return "onboarding.genderMale" as const;
    case "FEMALE":
      return "onboarding.genderFemale" as const;
    case "OTHER":
      return "onboarding.genderOther" as const;
    default:
      return "onboarding.genderUnknown" as const;
  }
}

/** 字段下方的说明/错误行（有 error 就显示 error，两者不同时出现）。 */
export function FieldHint({ text, tone = "muted" }: { text: string; tone?: "muted" | "danger" }) {
  return <Text style={tone === "danger" ? styles.hintDanger : styles.hint}>{text}</Text>;
}

const styles = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: colors.ink, marginBottom: 8, fontWeight: "500" },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.bg,
  },
  selectValue: { flex: 1, fontSize: 15, color: colors.ink },
  selectPlaceholder: { flex: 1, fontSize: 15, color: colors.muted },
  selectBody: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.white,
    paddingVertical: 4,
    overflow: "hidden",
  },
  search: {
    margin: 8,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.ink,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  optionLabel: { flex: 1, fontSize: 14, color: colors.ink },
  empty: { paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: colors.muted },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { marginTop: 6, fontSize: 12, color: colors.muted },
  hintDanger: { marginTop: 6, fontSize: 12, color: colors.danger },
});
