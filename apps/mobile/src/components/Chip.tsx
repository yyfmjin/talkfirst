import { Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "./Icon";
import { colors, themed } from "../theme";

import { radii, sizes } from "../design/tokens";
/**
 * 可多选的标签胶囊。
 *
 * 从 `InterestsScreen` 提出来：引导流程要用同一批胶囊展示同一批兴趣/语言/目的/国家，
 * 两处各画一个的话，选中态（勾 + 反色 + `accessibilityState.selected`）迟早只剩一处对。
 *
 * 选中不只靠颜色：加一个勾，并带上 `accessibilityState.selected` —— 颜色不应当独自
 * 承载状态（读屏用户与色觉障碍用户都拿不到「哪一个被选中了」）。
 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected ? styles.chipSelected : null]}
    >
      {selected ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
      <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = themed((c) => StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.glass,
  },
  chipSelected: { backgroundColor: c.primary, borderColor: c.primary },
  chipLabel: { fontSize: sizes.ui, color: c.ink },
  chipLabelSelected: { color: c.white, fontWeight: "600" },
}));
