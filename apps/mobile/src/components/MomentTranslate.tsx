import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { Icon } from "./Icon";
import { colors } from "../theme";

/**
 * 动态正文的「翻译」开关（2026-10-30）。
 *
 * ## 为什么是「按条请求」而不是「客户端带上正文去翻」
 *
 * 接口是 `POST /moments/:id/translate`：服务端自己按 id 取正文，顺带复用
 * `getMoment` 的可见性规则（看不到的动态也翻不出来）。如果让客户端把正文发过去，
 * 这个接口就等于一个免费翻译代理，任何人都能拿它翻任意文本。
 *
 * ## 为什么翻完可以「收起」
 *
 * 动态卡片上正文是主角。译文压在原文下面会让卡片变长一倍，而很多人只想扫一眼。
 * 所以默认收起原文、展开译文**并存**，再点一次回去 —— 与网页端同一个交互。
 *
 * ## 失败就一句话
 *
 * 翻译是锦上添花。服务端没配通道（503）或网络断了，只显示一行「翻译暂时不可用」，
 * 不弹窗、不影响卡片上的其它操作。
 */
export function MomentTranslate({ momentId, content }: { momentId: string; content: string }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (text) {
      setText(null);
      return;
    }
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await apiFetch<{ text: string | null }>(`/moments/${momentId}/translate`, {
        method: "POST",
        body: { targetLang: locale === "en" ? "en" : "zh" },
      });
      if (result?.text) setText(result.text);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /* 一句话以内的动态（「好」「+1」、纯表情）翻出来没有意义，按钮直接不出现。 */
  if (content.trim().length < 4) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityState={{ busy, expanded: text !== null }}
        accessibilityLabel={text ? t("moments.translateHide") : t("moments.translate")}
        hitSlop={6}
        style={styles.button}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primaryDark} />
        ) : (
          <Icon name="language-outline" size={14} color={colors.primaryDark} />
        )}
        <Text style={styles.label}>
          {text ? t("moments.translateHide") : t("moments.translate")}
        </Text>
      </Pressable>
      {text ? <Text style={styles.translation}>{text}</Text> : null}
      {failed ? <Text style={styles.failed}>{t("moments.translateFailed")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 6, gap: 4 },
  button: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  label: { fontSize: 12, fontWeight: "600", color: colors.primaryDark },
  translation: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
  },
  failed: { fontSize: 12, color: colors.danger },
});
