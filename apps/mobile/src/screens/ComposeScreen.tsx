import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ApiRequestError, apiFetch, apiUploadMultipart } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { Icon } from "../components/Icon";
import { colors } from "../theme";

/**
 * 发动态（2026-10-08 起）—— 对齐 web 的 `/moments/compose`。
 *
 * ## 阶段②：图片
 *
 * 选图走 expo-image-picker 的系统相册（Android 13+ 是系统 Photo Picker，
 * 不需要相册权限）；选完立即转 base64 data URL 上传 `POST /uploads/moment-media`
 * （服务端 body 上限 7MB 字符串、文件上限 5MB，客户端先按 5MB 拦一次），
 * 拿到 `{ url }` 存进本地列表；发布时 `POST /moments` 带 `images`（≤9 张）。
 *
 * ## 阶段③：视频
 *
 * 一个动态最多一个视频：选完用 multipart 上传 `POST /uploads/moment-video`
 * （字段名 `file`，见服务端 `video-upload.interceptor.ts` 的 `MOMENT_VIDEO_FIELD`），
 * 服务端回 `{ url }`；发布时带 `videoUrl`。播放走 expo-video，见 MomentsScreen。
 * 上传请求超时 10 分钟：响应要等服务端转码完才回（最长 5 分钟）。
 *
 * ## 服务端契约（apps/api/src/moments/moments.controller.ts 的 ComposeDto）
 *
 * `content` 必填且 `@MaxLength(2000)`；`images` 最多 9 张、`tags` 最多 10 个。
 * 客户端先按 2000 字拦一次，省一趟注定 400 的往返；服务端仍然是权威。
 */

const CONTENT_MAX_LENGTH = 2000;
const MAX_IMAGES = 9;
/** 服务端单张上限 5MB（moment-media 的 7_000_000 是 base64 字符串长度）。 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 服务端 multipart 上限 90MB（apps/api/src/uploads/video-upload.config.ts）。 */
const MAX_VIDEO_UPLOAD_BYTES = 90 * 1024 * 1024;
/** 服务端白名单（同 config 的 ALLOWED_VIDEO_MIME）与扩展名。 */
const ALLOWED_VIDEO_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

/** 一张已选图片：选完立刻上传，发布时只带服务端返回的 url。 */
type PendingImage = {
  id: string;
  localUri: string;
  remoteUrl: string | null;
  uploading: boolean;
  failed: boolean;
};

/** 一条动态最多一个视频（web 同样只允许一个）。 */
type PendingVideo = {
  id: string;
  localUri: string;
  name: string;
  durationMs: number | null;
  remoteUrl: string | null;
  uploading: boolean;
  failed: boolean;
};

let nextImageId = 1;

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
  const [images, setImages] = useState<PendingImage[]>([]);
  const [video, setVideo] = useState<PendingVideo | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");

  const trimmed = content.trim();
  const allImagesReady = images.every((img) => img.remoteUrl && !img.uploading && !img.failed);
  const videoReady = video === null || (video.remoteUrl != null && !video.uploading && !video.failed);
  const canPublish = trimmed.length > 0 && !publishing && allImagesReady && videoReady;

  /** 选一张 → 立刻转 data URL 上传。一次选一张：多选 + base64 在旧 Android 上不可靠。 */
  async function pickImage() {
    if (images.length >= MAX_IMAGES || publishing) return;
    setError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (asset.fileSize != null && asset.fileSize > MAX_IMAGE_BYTES) {
        setError(t("compose.imageTooLarge"));
        return;
      }
      if (!asset.base64) {
        setError(t("compose.imagePickError"));
        return;
      }
      const id = `img-${nextImageId++}`;
      const dataUrl = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
      setImages((previous) => [
        ...previous,
        { id, localUri: asset.uri, remoteUrl: null, uploading: true, failed: false },
      ]);
      try {
        const uploaded = await apiFetch<{ url: string }>("/uploads/moment-media", {
          method: "POST",
          body: { media: dataUrl },
        });
        setImages((previous) =>
          previous.map((img) =>
            img.id === id ? { ...img, remoteUrl: uploaded.url, uploading: false } : img,
          ),
        );
      } catch (uploadError) {
        setImages((previous) =>
          previous.map((img) => (img.id === id ? { ...img, uploading: false, failed: true } : img)),
        );
        setError(
          uploadError instanceof ApiRequestError && uploadError.code === "MEDIA_TOO_LARGE"
            ? t("compose.imageTooLarge")
            : t("compose.imageUploadError"),
        );
      }
    } catch {
      setError(t("compose.imagePickError"));
    }
  }

  function removeImage(id: string) {
    setImages((previous) => previous.filter((img) => img.id !== id));
    setError("");
  }

  /** 选一个视频 → 立刻 multipart 上传（字段名 `file`）。 */
  async function pickVideo() {
    if (video !== null || publishing) return;
    setError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"] });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (asset.fileSize != null && asset.fileSize > MAX_VIDEO_UPLOAD_BYTES) {
        setError(t("compose.videoTooLarge"));
        return;
      }
      const mime = asset.mimeType ?? "video/mp4";
      const extension = ALLOWED_VIDEO_MIME[mime];
      if (!extension) {
        setError(t("compose.videoTypeUnsupported"));
        return;
      }
      const name = asset.fileName ?? `video.${extension}`;
      const id = `video-${nextImageId++}`;
      setVideo({
        id,
        localUri: asset.uri,
        name,
        durationMs: asset.duration ?? null,
        remoteUrl: null,
        uploading: true,
        failed: false,
      });
      try {
        const form = new FormData();
        form.append("file", { uri: asset.uri, name, type: mime } as unknown as Blob);
        const uploaded = await apiUploadMultipart<{ url: string }>("/uploads/moment-video", form);
        setVideo((previous) =>
          previous && previous.id === id ? { ...previous, remoteUrl: uploaded.url, uploading: false } : previous,
        );
      } catch (uploadError) {
        setVideo((previous) =>
          previous && previous.id === id ? { ...previous, uploading: false, failed: true } : previous,
        );
        setError(
          uploadError instanceof ApiRequestError && uploadError.code === "FILE_TOO_LARGE"
            ? t("compose.videoTooLarge")
            : t("compose.videoUploadError"),
        );
      }
    } catch {
      setError(t("compose.videoPickError"));
    }
  }

  function removeVideo() {
    setVideo(null);
    setError("");
  }

  async function publish() {
    if (!canPublish) return;
    setPublishing(true);
    setError("");
    try {
      await apiFetch("/moments", {
        method: "POST",
        body: {
          content: trimmed,
          images: images.map((img) => img.remoteUrl as string),
          ...(video?.remoteUrl ? { videoUrl: video.remoteUrl } : {}),
        },
      });
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

      <View style={styles.editor}>
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

        {/* 已选图片：缩略图 + 右上角删除；上传中盖一个转圈，失败标一个叹号。 */}
        <View style={styles.imageGrid}>
          {images.map((img, index) => (
            <View key={img.id} style={styles.imageTile}>
              <Image source={{ uri: img.localUri }} style={styles.imageThumb} />
              {img.uploading ? (
                <View style={styles.imageOverlay}>
                  <ActivityIndicator color={colors.white} size="small" />
                </View>
              ) : null}
              {img.failed ? (
                <View style={styles.imageOverlay}>
                  <Text style={styles.imageFailedMark}>!</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => removeImage(img.id)}
                accessibilityRole="button"
                accessibilityLabel={t("compose.imageRemoveLabel", { n: index + 1 })}
                style={styles.imageRemove}
              >
                <Text style={styles.imageRemoveMark}>✕</Text>
              </Pressable>
            </View>
          ))}
          {images.length < MAX_IMAGES ? (
            <Pressable
              onPress={() => void pickImage()}
              accessibilityRole="button"
              accessibilityLabel={t("compose.addImages")}
              style={styles.addTile}
            >
              <Text style={styles.addTileMark}>＋</Text>
              <Text style={styles.addTileLabel}>
                {images.length}/{MAX_IMAGES}
              </Text>
            </Pressable>
          ) : null}

          {video ? (
            <View key={video.id} style={styles.videoTile}>
              <View style={styles.videoThumb}>
                <Icon name="play-circle" size={30} color={colors.primary} />
                <Text style={styles.videoName} numberOfLines={1}>
                  {video.name}
                </Text>
                {video.durationMs != null ? (
                  <Text style={styles.videoDuration}>
                    {t("compose.videoDuration", { s: Math.max(1, Math.round(video.durationMs / 1000)) })}
                  </Text>
                ) : null}
              </View>
              {video.uploading ? (
                <View style={styles.imageOverlay}>
                  <ActivityIndicator color={colors.white} size="small" />
                </View>
              ) : null}
              {video.failed ? (
                <View style={styles.imageOverlay}>
                  <Text style={styles.imageFailedMark}>!</Text>
                </View>
              ) : null}
              <Pressable
                onPress={removeVideo}
                accessibilityRole="button"
                accessibilityLabel={t("compose.videoRemoveLabel")}
                style={styles.imageRemove}
              >
                <Text style={styles.imageRemoveMark}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => void pickVideo()}
              accessibilityRole="button"
              accessibilityLabel={t("compose.addVideo")}
              style={styles.addTile}
            >
              <Icon name="play" size={22} color={colors.primary} />
              <Text style={styles.addTileLabel}>{t("compose.addVideo")}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.note}>
          {t("compose.mediaNote")} · {t("compose.imageCountHint")}
        </Text>
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
  editor: { flex: 1 },
  input: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    textAlignVertical: "top",
  },
  imageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  imageTile: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    overflow: "hidden",
  },
  imageThumb: { width: "100%", height: "100%" },
  imageOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(11,11,20,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageFailedMark: { color: colors.white, fontSize: 22, fontWeight: "700" },
  imageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(11,11,20,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageRemoveMark: { color: colors.white, fontSize: 12 },
  addTile: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  addTileMark: { fontSize: 22, color: colors.primary, lineHeight: 24 },
  addTileLabel: { fontSize: 11, color: colors.muted },
  videoTile: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    overflow: "hidden",
  },
  videoThumb: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, padding: 6 },
  videoName: { fontSize: 10, color: colors.muted, textAlign: "center" },
  videoDuration: { fontSize: 10, color: colors.muted },
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
