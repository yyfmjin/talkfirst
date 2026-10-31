import { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../lib/i18n-context";
import { colors } from "../theme";
import { DailyFortuneCard } from "./DailyFortuneCard";
import { Icon } from "./Icon";

/* 图标源在 `store/brand/fortune-icon.svg`，PNG 由它渲染而来（手机端不引 react-native-svg）。 */
const FORTUNE_ICON = require("../../assets/fortune-icon.png");

/**
 * 「每日占卜」的入口按钮 + 弹层（2026-10-31）。
 *
 * ## 为什么从「直接铺在首页」改成「点开看」
 *
 * 卡片本身是常驻在信息流顶部的：它抢在了第一条动态之前，而用户打开这个 App
 * 是来看人的。一块固定高度、每天都一样的板子压在最上面，视觉上就是「突兀」，
 * 而且它每天只值得看一次 —— 常驻的性价比极低。
 *
 * 改成按钮之后还顺手省掉一次请求：`DailyFortuneCard` 只有在弹层挂载之后才
 * 会去拉 `/fortune/today`，首页加载不再连带这个接口。
 *
 * ## 关闭方式给了三种
 *
 * 右上角 ✕、点遮罩、Android 返回键（`onRequestClose`）。少一种都会有人卡住。
 */
export function DailyFortuneEntry() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("fortune.entry")}
        style={styles.entry}
      >
        <Image source={FORTUNE_ICON} style={styles.entryIcon} resizeMode="contain" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityRole="button">
          {/* 内层拦住点击：点卡片本身不该关掉它。 */}
          <Pressable style={styles.sheet} onPress={() => undefined} accessibilityRole="none">
            <View style={styles.head}>
              <Text style={styles.title}>{t("fortune.title")}</Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t("fortune.close")}
                hitSlop={8}
                style={styles.close}
              >
                <Icon name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {open ? <DailyFortuneCard /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  /* 实底（不再用描边透明款）：淡品牌底 + 自家图标，和旁边两个描边按钮区分开。 */
  entry: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: colors.bgTint,
  },
  entryIcon: { width: 24, height: 24 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderRadius: 20,
    paddingTop: 14,
    paddingBottom: 6,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink },
  close: { padding: 4 },
});
