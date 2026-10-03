import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { apiFetch } from "../lib/api";
import type { Recommendation, RecommendationResponse } from "../lib/types";
import { colors } from "../theme";
import { ProfilePreview } from "./ProfilePreview";

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "language", label: "语言交换" },
  { id: "gaming", label: "游戏搭子" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];
const DAILY_LIMIT = 20;

export function DiscoverScreen() {
  const [filter, setFilter] = useState<FilterId>("all");
  const [items, setItems] = useState<Recommendation[]>([]);
  const [remaining, setRemaining] = useState(DAILY_LIMIT);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const loadRecommendations = useCallback(async (nextFilter: FilterId, initial = false) => {
    if (initial) setLoading(true);
    else setSwitching(true);
    setError("");
    try {
      const data = await apiFetch<RecommendationResponse>(
        `/discover/recommendations?limit=${DAILY_LIMIT}&filter=${nextFilter}`,
      );
      setItems(data.items);
      setRemaining(data.remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : "推荐加载失败，请稍后再试。");
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, []);

  useEffect(() => {
    void loadRecommendations("all", true);
  }, [loadRecommendations]);

  function changeFilter(next: FilterId) {
    if (next === filter || switching) return;
    setFilter(next);
    void loadRecommendations(next);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" accessibilityRole="progressbar" />
        <Text style={styles.muted}>正在发现新朋友…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>推荐暂时不可用</Text>
        {/* The failure resolves asynchronously from a retry/filter change, so
            nothing is focused when it appears: the live region is what makes
            TalkBack/VoiceOver announce it instead of staying silent. */}
        <Text style={styles.muted} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
        <View style={{ marginTop: 16, alignSelf: "stretch" }}>
          <Button label="重试" onPress={() => void loadRecommendations(filter)} />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyEmoji}>🌎</Text>
        <Text style={styles.emptyTitle}>
          {remaining === 0 ? "今天的推荐看完啦" : "暂时没有合适的人"}
        </Text>
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {remaining === 0 ? "明天再来看看，认真认识一个人。" : "完善语言、兴趣和目的后，会得到更好的推荐。"}
        </Text>
        <View style={{ marginTop: 16, alignSelf: "stretch" }}>
          <Button label="重新加载" onPress={() => void loadRecommendations(filter)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>发现</Text>
          <Text style={styles.subtitle}>先聊聊，再成为朋友。</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>今日剩余 {remaining}</Text>
        </View>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((option) => (
          <Pressable
            key={option.id}
            onPress={() => changeFilter(option.id)}
            disabled={switching}
            style={[styles.filterChip, filter === option.id ? styles.filterChipActive : null]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === option.id }}
          >
            <Text style={[styles.filterLabel, filter === option.id ? styles.filterLabelActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {switching ? (
        <View style={styles.switching}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      <FlatList
        data={items}
        numColumns={3}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Bubble item={item} onPress={() => setPreviewUserId(item.id)} />
        )}
      />

      <ProfilePreview userId={previewUserId} onClose={() => setPreviewUserId(null)} />
    </View>
  );
}

function Bubble({ item, onPress }: { item: Recommendation; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bubble, pressed ? styles.bubblePressed : null]}
      accessibilityRole="button"
      accessibilityLabel={`查看 ${item.nickname ?? "用户"} 的资料`}
    >
      <Avatar uri={item.avatarUrl} nickname={item.nickname} size={64} />
      <Text style={styles.bubbleName} numberOfLines={1}>
        {item.nickname ?? "用户"}
      </Text>
      <Text style={styles.bubbleMeta} numberOfLines={1}>
        {[item.age !== null ? `${item.age} 岁` : null, item.countryName ?? item.countryCode]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: 8 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: "600", color: colors.ink },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 4 },
  badge: { backgroundColor: colors.bgTint, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: 11, color: colors.primary, fontWeight: "500" },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 16 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterLabel: { fontSize: 12, color: colors.muted },
  filterLabelActive: { color: colors.white, fontWeight: "500" },
  switching: { paddingVertical: 12, alignItems: "center" },
  list: { paddingHorizontal: 12, paddingBottom: 24, paddingTop: 16 },
  row: { justifyContent: "space-between", marginBottom: 20 },
  bubble: { flex: 1, alignItems: "center", paddingVertical: 8 },
  bubblePressed: { opacity: 0.7 },
  bubbleName: { fontSize: 13, color: colors.ink, fontWeight: "500", marginTop: 8, maxWidth: 100 },
  bubbleMeta: { fontSize: 11, color: colors.muted, marginTop: 2, maxWidth: 100 },
  errorTitle: { fontSize: 15, fontWeight: "600", color: colors.danger, marginBottom: 8 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  muted: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 8 },
});
