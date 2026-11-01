import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { playSlideIn, playSlideOut, slideInStyle } from "../lib/motion";
import { colors } from "../theme";

/**
 * 一次性提示条（2026-10-31）。
 *
 * 用在「发布成功」这类**动作已完成**的反馈上：滑入 → 停留 1.4s → 滑出 → 自己消失，
 * 不拦点击（`pointerEvents="none"`），也不需要用户关。
 *
 * 为什么不用系统 Toast：Android 的 Toast 位置在屏幕底部，会盖住底栏；而且 iOS 没有。
 * 这条是自己控高度和节奏的，两端一致。
 *
 * 用户连续发两条时，`message` 变化会重置计时器，不会出现「第二条被第一条的定时器
 * 提前收掉」。
 */
export function FlashNotice({ message, onHidden }: { message: string | null; onHidden: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    playSlideIn(anim);
    const timer = setTimeout(() => {
      void playSlideOut(anim).then(onHidden);
    }, 1400);
    return () => clearTimeout(timer);
  }, [anim, message, onHidden]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.notice, slideInStyle(anim)]} pointerEvents="none">
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.ink,
    zIndex: 20,
  },
  text: { fontSize: 13, fontWeight: "600", color: colors.white },
});
