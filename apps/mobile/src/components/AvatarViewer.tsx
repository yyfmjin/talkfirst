import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, themed } from "../theme";
import { radii, sizes } from "../design/tokens";

/**
 * 头像大图查看。
 *
 * 为什么单独抽出来：头像在三个地方会被点（资料卡、我的、别人资料卡），
 * 每处都写一遍 Modal 迟早长歪。这里只管「看」；「改」由调用方通过
 * `actionLabel` / `onAction` 决定 —— 别人的头像没有可执行动作，就不传。
 *
 * 交互对齐成熟社交产品：
 *   - 点背景任意处关闭（不只是那个 ✕）；
 *   - 关闭按钮在右上角，带 44pt 命中区（视觉 36，靠 hitSlop 补）；
 *   - 动作按钮在底部、圆形大图正下方，单手能够到。
 */
export function AvatarViewer({
  visible,
  uri,
  nickname,
  onClose,
  actionLabel,
  onAction,
  actionLoading = false,
}: {
  visible: boolean;
  uri: string | null;
  nickname: string | null;
  onClose: () => void;
  /** 「更换头像」之类。不传就只有查看。 */
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
}) {
  const { width } = useWindowDimensions();
  // 屏幕再宽也不铺满：留出边距，图片看起来才是「一张照片」而不是背景。
  const photoSize = Math.min(width - 64, 360);
  const initial = (nickname ?? "?").slice(0, 1).toUpperCase();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="" accessible={false}>
        <View style={styles.body} accessibilityViewIsModal>
          {uri ? (
            <Image
              source={{ uri }}
              style={{ width: photoSize, height: photoSize, borderRadius: radii.card }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={[
                styles.fallback,
                { width: photoSize, height: photoSize, borderRadius: radii.card },
              ]}
            >
              <Text style={styles.fallbackInitial}>{initial}</Text>
            </View>
          )}

          {nickname ? <Text style={styles.name}>{nickname}</Text> : null}

          {actionLabel && onAction ? (
            <Pressable
              onPress={onAction}
              disabled={actionLoading}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              style={styles.action}
            >
              {actionLoading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.actionLabel}>{actionLabel}</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </Pressable>

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
        style={styles.close}
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </Modal>
  );
}

const styles = themed((c) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 12, 20, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  body: { alignItems: "center" },
  fallback: {
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackInitial: { color: c.white, fontSize: 96, fontWeight: "600" },
  name: {
    marginTop: 20,
    color: c.white,
    fontSize: sizes.body,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  action: {
    marginTop: 24,
    minWidth: 160,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: radii.pill,
    backgroundColor: c.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { color: c.white, fontSize: sizes.body, fontWeight: "600" },
  close: {
    position: "absolute",
    top: 56,
    right: 24,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  closeText: { color: c.white, fontSize: sizes.body, lineHeight: 20 },
}));
