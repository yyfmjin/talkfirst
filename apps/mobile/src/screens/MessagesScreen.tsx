import { useCallback, useEffect, useState } from "react";
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
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { NotificationsScreen } from "./NotificationsScreen";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";
import type { ChatMessage, ConversationItem, MessagePage } from "../lib/types";

/**
 * 消息（2026-10-07）—— 会话列表 + 会话内对话。
 *
 * ## 为什么不实时
 *
 * web 端的实时消息走 socket.io（`chat.gateway.ts`）。这里**先不做长连接**：
 * 加一个 socket 客户端等于给移动端引入新的原生依赖与生命周期管理，
 * 而这一步我没法在真机上验证。现在的行为是「进入会话时拉一页 + 手动下拉刷新 +
 * 发送后重拉」，先保证功能闭环，实时留作下一步（已在交接里记明）。
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

  const openConversation = useCallback(async (id: string) => {
    setOpenId(id);
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
      setMessages((previous) => [...previous, created]);
      setDraft("");
      void loadConversations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("messages.errorSend"));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
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
              void loadConversations();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("messages.backToList")}
            style={styles.backButton}
          >
            <Icon name="chevron-back" size={22} color={colors.ink} />
          </Pressable>
          <Avatar uri={peer?.avatarUrl ?? null} nickname={peer?.nickname ?? null} size={32} />
          <Text style={styles.threadName}>{peer?.nickname ?? t("messages.conversationFallback")}</Text>
        </View>

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

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
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
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
                {item.lastMessage?.content ?? t("messages.startChat")}
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
    paddingTop: 54,
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  threadName: { fontSize: 16, fontWeight: "600", color: colors.ink },
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
});
