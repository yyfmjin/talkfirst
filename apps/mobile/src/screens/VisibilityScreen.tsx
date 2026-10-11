import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { FieldVisibilityRow, ProfileVisibilityField, VisibilityTier } from "../lib/types";
import { colors } from "../theme";

/**
 * 资料可见范围 —— 对齐 web 的 `/me/visibility`（PC-1.4 §11-§12）。
 *
 * `GET /users/me/profile-field-visibility` 永远返回全部 13 个白名单字段，
 * 客户端不需要自己发明默认值；`PUT` 同一路径、body 为 `{ fieldKey, visibility }`，
 * 返回更新后的整张列表（设回「公开」在服务端是删除行，客户端不用知道）。
 *
 * 这里只治理个人资料；社交账号由 `SharedSocialAccount` 授权、动态可见范围由
 * `MomentSetting.visibleTo`，都不受这里影响 —— 页面文案里说明这一点。
 */

/** 三档可见性，chips 用短文案（与 web 的 VISIBILITY_SHORT_LABELS 一致）。 */
const TIER_CHIPS: Array<{ tier: VisibilityTier; labelKey: MsgKey }> = [
  { tier: "PUBLIC", labelKey: "visibility.chipPublic" },
  { tier: "CONNECTIONS", labelKey: "visibility.chipConnections" },
  { tier: "PRIVATE", labelKey: "visibility.chipPrivate" },
];

/** 「当前」行用全称（与 web 的 VISIBILITY_LABELS 一致）。 */
const TIER_LONG_LABELS: Record<VisibilityTier, MsgKey> = {
  PUBLIC: "visibility.tierPublic",
  CONNECTIONS: "visibility.tierConnections",
  PRIVATE: "visibility.tierPrivate",
};

/** 13 个白名单字段的中英文名（镜像 web 的 FIELD_VISIBILITY_LABELS）。 */
const FIELD_LABELS: Record<ProfileVisibilityField, MsgKey> = {
  nickname: "visibility.field.nickname",
  avatarUrl: "visibility.field.avatarUrl",
  birthDate: "visibility.field.birthDate",
  countryCode: "visibility.field.countryCode",
  city: "visibility.field.city",
  region: "visibility.field.region",
  gender: "visibility.field.gender",
  bio: "visibility.field.bio",
  languages: "visibility.field.languages",
  interests: "visibility.field.interests",
  purposes: "visibility.field.purposes",
  preferredCountries: "visibility.field.preferredCountries",
  attributes: "visibility.field.attributes",
};

export function VisibilityScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<FieldVisibilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FieldVisibilityRow[]>("/users/me/profile-field-visibility");
      setRows(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("visibility.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(fieldKey: ProfileVisibilityField, tier: VisibilityTier) {
    if (savingField) return;
    setSavingField(fieldKey);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<FieldVisibilityRow[]>("/users/me/profile-field-visibility", {
        method: "PUT",
        body: { fieldKey, visibility: tier },
      });
      setRows(data);
      setNotice(
        t("visibility.changed", {
          field: t(FIELD_LABELS[fieldKey]),
          tier: t(TIER_LONG_LABELS[tier]),
        }),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("visibility.errorSave"));
      // 保存失败时重拉一遍，状态与服务端保持一致，而不是留着没生效的本地选择。
      await load();
    } finally {
      setSavingField(null);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("visibility.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t("visibility.intro")}</Text>
        <Text style={styles.blockNote}>{t("visibility.blockNote")}</Text>

        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.primary} />
        ) : null}

        {!loading && error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
          </View>
        ) : null}

        {!loading && rows.length > 0 ? (
          <View style={styles.list}>
            {rows.map((row) => (
              <View key={row.fieldKey} style={styles.row}>
                <Text style={styles.fieldLabel}>{t(FIELD_LABELS[row.fieldKey])}</Text>
                <Text style={styles.current}>
                  {t("visibility.current", { tier: t(TIER_LONG_LABELS[row.visibility]) })}
                </Text>
                <View style={styles.chipRow}>
                  {TIER_CHIPS.map((chip) => {
                    const active = row.visibility === chip.tier;
                    const disabled = savingField === row.fieldKey;
                    return (
                      <Pressable
                        key={chip.tier}
                        onPress={() => void change(row.fieldKey, chip.tier)}
                        disabled={disabled}
                        accessibilityRole="button"
                        accessibilityLabel={t(chip.labelKey)}
                        /* 颜色不应当独自承载「选中」，所以同时给出 selected 状态。 */
                        accessibilityState={{ selected: active, disabled }}
                        style={[styles.chip, active ? styles.chipActive : null, disabled ? styles.chipDisabled : null]}
                      >
                        <Text style={[styles.chipLabel, active ? styles.chipLabelActive : null]}>
                          {t(chip.labelKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {notice ? (
          <Text style={styles.notice} accessibilityRole="alert">
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 20, color: colors.muted },
  blockNote: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  center: { marginTop: 28 },
  errorBox: { alignItems: "center", marginTop: 24, gap: 10 },
  errorText: { fontSize: 13, color: colors.danger, textAlign: "center" },
  list: { marginTop: 16, gap: 10 },
  row: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 14,
    gap: 8,
  },
  fieldLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  current: { fontSize: 12, color: colors.muted },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled: { opacity: 0.5 },
  chipLabel: { fontSize: 12, color: colors.muted },
  chipLabelActive: { color: colors.white, fontWeight: "600" },
  notice: {
    marginTop: 16,
    fontSize: 13,
    color: colors.success,
    textAlign: "center",
  },
});
