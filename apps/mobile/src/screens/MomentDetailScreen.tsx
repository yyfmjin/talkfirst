import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { apiFetch } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import { colors } from "../theme";
import type { CommentPage, Moment, MomentComment } from "../lib/types";
import { ProfilePreview } from "./ProfilePreview";

/**
 * 动态详情（移动端）。
 *
 * ## 与 web 的关系
 *
 * 对齐 web 的 `/moments/[id]`：点 feed 卡片进来，重新从 `GET /moments/:id`
 * 读这一条（feed 列表只是一份摘要，数据库才是作者/正文/媒体/时间的唯一来源），
 * 评论区走 `GET /moments/:id/comments` + `POST /moments/:id/comments`。
 *
 * 第一版覆盖：看详情、看评论（含一层回复）、发顶层评论、点赞、收藏、点头像看
 * 资料卡。评论的「回复 / 删除 / 编辑 / 举报」暂未接入 —— 与 web 相比是明确的
 * 后续项，先保证核心闭环（看 + 发 + 表态）可用。
 */
export function MomentDetailScreen({
  momentId,
  initial,
  onBack,
}: {
  momentId: string;
  initial?: Moment | null;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [moment, setMoment] = useState<Moment | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");

  const [comments, setComments] = useState<MomentComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [liking, setLiking] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const detail = await apiFetch<Moment>(`/moments/${momentId}`);
      setMoment(detail);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("moments.errorLoading"));
    } finally {
      setLoading(false);
    }
  }, [momentId, t]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    setCommentsError("");
    try {
      const page = await apiFetch<CommentPage>(`/moments/${momentId}/comments`);
      setComments(page.items);
    } catch (requestError) {
      setComments([]);
      setCommentsError(
        requestError instanceof Error ? requestError.message : t("moments.commentsError"),
      );
    } finally {
      setCommentsLoading(false);
    }
  }, [momentId, t]);

  useEffect(() => {
    void load();
    void loadComments();
  }, [load, loadComments]);

  async function toggleLike() {
    if (!moment || liking) return;
    setLiking(true);
    try {
      const result = await apiFetch<{ liked: boolean }>(`/moments/${moment.id}/like`, {
        method: "POST",
      });
      setMoment((current) =>
        current && current.id === moment.id
          ? {
              ...current,
              liked: result.liked,
              likeCount: Math.max(
                0,
                current.likeCount + (result.liked === current.liked ? 0 : result.liked ? 1 : -1),
              ),
            }
          : current,
      );
    } catch {
      // 点赞失败不打断阅读，与 feed 同一策略。
    } finally {
      setLiking(false);
    }
  }

  async function toggleBookmark() {
    if (!moment || bookmarking) return;
    setBookmarking(true);
    try {
      const next = !moment.bookmarked;
      const result = await apiFetch<{ bookmarked: boolean }>(`/moments/${moment.id}/bookmark`, {
        method: next ? "POST" : "DELETE",
      });
      setMoment((current) =>
        current && current.id === moment.id ? { ...current, bookmarked: result.bookmarked } : current,
      );
    } catch {
      // 收藏失败不弹错：和点赞一样，不值得为一次表态打断阅读。
    } finally {
      setBookmarking(false);
    }
  }

  async function submitComment() {
    if (!moment || sending) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setCommentsError("");
    try {
      const comment = await apiFetch<MomentComment>(`/moments/${moment.id}/comments`, {
        method: "POST",
        body: { content },
      });
      setComments((current) => [...current, comment]);
      setMoment((current) =>
        current ? { ...current, commentCount: current.commentCount + 1 } : current,
      );
      setDraft("");
    } catch (requestError) {
      setCommentsError(
        requestError instanceof Error ? requestError.message : t("moments.commentSendFailed"),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("moments.detail")} onBack={onBack} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !moment ? (
        <View style={styles.center}>
          <Icon name="alert-circle-outline" size={32} color={colors.muted} />
          <Text style={styles.errorText}>{error || t("moments.errorLoading")}</Text>
          <Button label={t("common.retry")} onPress={() => void load()} variant="ghost" />
        </View>
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <MomentCard
                moment={moment}
                t={t}
                liking={liking}
                bookmarking={bookmarking}
                onToggleLike={() => void toggleLike()}
                onToggleBookmark={() => void toggleBookmark()}
                onAuthorPress={() => setPreviewUserId(moment.userId)}
              />

              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>
                  {t("moments.comments")}
                  {moment.commentCount > 0 ? ` · ${moment.commentCount}` : ""}
                </Text>
              </View>

              {commentsLoading ? (
                <ActivityIndicator style={styles.commentsLoading} color={colors.primary} />
              ) : null}

              {!commentsLoading && commentsError ? (
                <View style={styles.commentsErrorBox}>
                  <Text style={styles.errorText}>{commentsError}</Text>
                  <Button
                    label={t("common.retry")}
                    onPress={() => void loadComments()}
                    variant="ghost"
                  />
                </View>
              ) : null}

              {!commentsLoading && !commentsError && comments.length === 0 ? (
                <Text style={styles.commentsEmpty}>{t("moments.commentsEmpty")}</Text>
              ) : null}

              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t("moments.commentPlaceholder")}
                  placeholderTextColor={colors.muted}
                  style={styles.composerInput}
                  multiline
                  maxLength={500}
                  accessibilityLabel={t("moments.commentPlaceholder")}
                />
                {commentsError ? <Text style={styles.errorText}>{commentsError}</Text> : null}
                <View style={styles.composerActions}>
                  {sending ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Button
                      label={t("moments.commentSend")}
                      onPress={() => void submitComment()}
                      disabled={!draft.trim()}
                    />
                  )}
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <CommentRow comment={item} t={t} onAuthorPress={() => setPreviewUserId(item.user.id)} />
          )}
          ListEmptyComponent={null}
        />
      )}

      <ProfilePreview userId={previewUserId} onClose={() => setPreviewUserId(null)} />
    </View>
  );
}

/**
 * 详情页里的动态卡片（正文 + 媒体 + 点赞/收藏操作行）。与 feed 卡片同形，
 * 但多一个收藏按钮、媒体用更大的展示。
 */
function MomentCard({
  moment,
  t,
  liking,
  bookmarking,
  onToggleLike,
  onToggleBookmark,
  onAuthorPress,
}: {
  moment: Moment;
  t: TranslateFn;
  liking: boolean;
  bookmarking: boolean;
  onToggleLike: () => void;
  onToggleBookmark: () => void;
  onAuthorPress: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable onPress={onAuthorPress} style={styles.cardHead} accessibilityRole="button">
        <Avatar uri={moment.author.avatarUrl} nickname={moment.author.nickname} size={40} />
        <View style={styles.cardHeadText}>
          <Text style={styles.nickname}>{moment.author.nickname ?? t("common.user")}</Text>
          <Text style={styles.meta}>
            {moment.author.countryCode ?? ""} {relativeTime(moment.createdAt, t)}
          </Text>
        </View>
      </Pressable>

      {moment.content ? <Text style={styles.content}>{moment.content}</Text> : null}

      {moment.tags.length > 0 ? (
        <View style={styles.tagRow}>
          {moment.tags.map((tag) => (
            <Text key={tag} style={styles.tag}>
              #{tag}
            </Text>
          ))}
        </View>
      ) : null}

      {moment.videoUrl ? (
        <MomentVideo uri={moment.videoUrl} />
      ) : moment.images.length === 1 ? (
        <Image source={{ uri: moment.images[0] }} style={styles.imageSingle} resizeMode="cover" />
      ) : moment.images.length > 1 ? (
        <View style={styles.imageRow}>
          {moment.images.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.image} resizeMode="cover" />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onToggleLike}
          disabled={liking}
          accessibilityRole="button"
          accessibilityLabel={moment.liked ? t("moments.unlike") : t("moments.like")}
          accessibilityState={{ selected: moment.liked }}
          style={styles.action}
        >
          <Icon
            name={moment.liked ? "heart" : "heart-outline"}
            size={20}
            color={moment.liked ? colors.danger : colors.muted}
          />
          <Text style={styles.actionLabel}>{moment.likeCount}</Text>
        </Pressable>
        <Pressable
          onPress={onToggleBookmark}
          disabled={bookmarking}
          accessibilityRole="button"
          accessibilityLabel={moment.bookmarked ? t("moments.unbookmark") : t("moments.bookmark")}
          accessibilityState={{ selected: moment.bookmarked }}
          style={styles.action}
        >
          <Icon
            name={moment.bookmarked ? "bookmark" : "bookmark-outline"}
            size={20}
            color={moment.bookmarked ? colors.primary : colors.muted}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** 一条评论 + 它的一层回复。 */
function CommentRow({
  comment,
  t,
  onAuthorPress,
}: {
  comment: MomentComment;
  t: TranslateFn;
  onAuthorPress: () => void;
}) {
  const replies = comment.replies ?? [];
  return (
    <View style={styles.comment}>
      <Pressable onPress={onAuthorPress} style={styles.commentHead} accessibilityRole="button">
        <Avatar uri={comment.user.avatarUrl} nickname={comment.user.nickname} size={28} />
        <View style={styles.commentHeadText}>
          <Text style={styles.commentNickname}>{comment.user.nickname ?? t("common.user")}</Text>
          <Text style={styles.commentMeta}>{relativeTime(comment.createdAt, t)}</Text>
        </View>
      </Pressable>
      <Text style={styles.commentContent}>{comment.content}</Text>

      {replies.length > 0 ? (
        <View style={styles.replies}>
          {replies.map((reply) => (
            <View key={reply.id} style={styles.reply}>
              <Pressable onPress={onAuthorPress} style={styles.commentHead} accessibilityRole="button">
                <Avatar uri={reply.user.avatarUrl} nickname={reply.user.nickname} size={22} />
                <View style={styles.commentHeadText}>
                  <Text style={styles.commentNickname}>
                    {reply.user.nickname ?? t("common.user")}
                  </Text>
                  <Text style={styles.commentMeta}>{relativeTime(reply.createdAt, t)}</Text>
                </View>
              </Pressable>
              <Text style={styles.commentContent}>{reply.content}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** 视频播放器（卡片内，与 feed 的 `MomentVideo` 同一套）。 */
function MomentVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
  });
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

function relativeTime(iso: string, t: TranslateFn): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMinutes = Math.floor((Date.now() - then) / 60000);
  if (diffMinutes < 1) return t("common.justNow");
  if (diffMinutes < 60) return t("common.minutesAgo", { n: diffMinutes });
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return t("common.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("common.daysAgo", { n: days });
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  listHeader: { gap: 12 },

  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardHeadText: { flex: 1 },
  nickname: { fontSize: 15, fontWeight: "600", color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  content: { fontSize: 15, lineHeight: 22, color: colors.ink },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { fontSize: 13, color: colors.primary },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: "#0B0B14" },
  imageSingle: { width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: colors.bgSoft },
  imageRow: { flexDirection: "row", gap: 6 },
  image: { flex: 1, height: 100, borderRadius: 10, backgroundColor: colors.bgSoft },
  actions: { flexDirection: "row", alignItems: "center", gap: 20, paddingTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 5 },
  actionLabel: { fontSize: 13, color: colors.muted },

  commentsHeader: { paddingTop: 6 },
  commentsTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  commentsLoading: { paddingVertical: 16 },
  commentsErrorBox: { alignItems: "center", paddingVertical: 16, gap: 8 },
  commentsEmpty: { fontSize: 13, color: colors.muted, paddingVertical: 16, textAlign: "center" },

  comment: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 6 },
  commentHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  commentHeadText: { flex: 1 },
  commentNickname: { fontSize: 13, fontWeight: "600", color: colors.ink },
  commentMeta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  commentContent: { fontSize: 14, lineHeight: 20, color: colors.ink },
  replies: { marginTop: 4, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.line, gap: 10 },
  reply: { gap: 4 },

  composer: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  composerInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: "top",
  },
  composerActions: { flexDirection: "row", justifyContent: "flex-end" },
  errorText: { fontSize: 13, color: colors.danger, textAlign: "center" },
});
