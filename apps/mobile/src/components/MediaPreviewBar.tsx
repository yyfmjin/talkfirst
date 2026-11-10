import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useI18n } from "../lib/i18n-context";
import { colors, themed } from "../theme";
import { radii, sizes } from "../design/tokens";

/** 选好但还没发出去的一项媒体。图片在发送时压缩，视频由服务端转码。 */
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
 * 发送前的媒体预览（贴在输入栏上方），一次可以多选。
 *
 * ## 为什么从「一张」改成一排
 *
 * 之前选完一张就直接上传，选三张要点三次「+」，选错了只能等它发出去再撤回。
 * 成熟的 IM 都是：相册里多选 → 一排缩略图 → 一次发出去。这里沿用同一个心智：
 *
 *   - 每张右上角有 ✕，可以只去掉其中一张，不用整批取消；
 *   - 上传是逐张串行（服务端一次一条消息），所以显示「正在发送 3 / 9」，
 *     比一根算不出进度的进度条诚实。
 *
 * ## 为什么放在输入栏上方而不是弹窗
 *
 * 选完图之后用户往往还想补一句话。预览条贴着输入框上沿，输入框仍然可点，
 * 两边不抢焦点；弹窗会把输入框整个盖住。
 */
export function MediaPreviewBar({
  items,
  uploading,
  sendIndex,
  onRemove,
  onCancel,
  onSend,
}: {
  items: PendingMedia[];
  uploading: boolean;
  /** 正在发送第几张（从 1 开始）；没在发就是 0。 */
  sendIndex?: number;
  onRemove: (index: number) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  if (items.length === 0) return null;

  const totalBytes = items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  const summary = [t("messages.previewCount", { n: items.length }), formatSize(totalBytes)]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {items.map((media, index) => (
          <View key={`${media.uri}-${index}`} style={styles.thumbWrap}>
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
            {uploading ? null : (
              <Pressable
                onPress={() => onRemove(index)}
                accessibilityRole="button"
                accessibilityLabel={t("messages.previewRemove")}
                hitSlop={8}
                style={styles.removeBadge}
              >
                <Icon name="close" size={12} color={colors.white} />
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerText}>
          <Text style={styles.title} numberOfLines={1}>
            {uploading
              ? t("messages.previewUploadingCount", { i: sendIndex || 1, n: items.length })
              : summary}
          </Text>
          <Text style={styles.hint} numberOfLines={1}>
            {items.length > 1
              ? t("messages.previewMultiHint")
              : items[0].kind === "image"
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
    </View>
  );
}

const styles = themed((c) => StyleSheet.create({
  bar: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: radii.control,
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
    gap: 8,
  },
  track: { flexDirection: "row", gap: 8 },
  thumbWrap: { width: 56, height: 56 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: c.bgTint },
  videoThumb: {
    backgroundColor: "#0F1A2B",
    alignItems: "center",
    justifyContent: "center",
  },
  videoDuration: {
    position: "absolute",
    bottom: 3,
    right: 4,
    fontSize: 9,
    color: c.white,
    fontVariant: ["tabular-nums"],
  },
  removeBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(15,26,43,0.86)",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { flexDirection: "row", alignItems: "center", gap: 10 },
  footerText: { flex: 1, gap: 2 },
  title: { fontSize: sizes.ui, fontWeight: "600", color: c.ink },
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
