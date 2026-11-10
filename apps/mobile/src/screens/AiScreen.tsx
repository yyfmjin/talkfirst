import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
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
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
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
  /**
   * 用户是否正在用手指拖列表。
   *
   * 2026-11-10 线上反馈「最后一条看不到」：FlatList 在首屏布局时会自己发一次
   * onScroll（offset 0、contentSize 还没算全），那一帧算出来"离底部很远"，
   * 把 pinned 置成 false；之后新消息到达时 `scrollToLatest` 直接 return，
   * 列表就永远停在最上面。
   *
   * 现在只认**用户的手**：只有拖动/惯性滚动期间才更新 pinned，
   * 程序滚动与首屏布局都不参与判断。
   */
  const userScrollingRef = useRef(false);

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
      /*
       * 合并而不是覆盖（2026-11-10）。
       *
       * 后台轮询与「发送后立刻刷新」会并发，先发的请求可能后到；直接 setState 会把
       * 新消息回退成上一次的快照 —— 屏幕上的聊天记录会突然消失。这里按 id 取并集，
       * 任何一次响应都不会让已经看到的消息变少。
       */
      setState((previous) => {
        if (!data) return data ?? null;
        if (!previous) return data;
        const byId = new Map(previous.messages.map((message) => [message.id, message]));
        for (const message of data.messages) byId.set(message.id, message);
        const messages = [...byId.values()].sort((left, right) =>
          left.createdAt === right.createdAt
            ? left.id.localeCompare(right.id)
            : left.createdAt.localeCompare(right.createdAt),
        );
        return { ...data, messages };
      });
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
   * 页面可见期间持续刷新（2026-11-10 线上反馈：**进去看不到最新消息，退出来再进才有一部分**）。
   *
   * 原因是 AI 的回复由服务端异步写入：首次 `/ai-companion` 很可能还是「上一轮」，
   * 而页面只在挂载时拉一次 —— 于是新消息要等下次进来才出现。这里：
   *
   *   - 每 4 秒重拉一次（正在发送时跳过，别覆盖乐观插入的那条）；
   *   - App 回到前台立刻拉一次（切出去聊别的再回来）。
   */
  /* 键盘弹出/收起会改变列表可视高度：贴底的人应该继续看到最新一条。 */
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => {
      pinnedRef.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => show.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!sending) void load();
    }, 4000);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void load();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [load, sending]);

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

  /* 换会话（或第一次进到某个 AI 朋友）：一定是最新那条在最下面。 */
  useEffect(() => {
    pinnedRef.current = true;
  }, [state?.conversationId]);

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
        /* 必须有 flex:1：聊天列表是这一列里唯一可伸缩的孩子。
           不写的话高度跟着内容长，长到超过屏幕后输入栏被顶出去，
           `scrollToEnd` 也在错误的参考系里 —— 表现就是"聊着聊着什么都不显示"。 */
        style={{ flex: 1 }}
        data={state?.messages ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        onContentSizeChange={() => scrollToLatest(false)}
        onScroll={(event) => {
          if (!userScrollingRef.current) return;
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          pinnedRef.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
        }}
        onScrollBeginDrag={() => {
          userScrollingRef.current = true;
        }}
        onScrollEndDrag={() => {
          userScrollingRef.current = false;
        }}
        onMomentumScrollEnd={(event) => {
          userScrollingRef.current = false;
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

const styles = themed((c) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  loadingText: { fontSize: sizes.ui, color: c.muted },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  headerButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  headerTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  headerTitleCentered: { flex: 1, textAlign: "center" },
  headerSubtitle: { fontSize: sizes.overline, color: c.muted, marginTop: 1 },
  list: { padding: 14, gap: 8 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 48 },
  emptyText: { fontSize: sizes.ui, color: c.muted, textAlign: "center" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: radii.control, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: c.primary, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: c.bgTint, borderBottomLeftRadius: 5 },
  bubbleTextMine: { fontSize: sizes.body, lineHeight: 21, color: c.white },
  bubbleTextTheirs: { fontSize: sizes.body, lineHeight: 21, color: c.ink },
  typingRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 4 },
  typingText: { fontSize: sizes.caption, color: c.muted },
  retry: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 6 },
  retryText: { fontSize: sizes.ui, color: c.danger, fontWeight: "600" },
  error: { paddingHorizontal: 16, paddingBottom: 4, fontSize: sizes.ui, color: c.danger, textAlign: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: c.line,
    backgroundColor: c.glass,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderRadius: radii.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: c.bgSoft,
    color: c.ink,
    fontSize: sizes.body,
  },
  sendButton: {
    /* 不再做成 40x40 的纯图标圆点：图标画不出来时，按钮就只是个色块。 */
    minWidth: 72,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.primary,
  },
  sendLabel: { color: c.white, fontSize: sizes.ui, fontWeight: "600" },
  sendDisabled: { opacity: 0.45 },
  form: { padding: 16, gap: 6, paddingBottom: 40 },
  formHint: { fontSize: sizes.ui, color: c.muted, lineHeight: 20, marginBottom: 6 },
  label: { fontSize: sizes.ui, fontWeight: "600", color: c.ink, marginTop: 10 },
  field: {
    borderRadius: radii.chip,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: c.bgSoft,
    color: c.ink,
    fontSize: sizes.body,
  },
  fieldMultiline: { minHeight: 92, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  formError: { marginTop: 10, fontSize: sizes.ui, color: c.danger },
  primaryButton: {
    marginTop: 18,
    borderRadius: radii.chip,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryButtonText: { fontSize: sizes.body, fontWeight: "600", color: c.white },
  privacy: { marginTop: 12, fontSize: sizes.caption, color: c.muted, textAlign: "center" },
  deleteButton: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.chip,
    backgroundColor: c.dangerSoft,
  },
  deleteText: { fontSize: sizes.ui, fontWeight: "600", color: c.danger },
}));
