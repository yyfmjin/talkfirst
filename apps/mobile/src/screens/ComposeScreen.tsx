import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from "expo-audio";
import { VoiceNote } from "../components/VoiceNote";
import type { ManageableMoment } from "../components/MomentOwnerActions";
import { ApiRequestError, apiFetch, apiUploadMultipart } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { Icon } from "../components/Icon";
import { KeyboardAware } from "../components/KeyboardAware";
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
/** 语音：服务端 4MB 原始上限（apps/api/src/uploads/uploads.service.ts 的 MAX_AUDIO_BYTES）。 */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
/** 一条语音最长 3 分钟：再长就不是「动态」而是播客，且 3 分钟 AAC 约 1.5MB，离上限还远。 */
const MAX_AUDIO_SECONDS = 180;
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

/** 语音动态：录完立即上传，发布时带服务端返回的 url。 */
type PendingAudio = {
  uri: string;
  remoteUrl: string | null;
  uploading: boolean;
  failed: boolean;
};

let nextImageId = 1;

export function ComposeScreen({
  onPublished,
  onCancel,
  editMoment,
}: {
  /** 发布 / 保存成功：调用方负责回到列表并刷新（以服务端返回为准，不在本地猜）。 */
  onPublished: () => void;
  onCancel: () => void;
  /** 传了就是**编辑态**（`PATCH /moments/:id` 而不是新建），初始值来自这条动态。 */
  editMoment?: ManageableMoment | null;
}) {
  const { t } = useI18n();
  const editing = Boolean(editMoment);
  const [content, setContent] = useState(editMoment?.content ?? "");
  /*
   * 已有媒体直接进「已上传」状态：`remoteUrl` 就是服务端地址，uploading/failed 为假，
   * 于是 `canPublish` 那套门禁不需要为编辑态开洞。
   */
  const [images, setImages] = useState<PendingImage[]>(() =>
    (editMoment?.images ?? []).map((url, index) => ({
      id: `existing-${index}`,
      localUri: url,
      remoteUrl: url,
      uploading: false,
      failed: false,
    })),
  );
  const [video, setVideo] = useState<PendingVideo | null>(() =>
    editMoment?.videoUrl
      ? {
          id: "existing-video",
          localUri: editMoment.videoUrl,
          name: "",
          durationMs: editMoment.durationSec != null ? editMoment.durationSec * 1000 : null,
          remoteUrl: editMoment.videoUrl,
          uploading: false,
          failed: false,
        }
      : null,
  );
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  /** 看大图：点缩略图打开，null 表示关闭。 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  /**
   * 语音动态（2026-10-24）。
   * 录音只用于「发动态」：录完立即转 base64 上传，发布时只带服务端返回的 url。
   * 上限 3 分钟、4MB —— 与服务端 MAX_AUDIO_BYTES 对齐。
   */
  const [audio, setAudio] = useState<PendingAudio | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const trimmed = content.trim();
  const allImagesReady = images.every((img) => img.remoteUrl && !img.uploading && !img.failed);
  const videoReady = video === null || (video.remoteUrl != null && !video.uploading && !video.failed);
  const audioReady =
    audio === null || (audio.remoteUrl !== null && !audio.uploading && !audio.failed);
  const canPublish =
    (trimmed.length > 0 || images.length > 0 || video !== null || audio !== null) &&
    !publishing &&
    allImagesReady &&
    videoReady &&
    audioReady;

  async function startRecording() {
    if (recording || audio || publishing) return;
    setError("");
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError(t("compose.micDenied"));
      return;
    }
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      // 到点自动停，避免忘关麦把整段会话录进去
      setTimeout(() => {
        void stopRecording();
      }, MAX_AUDIO_SECONDS * 1000);
    } catch {
      setError(t("compose.recordFailed"));
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
    } catch {
      // 停不下来也不应该卡住界面：下面按 uri 是否可读决定后续
    }
    const uri = recorder.uri;
    if (!uri) return;
    setAudio({ uri, remoteUrl: null, uploading: true, failed: false });
    void uploadAudio(uri);
  }

  async function uploadAudio(uri: string) {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64.length * 0.75 > MAX_AUDIO_BYTES) {
        throw new Error("AUDIO_TOO_LARGE");
      }
      const uploaded = await apiFetch<{ url: string }>("/uploads/moment-media", {
        method: "POST",
        body: { media: `data:audio/m4a;base64,${base64}` },
      });
      setAudio((previous) =>
        previous && previous.uri === uri
          ? { ...previous, remoteUrl: uploaded.url, uploading: false }
          : previous,
      );
    } catch (uploadError) {
      setAudio((previous) =>
        previous && previous.uri === uri
          ? { ...previous, uploading: false, failed: true }
          : previous,
      );
      setError(
        uploadError instanceof Error && uploadError.message === "AUDIO_TOO_LARGE"
          ? t("compose.audioTooLarge")
          : t("compose.audioUploadError"),
      );
    }
  }

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
      await apiFetch(editing && editMoment ? `/moments/${editMoment.id}` : "/moments", {
        method: editing ? "PATCH" : "POST",
        body: {
          content: trimmed,
          images: images.map((img) => img.remoteUrl as string),
          /*
           * 编辑时**显式**带 `videoUrl`（没视频就是空串）：服务端把 `""` 认作
           * 「删掉视频」，不传则是「保持不变」—— 与 web 的 `moment-edit-dialog` 同一约定。
           * 新建时不传空字段，与原来的行为一致。
           */
          ...(editing
            ? { videoUrl: video?.remoteUrl ?? "", audioUrl: audio?.remoteUrl ?? "" }
            : {
                ...(video?.remoteUrl ? { videoUrl: video.remoteUrl } : {}),
                ...(audio?.remoteUrl ? { audioUrl: audio.remoteUrl } : {}),
              }),
        },
      });
      onPublished();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : editing
            ? t("compose.errorSave")
            : t("compose.errorPublish"),
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <KeyboardAware style={styles.root} iosOffset={8}>
      <View style={styles.head}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("compose.cancel")}
          style={styles.headButton}
        >
          <Text style={styles.cancel}>{t("compose.cancel")}</Text>
        </Pressable>
        <Text style={styles.title}>{editing ? t("compose.editTitle") : t("compose.title")}</Text>
        <Pressable
          onPress={() => void publish()}
          disabled={!canPublish}
          accessibilityRole="button"
          accessibilityLabel={editing ? t("common.save") : t("compose.publish")}
          accessibilityState={{ disabled: !canPublish }}
          style={[styles.publish, canPublish ? null : styles.publishDisabled]}
        >
          {publishing ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.publishLabel}>
              {editing ? t("common.save") : t("compose.publish")}
            </Text>
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
              <Pressable
                onPress={() => setPreviewIndex(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel={t("compose.imagePreviewLabel", { n: index + 1 })}
                style={StyleSheet.absoluteFill}
              >
                <Image source={{ uri: img.localUri }} style={styles.imageThumb} />
              </Pressable>
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

        {/* 语音动态：最多一条，录完立即上传。 */}
        <View style={styles.audioRow}>
          {audio ? (
            <View style={styles.audioBox}>
              <VoiceNote uri={audio.remoteUrl ?? audio.uri} />
              {audio.uploading ? (
                <Text style={styles.audioHint}>{t("compose.audioUploading")}</Text>
              ) : null}
              {audio.failed ? (
                <Text style={styles.audioError}>{t("compose.audioUploadError")}</Text>
              ) : null}
              <Pressable
                onPress={() => setAudio(null)}
                accessibilityRole="button"
                accessibilityLabel={t("compose.audioRemove")}
                style={styles.audioRemove}
              >
                <Text style={styles.audioRemoveMark}>✕</Text>
              </Pressable>
            </View>
          ) : recording ? (
            <Pressable
              onPress={() => void stopRecording()}
              accessibilityRole="button"
              accessibilityLabel={t("compose.audioStop")}
              style={styles.recordStop}
            >
              <View style={styles.recordDot} />
              <Text style={styles.recordStopText}>{t("compose.audioStop")}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void startRecording()}
              accessibilityRole="button"
              accessibilityLabel={t("compose.addAudio")}
              style={styles.addTile}
            >
              <Icon name="mic" size={22} color={colors.primary} />
              <Text style={styles.addTileLabel}>{t("compose.addAudio")}</Text>
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

      {/*
       * 点缩略图看大图（2026-10-24 用户反馈「点图片没反应」）。
       * 只做三件事：看、设为第一张（封面）、删除 —— 裁剪/滤镜属于另一条产品线，
       * 放到这里会变成一个半成品编辑器。
       */}
      <Modal
        visible={previewIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewIndex(null)}
      >
        <View style={styles.previewBackdrop}>
          <Pressable
            onPress={() => setPreviewIndex(null)}
            accessibilityRole="button"
            accessibilityLabel={t("compose.imagePreviewClose")}
            style={styles.previewCloseButton}
          >
            <Text style={styles.previewCloseMark}>✕</Text>
          </Pressable>

          {previewIndex !== null && images[previewIndex] ? (
            <Image
              source={{ uri: images[previewIndex].localUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : null}

          <View style={styles.previewBar}>
            <Pressable
              onPress={() => {
                if (previewIndex === null) return;
                setImages((previous) => {
                  if (previewIndex === 0) return previous;
                  const next = [...previous];
                  const [picked] = next.splice(previewIndex, 1);
                  next.unshift(picked);
                  return next;
                });
                setPreviewIndex(0);
              }}
              accessibilityRole="button"
              style={[styles.previewAction, previewIndex === 0 ? styles.previewActionDisabled : null]}
              disabled={previewIndex === 0}
            >
              <Text style={styles.previewActionText}>{t("compose.imageMakeCover")}</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                if (previewIndex === null) return;
                removeImage(images[previewIndex].id);
                setPreviewIndex(null);
              }}
              accessibilityRole="button"
              style={styles.previewAction}
            >
              <Text style={[styles.previewActionText, styles.previewDanger]}>
                {t("compose.imageRemove")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAware>
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
  audioRow: { paddingHorizontal: 18, paddingBottom: 12 },
  audioBox: { position: "relative" },
  audioHint: { marginTop: 6, fontSize: 12, color: colors.muted },
  audioError: { marginTop: 6, fontSize: 12, color: colors.danger },
  audioRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
  audioRemoveMark: { fontSize: 12, color: colors.white },
  recordStop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#FDE8E8",
  },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  recordStopText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12, 14, 24, 0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "78%" },
  previewCloseButton: {
    position: "absolute",
    top: 48,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    zIndex: 2,
  },
  previewCloseMark: { fontSize: 18, color: colors.white },
  previewBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 40,
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  previewAction: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
  },
  previewActionDisabled: { opacity: 0.4 },
  previewActionText: { fontSize: 14, fontWeight: "600", color: colors.white },
  previewDanger: { color: "#FF8A8A" },
});
