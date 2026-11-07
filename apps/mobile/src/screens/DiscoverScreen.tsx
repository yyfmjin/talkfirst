import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { GuessSheet } from "../components/GuessSheet";
import { Icon } from "../components/Icon";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import type { Recommendation, RecommendationResponse } from "../lib/types";
import { colors, themed } from "../theme";
import { ProfilePreview } from "./ProfilePreview";
import { UserMomentsScreen } from "./UserMomentsScreen";

import { radii, sizes } from "../design/tokens";
/** 筛选条存词典键（不是中文串）：语言一变，标签跟着变。 */
const FILTERS = [
  { id: "all", labelKey: "discover.filterAll" },
  { id: "language", labelKey: "discover.filterLanguage" },
  { id: "gaming", labelKey: "discover.filterGaming" },
] as const satisfies readonly { id: string; labelKey: MsgKey }[];

type FilterId = (typeof FILTERS)[number]["id"];
const DAILY_LIMIT = 20;

/**
 * 外部「八字起名」工具页。
 *
 * 项目里没有装 `react-native-webview`（多一个原生依赖 = 多一轮构建与权限审查），
 * 所以按约定直接交给系统浏览器打开，而不是在 App 内渲染。
 */
const BAZI_URL = "https://bazi-app-production-b3f8.up.railway.app";

export function DiscoverScreen() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<FilterId>("all");
  const [items, setItems] = useState<Recommendation[]>([]);
  const [remaining, setRemaining] = useState(DAILY_LIMIT);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  /* 「查看动态」开在资料卡之上：先把资料卡关掉再开它（不叠两层 Modal）。 */
  const [momentsUserId, setMomentsUserId] = useState<string | null>(null);
  /**
   * 猜猜看邀请（2026-10-25 邀请制）。
   *
   * 默认不参与，我们先发邀请；这里只在「已受邀、还没决定」时显示一条横幅。
   * 接受后 `optIn` 为真，横幅消失，人进题库。
   */
  const [invite, setInvite] = useState<{ optIn: boolean; invitedAt: string | null; declinedAt: string | null } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  /* 猜猜看（2026-10-25）：与发现页共用同一天额度，关掉时把余额写回顶部。 */
  const [guessOpen, setGuessOpen] = useState(false);

  /**
   * 打开起名工具：交给系统浏览器。
   *
   * 这里**不先问 `canOpenURL`**：Android 11+ 的包可见性下，manifest 里没声明
   * `<queries>` 时它会返回 false —— 等于自己把入口锁死。直接 `openURL`，
   * 由系统决定用哪个浏览器；真没处理器时再提示。
   */
  const openBazi = useCallback(async () => {
    try {
      await Linking.openURL(BAZI_URL);
    } catch {
      Alert.alert(t("discover.baziEntry"), t("discover.baziOpenFailed"));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ optIn: boolean; invitedAt: string | null; declinedAt: string | null }>("/discover/guess/settings")
      .then((data) => {
        if (!cancelled) setInvite(data);
      })
      .catch(() => {
        /* 拿不到设置就不显示横幅：这个功能不该挡住发现页。 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const respondInvite = useCallback(
    async (accept: boolean) => {
      if (inviteBusy) return;
      setInviteBusy(true);
      try {
        const data = await apiFetch<{ optIn: boolean }>("/discover/guess/invite", {
          method: "POST",
          body: { accept },
        });
        setInvite((current) => (current ? { ...current, optIn: data.optIn, declinedAt: accept ? null : new Date().toISOString() } : current));
      } catch {
        /* 失败就保持原样，用户可再点一次。 */
      } finally {
        setInviteBusy(false);
      }
    },
    [inviteBusy],
  );

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
      setError(err instanceof Error ? err.message : t("discover.errorBody"));
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, [t]);

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
        <Text style={styles.muted}>{t("discover.loading")}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t("discover.errorTitle")}</Text>
        {/* The failure resolves asynchronously from a retry/filter change, so
            nothing is focused when it appears: the live region is what makes
            TalkBack/VoiceOver announce it instead of staying silent. */}
        <Text style={styles.muted} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
        <View style={{ marginTop: 16, alignSelf: "stretch" }}>
          <Button label={t("common.retry")} onPress={() => void loadRecommendations(filter)} />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyEmoji}>🌎</Text>
        <Text style={styles.emptyTitle}>
          {remaining === 0 ? t("discover.emptyDoneTitle") : t("discover.emptyNoneTitle")}
        </Text>
        <Text style={styles.muted} accessibilityLiveRegion="polite">
          {remaining === 0 ? t("discover.emptyDoneBody") : t("discover.emptyNoneBody")}
        </Text>
        <View style={{ marginTop: 16, alignSelf: "stretch" }}>
          <Button label={t("common.reload")} onPress={() => void loadRecommendations(filter)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{t("discover.title")}</Text>
          <Text style={styles.subtitle}>{t("discover.subtitle")}</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t("discover.remaining", { n: remaining })}</Text>
          </View>
          <Pressable
            onPress={() => setGuessOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("discover.guessEntry")}
            style={styles.guessButton}
          >
            <Icon name="dice-outline" size={16} color={colors.primary} />
            <Text style={styles.guessLabel}>{t("discover.guessEntry")}</Text>
          </Pressable>
        </View>
      </View>

      {/* 起名工具：一张小卡片，放在标题下方、筛选条之前。 */}
      <Pressable
        onPress={() => void openBazi()}
        accessibilityRole="button"
        accessibilityLabel={t("discover.baziEntry")}
        style={({ pressed }) => [styles.baziCard, pressed ? styles.baziCardPressed : null]}
      >
        <View style={styles.baziIcon}>
          <Icon name="brush-outline" size={17} color={colors.primary} />
        </View>
        <Text style={styles.baziLabel} numberOfLines={1}>
          {t("discover.baziEntry")}
        </Text>
        <Icon name="chevron-forward" size={16} color={colors.muted} />
      </Pressable>

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
              {t(option.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {invite && !invite.optIn && invite.invitedAt && !invite.declinedAt ? (
        <View style={styles.inviteCard}>
          <Text style={styles.inviteTitle}>{t("guess.inviteTitle")}</Text>
          <Text style={styles.inviteBody}>{t("guess.inviteBody")}</Text>
          <View style={styles.inviteActions}>
            <Pressable
              onPress={() => void respondInvite(true)}
              disabled={inviteBusy}
              accessibilityRole="button"
              style={styles.inviteAccept}
            >
              <Text style={styles.inviteAcceptLabel}>{t("guess.inviteAccept")}</Text>
            </Pressable>
            <Pressable
              onPress={() => void respondInvite(false)}
              disabled={inviteBusy}
              accessibilityRole="button"
              style={styles.inviteDecline}
            >
              <Text style={styles.inviteDeclineLabel}>{t("guess.inviteDecline")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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

      <ProfilePreview
        userId={previewUserId}
        onClose={() => setPreviewUserId(null)}
        onOpenMoments={(id) => {
          setPreviewUserId(null);
          setMomentsUserId(id);
        }}
      />
      <UserMomentsScreen userId={momentsUserId} onClose={() => setMomentsUserId(null)} />
      {/* 猜猜看：作答才扣次数，扣完把余额回写给顶部那个数字 */}
      <GuessSheet
        visible={guessOpen}
        onClose={() => setGuessOpen(false)}
        onQuotaChange={setRemaining}
      />
    </View>
  );
}

function Bubble({ item, onPress }: { item: Recommendation; onPress: () => void }) {
  const { t } = useI18n();
  const name = item.nickname ?? t("common.user");
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.bubble, pressed ? styles.bubblePressed : null]}
      accessibilityRole="button"
      accessibilityLabel={t("discover.viewProfile", { name })}
    >
      <Avatar uri={item.avatarUrl} nickname={item.nickname} size={64} />
      <Text style={styles.bubbleName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.bubbleMeta} numberOfLines={1}>
        {[
          item.age !== null ? t("common.age", { n: item.age }) : null,
          item.countryName ?? item.countryCode,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  baziCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.bgTint,
  },
  baziCardPressed: { opacity: 0.85 },
  baziIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.chip,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.glassRaised,
  },
  baziLabel: { flex: 1, fontSize: sizes.ui, fontWeight: "600", color: c.ink },
  inviteCard: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 14,
    borderRadius: radii.control,
    backgroundColor: "#F1F2FF",
    borderWidth: 1,
    borderColor: "#DCE0FF",
  },
  inviteTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  inviteBody: { marginTop: 4, fontSize: sizes.ui, lineHeight: 19, color: c.muted },
  inviteActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  inviteAccept: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: c.primary,
  },
  inviteAcceptLabel: { fontSize: sizes.ui, fontWeight: "600", color: c.white },
  inviteDecline: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "#DCE0FF",
    backgroundColor: c.glass,
  },
  inviteDeclineLabel: { fontSize: sizes.ui, fontWeight: "500", color: c.muted },
  root: { flex: 1, backgroundColor: c.bg, paddingTop: 8 },
  headerActions: { alignItems: "flex-end", gap: 8 },
  guessButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "#DCE0FF",
    backgroundColor: "#F1F2FF",
  },
  guessLabel: { fontSize: sizes.ui, fontWeight: "600", color: c.primary },
  center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20 },
  title: { fontSize: sizes.title, fontWeight: "600", color: c.ink },
  subtitle: { fontSize: sizes.ui, color: c.muted, marginTop: 4 },
  badge: { backgroundColor: c.bgTint, borderRadius: radii.control, paddingHorizontal: 12, paddingVertical: 6 },
  badgeText: { fontSize: sizes.overline, color: c.primary, fontWeight: "500" },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginTop: 16 },
  filterChip: {
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: radii.control,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  filterLabel: { fontSize: sizes.caption, color: c.muted },
  filterLabelActive: { color: c.white, fontWeight: "500" },
  switching: { paddingVertical: 12, alignItems: "center" },
  list: { paddingHorizontal: 12, paddingBottom: 24, paddingTop: 16 },
  row: { justifyContent: "space-between", marginBottom: 20 },
  bubble: { flex: 1, alignItems: "center", paddingVertical: 8 },
  bubblePressed: { opacity: 0.7 },
  bubbleName: { fontSize: sizes.ui, color: c.ink, fontWeight: "500", marginTop: 8, maxWidth: 100 },
  bubbleMeta: { fontSize: sizes.overline, color: c.muted, marginTop: 2, maxWidth: 100 },
  errorTitle: { fontSize: sizes.body, fontWeight: "600", color: c.danger, marginBottom: 8 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink, marginBottom: 8 },
  muted: { fontSize: sizes.ui, color: c.muted, textAlign: "center", marginTop: 8 },
}));
