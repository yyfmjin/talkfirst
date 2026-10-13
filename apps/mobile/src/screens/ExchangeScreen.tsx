import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useI18n } from "../lib/i18n-context";
import type { ExchangeEligibility, ExchangePlatformOption, SharedContact } from "../lib/types";
import { colors } from "../theme";

/**
 * 交换联系方式 —— 对齐 web 的 `/messages/[id]/connect`。
 *
 * ## 这一页在讲什么
 *
 * 「交换」不是加好友：两个人聊够一定条数之后，可以各自选一到三个平台，对方接受了，
 * 双方在这些平台上的账号才互相可见。所以在界面上要把三件事说清楚：还差多少（门槛）、
 * 谁先发起（方向）、以及接受才会互相可见（不是单向索取）。
 *
 * ## 谁有资格、能不能点，一律听服务端的
 *
 * `eligible` 由服务端算（聊够条数、且还没有任何交换）。客户端**不自己重算**：
 * 门槛改了、或者服务端加了别的条件，自算的那版就会变成一个点了会被拒的按钮 ——
 * web 那边修过一次正是这个毛病（`disabled` 漏了 `!eligible`）。
 *
 * ## 为什么限制 3 个平台
 *
 * 与服务端 `EXCHANGE_PLATFORMS_MAX` 对齐。这个数字接口没有下发，所以写在客户端常量里，
 * 并在此注明来源 —— 服务端仍是最终裁判（超过就是 400）。
 */

/** 选择上限。与 `apps/api/src/exchange/exchange.service.ts` 的 `EXCHANGE_PLATFORMS_MAX` 一致。 */
const MAX_PLATFORMS = 3;

export function ExchangeScreen({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [state, setState] = useState<ExchangeEligibility | null>(null);
  const [contacts, setContacts] = useState<SharedContact[]>([]);
  const [platforms, setPlatforms] = useState<ExchangePlatformOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  /** 拉一次「我能不能申请 / 有哪些没处理」。contacts 只在已经有交换时才拉。 */
  const refresh = useCallback(async () => {
    const eligibility = await apiFetch<ExchangeEligibility>(
      `/conversations/${conversationId}/exchange`,
    );
    setState(eligibility);
    if (eligibility.exchanged.length > 0) {
      const shared = await apiFetch<{ exchanged: boolean; contacts: SharedContact[] }>(
        `/conversations/${conversationId}/exchange/contacts`,
      );
      setContacts(shared.contacts);
    } else {
      setContacts([]);
    }
  }, [conversationId]);

  /**
   * 整个页面的加载。重试与首次挂载走同一条路 —— 分两条写，重试那条迟早会与首次
   * 不一致（少拉一个端点、忘了清错误提示）。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      /* 平台清单拉不到不应该挡住整页：没清单就选不了平台，但门槛与已交换的联系
         方式仍要能看到（它们来自另一个端点）。所以这里单独兜底成空数组。 */
      const options = await apiFetch<ExchangePlatformOption[]>("/exchange/platforms").catch(
        () => [] as ExchangePlatformOption[],
      );
      setPlatforms(options);
      await refresh();
    } catch {
      setError(t("exchange.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [refresh, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(platformId: string) {
    setSelected((current) => {
      if (current.includes(platformId)) return current.filter((id) => id !== platformId);
      /* 到上限就不接受新的，而不是把最早选中的挤掉：静默替换比当场拒绝更让人迷惑。 */
      if (current.length >= MAX_PLATFORMS) return current;
      return [...current, platformId];
    });
  }

  async function submit() {
    if (!state || selected.length === 0 || acting || !state.eligible) return;
    setActing(true);
    setError("");
    try {
      await apiFetch(`/conversations/${conversationId}/exchange`, {
        method: "POST",
        body: { platforms: selected, message: message.trim() || undefined },
      });
      setSelected([]);
      setMessage("");
      await refresh();
    } catch {
      setError(t("exchange.errorSend"));
    } finally {
      setActing(false);
    }
  }

  async function respond(exchangeId: string, action: "accept" | "reject") {
    if (acting) return;
    setActing(true);
    setError("");
    try {
      await apiFetch(`/exchange/${exchangeId}/respond`, { method: "POST", body: { action } });
      await refresh();
    } catch {
      setError(t("exchange.errorRespond"));
    } finally {
      setActing(false);
    }
  }

  async function cancel(exchangeId: string) {
    if (acting) return;
    setActing(true);
    setError("");
    try {
      await apiFetch(`/exchange/${exchangeId}/cancel`, { method: "POST" });
      await refresh();
    } catch {
      setError(t("exchange.errorCancel"));
    } finally {
      setActing(false);
    }
  }

  /** 「A、B」——连接符按语言走，不把中文顿号焊进英文界面。 */
  function joinPlatforms(items: ExchangePlatformOption[]): string {
    return items.map((platform) => platform.label).join(t("exchange.platformJoin"));
  }

  /** 门槛还差几条，用于按钮文案。取 0 为下限：服务端口径变了也不会显示负数。 */
  const missing = state ? Math.max(state.requiredMessages - state.messageCount, 0) : 0;

  return (
    <View style={styles.root}>
      <SubHeader title={t("exchange.title")} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t("exchange.intro", { n: state?.requiredMessages ?? 5 })}</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.muted}>{t("exchange.loading")}</Text>
          </View>
        ) : null}

        {!loading && !state ? (
          <View style={styles.center}>
            <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
          </View>
        ) : null}

        {!loading && state ? (
          <>
            {/*
             * 门槛进度：只把两个数字摆出来，由服务端的 `eligible` 决定说哪一句。
             * 画一条进度条反而会**夸大**它 —— 进度到了 100% 也不代表能交换
             * （服务端还有「还没有任何交换」这一条）。
             */}
            <View style={styles.progressCard}>
              <Text style={styles.progressText}>
                {state.eligible
                  ? t("exchange.progressReady", {
                      count: state.messageCount,
                      required: state.requiredMessages,
                    })
                  : t("exchange.progressNotReady", {
                      count: state.messageCount,
                      required: state.requiredMessages,
                    })}
              </Text>
            </View>

            {state.exchanged.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("exchange.sharedSection")}</Text>
                {contacts.map((contact) => (
                  <View key={`${contact.userId}-${contact.platform}`} style={styles.card}>
                    <Text style={styles.cardTitle}>
                      {contact.nickname ?? t("exchange.fallbackPeer")} · {contact.label}
                    </Text>
                    {/* `selectable`：这是整屏唯一一个要被复制到别处去的字符串，
                        可选中比让用户照着敲一遍强。 */}
                    <Text style={styles.handle} selectable>
                      {contact.handle}
                    </Text>
                  </View>
                ))}
                {contacts.length === 0 ? (
                  <Text style={styles.muted}>{t("exchange.sharedLoading")}</Text>
                ) : null}
              </View>
            ) : null}

            {state.pending.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t("exchange.pendingSection")}</Text>
                {state.pending.map((item) => {
                  /*
                   * 方向靠 `requesterId` 判，不靠文案猜。web 那边曾把「撤回我发起的
                   * 请求」渲染给**每一条**待处理请求（包括对方发起的），于是按钮在
                   * 说谎；只有发起方能撤回，收方该看到的是接受/拒绝。
                   */
                  const mine = item.requesterId === user?.id;
                  return (
                    <View key={item.id} style={styles.card}>
                      <Text style={styles.cardTitle}>
                        {mine
                          ? t("exchange.pendingMine", { platforms: joinPlatforms(item.platforms) })
                          : t("exchange.pendingTheirs", {
                              name: item.requester?.nickname ?? t("exchange.fallbackPeer"),
                              platforms: joinPlatforms(item.platforms),
                            })}
                      </Text>
                      {item.message ? <Text style={styles.note}>{item.message}</Text> : null}

                      {mine ? (
                        <>
                          <Text style={styles.note}>{t("exchange.pendingWaiting")}</Text>
                          <Button
                            label={t("exchange.withdraw")}
                            onPress={() => void cancel(item.id)}
                            disabled={acting}
                            loading={acting}
                            variant="ghost"
                          />
                        </>
                      ) : (
                        <>
                          <View style={styles.actionRow}>
                            <View style={styles.actionItem}>
                              <Button
                                label={t("exchange.reject")}
                                onPress={() => void respond(item.id, "reject")}
                                disabled={acting}
                                variant="ghost"
                              />
                            </View>
                            <View style={styles.actionItemWide}>
                              <Button
                                label={t("exchange.accept")}
                                onPress={() => void respond(item.id, "accept")}
                                disabled={acting}
                              />
                            </View>
                          </View>
                          <Text style={styles.hint}>{t("exchange.directionNote")}</Text>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {state.exchanged.length === 0 && state.pending.length === 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {t("exchange.pickSection", { n: MAX_PLATFORMS })}
                </Text>
                <View style={styles.chips}>
                  {platforms.map((platform) => {
                    const owned = state.myAccounts.some(
                      (account) => account.platform === platform.id,
                    );
                    return (
                      <Chip
                        key={platform.id}
                        /* 未绑定的平台照样能选（与 web 一致），但把「未绑定」
                           写进标签本身 —— 只靠降低不透明度，色觉障碍用户和读屏
                           用户都拿不到这条信息。 */
                        label={
                          owned
                            ? platform.label
                            : `${platform.label} ${t("exchange.notBound")}`
                        }
                        selected={selected.includes(platform.id)}
                        onPress={() => toggle(platform.id)}
                      />
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>{t("exchange.messageLabel")}</Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder={t("exchange.messagePlaceholder")}
                  placeholderTextColor={colors.muted}
                  style={styles.textarea}
                  maxLength={200}
                  multiline
                  accessibilityLabel={t("exchange.messageLabel")}
                />

                {/*
                 * `disabled` 里必须有 `!state.eligible`：少了它，一个写着「还需
                 * N 条消息」的按钮是可点的，点了要等一个来回才被服务端拒掉。
                 * 这正是 web 那次审计修掉的问题，这里不再犯第二遍。
                 */}
                <View style={styles.submitRow}>
                  <Button
                    label={
                      state.eligible ? t("exchange.submit") : t("exchange.submitNeedMore", { n: missing })
                    }
                    onPress={() => void submit()}
                    disabled={selected.length === 0 || acting || !state.eligible}
                    loading={acting && state.eligible && selected.length > 0}
                  />
                </View>
                <Text style={styles.hint}>{t("exchange.submitNote")}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        {error ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 20, paddingTop: 14, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 20, color: colors.muted },
  center: { alignItems: "center", gap: 10, paddingVertical: 28 },
  muted: { fontSize: 13, lineHeight: 19, color: colors.muted },
  progressCard: {
    marginTop: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
    padding: 14,
  },
  progressText: { fontSize: 12, lineHeight: 18, color: colors.muted },
  section: { marginTop: 22 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  card: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 14,
  },
  cardTitle: { fontSize: 15, color: colors.ink, fontWeight: "600" },
  handle: { marginTop: 6, fontSize: 15, color: colors.primaryDark },
  note: { marginTop: 8, fontSize: 12, lineHeight: 18, color: colors.muted },
  hint: { marginTop: 10, fontSize: 12, lineHeight: 18, color: colors.muted },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionItem: { flex: 1 },
  actionItemWide: { flex: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  fieldLabel: { marginTop: 16, fontSize: 12, fontWeight: "600", color: colors.muted },
  textarea: {
    marginTop: 6,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: "top",
  },
  submitRow: { marginTop: 16 },
  errorText: { marginTop: 16, fontSize: 13, lineHeight: 19, color: colors.danger },
});
