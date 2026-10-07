import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { NotificationPage, NotificationRecord } from "../lib/types";
import { colors } from "../theme";

/**
 * 通知类型 → 词典键（不是中文串）：类型是服务端给的枚举，标签在本端翻译，
 * 所以「新消息」这类标签会跟着 App 语言走。
 *
 * ⚠️ 通知的 `title` / `body` 是**服务端**生成的，目前只有中文 —— 那是另一件事
 * （服务端要按请求的语言选模板），见 apps/mobile/README.md 的后续项。
 */
const TYPE_KEYS: Record<string, MsgKey> = {
  NEW_MESSAGE: "notifications.type.NEW_MESSAGE",
  SAY_HELLO: "notifications.type.SAY_HELLO",
  REQUEST_ACCEPTED: "notifications.type.REQUEST_ACCEPTED",
  EXCHANGE_REQUEST: "notifications.type.EXCHANGE_REQUEST",
  EXCHANGE_ACCEPTED: "notifications.type.EXCHANGE_ACCEPTED",
  MOMENT_LIKE: "notifications.type.MOMENT_LIKE",
  MOMENT_COMMENT: "notifications.type.MOMENT_COMMENT",
  MOMENT_REPLY: "notifications.type.MOMENT_REPLY",
  REPORT_REVIEW: "notifications.type.REPORT_REVIEW",
  USER_STATUS: "notifications.type.USER_STATUS",
  FLOWER_RECEIVED: "notifications.type.FLOWER_RECEIVED",
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

export function NotificationsScreen() {
  const { t } = useI18n();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string) => {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const data = await apiFetch<NotificationPage>(`/notifications?pageSize=20${suffix}`);
    return data;
  }, []);

  // Lets `reload` bail out on a late response without being re-created on every
  // render, so the initial-load effect below still runs exactly once.
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await load();
      if (!mountedRef.current) return;
      setItems(data.items);
      setUnread(data.unread);
      setNextCursor(data.nextCursor);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : t("notifications.errorLoading"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [load, t]);

  useEffect(() => {
    void reload();
    return () => {
      mountedRef.current = false;
    };
  }, [reload]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await load(nextCursor);
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch {
      // Keep the existing list on failure.
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(id: string) {
    const target = items.find((item) => item.id === id);
    if (!target || target.readAt) return;
    try {
      await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)),
      );
      setUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // Do not pretend it succeeded.
    }
  }

  async function markAllRead() {
    if (markingAll) return;
    setMarkingAll(true);
    try {
      await apiFetch("/notifications/read", { method: "POST" });
      setItems((prev) =>
        prev.map((item) => (item.readAt ? item : { ...item, readAt: new Date().toISOString() })),
      );
      setUnread(0);
    } catch {
      // Keep unread state on failure.
    } finally {
      setMarkingAll(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t("notifications.title")}</Text>
          {unread > 0 ? (
            <Text style={styles.subtitle}>{t("notifications.unreadCount", { n: unread })}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => void markAllRead()}
          disabled={unread === 0 || markingAll}
          style={[styles.markAll, unread === 0 ? styles.markAllDisabled : null]}
          accessibilityRole="button"
          accessibilityLabel={t("notifications.markAllLabel")}
        >
          {markingAll ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={styles.markAllLabel}>{t("notifications.markAll")}</Text>
          )}
        </Pressable>
      </View>

      {error && items.length === 0 ? (
        <View style={styles.center}>
          {/* Announced via a live region because the failure lands after an
              await, with nothing focused. */}
          <Text style={styles.errorText} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
          {/* Other screens (Discover/ProfilePreview) offer a retry on failure;
              this one used to be a dead end whose only escape was killing the
              app. Reuses the same load path as the initial fetch. */}
          <Pressable
            onPress={() => void reload()}
            style={styles.retry}
            accessibilityRole="button"
            accessibilityLabel={t("notifications.retryLabel")}
            hitSlop={8}
          >
            <Text style={styles.retryLabel}>{t("notifications.retry")}</Text>
          </Pressable>
        </View>
      ) : null}

      {!error && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>{t("notifications.empty")}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <NotificationRow item={item} onPress={() => void markRead(item.id)} />
        )}
        ListFooterComponent={
          nextCursor ? (
            <Pressable onPress={() => void loadMore()} style={styles.loadMore} accessibilityRole="button">
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.loadMoreLabel}>{t("notifications.loadMore")}</Text>
              )}
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: NotificationRecord;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const unread = item.readAt === null;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, unread ? styles.rowUnread : null]}
      accessibilityRole="button"
      accessibilityLabel={unread ? t("notifications.unreadItemLabel", { title: item.title }) : item.title}
    >
      <View style={styles.rowTop}>
        <Text style={styles.typeLabel}>
          {t(TYPE_KEYS[item.type] ?? "notifications.typeFallback")}
          {item.count > 1 ? t("notifications.countSuffix", { n: item.count }) : ""}
        </Text>
        <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
      </View>
      <Text style={styles.rowTitle}>{item.title}</Text>
      {item.body ? (
        <Text style={styles.rowBody} numberOfLines={2}>
          {item.body}
        </Text>
      ) : null}
      {unread ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 28 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: { fontSize: 22, fontWeight: "600", color: colors.ink },
  subtitle: { fontSize: 12, color: colors.muted, marginTop: 4 },
  markAll: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  markAllDisabled: { borderColor: colors.line },
  markAllLabel: { fontSize: 12, color: colors.primary, fontWeight: "500" },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    backgroundColor: colors.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    marginBottom: 12,
  },
  rowUnread: { backgroundColor: colors.bgSoft, borderColor: "#E3E8FF" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  typeLabel: { fontSize: 11, color: colors.primary, fontWeight: "500" },
  time: { fontSize: 11, color: colors.muted },
  rowTitle: { fontSize: 15, color: colors.ink, fontWeight: "600", marginTop: 6 },
  rowBody: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 4 },
  dot: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  loadMore: { paddingVertical: 16, alignItems: "center" },
  loadMoreLabel: { fontSize: 13, color: colors.primary, fontWeight: "500" },
  errorText: { color: colors.danger, fontSize: 13, textAlign: "center" },
  retry: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryLabel: { fontSize: 13, color: colors.primary, fontWeight: "500" },
  emptyTitle: { fontSize: 15, color: colors.muted },
});
