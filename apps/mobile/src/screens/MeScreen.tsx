import { StyleSheet, Pressable, Text, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { useAuth } from "../lib/auth-context";
import { useI18n, type LocalePreference } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";

/**
 * 界面语言选项。
 *
 * 存的是**偏好**而不是当前语言：选了「跟随系统」以后，用户在手机设置里把语言
 * 改成英文，下次启动就该是英文 —— 不需要再进来手动改一次（见 `i18n-context`）。
 */
const LANGUAGE_OPTIONS = [
  { value: "system", labelKey: "me.languageSystem" },
  { value: "zh", labelKey: "me.languageZh" },
  { value: "en", labelKey: "me.languageEn" },
] as const satisfies readonly { value: LocalePreference; labelKey: MsgKey }[];

export function MeScreen() {
  const { user, signOut } = useAuth();
  const { t, preference, setPreference } = useI18n();

  if (!user) return null;

  const place = [user.city, user.region, user.countryName ?? user.countryCode]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("me.title")}</Text>
      </View>

      <View style={styles.card}>
        <Avatar uri={user.avatarUrl} nickname={user.nickname} size={72} />
        <Text style={styles.name}>{user.nickname ?? t("common.talkfirstUser")}</Text>
        <Text style={styles.email}>{user.email}</Text>
        {place ? <Text style={styles.place}>🌎 {place}</Text> : null}
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {user.profileCompleted ? t("me.profileComplete") : t("me.profileIncomplete")}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Text style={styles.sectionTitle}>{t("me.language")}</Text>
        <View style={styles.languageRow}>
          {LANGUAGE_OPTIONS.map((option) => {
            const active = preference === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setPreference(option.value)}
                accessibilityRole="button"
                /* 颜色不应当独自承载「选中」，所以同时给出 selected 状态。 */
                accessibilityState={{ selected: active }}
                style={[styles.languageChip, active ? styles.languageChipActive : null]}
              >
                <Text style={[styles.languageLabel, active ? styles.languageLabelActive : null]}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.languageNote}>{t("me.languageNote")}</Text>
      </View>

      <View style={styles.actions}>
        <Button label={t("me.signOut")} onPress={() => void signOut()} variant="ghost" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: "600", color: colors.ink },
  card: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 24,
    backgroundColor: colors.bgSoft,
    alignItems: "center",
    padding: 24,
  },
  name: { fontSize: 20, fontWeight: "600", color: colors.ink, marginTop: 12 },
  email: { fontSize: 13, color: colors.muted, marginTop: 4 },
  place: { fontSize: 12, color: colors.muted, marginTop: 4 },
  bio: { fontSize: 13, color: colors.muted, lineHeight: 20, textAlign: "center", marginTop: 12 },
  badgeRow: { flexDirection: "row", marginTop: 16 },
  badge: { backgroundColor: colors.bgTint, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: 11, color: colors.primary, fontWeight: "500" },
  actions: { paddingHorizontal: 20, marginTop: 24 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  languageRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  languageChip: {
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingVertical: 9,
  },
  languageChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  languageLabel: { fontSize: 13, color: colors.muted },
  languageLabelActive: { color: colors.white, fontWeight: "600" },
  languageNote: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 8 },
});
