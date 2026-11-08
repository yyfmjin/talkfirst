import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n-context";
import { colors, themed } from "../theme";
import { radii, sizes } from "../design/tokens";

/** 选好但还没发出去的媒体。图片会在发送时压缩，视频由服务端转码。 */
export type PendingMedia = {
  kind: "image" | "video";
  uri: string;
  width: number;
  height: number;
  /** 字节。安卓上不一定给，给了就显示。 */
  sizeBytes?: number;
  /** 视频时长（秒）。 */
  durationSec?: number;
};

/** 人类可读的体积：1.2 MB / 840 KB。拿不到就返回空串，不显示占位。 */
function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 发送前的媒体预览条（贴在输入栏上方）。
 *
 * ## 解决什么
 *
 * 以前选完图就直接上传：用户没有「确认」这一步，选错了只能等它发出去再撤回；
 * 上传期间只知道按钮在转圈，不知道在传什么、多大、要多久。成熟的 IM 都会先
 * 给一张缩略图 + 体积 + 明确的「发送 / 取消」。
 *
 * ## 为什么放在输入栏上方而不是弹窗
 *
 * 选完图之后用户往往还想补一句话。预览条贴在输入框上沿，输入框仍然可点，
 * 两边不抢焦点；弹窗会把输入框整个盖住。
 */
export function MediaPreviewBar({
  media,
  uploading,
  onCancel,
  onSend,
}: {
  media: PendingMedia;
  uploading: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  const meta = [formatSize(media.sizeBytes), formatDuration(media.durationSec)].filter(Boolean).join(" · ");

  return (
    <View style={styles.bar}>
      <View style={styles.thumbWrap}>
        {media.kind === "image" ? (
          <Image source={{ uri: media.uri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.videoThumb]}>
            <Icon name="play" size={18} color={colors.white} />
            {formatDuration(media.durationSec) ? (
              <Text style={styles.videoDuration}>{formatDuration(media.durationSec)}</Text>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {media.kind === "image" ? t("messages.previewImage") : t("messages.previewVideo")}
          {meta ? <Text style={styles.meta}>{`  ${meta}`}</Text> : null}
        </Text>
        <Text style={styles.hint} numberOfLines={1}>
          {uploading
            ? t("messages.previewUploading")
            : media.kind === "image"
              ? t("messages.previewImageHint")
              : t("messages.previewVideoHint")}
        </Text>
      </View>

      <Pressable
        onPress={onCancel}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={t("common.cancel")}
        hitSlop={8}
        style={styles.cancel}
      >
        <Icon name="close" size={18} color={colors.muted} />
      </Pressable>

      <Pressable
        onPress={onSend}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={t("messages.send")}
        style={[styles.send, uploading ? styles.sendDisabled : null]}
      >
        {uploading ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Icon name="arrow-up" size={18} color={colors.white} />
        )}
      </Pressable>
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: radii.control,
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
  },
  thumbWrap: { borderRadius: 12, overflow: "hidden" },
  thumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: c.bgTint },
  videoThumb: {
    backgroundColor: "#0F1A2B",
    alignItems: "center",
    justifyContent: "center",
  },
  videoDuration: {
    position: "absolute",
    bottom: 4,
    right: 6,
    fontSize: 10,
    color: c.white,
    fontVariant: ["tabular-nums"],
  },
  body: { flex: 1, gap: 3 },
  title: { fontSize: sizes.ui, fontWeight: "600", color: c.ink },
  meta: { fontSize: sizes.caption, fontWeight: "400", color: c.muted },
  hint: { fontSize: sizes.caption, color: c.muted },
  cancel: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.6 },
}));
