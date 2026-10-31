import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { MomentOwnerActions } from "../components/MomentOwnerActions";
import { SubHeader } from "../components/SubHeader";
import { VoiceNote } from "../components/VoiceNote";
import { MomentTranslate } from "../components/MomentTranslate";
import { useAuth } from "../lib/auth-context";
import { useI18n, type TranslateFn } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";
import type { CommentPage, Moment, MomentComment } from "../lib/types";
import { ProfilePreview } from "./ProfilePreview";
import { UserMomentsScreen } from "./UserMomentsScreen";

/**
 * 动态详情（移动端）。
 *
 * ## 与 web 的关系
 *
 * 对齐 web 的 `/moments/[id]`：点 feed 卡片进来，重新从 `GET /moments/:id`
 * 读这一条，评论区走 `GET /moments/:id/comments` + `POST /moments/:id/comments`。
 *
 * 评论支持：看（含一层回复）、发顶层评论、回复、编辑/删除自己的评论、举报。
 * `parentCommentId` 只接受**顶层评论**：回复一条回复时，实际挂到它所属的顶层
 * 评论下（服务端 `COMMENT_PARENT_INVALID` 拒绝「回复到回复」）。
 */

/** 举报原因：值与 web `report-reasons.ts` 一致，原样发给 `POST /reports`。 */
const REPORT_REASONS: Array<{ value: string; labelKey: MsgKey }> = [
  { value: "Harassment", labelKey: "report.reasonHarassment" },
  { value: "Spam", labelKey: "report.reasonSpam" },
  { value: "Scam", labelKey: "report.reasonScam" },
  { value: "Sexual content", labelKey: "report.reasonSexual" },
  { value: "Hate speech", labelKey: "report.reasonHate" },
  { value: "Fake profile", labelKey: "report.reasonFake" },
  { value: "Other", labelKey: "report.reasonOther" },
];

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
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;

  const [moment, setMoment] = useState<Moment | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState("");

  const [comments, setComments] = useState<MomentComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<MomentComment | null>(null);
  const [editingComment, setEditingComment] = useState<MomentComment | null>(null);
  const [reportTarget, setReportTarget] = useState<MomentComment | null>(null);

  const [liking, setLiking] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  /* 「查看动态」开在资料卡之上：先把资料卡关掉再开它（不叠两层 Modal）。 */
  const [momentsUserId, setMomentsUserId] = useState<string | null>(null);

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
      if (editingComment) {
        // 编辑自己的评论：PATCH /moments/:id/comments/:commentId
        await apiFetch(`/moments/${moment.id}/comments/${editingComment.id}`, {
          method: "PATCH",
          body: { content },
        });
        setComments((current) => editCommentInList(current, editingComment.id, content));
        setEditingComment(null);
      } else if (replyTo) {
        // 回复：parentCommentId 必须是顶层评论。回复一条回复时挂到它的顶层评论下。
        const parentId = replyTo.parentCommentId ?? replyTo.id;
        const reply = await apiFetch<MomentComment>(`/moments/${moment.id}/comments`, {
          method: "POST",
          body: { content, parentCommentId: parentId },
        });
        setComments((current) => insertReply(current, parentId, reply));
        setMoment((current) =>
          current ? { ...current, commentCount: current.commentCount + 1 } : current,
        );
        setReplyTo(null);
      } else {
        // 顶层评论
        const comment = await apiFetch<MomentComment>(`/moments/${moment.id}/comments`, {
          method: "POST",
          body: { content },
        });
        setComments((current) => [...current, comment]);
        setMoment((current) =>
          current ? { ...current, commentCount: current.commentCount + 1 } : current,
        );
      }
      setDraft("");
    } catch (requestError) {
      setCommentsError(
        requestError instanceof Error ? requestError.message : t("moments.commentSendFailed"),
      );
    } finally {
      setSending(false);
    }
  }

  function beginReply(comment: MomentComment) {
    setEditingComment(null);
    setReplyTo(comment);
    setDraft("");
  }

  function beginEdit(comment: MomentComment) {
    setReplyTo(null);
    setEditingComment(comment);
    setDraft(comment.content);
  }

  function cancelComposerContext() {
    setReplyTo(null);
    setEditingComment(null);
    setDraft("");
  }

  function confirmDelete(comment: MomentComment) {
    Alert.alert(t("moments.delete"), t("moments.deleteConfirm"), [
      { text: t("moments.cancel"), style: "cancel" },
      { text: t("moments.delete"), style: "destructive", onPress: () => void deleteComment(comment) },
    ]);
  }

  async function deleteComment(comment: MomentComment) {
    if (!moment) return;
    setCommentsError("");
    try {
      await apiFetch(`/moments/${moment.id}/comments/${comment.id}`, { method: "DELETE" });
      setComments((current) => removeCommentFromList(current, comment.id));
      setMoment((current) =>
        current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current,
      );
      if (editingComment?.id === comment.id) setEditingComment(null);
    } catch (requestError) {
      setCommentsError(
        requestError instanceof Error ? requestError.message : t("moments.deleteFailed"),
      );
    }
  }

  const composerContextLabel = editingComment
    ? t("moments.editingComment")
    : replyTo
      ? t("moments.replyTo", { name: replyTo.user.nickname ?? t("common.user") })
      : null;

  const composerPlaceholder = editingComment
    ? t("moments.editingComment")
    : replyTo
      ? t("moments.replyPlaceholder")
      : t("moments.commentPlaceholder");

  if (reportTarget) {
    return (
      <ReportSheet
        comment={reportTarget}
        onBack={() => setReportTarget(null)}
        onSubmitted={() => setReportTarget(null)}
      />
    );
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

              {/* 自己的动态：编辑 / 删除。web 的详情页也有这两个动作。 */}
              {moment.userId === currentUserId ? (
                <MomentOwnerActions
                  variant="row"
                  moment={moment}
                  onEdited={(updated) => setMoment({ ...moment, ...updated })}
                  onDeleted={onBack}
                />
              ) : null}

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
                {composerContextLabel ? (
                  <View style={styles.composerContext}>
                    <Text style={styles.composerContextText}>{composerContextLabel}</Text>
                    <Pressable
                      onPress={cancelComposerContext}
                      accessibilityRole="button"
                      accessibilityLabel={t("moments.cancel")}
                    >
                      <Icon name="close" size={16} color={colors.muted} />
                    </Pressable>
                  </View>
                ) : null}
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={composerPlaceholder}
                  placeholderTextColor={colors.muted}
                  style={styles.composerInput}
                  multiline
                  maxLength={500}
                  accessibilityLabel={composerPlaceholder}
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
            <CommentRow
              comment={item}
              t={t}
              currentUserId={currentUserId}
              onAuthorPress={() => setPreviewUserId(item.user.id)}
              onReply={beginReply}
              onEdit={beginEdit}
              onDelete={confirmDelete}
              onReport={setReportTarget}
            />
          )}
          ListEmptyComponent={null}
        />
      )}

      <ProfilePreview
        userId={previewUserId}
        onClose={() => setPreviewUserId(null)}
        onOpenMoments={(id) => {
          setPreviewUserId(null);
          setMomentsUserId(id);
        }}
      />
      <UserMomentsScreen userId={momentsUserId} onClose={() => setMomentsUserId(null)} />
    </View>
  );
}

/** 在顶层评论列表里插入一条回复。 */
function insertReply(list: MomentComment[], parentId: string, reply: MomentComment): MomentComment[] {
  return list.map((comment) =>
    comment.id === parentId
      ? { ...comment, replies: [...(comment.replies ?? []), reply] }
      : comment,
  );
}

/** 就地更新一条评论的内容（可能是顶层，也可能是某条的回复）。 */
function editCommentInList(list: MomentComment[], commentId: string, content: string): MomentComment[] {
  return list.map((comment) => {
    if (comment.id === commentId) return { ...comment, content };
    if (comment.replies?.some((reply) => reply.id === commentId)) {
      return {
        ...comment,
        replies: comment.replies.map((reply) =>
          reply.id === commentId ? { ...reply, content } : reply,
        ),
      };
    }
    return comment;
  });
}

/** 删除一条评论（顶层或回复）。 */
function removeCommentFromList(list: MomentComment[], commentId: string): MomentComment[] {
  return list
    .filter((comment) => comment.id !== commentId)
    .map((comment) => ({
      ...comment,
      replies: (comment.replies ?? []).filter((reply) => reply.id !== commentId),
    }));
}

/** 一条评论 + 它的一层回复。 */
function CommentRow({
  comment,
  t,
  currentUserId,
  onAuthorPress,
  onReply,
  onEdit,
  onDelete,
  onReport,
}: {
  comment: MomentComment;
  t: TranslateFn;
  currentUserId: string | undefined;
  onAuthorPress: () => void;
  onReply: (comment: MomentComment) => void;
  onEdit: (comment: MomentComment) => void;
  onDelete: (comment: MomentComment) => void;
  onReport: (comment: MomentComment) => void;
}) {
  const replies = comment.replies ?? [];
  const isMine = currentUserId === comment.user.id;
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
      <CommentActions
        t={t}
        isMine={isMine}
        onReply={() => onReply(comment)}
        onEdit={() => onEdit(comment)}
        onDelete={() => onDelete(comment)}
        onReport={() => onReport(comment)}
      />

      {replies.length > 0 ? (
        <View style={styles.replies}>
          {replies.map((reply) => {
            const replyIsMine = currentUserId === reply.user.id;
            return (
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
                <CommentActions
                  t={t}
                  isMine={replyIsMine}
                  onReply={() => onReply(reply)}
                  onEdit={() => onEdit(reply)}
                  onDelete={() => onDelete(reply)}
                  onReport={() => onReport(reply)}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** 一条评论/回复下面的小操作行：回复 · （编辑 · 删除，仅自己）· （举报，仅他人）。 */
function CommentActions({
  t,
  isMine,
  onReply,
  onEdit,
  onDelete,
  onReport,
}: {
  t: TranslateFn;
  isMine: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  return (
    <View style={styles.commentActions}>
      <ActionText label={t("moments.reply")} onPress={onReply} />
      {isMine ? <ActionText label={t("moments.edit")} onPress={onEdit} /> : null}
      {isMine ? <ActionText label={t("moments.delete")} onPress={onDelete} danger /> : null}
      {!isMine ? <ActionText label={t("moments.report")} onPress={onReport} danger /> : null}
    </View>
  );
}

function ActionText({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={styles.actionTextWrap}>
      <Text style={[styles.actionText, danger ? styles.actionTextDanger : null]}>{label}</Text>
    </Pressable>
  );
}

/** 举报评论的全屏面板。 */
function ReportSheet({
  comment,
  onBack,
  onSubmitted,
}: {
  comment: MomentComment;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!reason || sending) return;
    setSending(true);
    setError("");
    try {
      await apiFetch("/reports", {
        method: "POST",
        body: { commentId: comment.id, reason, description: description.trim() || undefined },
      });
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("moments.reportFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("moments.reportTitle")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.reportBody} keyboardShouldPersistTaps="handled">
        <Text style={styles.reportHint}>{t("moments.reportReason")}</Text>
        <View style={styles.reportReasonWrap}>
          {REPORT_REASONS.map((option) => {
            const active = reason === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setReason(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.reportChip, active ? styles.reportChipActive : null]}
              >
                {active ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
                <Text style={[styles.reportChipLabel, active ? styles.reportChipLabelActive : null]}>
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.reportHint}>{t("moments.reportDescription")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("moments.reportDescription")}
          placeholderTextColor={colors.muted}
          style={styles.reportInput}
          multiline
          maxLength={1000}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {sent ? <Text style={styles.okText}>{t("moments.reportSent")}</Text> : null}

        <View style={styles.reportActions}>
          {sending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Button
              label={t("moments.reportSubmit")}
              onPress={() => void submit()}
              disabled={!reason}
            />
          )}
        </View>

        {sent ? (
          <View style={styles.reportActions}>
            <Button label={t("common.close")} onPress={onSubmitted} variant="ghost" />
          </View>
        ) : null}
      </ScrollView>
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

      {moment.content ? (
        <>
          <Text style={styles.content}>{moment.content}</Text>
          <MomentTranslate momentId={moment.id} content={moment.content} />
        </>
      ) : null}

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

      {/* 语音动态（2026-10-24）：与视频/图片并行，最多一段录音。 */}
      {moment.audioUrl ? (
        <VoiceNote uri={moment.audioUrl} durationSec={moment.durationSec} />
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

  commentActions: { flexDirection: "row", gap: 14, paddingTop: 2 },
  actionTextWrap: { paddingVertical: 2 },
  actionText: { fontSize: 12, color: colors.muted, fontWeight: "500" },
  actionTextDanger: { color: colors.danger },

  composer: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  composerContext: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  composerContextText: { fontSize: 13, fontWeight: "600", color: colors.primary },
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
  okText: { fontSize: 13, color: colors.primary, textAlign: "center" },

  reportBody: { padding: 20, paddingBottom: 40, gap: 14 },
  reportHint: { fontSize: 13, fontWeight: "600", color: colors.muted },
  reportReasonWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reportChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  reportChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  reportChipLabel: { fontSize: 13, color: colors.ink },
  reportChipLabelActive: { color: colors.white, fontWeight: "600" },
  reportInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: "top",
  },
  reportActions: { marginTop: 4 },
});
