import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Video, ResizeMode } from "expo-av";
import { apiFetch } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { colors } from "../theme";
import type { Moment, VideoFeedPage } from "../lib/types";

/**
 * 视频流（2026-10-07）—— 全屏、上下滑切换，与 web 的 `/videos` 同源。
 *
 * 数据来自 `GET /moments/videos`：服务端复用**与动态流完全相同的可见性链**
 * （拉黑 / 审核 / 作者可见范围 / 敏感内容过滤），只加了「有视频」与打散。
 *
 * ## 播放策略（每条都对应一个真会踩到的坑）
 *
 * · **只让当前那一条播**（`shouldPlay={index === activeIndex}`）：同时播多路，
 *   手机直接掉帧甚至被杀。
 * · **静音起步**：iOS 上「带声音的自动播放」会被系统拒绝，表现是一片黑。
 *   所以默认静音，右上角给一个显式的开声音按钮。
 * · **`pagingEnabled`**：整屏吸附就是「上下滑切换」的全部实现，不需要手势库。
 * · **`isLooping` + `resizeMode="contain"`**：竖屏也可能有横屏视频，contain 不裁。
 * · **记住看过的 id**（`exclude`，服务端只认最后 50 个）：翻页时不重复推同一条。
 *   服务端回 `exhausted` 说明已经没有没看过的了，这时**从头循环**，
 *   而不是继续请求空页。
 */
export function VideosScreen({ startId, onClose }: { startId?: string; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const [items, setItems] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const seenRef = useRef<string[]>([]);
  const exhaustedRef = useRef(false);
  const loadingRef = useRef(false);
  const startHandledRef = useRef(false);

  const loadBatch = useCallback(
    async (reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        if (reset) {
          seenRef.current = [];
          exhaustedRef.current = false;
        }
        const exclude = reset ? "" : seenRef.current.slice(-50).join(",");
        const data = await apiFetch<VideoFeedPage>(
          `/moments/videos?limit=5${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ""}`,
        );
        exhaustedRef.current = data.exhausted;
        let incoming = data.items.filter((item) => Boolean(item.videoUrl));

        // 从动态卡片点进来的那一条排到最前；不在这批里就照常从这批开始
        // （随机流里它可能不在，为它多跑一次请求不划算）。
        if (reset && startId && !startHandledRef.current) {
          startHandledRef.current = true;
          const index = incoming.findIndex((item) => item.id === startId);
          if (index > 0) incoming = [incoming[index], ...incoming.filter((_, i) => i !== index)];
        }

        if (reset) {
          seenRef.current = incoming.map((item) => item.id);
          setItems(incoming);
          setActiveIndex(0);
        } else {
          const fresh = incoming.filter((item) => !seenRef.current.includes(item.id));
          seenRef.current = [...seenRef.current, ...fresh.map((item) => item.id)].slice(-50);
          if (fresh.length > 0) setItems((previous) => [...previous, ...fresh]);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "视频加载失败。");
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [startId],
  );

  useEffect(() => {
    void loadBatch(true);
  }, [loadBatch]);

  /** 翻到末尾：还有没看过的就拉下一批，已经翻完就从头循环。 */
  function handleEndReached() {
    if (exhaustedRef.current) {
      void loadBatch(true);
      return;
    }
    void loadBatch(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.white} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.5}
        onEndReached={handleEndReached}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.y / height);
          setActiveIndex(Math.max(0, Math.min(items.length - 1, index)));
        }}
        getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
        ListEmptyComponent={
          <View style={[styles.center, { height }]}>
            <Ionicons name="videocam-outline" size={36} color={colors.white} />
            <Text style={styles.emptyText}>还没有视频。发布一条带视频的动态，它就会出现在这里。</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[styles.page, { height }]}>
            {Math.abs(index - activeIndex) <= 1 ? (
              <Video
                source={{ uri: item.videoUrl! }}
                style={styles.video}
                resizeMode={ResizeMode.CONTAIN}
                isLooping
                isMuted={muted}
                shouldPlay={index === activeIndex}
                useNativeControls={false}
              />
            ) : (
              <View style={styles.video} />
            )}

            <View style={styles.overlay}>
              <View style={styles.authorRow}>
                <Avatar uri={item.author.avatarUrl} nickname={item.author.nickname} size={38} />
                <View style={styles.authorText}>
                  <Text style={styles.nickname}>{item.author.nickname ?? "用户"}</Text>
                  {item.author.countryCode ? <Text style={styles.country}>{item.author.countryCode}</Text> : null}
                </View>
              </View>
              {item.content ? (
                <Text style={styles.content} numberOfLines={3}>
                  {item.content}
                </Text>
              ) : null}
              <View style={styles.counts}>
                <Ionicons name={item.liked ? "heart" : "heart-outline"} size={18} color={colors.white} />
                <Text style={styles.countText}>{item.likeCount}</Text>
                <Ionicons name="chatbubble-outline" size={17} color={colors.white} style={styles.countIcon} />
                <Text style={styles.countText}>{item.commentCount}</Text>
              </View>
            </View>
          </View>
        )}
      />

      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="返回" style={styles.topLeft}>
        <Ionicons name="arrow-back" size={22} color={colors.white} />
      </Pressable>
      <Pressable
        onPress={() => setMuted((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={muted ? "打开声音" : "静音"}
        accessibilityState={{ selected: !muted }}
        style={styles.topRight}
      >
        <Ionicons name={muted ? "volume-mute" : "volume-high"} size={22} color={colors.white} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#000000" },
  page: { width: "100%", justifyContent: "center", backgroundColor: "#000000" },
  video: { width: "100%", height: "100%" },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 18,
    paddingBottom: 34,
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  authorRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  authorText: { flex: 1 },
  nickname: { fontSize: 15, fontWeight: "700", color: colors.white },
  country: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 1 },
  content: { fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.92)" },
  counts: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  countText: { fontSize: 13, color: colors.white },
  countIcon: { marginLeft: 12 },
  emptyText: { fontSize: 14, color: "rgba(255,255,255,0.8)", textAlign: "center", paddingHorizontal: 40, lineHeight: 21 },
  topLeft: {
    position: "absolute",
    top: 54,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  topRight: {
    position: "absolute",
    top: 54,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  error: { position: "absolute", left: 16, right: 16, bottom: 40, fontSize: 13, color: "#FFD8D8", textAlign: "center" },
});
