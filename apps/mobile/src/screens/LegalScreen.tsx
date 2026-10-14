import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { SubHeader } from "../components/SubHeader";
import { useI18n } from "../lib/i18n-context";
import { LEGAL_DOCS, legalUrl, SUPPORT_EMAIL } from "../lib/legal";
import { colors } from "../theme";

/**
 * 条款与隐私 —— 「我的」里唯一一个不自己渲染正文的子页。
 *
 * 三份文档都在线上（见 `lib/legal`），这里只做入口与失败提示。加这一页的直接
 * 原因有两个：
 *
 *  1. Google Play 要求隐私政策既在商店页面上可达，**也要在 App 内可达**；
 *  2. 用户遇事想找条款时，不该先猜「去官网哪个角落找」。
 */
export function LegalScreen({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);

  async function openUrl(url: string) {
    try {
      await Linking.openURL(url);
      setFailed(false);
    } catch {
      /* 没有浏览器 / 被系统策略拦下：说清楚，别让按钮看着像没反应。 */
      setFailed(true);
    }
  }

  return (
    <View style={styles.root}>
      <SubHeader title={t("legal.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>{t("legal.intro")}</Text>

        <View style={styles.card}>
          {LEGAL_DOCS.map((doc, index) => (
            <Pressable
              key={doc.path}
              onPress={() => void openUrl(legalUrl(locale, doc.path))}
              accessibilityRole="link"
              accessibilityLabel={t(doc.key)}
              style={[styles.row, index > 0 && styles.rowDivided]}
            >
              <Text style={styles.rowLabel}>{t(doc.key)}</Text>
              <Icon name="open-outline" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t("legal.contact")}</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => void openUrl(`mailto:${SUPPORT_EMAIL}`)}
            accessibilityRole="link"
            accessibilityLabel={SUPPORT_EMAIL}
            style={styles.row}
          >
            <Text style={styles.rowLabel}>{SUPPORT_EMAIL}</Text>
            <Icon name="mail-outline" size={18} color={colors.muted} />
          </Pressable>
        </View>

        {failed ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {t("legal.openFailed")}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 12, paddingBottom: 32 },
  intro: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 12 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 48,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.line },
  rowLabel: { fontSize: 15, color: colors.ink },
  sectionTitle: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8 },
  error: { fontSize: 13, color: colors.danger },
});
