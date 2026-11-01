import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { EASE, MOTION } from "../lib/motion";
import { colors } from "../theme";
import { Icon } from "./Icon";

/**
 * 点赞按钮（2026-10-31）。
 *
 * ## 只在「变成已赞」时弹一次
 *
 * 取消赞不弹 —— 取消是「撤销」，给它庆祝动画会显得莫名其妙。所以动画挂在
 * `liked` 从 false 变 true 的那一刻，靠 effect 而不是每次点击。
 *
 * ## 为什么用序列而不是弹簧
 *
 * 1 → 1.25 → 1 两段各 90ms，落回来用 `EASE.out`：有「按下去有反馈」的手感，
 * 但不过冲。弹簧的过冲在这种高频操作上会显得吵。
 *
 * 全程 `useNativeDriver: true`，不会跟列表滚动抢 JS 线程。
 */
export function LikeButton({
  liked,
  count,
  onPress,
  label,
}: {
  liked: boolean;
  count: number;
  onPress: () => void;
  label: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!liked) return;
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.25,
        duration: MOTION.fast / 2,
        easing: EASE.out,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: MOTION.fast / 2,
        easing: EASE.out,
        useNativeDriver: true,
      }),
    ]).start();
  }, [liked, scale]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: liked }}
      style={styles.action}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon
          name={liked ? "heart" : "heart-outline"}
          size={20}
          color={liked ? colors.danger : colors.muted}
        />
      </Animated.View>
      <Text style={styles.label}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 6, paddingRight: 10 },
  label: { fontSize: 13, color: colors.muted },
});
