import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { useBackHandler } from "../lib/back-stack";
import { Chip } from "../components/Chip";
import { Icon } from "../components/Icon";
import { KeyboardAware } from "../components/KeyboardAware";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";

/**
 * AI 朋友（对齐 web 的 `/ai`）—— 一个专属、可定制人设的 AI 聊天伙伴。
 *
 * ## 与真人会话的区别
 *
 * AI 会话不走实时网关：发消息用 `POST /ai-companion/messages`，服务端在**同一次
 * 请求里**生成并落库回复（`{ message, reply }`）。所以这里没有长连接，
 * 状态机只有三段：发送中 → 成功 / 失败可重试。
 *
 * ## 为什么先画一条「待确认」的气泡
 *
 * 生成回复要 1-5 秒（Gemini 实测）。等整次请求回来才显示用户那句话，会让人怀疑
 * 自己没按上发送键。所以先把这句话乐观地放进列表（id 以 `pending-` 开头），
 * 服务端返回后用真实的那一条替换掉 —— 失败时留下一句明确的错误和「重试回复」。
 */

type AiMessage = {
  id: string;
  senderId: string | null;
  senderKind: "USER" | "AI";
  content: string;
  createdAt: string;
};

type AiCompanion = {
  id: string;
  name: string;
  userNickname: string;
  stylePreset: string | null;
  personality: string | null;
  greeting: string | null;
};

type AiState = {
  companion: AiCompanion;
  conversationId: string | null;
  messages: AiMessage[];
};

type StyleOption = { key: string; labelKey: MsgKey };

/**
 * AI 回复的请求上限。
 *
 * 服务端会依次尝试降级链里的模型（**单次**上限 30 秒，见
 * `apps/api/src/ai-companion/ai.service.ts` 的 `ATTEMPT_TIMEOUT_MS`），最坏耗时
 * 约 61 秒。这里必须**大于**那个数：否则服务端还在等模型，用户已经先看到超时——
 * 一次本来会成功的回复被当成失败。两个数字要一起改。
 */
const AI_REQUEST_TIMEOUT_MS = 75_000;

const STYLE_OPTIONS: StyleOption[] = [
  { key: "gentle", labelKey: "ai.styleGentle" },
  { key: "witty", labelKey: "ai.styleWitty" },
  { key: "calm", labelKey: "ai.styleCalm" },
  { key: "energetic", labelKey: "ai.styleEnergetic" },
  { key: "warm", labelKey: "ai.styleWarm" },
  { key: "listener", labelKey: "ai.styleListener" },
];

export function AiScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  /** undefined = 还在加载；null = 还没创建过 AI 朋友。 */
  const [state, setState] = useState<AiState | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** 回复失败时「卡在哪一条用户消息之后」，用于给重试按钮定位。 */
  const [failedAfterId, setFailedAfterId] = useState<string | null>(null);
  const listRef = useRef<FlatList<AiMessage>>(null);
  /** 贴在底部？用户往上翻历史（离开底部超过 80px）后，新消息就不该把他拽回来。 */
  const pinnedRef = useRef(true);

  // 表单（创建/设置共用）
  const [name, setName] = useState("");
  const [userNickname, setUserNickname] = useState("");
  const [stylePreset, setStylePreset] = useState<string | null>(null);
  const [personality, setPersonality] = useState("");
  const [greeting, setGreeting] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await apiFetch<AiState | null>("/ai-companion");
      setState(data ?? null);
      if (data) {
        setName(data.companion.name);
        setUserNickname(data.companion.userNickname);
        setStylePreset(data.companion.stylePreset);
        setPersonality(data.companion.personality ?? "");
        setGreeting(data.companion.greeting ?? "");
        if (data.messages.length > 0) {
          void apiFetch("/ai-companion/messages/read", { method: "POST" }).catch(() => undefined);
        }
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("ai.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 滚到最新一条（2026-10-29）。
   *
   * 排到下一帧再滚：新消息刚进列表时 `scrollToEnd` 量到的还是**上一帧**的内容
   * 高度，会少滚一条 —— 这就是「新消息不会自动跳过去」看到的那个现象。
   * 键盘动画跨帧的那几十毫秒也靠这一帧吃掉。
   */
  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      if (!pinnedRef.current) return;
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    const hasMessages = (state?.messages.length ?? 0) > 0;
    if (!hasMessages && !sending) return;
    /* 自己发的消息：不管刚才翻到哪儿，都回到底部（微信也是这个行为）。 */
    if (sending) pinnedRef.current = true;
    scrollToLatest(true);
  }, [state?.messages.length, sending, scrollToLatest]);

  /*
   * 返回键：先退出「设定」回到聊天，再退出整个 AI 朋友页。
   * 这一层自己接管（父页 MessagesScreen 在 AI 页打开时不再注册），
   * 所以不用担心栈顺序。
   */
  useBackHandler(true, () => {
    if (view === "settings" && state) setView("chat");
    else onBack();
  });

  async function send() {
    const content = draft.trim();
    if (!content || sending || !state?.conversationId) return;
    setDraft("");
    setSending(true);
    setFailedAfterId(null);
    const optimisticId = `pending-${Date.now()}`;
    setState((previous) =>
      previous
        ? {
            ...previous,
            messages: [
              ...previous.messages,
              {
                id: optimisticId,
                senderId: "me",
                senderKind: "USER",
                content,
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : previous,
    );

    try {
      const result = await apiFetch<{ message: AiMessage; reply: AiMessage | null }>(
        "/ai-companion/messages",
        { method: "POST", body: { content }, timeoutMs: AI_REQUEST_TIMEOUT_MS },
      );
      setState((previous) => {
        if (!previous) return previous;
        const withoutOptimistic = previous.messages.filter((item) => item.id !== optimisticId);
        return {
          ...previous,
          messages: result.reply
            ? [...withoutOptimistic, result.message, result.reply]
            : [...withoutOptimistic, result.message],
        };
      });
      if (!result.reply) {
        const failedId = result.message.id;
        setFailedAfterId(failedId);
      }
      void load();
    } catch (error) {
      // 请求整体失败：这次发出去的话服务端可能已经落库，所以重新拉一次以服务端为准。
      setFailedAfterId("unknown");
      const message = error instanceof Error ? error.message : t("ai.sendFailed");
      setLoadError(message);
      void load();
    } finally {
      setSending(false);
    }
  }

  async function retryReply() {
    if (sending) return;
    setSending(true);
    setLoadError("");
    try {
      const result = await apiFetch<{ message: AiMessage; reply: AiMessage | null }>(
        "/ai-companion/reply",
        { method: "POST", timeoutMs: AI_REQUEST_TIMEOUT_MS },
      );
      setState((previous) =>
        previous && result.reply
          ? { ...previous, messages: [...previous.messages, result.reply] }
          : previous,
      );
      setFailedAfterId(result.reply ? null : "unknown");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("ai.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  async function save() {
    const trimmedName = name.trim();
    const trimmedNickname = userNickname.trim();
    if (!trimmedName || !trimmedNickname) {
      setFormError(t("ai.errorRequired"));
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const data = await apiFetch<AiState>("/ai-companion", {
        method: "PUT",
        body: {
          name: trimmedName,
          userNickname: trimmedNickname,
          stylePreset: stylePreset ?? undefined,
          personality: personality.trim() || undefined,
          greeting: greeting.trim() || undefined,
        },
      });
      setState(data);
      setView("chat");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("common.actionFailed"));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!state) return;
    Alert.alert(
      t("ai.deleteConfirmTitle", { name: state.companion.name }),
      t("ai.deleteConfirmBody"),
      [
        { text: t("common.close"), style: "cancel" },
        {
          text: t("ai.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await apiFetch("/ai-companion", { method: "DELETE" });
                setState(null);
                setView("chat");
                setName("");
                setUserNickname("");
                setStylePreset(null);
                setPersonality("");
                setGreeting("");
              } catch (error) {
                setFormError(error instanceof Error ? error.message : t("common.actionFailed"));
              }
            })();
          },
        },
      ],
    );
  }

  if (state === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>{t("ai.loading")}</Text>
      </View>
    );
  }

  if (state === null && view === "chat") {
    // 没创建过：直接进创建表单（对齐 web 的「空状态 = 表单」）。
    return (
      <SetupForm
        title={t("ai.setupTitle")}
        onBack={onBack}
        {...{ name, setName, userNickname, setUserNickname, stylePreset, setStylePreset, personality, setPersonality, greeting, setGreeting, saving, formError, save }}
      />
    );
  }

  if (view === "settings" && state) {
    return (
      <SetupForm
        title={t("ai.settingsTitle")}
        onBack={() => setView("chat")}
        onDelete={confirmDelete}
        {...{ name, setName, userNickname, setUserNickname, stylePreset, setStylePreset, personality, setPersonality, greeting, setGreeting, saving, formError, save }}
      />
    );
  }

  return (
    <KeyboardAware style={styles.root} iosOffset={8}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t("ai.back")}
          hitSlop={8}
          style={styles.headerButton}
        >
          <Icon name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {state?.companion.name ?? t("ai.title")}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {t("ai.headerSubtitle")}
          </Text>
        </View>
        <Pressable
          onPress={() => setView("settings")}
          accessibilityRole="button"
          accessibilityLabel={t("ai.settings")}
          hitSlop={8}
          style={styles.headerButton}
        >
          <Icon name="settings-outline" size={20} color={colors.ink} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={state?.messages ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scrollToLatest(false)}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          pinnedRef.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }}
        scrollEventThrottle={16}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="sparkles-outline" size={30} color={colors.muted} />
            <Text style={styles.emptyText}>
              {t("ai.emptyHint", { name: state?.companion.name ?? t("ai.title") })}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.senderKind === "USER";
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                  {item.content}
                </Text>
              </View>
            </View>
          );
        }}
      />

      {sending ? (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.typingText}>{t("ai.typing")}</Text>
        </View>
      ) : null}

      {failedAfterId ? (
        <Pressable
          onPress={() => void retryReply()}
          accessibilityRole="button"
          style={styles.retry}
        >
          <Icon name="refresh-outline" size={15} color={colors.danger} />
          <Text style={styles.retryText}>{t("ai.retry")}</Text>
        </Pressable>
      ) : null}

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t("ai.inputPlaceholder", { name: state?.companion.name ?? t("ai.title") })}
          placeholderTextColor={colors.muted}
          style={styles.input}
          maxLength={2000}
          multiline
          accessibilityLabel={t("ai.inputPlaceholder", { name: state?.companion.name ?? "" })}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={t("ai.send")}
          style={[styles.sendButton, !draft.trim() || sending ? styles.sendDisabled : null]}
        >
          {sending ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Icon name="arrow-up" size={16} color={colors.white} />
              {/* 文字一定在：图标字体没就位时，这枚按钮也不该只剩一个色块。 */}
              <Text style={styles.sendLabel}>{t("ai.send")}</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAware>
  );
}

/** 创建 / 设定表单：两处字段完全一致，只有标题和底部动作不同。 */
function SetupForm(props: {
  title: string;
  onBack: () => void;
  onDelete?: () => void;
  name: string;
  setName: (value: string) => void;
  userNickname: string;
  setUserNickname: (value: string) => void;
  stylePreset: string | null;
  setStylePreset: (value: string | null) => void;
  personality: string;
  setPersonality: (value: string) => void;
  greeting: string;
  setGreeting: (value: string) => void;
  saving: boolean;
  formError: string;
  save: () => void;
}) {
  const { t } = useI18n();
  return (
    <KeyboardAware style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={props.onBack}
          accessibilityRole="button"
          accessibilityLabel={t("ai.back")}
          hitSlop={8}
          style={styles.headerButton}
        >
          <Icon name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, styles.headerTitleCentered]} numberOfLines={1}>
          {props.title}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.formHint}>{t("ai.setupSubtitle")}</Text>

        <Text style={styles.label}>{t("ai.nameLabel")}</Text>
        <TextInput
          value={props.name}
          onChangeText={props.setName}
          placeholder={t("ai.namePlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.field}
          maxLength={30}
        />

        <Text style={styles.label}>{t("ai.userNicknameLabel")}</Text>
        <TextInput
          value={props.userNickname}
          onChangeText={props.setUserNickname}
          placeholder={t("ai.userNicknamePlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.field}
          maxLength={30}
        />

        <Text style={styles.label}>{t("ai.styleLabel")}</Text>
        <View style={styles.chips}>
          {STYLE_OPTIONS.map((option) => (
            <Chip
              key={option.key}
              label={t(option.labelKey)}
              selected={props.stylePreset === option.key}
              onPress={() =>
                props.setStylePreset(props.stylePreset === option.key ? null : option.key)
              }
            />
          ))}
        </View>

        <Text style={styles.label}>{t("ai.personalityLabel")}</Text>
        <TextInput
          value={props.personality}
          onChangeText={props.setPersonality}
          placeholder={t("ai.personalityPlaceholder")}
          placeholderTextColor={colors.muted}
          style={[styles.field, styles.fieldMultiline]}
          maxLength={500}
          multiline
        />

        <Text style={styles.label}>{t("ai.greetingLabel")}</Text>
        <TextInput
          value={props.greeting}
          onChangeText={props.setGreeting}
          placeholder={t("ai.greetingPlaceholder")}
          placeholderTextColor={colors.muted}
          style={styles.field}
          maxLength={200}
        />

        {props.formError ? <Text style={styles.formError}>{props.formError}</Text> : null}

        <Pressable
          onPress={props.save}
          disabled={props.saving}
          accessibilityRole="button"
          style={[styles.primaryButton, props.saving ? styles.sendDisabled : null]}
        >
          {props.saving ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {props.onDelete ? t("ai.settings") : t("ai.create")}
            </Text>
          )}
        </Pressable>

        <Text style={styles.privacy}>{t("ai.privacyNote")}</Text>

        {props.onDelete ? (
          <Pressable onPress={props.onDelete} accessibilityRole="button" style={styles.deleteButton}>
            <Icon name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteText}>{t("ai.delete")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAware>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: 13, color: colors.muted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  headerTitleCentered: { flex: 1, textAlign: "center" },
  headerSubtitle: { fontSize: 11, color: colors.muted, marginTop: 1 },
  list: { padding: 14, gap: 8 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 48 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: "center" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: colors.bgTint, borderBottomLeftRadius: 5 },
  bubbleTextMine: { fontSize: 15, lineHeight: 21, color: colors.white },
  bubbleTextTheirs: { fontSize: 15, lineHeight: 21, color: colors.ink },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 4 },
  typingText: { fontSize: 12, color: colors.muted },
  retry: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 6 },
  retryText: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  error: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 13, color: colors.danger, textAlign: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgSoft,
    color: colors.ink,
    fontSize: 15,
  },
  sendButton: {
    /* 不再做成 40x40 的纯图标圆点：图标画不出来时，按钮就只是个色块。 */
    minWidth: 72,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  sendLabel: { color: colors.white, fontSize: 14, fontWeight: "600" },
  sendDisabled: { opacity: 0.45 },
  form: { padding: 16, gap: 6, paddingBottom: 40 },
  formHint: { fontSize: 13, color: colors.muted, lineHeight: 20, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: "600", color: colors.ink, marginTop: 10 },
  field: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.bgSoft,
    color: colors.ink,
    fontSize: 15,
  },
  fieldMultiline: { minHeight: 92, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  formError: { marginTop: 10, fontSize: 13, color: colors.danger },
  primaryButton: {
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonText: { fontSize: 15, fontWeight: "600", color: colors.white },
  privacy: { marginTop: 12, fontSize: 12, color: colors.muted, textAlign: "center" },
  deleteButton: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  deleteText: { fontSize: 14, fontWeight: "600", color: colors.danger },
});
