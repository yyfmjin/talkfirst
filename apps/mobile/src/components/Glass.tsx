import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../theme";

/**
 * 全站毛玻璃的两个积木（2026-11-03，对齐 web 的 `globals.css` 与 `glass` token）。
 *
 * 玻璃要成立，三件事必须同时在位，缺一个就退化成「一层灰雾」：
 *   1. `<Wash />` —— 背后确实有东西可透；
 *   2. 半透明 tint —— `colors.glass / glassRaised / glassSunken`；
 *   3. `<Glass />` 里的 `BlurView` —— 真正去模糊后面的东西。
 *
 * Android 注意：expo-blur 在 Android 上默认**不模糊**，只给一块半透明色。
 * 必须显式传 `experimentalBlurMethod`（dimezis 实现走 RenderEffect，API 31+）。
 * 更低版本的机器上它仍会退化成色块 —— 那是系统能力，不是这里能配出来的。
 */
export function Wash() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* 底色：上浅下深，跟 web 那层竖向渐变同一组值。 */}
      <LinearGradient
        colors={[colors.washTop, colors.washMid, colors.washBottom]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/*
       * 一处柔光。web 那边是 radial-gradient，RN 没有，用一个斜向的淡出近似 ——
       * 目的只是让平面上有明暗差，玻璃压上去才看得出层次。
       */}
      <LinearGradient
        colors={["rgba(207, 228, 255, 0.95)", "rgba(207, 228, 255, 0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.85, y: 0.65 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/**
 * 一块玻璃面。
 *
 * `tone` 对应 web 的三档：`card` 普通卡片、`raised` 浮层 / 吸顶栏 / 底栏、
 * `sunken` 输入框这类凹陷。别自己传 rgba 进来，档位是刻意收敛的。
 */
export function Glass({
  children,
  style,
  tone = "card",
  intensity = 40,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "card" | "raised" | "sunken";
  intensity?: number;
}) {
  const backgroundColor =
    tone === "raised" ? colors.glassRaised : tone === "sunken" ? colors.glassSunken : colors.glass;

  return (
    <BlurView
      tint="light"
      intensity={intensity}
      experimentalBlurMethod="dimezisBlurView"
      /* 调用方的 style 先合并，档位色最后写 —— 免得某处旧的 `backgroundColor:
         colors.white` 把玻璃又盖成实色。 */
      style={[styles.glass, style, { backgroundColor }]}
    >
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    /* 圆角由调用方给；这里只保证裁剪，否则子视图会盖住圆角。 */
    overflow: "hidden",
  },
});
