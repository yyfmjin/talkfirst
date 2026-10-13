import { Pressable, StyleSheet, View } from "react-native";
import { colors } from "../theme";

/**
 * 开关。
 *
 * ## 为什么不用 react-native 自带的 `Switch`
 *
 * 它的外观由平台决定（Android 是 Material 的一颗药丸、iOS 是自家绿色），在这个
 * 已经有自己色板的界面里会像别人家的控件；而且在测试里它渲染成原生宿主节点，
 * 状态断言不到 —— 我们那套渲染冒烟检查的是「我们自己写的开关有没有接到状态」。
 *
 * ## 状态不只靠位置和颜色
 *
 * 带上 `accessibilityRole="switch"` 与 `accessibilityState.checked`，读屏才会念出
 * 「开 / 关」；只把滑块挪到右边，读屏用户什么也得不到。
 *
 * ## 为什么不做滑动动画
 *
 * 设置页一屏就有七八个开关。逐个跑动画既费电，也违背「动效只服务于反馈」这条 ——
 * 位置变化本身就是反馈。用 `justifyContent` 挪滑块，不动画、不跳帧。
 */
export function Switch({
  checked,
  label,
  disabled = false,
  onChange,
}: {
  checked: boolean;
  /** 读屏用的名字，必填：一个没名字的开关等于没说清它管什么。 */
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      hitSlop={8}
      style={[styles.track, checked ? styles.trackOn : styles.trackOff, disabled ? styles.disabled : null]}
    >
      <View style={styles.knob} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 48,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  trackOn: { backgroundColor: colors.primary, alignItems: "flex-end" },
  trackOff: { backgroundColor: colors.muted, alignItems: "flex-start" },
  /* 白色的滑块在两种底色上都是 3:1 以上，不靠颜色单独区分开关状态。 */
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.white },
  disabled: { opacity: 0.5 },
});
