import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { colors } from "../theme";
import type { Moment, MomentPage } from "../lib/types";

/**
 * 动态（2026-10-07）—— 移动端的主时间线。
 *
 * ## 与 web 的关系
 *
 * 走的是同一个 `GET /moments/feed`，拿到的也是同一份投影（`feedItem()`），
 * 所以字段与服务端的可见性规则（拉黑 / 审核 / 作者可见范围 / 敏感内容过滤）
 * 都不需要在客户端重做 —— 服务端已经滤过了。
 *
 * ## 这里为什么只做「点赞」，没做「收藏」
 *
 * 点赞的端点（`POST /moments/:id/like`，toggle）我能在服务端代码里确认形状；
 * 收藏的写法我没确认，宁可先不写，也不猜一个可能 404 的路径。
 *
 * ## 视频
 *
 * 卡片里的视频**不在这里播放**：点一下进全屏的视频流（`onOpenVideo`），
 * 与 web 一致 —— 理由也一样（原生 `controls` 与「点开沉浸模式」会抢同一次点击，
 * 而且时间线里同时播多路视频在手机上会直接卡死）。
 */
export function MomentsScreen({ onOpenVideo }: { onOpenVideo: (momentId?: string) => void }) {
  const [items, setItems] = useState<Moment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (mode: "initial" | "refresh" | "more") => {
    if (mode === "more" && !cursor) return;
    if (mode === "more") setLoadingMore(true);
    if (mode === "refresh") setRefreshing(true);
    setError("");
    try {
      const suffix = mode === "more" && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const data = await apiFetch<MomentPage>(`/moments/feed?limit=10${suffix}`);
      setItems((previous) => (mode === "more" ? [...previous, ...data.items] : data.items));
      setCursor(data.nextCursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "动态加载失败，请稍后再试。");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    void load("initial");
    // 只在挂载时拉第一页；翻页与下拉各有自己的入口。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点赞：服务端是 toggle，所以直接用返回值覆盖本地状态，不做乐观加一。 */
  async function toggleLike(moment: Moment) {
    try {
      const data = await apiFetch<{ liked: boolean; likeCount: number }>(
        `/moments/${moment.id}/like`,
        { method: "POST" },
      );
      setItems((previous) =>
        previous.map((item) =>
          item.id === moment.id
            ? { ...item, liked: data.liked, likeCount: data.likeCount }
            : item,
        ),
      );
    } catch {
      // 点赞失败不弹错：时间线里为一次点赞打断阅读不值得。
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>动态</Text>
        <Pressable
          onPress={() => onOpenVideo()}
          accessibilityRole="button"
          accessibilityLabel="看视频"
          style={styles.videoEntry}
        >
          <Ionicons name="play-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.videoEntryLabel}>看视频</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={colors.primary} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => void load("more")}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="images-outline" size={32} color={colors.muted} />
            <Text style={styles.emptyText}>还没有动态。发布一条，或者去发现页认识新朋友。</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.footer} color={colors.primary} /> : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Avatar uri={item.author.avatarUrl} nickname={item.author.nickname} size={40} />
              <View style={styles.cardHeadText}>
                <Text style={styles.nickname}>{item.author.nickname ?? "用户"}</Text>
                <Text style={styles.meta}>
                  {item.author.countryCode ?? ""} {relativeTime(item.createdAt)}
                </Text>
              </View>
            </View>

            {item.content ? <Text style={styles.content}>{item.content}</Text> : null}

            {item.videoUrl ? (
              <Pressable
                onPress={() => onOpenVideo(item.id)}
                accessibilityRole="button"
                accessibilityLabel="全屏播放视频"
                style={styles.videoWrap}
              >
                {item.images[0] ? (
                  <Image source={{ uri: item.images[0] }} style={styles.videoPoster} resizeMode="cover" />
                ) : (
                  <View style={[styles.videoPoster, styles.videoPosterEmpty]} />
                )}
                <View style={styles.playBadge}>
                  <Ionicons name="play" size={22} color={colors.white} />
                </View>
              </Pressable>
            ) : item.images.length > 0 ? (
              <View style={styles.imageRow}>
                {item.images.slice(0, 3).map((uri) => (
                  <Image key={uri} source={{ uri }} style={styles.image} resizeMode="cover" />
                ))}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                onPress={() => void toggleLike(item)}
                accessibilityRole="button"
                accessibilityLabel={item.liked ? "取消点赞" : "点赞"}
                accessibilityState={{ selected: item.liked }}
                style={styles.action}
              >
                <Ionicons
                  name={item.liked ? "heart" : "heart-outline"}
                  size={20}
                  color={item.liked ? colors.danger : colors.muted}
                />
                <Text style={styles.actionLabel}>{item.likeCount}</Text>
              </Pressable>
              <View style={styles.action}>
                <Ionicons name="chatbubble-outline" size={19} color={colors.muted} />
                <Text style={styles.actionLabel}>{item.commentCount}</Text>
              </View>
            </View>
          </View>
        )}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** 「刚刚 / 12 分钟前 / 3 小时前 / 2 天前」，超过一周就显示日期。 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMinutes = Math.floor((Date.now() - then) / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 24, fontWeight: "700", color: colors.ink },
  videoEntry: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.bgTint },
  videoEntryLabel: { fontSize: 13, fontWeight: "600", color: colors.primary },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardHeadText: { flex: 1 },
  nickname: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  content: { fontSize: 15, lineHeight: 22, color: colors.ink },
  videoWrap: { position: "relative", borderRadius: 12, overflow: "hidden" },
  videoPoster: { width: "100%", height: 200, backgroundColor: "#0B0B14" },
  videoPosterEmpty: { height: 200 },
  playBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "38%",
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  imageRow: { flexDirection: "row", gap: 6 },
  image: { flex: 1, height: 120, borderRadius: 10, backgroundColor: colors.bgSoft },
  actions: { flexDirection: "row", alignItems: "center", gap: 20, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionLabel: { fontSize: 13, color: colors.muted },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: "center", lineHeight: 21 },
  footer: { paddingVertical: 18 },
  error: { position: "absolute", left: 16, right: 16, bottom: 12, fontSize: 13, color: colors.danger, textAlign: "center" },
});

/** 让 `Button` 在本文件里被用到（发布入口后续接上时复用同一个组件）。 */
export const __momentsScreenKeepsButtonImport = Button;
