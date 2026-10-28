import { Image, StyleSheet, View } from "react-native";

import { colors } from "../theme";

/**
 * 品牌标志（2026-10-28 换成正式图标）。
 *
 * ## 为什么用图片而不是画 SVG
 *
 * 正式标志是「三段弧环 + 笑脸」，路径来自 `store/brand/talkfirst-icon.svg`。
 * 在 App 里画它需要 react-native-svg（新原生依赖，又一次出包与权限审查），
 * 而我们已经有一张由同一份 SVG 渲染的白色前景图（`assets/adaptive-icon.png`，
 * 蓝底已抠成透明）。直接叠在品牌蓝方块上，效果与桌面图标完全一致。
 *
 * ## 颜色
 *
 * 方块底色用 `colors.primary`（2026-10-28 起它已经是图标蓝 `#0B7FFF`）——
 * 界面主色与标志同色，不再需要单独写死一个常量。
 */
const BRAND_BLUE = colors.primary;

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.28 },
      ]}
    >
      <Image
        source={require("../../assets/adaptive-icon.png")}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { backgroundColor: BRAND_BLUE, alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
