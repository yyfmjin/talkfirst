import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { SharedBinding, SocialSyncAccount, SocialSyncProvider } from "../lib/types";
import { colors } from "../theme";

/** 同步条数可选项（服务端同样只认 1~3）。 */
const SYNC_LIMITS = [1, 2, 3];

/**
 * 服务端的同步错误码 → 文案键。服务端从不把平台的原始文案发给客户端，
 * 这里的每条都是为本页写的；未知码兜底为「未知错误」。
 */
const SYNC_ERROR_KEYS: Record<string, MsgKey> = {
  SOCIAL_AUTH_REQUIRED: "social.errAuthRequired",
  SOCIAL_TOKEN_REFRESH_FAILED: "social.errTokenRefreshFailed",
  SOCIAL_PERMISSION_DENIED: "social.errPermissionDenied",
  SOCIAL_RATE_LIMITED: "social.errRateLimited",
  SOCIAL_PROVIDER_NOT_SUPPORTED: "social.errProviderNotSupported",
  SOCIAL_PROVIDER_REQUIRES_APPROVAL: "social.errRequiresApproval",
  SOCIAL_AUTH_FAILED: "social.errAuthFailed",
  SOCIAL_SYNC_FAILED: "social.errSyncFailed",
  SOCIAL_PROVIDER_ERROR: "social.errProviderError",
};

/**
 * 管理社交账号 —— 对齐 web 的 `/me/social`。
 *
 * 两个不同的「社交账号」概念，页面也分两段（与 web 同一个理由）：
 *   1. 动态同步（SocialSyncAccount）：OAuth 授权后读取最近 1~3 条公开动态；
 *   2. 好友可见的账号（SharedSocialAccount）：老功能，这里只读展示。
 *
 * ## 授权跳转与 web 的差别
 *
 * web 是整页跳到 OAuth 授权页；移动端用 `Linking.openURL` 打开系统浏览器，
 * 完成后用户回到 App 下拉刷新即可看到账号（授权回调落在 web 域名，App 拿不到）。
 */
export function SocialScreen({ onBack, footer }: { onBack: () => void; footer?: ReactNode }) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<SocialSyncProvider[]>([]);
  const [accounts, setAccounts] = useState<SocialSyncAccount[]>([]);
  const [bindings, setBindings] = useState<SharedBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError("");
      try {
        const [catalogue, syncAccounts, legacy] = await Promise.all([
          apiFetch<{ providers: SocialSyncProvider[] }>("/social-sync/providers"),
          apiFetch<{ accounts: SocialSyncAccount[] }>("/social-sync/accounts"),
          apiFetch<SharedBinding[]>("/moments/bindings").catch(() => [] as SharedBinding[]),
        ]);
        setProviders(catalogue.providers);
        setAccounts(syncAccounts.accounts);
        setBindings(legacy);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t("social.errorLoad"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load("initial");
    // 只在挂载时拉一次；重进页面 / 下拉刷新各有自己的入口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountFor = (provider: string) => accounts.find((row) => row.provider === provider);

  async function connect(provider: string) {
    setBusy(provider);
    setError("");
    setNotice("");
    try {
      const data = await apiFetch<{ authorizationUrl: string }>(
        `/social-sync/${provider.toLowerCase()}/start`,
      );
      await Linking.openURL(data.authorizationUrl);
      setNotice(t("social.authHint"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("social.errorConnect"));
    } finally {
      setBusy(null);
    }
  }

  async function updateAccount(
    account: SocialSyncAccount,
    patch: { syncLimit?: number; syncEnabled?: boolean },
  ) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/social-sync/accounts/${account.id}`, { method: "PATCH", body: patch });
      await load("refresh");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("social.errorSave"));
      setBusy(null);
    }
  }

  async function syncNow(account: SocialSyncAccount) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ fetched: number }>(
        `/social-sync/accounts/${account.id}/sync`,
        { method: "POST" },
      );
      setNotice(t("social.syncedCount", { n: result.fetched }));
      await load("refresh");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("social.errorSync"));
      setBusy(null);
    }
  }

  async function disconnect(account: SocialSyncAccount) {
    setBusy(account.id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/social-sync/accounts/${account.id}`, { method: "DELETE" });
      setNotice(t("social.disconnected"));
      await load("refresh");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("social.errorDisconnect"));
      setBusy(null);
    }
  }

  function statusBadge(account: SocialSyncAccount | undefined) {
    if (!account) {
      return <Text style={styles.notBound}>{t("social.notBound")}</Text>;
    }
    const tone =
      account.status === "ACTIVE"
        ? { box: styles.badgeOk, text: styles.badgeOkText, label: t("social.bound") }
        : account.status === "NEEDS_REAUTH"
          ? { box: styles.badgeWarn, text: styles.badgeWarnText, label: t("social.needReauth") }
          : { box: styles.badgeNeutral, text: styles.badgeNeutralText, label: t("social.revoked") };
    return (
      <View style={[styles.badge, tone.box]}>
        <Text style={[styles.badgeText, tone.text]}>{tone.label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("social.title")} onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor={colors.primary}
          />
        }
      >
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.sectionTitle}>{t("social.syncSection")}</Text>
        <Text style={styles.sectionHint}>{t("social.syncHint")}</Text>

        {loading ? <ActivityIndicator style={styles.center} color={colors.primary} /> : null}

        {!loading && providers.length === 0 ? (
          <View style={styles.emptyBox}>
            <Icon name="link-outline" size={26} color={colors.muted} />
            <Text style={styles.emptyTitle}>{t("social.noProviders")}</Text>
            <Text style={styles.emptyBody}>{t("social.noProvidersBody")}</Text>
          </View>
        ) : null}

        {!loading
          ? providers.map((provider) => {
              const account = accountFor(provider.provider);
              return (
                <View key={provider.provider} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.providerLabel}>{provider.label}</Text>
                    {statusBadge(account)}
                  </View>

                  {provider.availability !== "AVAILABLE" ? (
                    <View style={styles.hintRow}>
                      <Icon name="lock-closed-outline" size={12} color={colors.muted} />
                      <Text style={styles.hintText}>
                        {provider.availability === "REQUIRES_APPROVAL"
                          ? t("social.availabilityApproval")
                          : t("social.availabilityNotConfigured")}
                      </Text>
                    </View>
                  ) : account ? (
                    <>
                      {account.handle || account.displayName ? (
                        <Text style={styles.handle}>
                          {account.displayName ?? account.handle}
                          {account.handle && account.displayName ? ` · @${account.handle}` : ""}
                        </Text>
                      ) : null}

                      {account.status === "NEEDS_REAUTH" ? (
                        <View style={styles.warnRow}>
                          <Icon name="warning-outline" size={12} color="#B26A00" />
                          <Text style={styles.warnText}>
                            {t("social.reauthHint", {
                              reason: t(SYNC_ERROR_KEYS[account.lastSyncError ?? ""] ?? "social.errUnknown"),
                            })}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.syncRow}>
                        <Text style={styles.syncLabel}>{t("social.syncLimitLabel", { n: account.syncLimit })}</Text>
                        <View style={styles.chipRow}>
                          {SYNC_LIMITS.map((value) => {
                            const active = account.syncLimit === value;
                            return (
                              <Pressable
                                key={value}
                                onPress={() => void updateAccount(account, { syncLimit: value })}
                                disabled={busy === account.id}
                                accessibilityRole="button"
                                accessibilityLabel={t("social.syncLimitLabel", { n: value })}
                                accessibilityState={{ selected: active }}
                                style={[styles.chip, active ? styles.chipActive : null]}
                              >
                                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                                  {value}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>

                      <Pressable
                        onPress={() =>
                          void updateAccount(account, { syncEnabled: !account.syncEnabled })
                        }
                        disabled={busy === account.id}
                        accessibilityRole="button"
                        style={styles.textButton}
                      >
                        <Text style={styles.textButtonLabel}>
                          {account.syncEnabled ? t("social.pauseSync") : t("social.resumeSync")}
                        </Text>
                      </Pressable>

                      <Text style={styles.lastSynced}>
                        {t("social.lastSynced", {
                          time: account.lastSyncedAt
                            ? new Date(account.lastSyncedAt).toLocaleString()
                            : t("social.neverSynced"),
                        })}
                      </Text>

                      <View style={styles.actionRow}>
                        <SmallButton
                          label={t("social.syncNow")}
                          tone="secondary"
                          disabled={busy === account.id}
                          loading={busy === account.id}
                          onPress={() => void syncNow(account)}
                        />
                        {account.status === "NEEDS_REAUTH" ? (
                          <SmallButton
                            label={t("social.reauth")}
                            tone="primary"
                            disabled={busy === account.id}
                            onPress={() => void connect(provider.provider)}
                          />
                        ) : null}
                        <SmallButton
                          label={t("social.disconnect")}
                          tone="danger"
                          disabled={busy === account.id}
                          onPress={() => void disconnect(account)}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={styles.actionRow}>
                      <SmallButton
                        label={t("social.connectPrefix", { label: provider.label })}
                        tone="primary"
                        disabled={busy === provider.provider}
                        loading={busy === provider.provider}
                        onPress={() => void connect(provider.provider)}
                      />
                    </View>
                  )}
                </View>
              );
            })
          : null}

        {bindings.length > 0 ? (
          <View style={styles.bindingsSection}>
            <Text style={styles.sectionTitle}>{t("social.bindingsSection")}</Text>
            <View style={styles.bindingsCard}>
              {bindings.map((binding) => (
                <View key={binding.platform} style={styles.bindingRow}>
                  <Text style={styles.bindingHandle}>{binding.handle}</Text>
                  <View
                    style={[
                      styles.badge,
                      binding.syncEnabled ? styles.badgeOk : styles.badgeNeutral,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        binding.syncEnabled ? styles.badgeOkText : styles.badgeNeutralText,
                      ]}
                    >
                      {binding.syncEnabled ? t("social.bindingShown") : t("social.bindingPaused")}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.sectionHint}>{t("social.bindingsNote")}</Text>
          </View>
        ) : null}
      </ScrollView>
      {/*
        可选脚部。引导流程把这一页当作最后一步用 —— 那一步需要的是「下一步」而不是
        「返回」，而「我的 → 管理社交账号」这条路径不应该多出这个按钮。
        所以由调用方把按钮传进来：这一页不需要知道引导的文案键。
      */}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

/** 行内小按钮（立即同步 / 重新授权 / 解除绑定），比全宽大按钮更贴合列表。 */
function SmallButton({
  label,
  onPress,
  tone,
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  tone: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.smallBtn,
        tone === "primary" ? styles.smallBtnPrimary : tone === "danger" ? styles.smallBtnDanger : styles.smallBtnSecondary,
        isDisabled ? styles.smallBtnDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone === "secondary" ? colors.primary : colors.white} />
      ) : (
        <Text
          style={[
            styles.smallBtnLabel,
            tone === "primary" ? styles.smallBtnLabelLight : tone === "danger" ? styles.smallBtnLabelLight : styles.smallBtnLabelDark,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingBottom: 40 },
  notice: { fontSize: 12, color: colors.success, marginBottom: 8 },
  error: { fontSize: 13, color: colors.danger, marginBottom: 8 },
  center: { marginTop: 24 },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6 },
  sectionHint: { fontSize: 11, lineHeight: 16, color: colors.muted, marginBottom: 12 },
  emptyBox: { alignItems: "center", marginTop: 16, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  emptyBody: { fontSize: 12, color: colors.muted, textAlign: "center" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  providerLabel: { fontSize: 15, fontWeight: "600", color: colors.ink, flexShrink: 1 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeOk: { backgroundColor: "#E8F7EF" },
  badgeOkText: { color: colors.success },
  badgeWarn: { backgroundColor: "#FFF4E5" },
  badgeWarnText: { color: "#B26A00" },
  badgeNeutral: { backgroundColor: colors.bgTint },
  badgeNeutralText: { color: colors.muted },
  badgeText: { fontSize: 11, fontWeight: "500" },
  notBound: { fontSize: 11, color: colors.muted },
  hintRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  hintText: { flex: 1, fontSize: 11, lineHeight: 16, color: colors.muted },
  handle: { fontSize: 13, color: colors.muted },
  warnRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  warnText: { flex: 1, fontSize: 11, lineHeight: 16, color: "#B26A00" },
  syncRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  syncLabel: { fontSize: 12, color: colors.muted },
  chipRow: { flexDirection: "row", gap: 8 },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.muted },
  chipTextActive: { color: colors.white, fontWeight: "600" },
  textButton: { alignSelf: "flex-start" },
  textButtonLabel: { fontSize: 11, color: colors.muted, textDecorationLine: "underline" },
  lastSynced: { fontSize: 11, color: colors.muted },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smallBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnPrimary: { backgroundColor: colors.primary },
  smallBtnSecondary: { backgroundColor: colors.bgTint },
  smallBtnDanger: { backgroundColor: colors.dangerSoft },
  smallBtnDisabled: { opacity: 0.5 },
  smallBtnLabel: { fontSize: 13, fontWeight: "600" },
  smallBtnLabelLight: { color: colors.white },
  smallBtnLabelDark: { color: colors.primaryDark },
  bindingsSection: { marginTop: 14 },
  bindingsCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 14,
    gap: 10,
    marginBottom: 10,
  },
  bindingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bindingHandle: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
});
