import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./Icon";
import { ModalScrim } from "./ModalScrim";
import { useI18n } from "../lib/i18n-context";
import { colors, themed } from "../theme";
import { radii, sizes } from "../design/tokens";

/**
 * 聊天里的「+」→ 底部选择面板。
 *
 * ## 为什么不再用 Alert.alert
 *
 * 之前点「+」弹的是系统 Alert：两行纯文字、没有图标、按钮位置由系统决定，
 * 和 App 里其他弹层完全不是一个语言；而且在 Android 上点外面关闭后，
 * 再来一次还要重新读一遍两个动词。成熟的 IM（微信 / Telegram / iMessage）
 * 在这里都是**带图标的底部面板** —— 眼睛先认图标，手再落下去。
 *
 * ## 为什么是两张卡片而不是四个
 *
 * 相机权限在本项目里是主动关闭的（`app.json` 的 `blockedPermissions`），
 * 所以「拍照 / 录像」放上来只会点了报错。这里只留真正能用的两条：
 * 相册照片、相册视频。以后开了相机权限，往 `OPTIONS` 里加一项即可。
 */
export function AttachmentSheet({
  visible,
  onClose,
  onPickImage,
  onPickVideo,
}: {
  visible: boolean;
  onClose: () => void;
  onPickImage: () => void;
  onPickVideo: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ModalScrim />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t("messages.attachTitle")}</Text>

          <View style={styles.options}>
            <Pressable
              onPress={onPickImage}
              accessibilityRole="button"
              accessibilityLabel={t("messages.attachImage")}
              style={styles.option}
            >
              <View style={styles.optionIcon}>
                <Icon name="image-outline" size={24} color={colors.primary} />
              </View>
              <Text style={styles.optionTitle}>{t("messages.attachImage")}</Text>
              <Text style={styles.optionHint}>{t("messages.attachImageHint")}</Text>
            </Pressable>

            <Pressable
              onPress={onPickVideo}
              accessibilityRole="button"
              accessibilityLabel={t("messages.attachVideo")}
              style={styles.option}
            >
              <View style={styles.optionIcon}>
                <Icon name="videocam-outline" size={24} color={colors.primary} />
              </View>
              <Text style={styles.optionTitle}>{t("messages.attachVideo")}</Text>
              <Text style={styles.optionHint}>{t("messages.attachVideoHint")}</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            style={styles.cancel}
          >
            <Text style={styles.cancelLabel}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed((c) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: c.bgSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 34,
  },
  /* 顶部小横条：告诉用户「这一层是可以往下拽/点外面关掉的」。 */
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.line,
    marginBottom: 14,
  },
  title: { fontSize: sizes.body, fontWeight: "600", color: c.ink, marginBottom: 16 },
  options: { flexDirection: "row", gap: 12 },
  option: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: c.bgSoft,
    borderWidth: 1,
    borderColor: c.line,
    gap: 4,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.bgTint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  optionTitle: { fontSize: sizes.body, fontWeight: "600", color: c.ink },
  optionHint: { fontSize: sizes.caption, color: c.muted, lineHeight: 16 },
  cancel: {
    marginTop: 14,
    height: 48,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: { fontSize: sizes.body, color: c.muted, fontWeight: "500" },
}));
