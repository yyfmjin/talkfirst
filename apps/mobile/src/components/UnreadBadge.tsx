import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { EASE, MOTION } from "../lib/motion";
import { colors } from "../theme";

/**
 * 未读徽标（2026-10-31）。
 *
 * 未读变 0 时**不是瞬间消失**，而是缩到 0 再卸载 —— 瞬间消失会让人怀疑「是不是
 * 我看错了/点错了」。反过来出现时也放大进来，让「有新消息」这件事被看见。
 *
 * 用 `visible` 状态控制卸载时机：动画结束才移除节点，否则退出动画根本没机会播。
 */
export function UnreadBadge({ count }: { count: number }) {
  const [visible, setVisible] = useState(count > 0);
  const scale = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;

  useEffect(() => {
    if (count > 0) {
      setVisible(true);
      Animated.timing(scale, {
        toValue: 1,
        duration: MOTION.fast,
        easing: EASE.out,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!visible) return;
    Animated.timing(scale, {
      toValue: 0,
      duration: MOTION.instant,
      easing: EASE.inOut,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [count, scale, visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.badge, { opacity: scale, transform: [{ scale }] }]}>
      <Text style={styles.text}>{count > 99 ? "99+" : count}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  text: { fontSize: 12, fontWeight: "700", color: colors.white },
});
