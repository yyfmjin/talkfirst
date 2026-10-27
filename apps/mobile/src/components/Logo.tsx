import { Image, StyleSheet, View } from "react-native";

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
 * 方块底色写死 `#0B7FFF`（图标蓝），而不是 `colors.primary`（界面主色 #6B7CFF）：
 * 两者本来就不是一个颜色，标志要跟应用图标一致，不跟按钮一致。
 */
const BRAND_BLUE = "#0B7FFF";

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
