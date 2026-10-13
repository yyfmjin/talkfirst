import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import type { UserMomentItem, UserMomentsDetail } from "../lib/types";
import { colors } from "../theme";
import { MomentDetailScreen } from "./MomentDetailScreen";

/**
 * 某个人的动态 —— 对齐 web 的 `/moments/user/[id]`。
 *
 * ## 为什么入口挂在「资料卡」上
 *
 * web 那边这个页面是从 `/profile/[id]` 上的「查看动态」进去的（不是从动态卡片）。
 * 移动端同一位置是 `ProfilePreview`，所以入口也放在那里 —— 同一个动作在产品里
 * 只能有一条路径，否则「我想看他其他动态」在两端的走法就不一样了。
 *
 * ## 为什么要单独区分 `locked`
 *
 * 对方把动态设成「仅连接 / 不公开」时，服务端**不会返回条目**。如果把它当空列表，
 * 界面会说「TA 还没有动态」—— 而真实情况是「你看不到」。这两句话对用户意味着完全
 * 不同的下一步（等一等 vs 去建立连接），所以必须分开说。
 *
 * ## 为什么用 Modal 而不是像 ComposeScreen 那样接管一屏
 *
 * 它是从资料卡（本身就是个底部弹出的 Modal）里点进去的，父级是三个不同的页面
 * （发现 / 我的连接 / 动态详情）。做成自带 Modal 的组件，三个调用点只需要一个
 * `userId` 状态，不必各自搭一套全屏切换。资料卡会先关掉自己再打开它 ——
 * 不叠两层 Modal（Android 上那是两个 Dialog 窗，返回键的行为会变得难以预测）。
 */
export function UserMomentsScreen({
  userId,
  onClose,
}: {
  /** null = 关闭。与 `ProfilePreview` 同一个约定。 */
  userId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<UserMomentsDetail | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  /** 点开某一条（在同一个 Modal 里换成详情页）。 */
  const [openMomentId, setOpenMomentId] = useState<string | null>(null);
  const [opened, setOpened] = useState<UserMomentItem | null>(null);
  /** 点赞的本地覆盖：列表项没有嵌套 author，但点赞状态要能立刻反映出来。 */
  const [likes, setLikes] = useState<Record<string, { liked: boolean; likeCount: number }>>({});

  const load = useCallback(
    async (mode: "initial" | "more") => {
      if (!userId) return;
      if (mode === "more" && !cursor) return;
      if (mode === "more") setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const suffix = mode === "more" && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const data = await apiFetch<UserMomentsDetail>(
          `/moments/user/${encodeURIComponent(userId)}?limit=10${suffix}`,
        );
        setDetail((previous) =>
          mode === "more" && previous
            ? { ...data, items: [...previous.items, ...data.items] }
            : data,
        );
        setCursor(data.nextCursor);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : t("moments.errorLoading"));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [cursor, t, userId],
  );

  /* 每次换人重新拉：Modal 是复用的，不清空就会先闪一下上一个人的动态。 */
  useEffect(() => {
    if (!userId) return;
    setDetail(null);
    setCursor(null);
    setLikes({});
    setOpenMomentId(null);
    setOpened(null);
    void load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function toggleLike(item: UserMomentItem) {
    const current = likes[item.id] ?? { liked: item.liked, likeCount: item.likeCount };
    /* 先改界面再发请求：点赞是最高频的动作，等一个来回才有反馈会显得卡。 */
    setLikes((previous) => ({
      ...previous,
      [item.id]: {
        liked: !current.liked,
        likeCount: current.likeCount + (current.liked ? -1 : 1),
      },
    }));
    try {
      const result = await apiFetch<{ liked: boolean }>(`/moments/${item.id}/like`, {
        method: "POST",
      });
      setLikes((previous) => ({
        ...previous,
        [item.id]: {
          liked: result.liked,
          /*
            服务端只回 `{liked}`，没有计数，所以只能拿「原状态 → 新状态」自己加减。
            写死成 `+ (liked ? 1 : 0)` 会让「取消点赞」加 0 —— 红心灭了但数字没降。
          */
          likeCount: Math.max(
            0,
            current.likeCount + (result.liked === current.liked ? 0 : result.liked ? 1 : -1),
          ),
        },
      }));
    } catch {
      /* 失败就退回原状态，而不是留一个骗人的红心。 */
      setLikes((previous) => ({ ...previous, [item.id]: current }));
    }
  }

  if (!userId) return null;

  if (openMomentId) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setOpenMomentId(null)}>
        <View style={styles.modalRoot}>
          {/* 详情页自己就是一个整屏；这里的返回先回到「TA 的动态」，而不是直接关掉。 */}
          <MomentDetailScreen
            momentId={openMomentId}
            initial={
              opened
                ? { ...opened, author: detail?.author ?? { id: userId, nickname: null, avatarUrl: null, countryCode: null } }
                : null
            }
            onBack={() => setOpenMomentId(null)}
          />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <SubHeader
          title={detail?.author.nickname ?? t("moments.userTitle")}
          onBack={onClose}
        />

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label={t("common.retry")} onPress={() => void load("initial")} />
          </View>
        ) : (
          <FlatList
            data={detail?.locked ? [] : (detail?.items ?? [])}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              detail ? (
                <View>
                  <View style={styles.authorCard}>
                    <Avatar
                      uri={detail.author.avatarUrl}
                      nickname={detail.author.nickname}
                      size={64}
                    />
                    <Text style={styles.authorName}>
                      {detail.author.nickname ?? t("common.user")}
                    </Text>
                    {detail.author.countryCode ? (
                      <Text style={styles.authorMeta}>{detail.author.countryCode}</Text>
                    ) : null}
                    {detail.author.bio ? (
                      <Text style={styles.authorBio}>{detail.author.bio}</Text>
                    ) : null}
                  </View>

                  {detail.bindings.length > 0 ? (
                    <View style={styles.bindingRow}>
                      {detail.bindings.map((binding) => (
                        <View key={binding.platform} style={styles.bindingTag}>
                          <Text style={styles.bindingText}>
                            {binding.displayName ?? binding.handle}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {detail.locked ? (
                    <View style={styles.lockedCard}>
                      <Text style={styles.lockedTitle}>{t("moments.userLockedTitle")}</Text>
                      <Text style={styles.lockedBody}>{t("moments.userLockedBody")}</Text>
                      <View style={styles.lockedAction}>
                        <Button label={t("moments.userLockedCta")} onPress={onClose} />
                      </View>
                    </View>
                  ) : null}

                  {!detail.locked && detail.items.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyTitle}>{t("moments.userEmpty")}</Text>
                      <Text style={styles.emptyBody}>{t("moments.userEmptyBody")}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const like = likes[item.id] ?? { liked: item.liked, likeCount: item.likeCount };
              return (
                <Pressable
                  style={styles.card}
                  accessibilityRole="button"
                  onPress={() => {
                    setOpened(item);
                    setOpenMomentId(item.id);
                  }}
                >
                  <Text style={styles.meta}>{relativeTime(item.createdAt, t)}</Text>
                  {item.content ? <Text style={styles.content}>{item.content}</Text> : null}

                  {item.videoUrl ? (
                    <View style={styles.videoPlaceholder}>
                      <Icon name="videocam-outline" size={20} color={colors.muted} />
                      <Text style={styles.videoHint}>{t("moments.watchVideos")}</Text>
                    </View>
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
                      accessibilityLabel={like.liked ? t("moments.unlike") : t("moments.like")}
                      accessibilityState={{ selected: like.liked }}
                      style={styles.action}
                    >
                      <Icon
                        name={like.liked ? "heart" : "heart-outline"}
                        size={20}
                        color={like.liked ? colors.danger : colors.muted}
                      />
                      <Text style={styles.actionLabel}>{like.likeCount}</Text>
                    </Pressable>
                    <View style={styles.action}>
                      <Icon name="chatbubble-outline" size={19} color={colors.muted} />
                      <Text style={styles.actionLabel}>{item.commentCount}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
            ListFooterComponent={
              detail && !detail.locked && cursor ? (
                loadingMore ? (
                  <ActivityIndicator style={styles.footer} color={colors.primary} />
                ) : (
                  <Pressable
                    onPress={() => void load("more")}
                    accessibilityRole="button"
                    accessibilityLabel={t("moments.userLoadMore")}
                    style={styles.loadMore}
                  >
                    <Text style={styles.loadMoreLabel}>{t("moments.userLoadMore")}</Text>
                  </Pressable>
                )
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}

/** 「3 分钟前」这类相对时间。与动态列表同一套写法（那里是模块内的函数）。 */
function relativeTime(iso: string, t: TranslateFn): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  return t("common.daysAgo", { n: Math.floor(hours / 24) });
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  list: { padding: 20, paddingBottom: 40 },
  authorCard: { alignItems: "center", paddingVertical: 12 },
  authorName: { marginTop: 10, fontSize: 18, fontWeight: "600", color: colors.ink },
  authorMeta: { marginTop: 4, fontSize: 12, color: colors.muted },
  authorBio: {
    marginTop: 8,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    textAlign: "center",
  },
  bindingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  bindingTag: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  bindingText: { fontSize: 12, color: colors.muted },
  lockedCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    padding: 18,
    alignItems: "center",
  },
  lockedTitle: { fontSize: 15, fontWeight: "600", color: colors.ink, textAlign: "center" },
  lockedBody: {
    marginTop: 6,
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  lockedAction: { alignSelf: "stretch", marginTop: 14 },
  emptyCard: { marginTop: 24, alignItems: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  emptyBody: { marginTop: 6, fontSize: 13, color: colors.muted, textAlign: "center" },
  card: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
    paddingBottom: 10,
  },
  meta: { fontSize: 12, color: colors.muted },
  content: { marginTop: 6, fontSize: 15, color: colors.ink, lineHeight: 22 },
  imageRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  image: { width: 92, height: 92, borderRadius: 12, backgroundColor: colors.bgSoft },
  videoPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
  },
  videoHint: { fontSize: 13, color: colors.muted },
  actions: { flexDirection: "row", gap: 22, marginTop: 10 },
  action: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionLabel: { fontSize: 13, color: colors.muted },
  loadMore: { alignItems: "center", paddingVertical: 16 },
  loadMoreLabel: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  footer: { marginVertical: 16 },
  errorText: { fontSize: 14, color: colors.danger, textAlign: "center" },
});
