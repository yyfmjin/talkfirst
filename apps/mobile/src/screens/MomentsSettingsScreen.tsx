import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { Switch } from "../components/Switch";
import { apiFetch, ApiRequestError } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { MomentPlatform, MomentPlatformBinding, MomentSettings } from "../lib/types";
import { colors } from "../theme";

/**
 * 我的动态设置 —— 对齐 web 的 `/moments/settings`。
 *
 * ## 这一页管什么
 *
 * 三件事，与 web 一一对应：把别的社交平台的账号绑上来（绑定 / 解绑 / 逐平台开关）、
 * 谁能看到你的动态聚合页（`MomentSetting.visibleTo`）、以及聚合进来哪些类型的内容。
 * 注意它**不是**「管理社交账号」（那是 `/me/social`，走 OAuth 授权）—— 这条线只填
 * 用户名，服务端目前不同步真实数据。
 *
 * ## 为什么要摆一条「示例内容说明」
 *
 * 绑定以后动态里会出现这个人的「示例」内容。如果界面上不说清楚，运营方和用户都会
 * 以为真的连上了 Instagram —— 而事实是平台授权还没接。这句话不是免责套话，是这条
 * 功能当前唯一诚实的状态描述，所以放在最上面、用警告色之外但明显区别于正文的样式。
 *
 * ## 为什么设置是「先改界面再发请求」
 *
 * 开关这种控件，等一个来回才有反馈会显得卡；失败就退回原状态并报错（见
 * `updateSetting`）。同时用一个 `savingKey` 把并发点按拦掉：连点两次「仅连接可见」
 * 会发两个 PATCH，先回来的那个不一定是最后点的那次。
 */

/** 三档可见范围。值与服务端 `MomentSetting.visibleTo` 的白名单一致。 */
const VISIBILITY_OPTIONS: Array<{ value: string; labelKey: MsgKey; descKey: MsgKey }> = [
  {
    value: "everyone",
    labelKey: "momentsSettings.visibleEveryone",
    descKey: "momentsSettings.visibleEveryoneDesc",
  },
  {
    value: "connections",
    labelKey: "momentsSettings.visibleConnections",
    descKey: "momentsSettings.visibleConnectionsDesc",
  },
  {
    value: "private",
    labelKey: "momentsSettings.visiblePrivate",
    descKey: "momentsSettings.visiblePrivateDesc",
  },
];

/** 内容筛选的六个开关。`key` 就是 `MomentSettings` 上的字段名，PATCH 直接用它。 */
type ContentToggleKey =
  | "showPhotos"
  | "showVideos"
  | "showTexts"
  | "showReels"
  | "showLives"
  | "filterSensitive";

const CONTENT_TOGGLES: Array<{ key: ContentToggleKey; labelKey: MsgKey; descKey: MsgKey }> = [
  { key: "showPhotos", labelKey: "momentsSettings.showPhotos", descKey: "momentsSettings.showPhotosDesc" },
  { key: "showVideos", labelKey: "momentsSettings.showVideos", descKey: "momentsSettings.showVideosDesc" },
  { key: "showTexts", labelKey: "momentsSettings.showTexts", descKey: "momentsSettings.showTextsDesc" },
  { key: "showReels", labelKey: "momentsSettings.showReels", descKey: "momentsSettings.showReelsDesc" },
  { key: "showLives", labelKey: "momentsSettings.showLives", descKey: "momentsSettings.showLivesDesc" },
  {
    key: "filterSensitive",
    labelKey: "momentsSettings.filterSensitive",
    descKey: "momentsSettings.filterSensitiveDesc",
  },
];

/**
 * 服务端错误码 → 界面文案。
 *
 * 不直接显示服务端的 `message`：那是英文原文（「INVALID_HANDLE」一类），摆在中文
 * 界面里等于没解释。与登录/注册同一套做法（见 `AuthScreen` 的 AUTH_ERROR_KEYS）。
 * 认不出来的码一律说「失败，请重试」，不把原始句子透出去。
 */
const BIND_ERROR_KEYS: Record<string, MsgKey> = {
  INVALID_HANDLE: "momentsSettings.errorHandle",
  UNKNOWN_PLATFORM: "momentsSettings.errorBind",
};

/**
 * 加载失败时说什么。
 *
 * `api.ts` 只对网络层（断网 / 超时）自己本地化过；服务端返回的 `message` 是英文
 * 原文，直接摆在中文界面上等于没解释。所以：认识的两个情况用已经有语言的句子，
 * 其余一律说我们自己的话。
 */
function loadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.code === "NETWORK_ERROR") return error.message;
  if (error instanceof Error && error.name === "RequestTimeoutError") return error.message;
  return fallback;
}

/** 绑定成功后 `load()` 会重拉这一页，所以这里只挑需要的三个端点。 */
export function MomentsSettingsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [platforms, setPlatforms] = useState<MomentPlatform[]>([]);
  const [bindings, setBindings] = useState<MomentPlatformBinding[]>([]);
  const [setting, setSetting] = useState<MomentSettings | null>(null);
  /** 未绑定平台那一栏里正在输入的账号名。 */
  const [handles, setHandles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** 正在请求的平台 id（绑定 / 解绑 / 逐平台开关）。 */
  const [acting, setActing] = useState<string | null>(null);
  /** 正在保存的设置字段名：同一条设置不允许并发提交两次。 */
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [pendingUnbind, setPendingUnbind] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [platformList, bindingList, current] = await Promise.all([
        apiFetch<MomentPlatform[]>("/moments/platforms"),
        apiFetch<MomentPlatformBinding[]>("/moments/bindings"),
        apiFetch<MomentSettings>("/moments/settings"),
      ]);
      setPlatforms(platformList);
      setBindings(bindingList);
      setSetting(current);
    } catch (requestError) {
      setError(loadErrorMessage(requestError, t("momentsSettings.errorLoad")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 「已保存」挂 1.6 秒就撤；组件卸载时要把定时器清掉，否则是一次对已卸载组件的
     setState（开发模式会警告，测试里也会脏掉下一个用例）。 */
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  }

  async function updateSetting(patch: Partial<MomentSettings>, key: string) {
    if (!setting || savingKey) return;
    const previous = setting;
    setSavingKey(key);
    setError("");
    setSetting({ ...setting, ...patch });
    try {
      const next = await apiFetch<MomentSettings>("/moments/settings", { method: "PATCH", body: patch });
      setSetting(next);
      flashSaved();
    } catch {
      setSetting(previous);
      /* 不显示服务端的英文原文（与登录/注册同一套口径）。 */
      setError(t("momentsSettings.errorSave"));
    } finally {
      setSavingKey(null);
    }
  }

  async function bind(platform: MomentPlatform) {
    const handle = (handles[platform.id] ?? "").trim().replace(/^@+/, "");
    if (!handle) {
      setError(t("momentsSettings.errorHandle"));
      return;
    }
    setActing(platform.id);
    setError("");
    try {
      await apiFetch("/moments/bindings", { method: "POST", body: { platform: platform.id, handle } });
      setHandles((current) => ({ ...current, [platform.id]: "" }));
      /* 绑定会连带把总开关打开、并写入示例内容（服务端行为），所以整页重拉，
         而不是只把这一行改成「已绑定」—— 总开关不该停在旧状态上。 */
      await load();
      flashSaved();
    } catch (requestError) {
      const code = requestError instanceof ApiRequestError ? requestError.code : "";
      setError(t(BIND_ERROR_KEYS[code] ?? "momentsSettings.errorBind"));
    } finally {
      setActing(null);
    }
  }

  async function togglePlatform(platform: string, syncEnabled: boolean) {
    setActing(platform);
    setError("");
    try {
      await apiFetch(`/moments/bindings/${platform}`, { method: "PATCH", body: { syncEnabled } });
      setBindings((current) =>
        current.map((item) => (item.platform === platform ? { ...item, syncEnabled } : item)),
      );
    } catch {
      setError(t("momentsSettings.errorSave"));
    } finally {
      setActing(null);
    }
  }

  async function confirmUnbind(platform: string) {
    setActing(platform);
    setError("");
    try {
      await apiFetch(`/moments/bindings/${platform}`, { method: "DELETE" });
      setPendingUnbind(null);
      /* 解绑只删绑定：已同步进来的动态会保留（文案里就是这么承诺的），所以这里
         不需要动动态列表，重拉这一页即可。 */
      await load();
      flashSaved();
    } catch {
      setError(t("momentsSettings.errorUnbind"));
    } finally {
      setActing(null);
    }
  }

  const bound = (platform: string) => bindings.find((item) => item.platform === platform);
  const boundCount = bindings.filter((item) => item.syncEnabled).length;

  return (
    <View style={styles.root}>
      <SubHeader title={t("momentsSettings.title")} onBack={onBack} />

      {/* 固定高度的一格：出现/消失不会把下面的内容顶上顶下。 */}
      <View style={styles.savedSlot}>
        {saved ? (
          <View style={styles.savedPill}>
            <Icon name="checkmark" size={13} color={colors.success} />
            <Text style={styles.savedLabel}>{t("momentsSettings.saved")}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>{t("momentsSettings.demoTitle")}</Text>
          <Text style={styles.noticeBody}>{t("momentsSettings.demoBody")}</Text>
        </View>

        <Text style={styles.intro}>{t("momentsSettings.intro", { n: boundCount })}</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingLabel}>{t("momentsSettings.loading")}</Text>
          </View>
        ) : null}

        {!loading && !setting ? (
          <View style={styles.center}>
            <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
          </View>
        ) : null}

        {!loading && setting ? (
          <>
            <Text style={styles.sectionTitle}>{t("momentsSettings.syncSection")}</Text>
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <Text style={styles.rowLabel}>{t("momentsSettings.syncMaster")}</Text>
                <Switch
                  checked={setting.syncEnabled}
                  label={t("momentsSettings.syncMaster")}
                  disabled={savingKey !== null}
                  onChange={(next) => void updateSetting({ syncEnabled: next }, "syncEnabled")}
                />
              </View>
            </View>

            {/* 站内自己的动态不需要「绑定」，所以与 web 一样把它排除在外。 */}
            {platforms
              .filter((item) => item.id !== "TALKFIRST")
              .map((platform) => {
                const binding = bound(platform.id);
                return (
                  <View key={platform.id} style={styles.platformCard}>
                    <View style={styles.platformTop}>
                      <View style={[styles.platformBadge, { backgroundColor: platform.color }]}>
                        <Text style={styles.platformBadgeText}>{platform.icon}</Text>
                      </View>
                      <View style={styles.platformInfo}>
                        <Text style={styles.platformName}>{platform.label}</Text>
                        <Text style={styles.platformMeta} numberOfLines={1}>
                          {binding ? `@${binding.handle}` : platform.connectedLabel}
                        </Text>
                      </View>
                      {binding ? (
                        <Switch
                          checked={binding.syncEnabled}
                          label={`${platform.label} ${t("momentsSettings.syncMaster")}`}
                          disabled={acting === platform.id}
                          onChange={(next) => void togglePlatform(platform.id, next)}
                        />
                      ) : (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{t("momentsSettings.unbound")}</Text>
                        </View>
                      )}
                    </View>

                    {binding ? (
                      pendingUnbind === platform.id ? (
                        <View style={styles.confirmBox}>
                          <Text style={styles.confirmTitle}>{t("momentsSettings.unbindTitle")}</Text>
                          <Text style={styles.confirmBody}>{t("momentsSettings.unbindBody")}</Text>
                          <Text style={styles.confirmTarget}>
                            {t("momentsSettings.unbindTarget", {
                              name: `${platform.label}（@${binding.handle}）`,
                            })}
                          </Text>
                          <View style={styles.confirmActions}>
                            <Pressable
                              onPress={() => setPendingUnbind(null)}
                              accessibilityRole="button"
                              accessibilityLabel={t("moments.cancel")}
                              style={styles.cancelButton}
                            >
                              <Text style={styles.cancelLabel}>{t("moments.cancel")}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => void confirmUnbind(platform.id)}
                              disabled={acting === platform.id}
                              accessibilityRole="button"
                              accessibilityLabel={t("momentsSettings.unbindConfirm")}
                              style={[styles.dangerButton, acting === platform.id ? styles.disabled : null]}
                            >
                              <Text style={styles.dangerLabel}>
                                {acting === platform.id
                                  ? t("momentsSettings.unbinding")
                                  : t("momentsSettings.unbindConfirm")}
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => setPendingUnbind(platform.id)}
                          accessibilityRole="button"
                          accessibilityLabel={t("momentsSettings.unbind")}
                          style={styles.linkRow}
                        >
                          <Icon name="unlink-outline" size={15} color={colors.muted} />
                          <Text style={styles.linkLabel}>{t("momentsSettings.unbind")}</Text>
                        </Pressable>
                      )
                    ) : (
                      <View style={styles.bindRow}>
                        <TextInput
                          value={handles[platform.id] ?? ""}
                          onChangeText={(text) =>
                            setHandles((current) => ({ ...current, [platform.id]: text }))
                          }
                          placeholder={t("momentsSettings.handlePlaceholder", { platform: platform.label })}
                          placeholderTextColor={colors.muted}
                          maxLength={128}
                          autoCapitalize="none"
                          autoCorrect={false}
                          accessibilityLabel={t("momentsSettings.handlePlaceholder", {
                            platform: platform.label,
                          })}
                          style={styles.handleInput}
                        />
                        <View style={styles.bindButton}>
                          <Button
                            label={
                              acting === platform.id
                                ? t("momentsSettings.binding")
                                : t("momentsSettings.bind")
                            }
                            onPress={() => void bind(platform)}
                            loading={acting === platform.id}
                          />
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

            <Text style={styles.sectionTitle}>{t("momentsSettings.privacySection")}</Text>
            <Text style={styles.sectionIntro}>{t("momentsSettings.privacyIntro")}</Text>
            <View style={styles.card}>
              {VISIBILITY_OPTIONS.map((option, index) => {
                const active = setting.visibleTo === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => void updateSetting({ visibleTo: option.value }, "visibleTo")}
                    disabled={savingKey !== null}
                    accessibilityRole="radio"
                    /* 三档互斥：勾选状态要让读屏念出来，不能只靠那一圈颜色。 */
                    accessibilityState={{ checked: active, selected: active }}
                    accessibilityLabel={`${t(option.labelKey)}，${t(option.descKey)}`}
                    style={[styles.radioRow, index > 0 ? styles.divided : null]}
                  >
                    <View style={styles.radioText}>
                      <Text style={[styles.rowLabel, active ? styles.rowLabelActive : null]}>
                        {t(option.labelKey)}
                      </Text>
                      <Text style={styles.rowDesc}>{t(option.descKey)}</Text>
                    </View>
                    <View style={[styles.radioDot, active ? styles.radioDotActive : null]}>
                      {active ? <Icon name="checkmark" size={12} color={colors.white} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>{t("momentsSettings.filterSection")}</Text>
            <View style={styles.card}>
              {CONTENT_TOGGLES.map((toggle, index) => (
                <View key={toggle.key} style={[styles.toggleRow, index > 0 ? styles.divided : null]}>
                  <View style={styles.radioText}>
                    <Text style={styles.rowLabel}>{t(toggle.labelKey)}</Text>
                    <Text style={styles.rowDesc}>{t(toggle.descKey)}</Text>
                  </View>
                  <Switch
                    checked={setting[toggle.key]}
                    label={t(toggle.labelKey)}
                    disabled={savingKey !== null}
                    onChange={(next) =>
                      void updateSetting({ [toggle.key]: next } as Partial<MomentSettings>, toggle.key)
                    }
                  />
                </View>
              ))}
            </View>

            <View style={styles.doneRow}>
              <Button label={t("momentsSettings.done")} onPress={onBack} variant="ghost" />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  savedSlot: { height: 28, alignItems: "center", justifyContent: "center" },
  savedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  savedLabel: { fontSize: 12, color: colors.success, fontWeight: "600" },
  noticeCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgTint,
    padding: 14,
  },
  noticeTitle: { fontSize: 13, fontWeight: "700", color: colors.primaryDark },
  noticeBody: { marginTop: 6, fontSize: 12, lineHeight: 19, color: colors.ink },
  intro: { marginTop: 12, fontSize: 13, lineHeight: 20, color: colors.muted },
  errorText: { marginTop: 10, fontSize: 13, lineHeight: 19, color: colors.danger },
  center: { alignItems: "center", gap: 10, paddingVertical: 28 },
  loadingLabel: { fontSize: 13, color: colors.muted },
  sectionTitle: { marginTop: 24, fontSize: 15, fontWeight: "700", color: colors.ink },
  sectionIntro: { marginTop: 6, fontSize: 13, lineHeight: 19, color: colors.muted },
  card: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
  },
  divided: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { fontSize: 15, color: colors.ink },
  rowLabelActive: { color: colors.primaryDark, fontWeight: "600" },
  rowDesc: { marginTop: 3, fontSize: 12, lineHeight: 18, color: colors.muted },
  radioText: { flex: 1, minWidth: 0 },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
  },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  platformCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 14,
  },
  platformTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  platformBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  platformBadgeText: { fontSize: 13, fontWeight: "700", color: colors.white },
  platformInfo: { flex: 1, minWidth: 0 },
  platformName: { fontSize: 15, fontWeight: "500", color: colors.ink },
  platformMeta: { marginTop: 3, fontSize: 12, color: colors.muted },
  badge: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, color: colors.muted },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, alignSelf: "flex-start" },
  linkLabel: { fontSize: 12, color: colors.muted },
  bindRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  handleInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  bindButton: { width: 96 },
  confirmBox: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    padding: 12,
  },
  confirmTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  confirmBody: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.muted },
  confirmTarget: { marginTop: 6, fontSize: 12, color: colors.ink },
  confirmActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  cancelButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgTint,
  },
  cancelLabel: { fontSize: 14, fontWeight: "600", color: colors.primaryDark },
  dangerButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  dangerLabel: { fontSize: 14, fontWeight: "600", color: colors.white },
  disabled: { opacity: 0.5 },
  doneRow: { marginTop: 24 },
});
