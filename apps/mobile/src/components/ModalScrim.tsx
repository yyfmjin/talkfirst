import { BlurView } from "expo-blur";
import { StyleSheet, useColorScheme, View } from "react-native";

/**
 * 弹层背后的「虚化 + 压暗」层（2026-11-07）。
 *
 * ## 为什么需要它
 *
 * 之前各弹层的遮罩只是一层半透明黑（`rgba(0,0,0,0.45)` 之类）。压在信息密集的
 * 页面上（动态列表、头像墙）时，背后的文字和照片会直接透上来，和弹层里的内容
 * 混在一起——看不清哪层是哪层。虚化把背后的细节「推远」，压暗兜住对比度，
 * 眼睛就只落在弹层上了。
 *
 * ## 两个实现细节
 *
 * 1. **Android 必须显式开 dimezis 模糊**：expo-blur 在 Android 上默认只返回一块
 *    半透明色，不真的模糊。`experimentalBlurMethod="dimezisBlurView"` 走
 *    RenderEffect（API 31+）；更低版本会退化成半透明，所以下面那层压暗不能省。
 * 2. `pointerEvents="none"`：这一层只负责观感，点击穿透交给调用方自己的
 *    Pressable 处理，避免出现「点遮罩关不掉」或「点穿到弹层」。
 */
export function ModalScrim({ intensity = 22 }: { intensity?: number }) {
  const scheme = useColorScheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={intensity}
        tint={scheme === "dark" ? "dark" : "light"}
        experimentalBlurMethod="dimezisBlurView"
      />
      <View style={[StyleSheet.absoluteFill, styles.dim]} />
    </View>
  );
}

const styles = StyleSheet.create({
  /** 压暗：兜住对比度（也是 Android < 31 上模糊失效时的兜底）。 */
  dim: { backgroundColor: "rgba(15, 23, 42, 0.42)" },
});
