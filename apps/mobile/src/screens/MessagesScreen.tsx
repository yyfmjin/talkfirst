import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { appendMessageOnce, mergeMessages, useChatSocket } from "../lib/chat-socket";
import { useBackHandler } from "../lib/back-stack";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { AiScreen } from "./AiScreen";
import { ExchangeScreen } from "./ExchangeScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";
import type { ChatMessage, ConversationItem, MessagePage } from "../lib/types";

/**
 * 消息（2026-10-07；实时 2026-10-16）—— 会话列表 + 会话内对话。
 *
 * ## 实时
 *
 * 一个 socket 连接同时服务两个位置（实现在 `lib/chat-socket.ts`）：
 *
 *   - **打开的会话**：`message.new` 直接把新消息接进 `messages`（按 id 去重 ——
 *     自己发的那条同时从 REST 返回、又是广播的回声）；
 *   - **列表**：`conversation.activity` 只发给收件人自己的房间（列表页不可能把所有
 *     会话都 join 一遍），用它更新预览/未读/排序。
 *
 * 发送仍走 REST（`POST /conversations/:id/messages`）：它能明确报错、区分
 * AI 会话，而 socket 只用来**接收**。
 *
 * 断线期间的消息不会补发广播，所以重新连上时补拉一次最新页（合并，不替换）。
 *
 * ## 打开会话时顺手清掉它的消息通知
 *
 * `POST /conversations/:id/read` 不只是写 `lastReadAt`：服务端还会把这条会话的
 * **未读消息通知**一并标为已读（通知合并的另一半）。所以这里两件事一次做完，
 * 不需要客户端再调通知的接口。
 */
export function MessagesScreen() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 会话里的「交换联系方式」全屏子页（对齐 web 的 `/messages/[id]/connect`）。 */
  const [exchange, setExchange] = useState(false);
  /** AI 朋友全屏子页（对齐 web 的 `/ai`，入口在列表顶部）。 */
  const [ai, setAi] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  /**
   * 会话 / 通知两个分段。
   *
   * 2026-10-08 运营方反馈「通知界面跟消息界面有点重合，合并到一起」—— 分开两个 tab
   * 对使用的人没有意义（都是「谁来找过我」），所以合并成一页里的两个分段，
   * 底部 tab 也就从 5 个减到 4 个。
   */
  const [segment, setSegment] = useState<"conversations" | "notifications">("conversations");
  /** 对方正在输入（服务端 `typing` 事件；只关心当前会话与别人）。 */
  const [peerTyping, setPeerTyping] = useState(false);

  const loadConversations = useCallback(async () => {
    setError("");
    try {
      const data = await apiFetch<ConversationItem[]>("/conversations");
      setConversations(data);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorList"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /** 重新拉一次正在看的那个会话的最新页（断线重连后用）。 */
  const refreshOpenConversation = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<MessagePage>(`/conversations/${id}/messages?limit=30`);
      setMessages((previous) => mergeMessages(previous, data.items));
    } catch {
      // 补拉失败不惊动用户：下次打开会话或重连会再试。
    }
  }, []);

  const { state: liveState, setTyping } = useChatSocket({
    conversationId: openId,
    onMessage: (message) => {
      setMessages((previous) => appendMessageOnce(previous, message));
      // 正看着这个会话：列表上的未读不该留着。
      setConversations((previous) =>
        previous.map((item) =>
          item.id === message.conversationId ? { ...item, unreadCount: 0 } : item,
        ),
      );
      setPeerTyping(false);
    },
    onActivity: (activity) => {
      setConversations((previous) => {
        const index = previous.findIndex((item) => item.id === activity.conversationId);
        // 列表里还没有这个会话（对方第一次发来消息）：重拉列表拿头像/昵称。
        if (index < 0) {
          void loadConversations();
          return previous;
        }
        const target = previous[index];
        const updated: ConversationItem = {
          ...target,
          // 打开着这个会话就不涨未读 —— 用户已经在看了。
          unreadCount: openId === activity.conversationId ? 0 : (target.unreadCount ?? 0) + 1,
          updatedAt: activity.createdAt,
          lastMessage: {
            content: activity.preview ?? "",
            senderId: activity.senderId,
            createdAt: activity.createdAt,
            type: activity.type,
          },
        };
        // 有新消息的会话浮到最上面，与刷新后的服务端顺序一致。
        return [updated, ...previous.filter((_, position) => position !== index)];
      });
    },
    onTyping: (payload) => {
      if (payload.userId !== user?.id) setPeerTyping(payload.typing);
    },
  });

  /*
   * 从「非 live」回到 live 时补一次数据：断线期间的消息不会有广播，
   * 只能重新拉一次（列表 + 正在看的会话）。
   *
   * 初值是 `true`：首次连接不需要补拉 —— 挂载时本来就会拉列表，
   * 而会话内容是打开时才拉的。
   */
  const wasLive = useRef(true);
  useEffect(() => {
    if (liveState !== "live") {
      wasLive.current = false;
      return;
    }
    if (wasLive.current) return;
    wasLive.current = true;
    void loadConversations();
    if (openId) void refreshOpenConversation(openId);
  }, [liveState, openId, loadConversations, refreshOpenConversation]);

  /*
   * 系统返回键：先关更靠前的子页，再关会话本身（注册晚的优先级高）。
   * AI 朋友屏自己管返回（设定页 → 聊天页 → 关掉），所以这里不管它。
   */
  useBackHandler(openId !== null, () => {
    setOpenId(null);
    setExchange(false);
    void loadConversations();
  });
  useBackHandler(openId !== null && exchange, () => setExchange(false));

  const openConversation = useCallback(async (id: string) => {
    setOpenId(id);
    setExchange(false);
    setPeerTyping(false);
    setMessages([]);
    setCursor(null);
    setError("");
    try {
      const data = await apiFetch<MessagePage>(`/conversations/${id}/messages?limit=30`);
      setMessages(data.items);
      setCursor(data.nextCursor);
      // 已读：写 lastReadAt，并清掉这条会话的未读消息通知。
      await apiFetch(`/conversations/${id}/read`, { method: "POST" });
      setConversations((previous) =>
        previous.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorThread"));
    }
  }, [t]);

  /** 更早的一页：服务端最旧在前，`nextCursor` 指向更早。 */
  async function loadOlder() {
    if (!openId || !cursor) return;
    try {
      const data = await apiFetch<MessagePage>(
        `/conversations/${openId}/messages?limit=30&cursor=${encodeURIComponent(cursor)}`,
      );
      setMessages((previous) => [...data.items, ...previous]);
      setCursor(data.nextCursor);
    } catch {
      // 翻旧消息失败不打扰当前阅读。
    }
  }

  async function send() {
    const content = draft.trim();
    if (!openId || !content || sending) return;
    setSending(true);
    setError("");
    try {
      const created = await apiFetch<ChatMessage>(`/conversations/${openId}/messages`, {
        method: "POST",
        body: { content },
      });
      // 直接把服务端返回的那一条接在末尾：不重拉整页，也不做本地猜测（id/时间戳都以服务端为准）。
      // 同一条还会随 `message.new` 广播回来，由 `appendMessageOnce` 去重。
      setMessages((previous) => appendMessageOnce(previous, created));
      setDraft("");
      setTyping(false);
      void loadConversations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorSend"));
    } finally {
      setSending(false);
    }
  }

  /*
   * 实时状态只在**不健康**时显示一行：正常连着不该占地方。
   * 文案只描述连接状态，不说「发不出去」—— 发送走 REST，与这条长连接无关。
   */
  const liveBanner =
    liveState === "live" ? null : (
      <Text style={styles.liveState}>
        {t(
          liveState === "connecting"
            ? "messages.liveConnecting"
            : liveState === "reconnecting"
              ? "messages.liveReconnecting"
              : "messages.liveOffline",
        )}
      </Text>
    );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (ai) {
    return <AiScreen onBack={() => setAi(false)} />;
  }

  if (segment === "notifications") {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t("messages.title")}</Text>
        </View>
        <Segments value={segment} onChange={setSegment} />
        <NotificationsScreen />
      </View>
    );
  }

  /*
   * 交换联系方式：从会话头部进去的全屏子页。
   *
   * 放在会话分支**之前**：它比会话本身更靠前，返回时回到会话而不是回到列表。
   * `openId` 就是它的入参 —— 列表态（没有会话）不会走到这里。
   */
  if (openId && exchange) {
    return <ExchangeScreen conversationId={openId} onBack={() => setExchange(false)} />;
  }

  if (openId) {
    const peer = conversations.find((item) => item.id === openId)?.peer ?? null;
    return (
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={styles.threadHead}>
          <Pressable
            onPress={() => {
              setOpenId(null);
              setExchange(false);
              void loadConversations();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.backToList")}
            style={styles.backButton}
          >
            <Icon name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Avatar uri={peer?.avatarUrl ?? null} nickname={peer?.nickname ?? null} size={32} />
          <Text style={styles.threadName} numberOfLines={1}>
            {peer?.nickname ?? t("messages.conversationFallback")}
          </Text>
          {/* 交换入口与 web 头部那条 `🔗 交换联系方式` 同位同义。门槛、能不能点
              都由交换页自己按服务端的 `eligible` 说，这里不预先藏起来 —— 否则
              用户无从知道「聊够就能换」这条规则。 */}
          <Pressable
            onPress={() => setExchange(true)}
            accessibilityRole="button"
            accessibilityLabel={t("exchange.entry")}
            style={styles.exchangeButton}
          >
            <Icon name="link-outline" size={14} color={colors.primaryDark} />
            <Text style={styles.exchangeLabel}>{t("exchange.entry")}</Text>
          </Pressable>
        </View>

        {liveBanner}

        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.threadList}
          onStartReached={loadOlder}
          onStartReachedThreshold={0.3}
          ListHeaderComponent={
            cursor ? (
              <Pressable onPress={() => void loadOlder()} style={styles.loadOlder}>
                <Text style={styles.loadOlderText}>{t("messages.loadOlder")}</Text>
              </Pressable>
            ) : null
          }
          renderItem={({ item }) => {
            const mine = item.senderId === user?.id;
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : null]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{item.content}</Text>
                </View>
              </View>
            );
          }}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* 对方正在输入：贴着输入框上沿，不挤压消息列表。 */}
        {peerTyping ? <Text style={styles.typingLine}>{t("messages.typing")}</Text> : null}

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              // 空输入框不算「正在输入」。对方那边 4 秒没动静会自动清掉（见 chat-socket.ts）。
              setTyping(value.trim().length > 0);
            }}
            placeholder={t("messages.composerPlaceholder")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={2000}
            multiline
            accessibilityLabel={t("messages.composerLabel")}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t("messages.send")}
            style={[styles.sendButton, !draft.trim() || sending ? styles.sendDisabled : null]}
          >
            {sending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Icon name="arrow-up" size={18} color={colors.white} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t("messages.title")}</Text>
      </View>
      <Segments value={segment} onChange={setSegment} />
      {liveBanner}
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        /*
         * AI 朋友入口固定在列表顶部（与 web 的 /messages 顶部那条入口同位置）。
         * 放在 ListHeaderComponent 而不是列表数据里：它不是一个会话，
         * 混进数据会让「没有会话」时的空状态失效。
         */
        ListHeaderComponent={
          <Pressable
            onPress={() => setAi(true)}
            accessibilityRole="button"
            accessibilityLabel={t("ai.title")}
            style={styles.aiEntry}
          >
            <View style={styles.aiIcon}>
              <Icon name="sparkles-outline" size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.peerName} numberOfLines={1}>
                {t("ai.title")}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {t("ai.entryHint")}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Icon name="chatbubbles-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>{t("messages.empty")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void openConversation(item.id)}
            accessibilityRole="button"
            style={styles.row}
          >
            <Avatar uri={item.peer?.avatarUrl ?? null} nickname={item.peer?.nickname ?? null} size={48} />
            <View style={styles.rowText}>
              <View style={styles.rowTop}>
                <Text style={styles.peerName} numberOfLines={1}>
                  {item.peer?.nickname ?? t("messages.conversationFallback")}
                </Text>
                <Text style={styles.time}>{compactTime(item.lastMessage?.createdAt ?? item.updatedAt, t)}</Text>
              </View>
              <Text style={styles.preview} numberOfLines={1}>
                {previewText(item, t)}
              </Text>
            </View>
            {item.unreadCount && item.unreadCount > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/**
 * 列表预览：图片消息的 `content` 是图片 URL，不能当预览摆到列表里，
 * 显示本地化的「[图片]」。其余情况就是消息正文。
 */
function previewText(item: ConversationItem, t: TranslateFn): string {
  if (!item.lastMessage) return t("messages.startChat");
  return item.lastMessage.type === "IMAGE" ? t("messages.imagePreview") : item.lastMessage.content;
}

/** 会话列表右侧那个时间：与 `MomentsScreen.relativeTime` 同形状，`t` 由调用方传入。 */
function compactTime(iso: string, t: TranslateFn): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("common.daysAgo", { n: days });
  return date.toLocaleDateString();
}

/** 会话 / 通知的分段控件（两个分段而已，不值得引入组件库）。 */
function Segments({
  value,
  onChange,
}: {
  value: "conversations" | "notifications";
  onChange: (next: "conversations" | "notifications") => void;
}) {
  const { t } = useI18n();
  const options: ["conversations" | "notifications", MsgKey][] = [
    ["conversations", "messages.title"],
    ["notifications", "tab.notifications"],
  ];

  return (
    <View style={styles.segments}>
      {options.map(([id, labelKey]) => {
        const active = value === id;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(labelKey)}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            <Text style={[styles.segmentLabel, active ? styles.segmentLabelActive : null]}>
              {t(labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  segments: { flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.bgSoft,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentLabel: { fontSize: 14, fontWeight: "600", color: colors.muted },
  segmentLabelActive: { color: colors.white },
  headerTitle: { fontSize: 24, fontWeight: "700", color: colors.ink },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 8 },
  rowText: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  peerName: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  time: { fontSize: 12, color: colors.muted },
  preview: { fontSize: 13, color: colors.muted, marginTop: 3 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  unreadText: { fontSize: 12, fontWeight: "700", color: colors.white },
  threadHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // 同 ComposeScreen：顶部安全区已由 App.tsx 统一留白，这里不再写死 54。
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  threadName: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.ink },
  exchangeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 14,
    backgroundColor: colors.bgTint,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exchangeLabel: { fontSize: 12, fontWeight: "600", color: colors.primaryDark },
  threadList: { padding: 14, gap: 8 },
  loadOlder: { alignItems: "center", paddingVertical: 10 },
  loadOlderText: { fontSize: 13, color: colors.primary },
  bubbleRow: { flexDirection: "row" },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: colors.bgTint, borderBottomLeftRadius: 5 },
  bubbleTextMine: { fontSize: 15, lineHeight: 21, color: colors.white },
  bubbleTextTheirs: { fontSize: 15, lineHeight: 21, color: colors.ink },
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  sendDisabled: { opacity: 0.45 },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 21 },
  error: { position: "absolute", left: 16, right: 16, bottom: 96, fontSize: 13, color: colors.danger, textAlign: "center" },
  typingLine: { position: "absolute", left: 16, right: 16, bottom: 62, fontSize: 12, color: colors.muted },
  liveState: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    fontSize: 12,
    color: colors.muted,
    textAlign: "center",
  },
  aiEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: colors.bgTint,
  },
  aiIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
});
