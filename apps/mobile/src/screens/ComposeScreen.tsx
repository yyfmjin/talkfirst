import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";

/**
 * 发动态（2026-10-08）—— 对齐 web 的 `/moments/compose`。
 *
 * ## 为什么先做文字
 *
 * App 之前**只能看、不能发**：动态流、消息都有了，但产品最核心的动作（发一条动态）
 * 完全没有入口 —— 对社交产品来说这不是"少个功能"，是闭环断了。
 *
 * 图片要相册权限、要上传、要处理失败与进度，是一整块独立工作（web 端有自己的上传链路）；
 * 这一版先只做文字，把闭环接上，媒体放到下一批，并在界面上**明说**这一点 ——
 * 让人以为"图片是坏的"比暂时没有图片更糟。
 *
 * ## 服务端契约（apps/api/src/moments/moments.controller.ts 的 ComposeDto）
 *
 * `POST /moments`，`content` 必填且 `@MaxLength(2000)`；`images` 最多 9 张、`tags` 最多 10 个。
 * 客户端先按 2000 字拦一次，省一趟注定 400 的往返；服务端仍然是权威。
 */
const CONTENT_MAX_LENGTH = 2000;

export function ComposeScreen({
  onPublished,
  onCancel,
}: {
  /** 发布成功：调用方负责回到列表并刷新（新动态以服务端返回为准，不在本地猜）。 */
  onPublished: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const trimmed = content.trim();
  const canPublish = trimmed.length > 0 && !publishing;

  async function publish() {
    if (!canPublish) return;
    setPublishing(true);
    setError("");
    try {
      await apiFetch("/moments", { method: "POST", body: { content: trimmed } });
      onPublished();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("compose.errorPublish"));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      <View style={styles.head}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("compose.cancel")}
          style={styles.headButton}
        >
          <Text style={styles.cancel}>{t("compose.cancel")}</Text>
        </Pressable>
        <Text style={styles.title}>{t("compose.title")}</Text>
        <Pressable
          onPress={() => void publish()}
          disabled={!canPublish}
          accessibilityRole="button"
          accessibilityLabel={t("compose.publish")}
          accessibilityState={{ disabled: !canPublish }}
          style={[styles.publish, canPublish ? null : styles.publishDisabled]}
        >
          {publishing ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.publishLabel}>{t("compose.publish")}</Text>
          )}
        </Pressable>
      </View>

      <TextInput
        value={content}
        onChangeText={setContent}
        placeholder={t("compose.placeholder")}
        placeholderTextColor={colors.muted}
        style={styles.input}
        multiline
        autoFocus
        maxLength={CONTENT_MAX_LENGTH}
        accessibilityLabel={t("compose.placeholder")}
      />

      <View style={styles.footer}>
        {/* 媒体这一版明确不做，先说清楚，别让人以为图片坏了。 */}
        <Text style={styles.note}>{t("compose.mediaNote")}</Text>
        <Text style={styles.counter}>
          {content.length}/{CONTENT_MAX_LENGTH}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    // 顶部安全区已由 App.tsx 的 SafeAreaView 统一留白（2026-10-09），
    // 这里再写 54 就会在状态栏下面空出一大块。
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headButton: { minWidth: 64, paddingVertical: 6 },
  cancel: { fontSize: 15, color: colors.muted },
  title: { fontSize: 17, fontWeight: "600", color: colors.ink },
  publish: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  publishDisabled: { opacity: 0.45 },
  publishLabel: { fontSize: 14, fontWeight: "600", color: colors.white },
  input: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    textAlignVertical: "top",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  note: { flex: 1, fontSize: 12, color: colors.muted },
  counter: { fontSize: 12, color: colors.muted },
  error: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 60,
    fontSize: 13,
    color: colors.danger,
    textAlign: "center",
  },
});
