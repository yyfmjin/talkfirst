import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { SubHeader } from "../components/SubHeader";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";
import { radii, sizes } from "../design/tokens";

/**
 * 树洞（2026-11-12）—— 匿名吐槽板。
 *
 * 匿名是服务端保证的：接口只回 `alias`（「树友·A3F2」），不回 userId。
 * 所以这个界面**不做任何身份相关的事**：没有头像、没有昵称、没有「我的帖子」
 * —— 一旦这里出现「你发的」，匿名就只是嘴上说说。
 */

type Post = {
  id: string;
  alias: string;
  content: string;
  commentCount: number;
  createdAt: string;
};

type Comment = { id: string; alias: string; content: string; createdAt: string };

function timeAgo(iso: string, t: (key: "treeHole.justNow" | "treeHole.minutesAgo" | "treeHole.hoursAgo" | "treeHole.daysAgo", params?: { n: number }) => string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("treeHole.justNow");
  if (minutes < 60) return t("treeHole.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("treeHole.hoursAgo", { n: hours });
  return t("treeHole.daysAgo", { n: Math.floor(hours / 24) });
}

export function TreeHoleScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  /** 打开某条帖子时进详情；null = 列表。 */
  const [opened, setOpened] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commenting, setCommenting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await apiFetch<{ items: Post[] }>("/tree-hole/posts?limit=30");
      setPosts(data.items);
    } catch {
      setError(t("treeHole.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    const content = draft.trim();
    if (!content || posting) return;
    setPosting(true);
    setError("");
    try {
      await apiFetch("/tree-hole/posts", { method: "POST", body: { content } });
      setDraft("");
      await load();
    } catch {
      setError(t("treeHole.postFailed"));
    } finally {
      setPosting(false);
    }
  }

  async function openComments(post: Post) {
    setOpened(post);
    setComments([]);
    setCommentsLoading(true);
    setError("");
    try {
      const data = await apiFetch<{ items: Comment[] }>(`/tree-hole/posts/${post.id}/comments`);
      setComments(data.items);
    } catch {
      setError(t("treeHole.loadFailed"));
    } finally {
      setCommentsLoading(false);
    }
  }

  async function sendComment() {
    const content = commentDraft.trim();
    if (!content || !opened || commenting) return;
    setCommenting(true);
    setError("");
    try {
      const created = await apiFetch<Comment>(`/tree-hole/posts/${opened.id}/comments`, {
        method: "POST",
        body: { content },
      });
      setComments((current) => [...current, created]);
      setCommentDraft("");
      setPosts((current) =>
        current.map((item) =>
          item.id === opened.id ? { ...item, commentCount: item.commentCount + 1 } : item,
        ),
      );
    } catch {
      setError(t("treeHole.commentFailed"));
    } finally {
      setCommenting(false);
    }
  }

  if (opened) {
    return (
      <View style={styles.root}>
        <SubHeader title={t("treeHole.title")} onBack={() => setOpened(null)} />
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.alias}>{opened.alias}</Text>
            <Text style={styles.content}>{opened.content}</Text>
          </View>
          {commentsLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.commentHead}>
                <Text style={styles.commentAlias}>{comment.alias}</Text>
                <Text style={styles.meta}>{timeAgo(comment.createdAt, t)}</Text>
              </View>
              <Text style={styles.commentBody}>{comment.content}</Text>
            </View>
          ))}
          {!commentsLoading && comments.length === 0 ? (
            <Text style={styles.empty}>{t("treeHole.noComments")}</Text>
          ) : null}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            value={commentDraft}
            onChangeText={setCommentDraft}
            placeholder={t("treeHole.commentPlaceholder")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={300}
            multiline
          />
          <Button
            label={commenting ? t("treeHole.sending") : t("treeHole.send")}
            onPress={() => void sendComment()}
            disabled={commenting || !commentDraft.trim()}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("treeHole.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t("treeHole.hint")}</Text>

        <View style={styles.card}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t("treeHole.postPlaceholder")}
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={500}
            multiline
          />
          <Button
            label={posting ? t("treeHole.posting") : t("treeHole.post")}
            onPress={() => void publish()}
            disabled={posting || !draft.trim()}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && posts.length === 0 ? <Text style={styles.empty}>{t("treeHole.empty")}</Text> : null}

        {posts.map((post) => (
          <Pressable
            key={post.id}
            onPress={() => void openComments(post)}
            accessibilityRole="button"
            style={styles.card}
          >
            <View style={styles.commentHead}>
              <Text style={styles.alias}>{post.alias}</Text>
              <Text style={styles.meta}>{timeAgo(post.createdAt, t)}</Text>
            </View>
            <Text style={styles.content}>{post.content}</Text>
            <Text style={styles.count}>{t("treeHole.commentCount", { n: post.commentCount })}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  hint: { fontSize: sizes.caption, lineHeight: 18, color: colors.muted },
  card: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.control,
    padding: 14,
    gap: 8,
  },
  commentHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  alias: { fontSize: sizes.ui, fontWeight: "600", color: colors.primary },
  commentAlias: { fontSize: sizes.caption, fontWeight: "600", color: colors.muted },
  meta: { fontSize: sizes.caption, color: colors.muted },
  content: { fontSize: sizes.body, lineHeight: 22, color: colors.ink },
  count: { fontSize: sizes.caption, color: colors.muted },
  comment: {
    borderLeftWidth: 2,
    borderLeftColor: colors.line,
    paddingLeft: 10,
    gap: 4,
  },
  commentBody: { fontSize: sizes.ui, lineHeight: 20, color: colors.ink },
  composer: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.line },
  input: {
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    backgroundColor: colors.glassSunken,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: sizes.body,
    color: colors.ink,
  },
  empty: { fontSize: sizes.ui, color: colors.muted, textAlign: "center", marginTop: 12 },
  error: { fontSize: sizes.caption, color: colors.danger, paddingHorizontal: 16, paddingBottom: 8 },
});
