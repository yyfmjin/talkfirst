import { Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";
import { Icon } from "./Icon";

/**
 * 子页面通用的头部：返回 + 标题。
 *
 * 「我的」下面没有路由，子页面用全屏接管状态（见 MeScreen 的 `open`），
 * 每个子页面都需要一个能回去的头。这里收口一处，四个新模块与
 * 编辑资料 / 意见反馈共用同一个样式。
 */
export function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <View style={styles.subHeader}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t("me.back")}
        style={styles.subBack}
        /* 视觉上是 32×32（居中好看），手指可点范围抩到 44（与 tab 同量级，
           单手握持时不用瞄）。 */
        hitSlop={6}
      >
        <Icon name="chevron-back" size={22} color={colors.ink} />
      </Pressable>
      <Text style={styles.subTitle}>{title}</Text>
      {/* 右侧占位，让标题始终居中。 */}
      <View style={styles.subBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  subBack: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  subTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.ink },
});
