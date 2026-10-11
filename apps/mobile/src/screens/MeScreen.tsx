import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n, type LocalePreference } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { SessionUser } from "../lib/types";
import { colors } from "../theme";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { SafetyScreen } from "./SafetyScreen";
import { SocialScreen } from "./SocialScreen";
import { VisibilityScreen } from "./VisibilityScreen";

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

/**
 * 「我的」里的入口，**分组方式与 web 端 `/me` 一致**（内容 / 帮助与反馈）。
 *
 * web 那边把入口分了组而不是平铺一列按钮 —— 六个一模一样的大按钮等于没有重点。
 * 这里沿用同样的分组与图标语义，让两端看起来是同一个产品。
 *
 * 入口按 web `/me` 的四组放：内容（编辑基本资料）、关系（我的连接/管理社交账号）、
 * 隐私与安全（资料可见范围/安全中心）、帮助与反馈（意见反馈）。
 * 「语言 · 兴趣 · 交友目的」与「交友属性」是 web 已有而移动端还没实现的入口，
 * 继续按老规矩：挂了但点了没反应，不如暂时不挂。
 */
type MeEntry = {
  key: "edit" | "feedback" | "connections" | "social" | "visibility" | "safety";
  labelKey: MsgKey;
  icon: string;
};
type MeGroup = { titleKey: MsgKey; entries: MeEntry[] };

const ME_GROUPS: MeGroup[] = [
  {
    titleKey: "me.groupContent",
    entries: [{ key: "edit", labelKey: "me.editProfile", icon: "create-outline" }],
  },
  {
    titleKey: "me.groupRelations",
    entries: [
      { key: "connections", labelKey: "me.connections", icon: "people-outline" },
      { key: "social", labelKey: "me.social", icon: "globe-outline" },
    ],
  },
  {
    titleKey: "me.groupPrivacy",
    entries: [
      { key: "visibility", labelKey: "me.visibility", icon: "eye-outline" },
      { key: "safety", labelKey: "me.safety", icon: "shield-checkmark-outline" },
    ],
  },
  {
    titleKey: "me.groupHelp",
    entries: [{ key: "feedback", labelKey: "me.feedback", icon: "chatbox-ellipses-outline" }],
  },
];

export function MeScreen() {
  const { user, signOut, setUser } = useAuth();
  const { t, preference, setPreference } = useI18n();
  const [open, setOpen] = useState<MeEntry["key"] | null>(null);

  if (!user) return null;

  if (open === "edit") {
    return <EditProfileScreen user={user} onDone={() => setOpen(null)} onSaved={setUser} />;
  }
  if (open === "feedback") {
    return <FeedbackScreen onDone={() => setOpen(null)} />;
  }
  if (open === "connections") {
    return <ConnectionsScreen onBack={() => setOpen(null)} />;
  }
  if (open === "social") {
    return <SocialScreen onBack={() => setOpen(null)} />;
  }
  if (open === "visibility") {
    return <VisibilityScreen onBack={() => setOpen(null)} />;
  }
  if (open === "safety") {
    /* 安全中心底部的「管理社交账号可见性」直达社交账号页 —— 与 web 的
       href="/me/social" 同一个跳转，全屏接管状态下就是换个 open 值。 */
    return <SafetyScreen onBack={() => setOpen(null)} onOpenSocial={() => setOpen("social")} />;
  }

  const place = [user.city, user.region, user.countryName ?? user.countryCode]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("me.title")}</Text>
      </View>

      <View style={styles.card}>
        <Avatar uri={user.avatarUrl} nickname={user.nickname} size={72} />
        <Text style={styles.name}>{user.nickname ?? t("common.talkfirstUser")}</Text>
        <Text style={styles.email}>{user.email}</Text>
        {place ? <Text style={styles.place}>{place}</Text> : null}
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {user.profileCompleted ? t("me.profileComplete") : t("me.profileIncomplete")}
            </Text>
          </View>
        </View>
      </View>

      {ME_GROUPS.map((group) => (
        <View key={group.titleKey} style={styles.group}>
          <Text style={styles.groupTitle}>{t(group.titleKey)}</Text>
          <View style={styles.groupCard}>
            {group.entries.map((entry) => (
              <Pressable
                key={entry.key}
                onPress={() => setOpen(entry.key)}
                accessibilityRole="button"
                accessibilityLabel={t(entry.labelKey)}
                style={styles.row}
              >
                <Icon name={entry.icon} size={18} color={colors.primary} />
                <Text style={styles.rowLabel}>{t(entry.labelKey)}</Text>
                <Icon name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <Text style={styles.moreSoon}>{t("me.moreSoon")}</Text>

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
                accessibilityLabel={t(option.labelKey)}
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
    </ScrollView>
  );
}

/**
 * 编辑基本资料。
 *
 * 走 `PATCH /users/me`（与 web 的 `/me/edit` 同一个接口），只提交改动过的字段：
 * 这个端点是部分更新，少发几个字段比发一堆原值更不容易出错。
 */
function EditProfileScreen({
  user,
  onDone,
  onSaved,
}: {
  user: SessionUser;
  onDone: () => void;
  onSaved: (user: SessionUser) => void;
}) {
  const { t } = useI18n();
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await apiFetch<SessionUser>("/users/me", {
        method: "PATCH",
        body: { nickname: nickname.trim(), bio: bio.trim(), city: city.trim() },
      });
      onSaved({ ...user, ...updated });
      setMessage(t("me.saved"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.page}>
      <SubHeader title={t("me.editProfile")} onBack={onDone} />
      <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
        <Field label={t("me.nickname")} value={nickname} onChange={setNickname} maxLength={30} />
        <Field label={t("me.city")} value={city} onChange={setCity} maxLength={40} />
        <Field label={t("me.bio")} value={bio} onChange={setBio} maxLength={200} multiline />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {message ? <Text style={styles.okText}>{message}</Text> : null}
        <View style={styles.pageActions}>
          {saving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button label={t("me.save")} onPress={() => void save()} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** 意见反馈：`POST /feedback`（与 web 的 `/me/feedback` 同一个接口）。 */
function FeedbackScreen({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      await apiFetch("/feedback", { method: "POST", body: { content: trimmed } });
      setSent(true);
      setContent("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("me.loadingFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.page}>
      <SubHeader title={t("me.feedback")} onBack={onDone} />
      <ScrollView contentContainerStyle={styles.pageBody} keyboardShouldPersistTaps="handled">
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder={t("me.feedbackPlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.textArea}
          multiline
          maxLength={2000}
          accessibilityLabel={t("me.feedbackPlaceholder")}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {sent ? <Text style={styles.okText}>{t("me.feedbackSent")}</Text> : null}
        <View style={styles.pageActions}>
          {sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button label={t("me.feedbackSubmit")} onPress={() => void submit()} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/** 一个带标签的输入行。 */
function Field({
  label,
  value,
  onChange,
  maxLength,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        multiline={multiline}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
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
  badge: {
    backgroundColor: colors.bgTint,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontSize: 11, color: colors.primary, fontWeight: "500" },

  group: { marginTop: 22, paddingHorizontal: 20 },
  groupTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8 },
  groupCard: {
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.ink },
  moreSoon: { marginTop: 14, paddingHorizontal: 20, fontSize: 12, color: colors.muted },

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

  page: { flex: 1, backgroundColor: colors.bg },
  pageBody: { padding: 20, gap: 16 },
  pageActions: { marginTop: 4 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },
  textArea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    backgroundColor: colors.white,
    textAlignVertical: "top",
  },
  errorText: { fontSize: 13, color: colors.danger },
  okText: { fontSize: 13, color: colors.primary },
});
