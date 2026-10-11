import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { apiFetch } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import { colors } from "../theme";
import type { Moment, VideoFeedPage } from "../lib/types";

/**
 * 视频流（移动端）—— 全屏、上下滑切换，与 web 的 `/videos` 同源。
 *
 * 数据来自 `GET /moments/videos`：服务端复用**与动态流完全相同的可见性链**
 * （拉黑 / 审核 / 作者可见范围 / 敏感内容过滤），只加了「有视频」与打散。
 *
 * ## 播放策略（每条都对应一个真会踩到的坑）
 *
 * · **只让当前那一条播**：同时播多路，手机直接掉帧甚至被杀。
 * · **静音起步**：iOS 上「带声音的自动播放」会被系统拒绝，表现是一片黑。
 *   所以默认静音，右上角给一个显式的开声音按钮。
 * · **`pagingEnabled`**：整屏吸附就是「上下滑切换」的全部实现，不需要手势库。
 * · **`loop` + `contentFit="contain"`**：竖屏也可能有横屏视频，contain 不裁。
 * · **记住看过的 id**（`exclude`，服务端只认最后 50 个）：翻页时不重复推同一条。
 *   服务端回 `exhausted` 说明已经没有没看过的了，这时**从头循环**。
 */
export function VideosScreen({
  startId,
  onClose,
}: {
  startId?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
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
        setError(requestError instanceof Error ? requestError.message : t("videos.errorLoading"));
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [startId, t],
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
            <Icon name="videocam-outline" size={36} color={colors.white} />
            <Text style={styles.emptyText}>{t("videos.empty")}</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <VideoPage item={item} active={index === activeIndex} muted={muted} height={height} t={t} />
        )}
      />

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t("videos.back")}
        style={styles.topLeft}
      >
        <Icon name="arrow-back" size={22} color={colors.white} />
      </Pressable>
      <Pressable
        onPress={() => setMuted((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={muted ? t("videos.unmute") : t("videos.mute")}
        accessibilityState={{ selected: !muted }}
        style={styles.topRight}
      >
        <Icon name={muted ? "volume-mute" : "volume-high"} size={22} color={colors.white} />
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** 一屏一条视频：只有当前这条播，其它暂停。 */
function VideoPage({
  item,
  active,
  muted,
  height,
  t,
}: {
  item: Moment;
  active: boolean;
  muted: boolean;
  height: number;
  t: TranslateFn;
}) {
  const player = useVideoPlayer(item.videoUrl ?? "", (videoPlayer) => {
    videoPlayer.loop = true;
  });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    return () => {
      player.pause();
    };
  }, [player]);

  return (
    <View style={[styles.page, { height }]}>
      <VideoView player={player} style={styles.video} contentFit="contain" />

      <View style={styles.overlay}>
        <View style={styles.authorRow}>
          <Avatar uri={item.author.avatarUrl} nickname={item.author.nickname} size={38} />
          <View style={styles.authorText}>
            <Text style={styles.nickname}>{item.author.nickname ?? t("common.user")}</Text>
            {item.author.countryCode ? <Text style={styles.country}>{item.author.countryCode}</Text> : null}
          </View>
        </View>
        {item.content ? (
          <Text style={styles.content} numberOfLines={3}>
            {item.content}
          </Text>
        ) : null}
        <View style={styles.counts}>
          <View style={styles.countGroup}>
            <Icon name={item.liked ? "heart" : "heart-outline"} size={18} color={colors.white} />
            <Text style={styles.countText}>{item.likeCount}</Text>
          </View>
          <View style={styles.countGroup}>
            <Icon name="chatbubble-outline" size={17} color={colors.white} />
            <Text style={styles.countText}>{item.commentCount}</Text>
          </View>
        </View>
      </View>
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
  counts: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 2 },
  countGroup: { flexDirection: "row", alignItems: "center", gap: 5 },
  countText: { fontSize: 13, color: colors.white },
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
