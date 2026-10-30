import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";

/**
 * 每日占卜小卡片（2026-10-30）。
 *
 * ## 内容全部来自服务端
 *
 * 宜忌、幸运色、运势、紫微那一行都是服务端按「用户 + 日期」算好的成品字符串
 * （见 `apps/api/src/fortune`）。客户端只渲染 —— 两端（App/网页）共享同一份
 * 文案表，不会出现「手机上说宜聊天、网页上说宜早睡」。
 *
 * ## 为什么要确定性
 *
 * 服务端用 `userId|date` 做种子，同一天刷新永远是同一张卡。这条很重要：会变的
 * 占卜不是占卜，是抽奖，用户一眼就看穿了。所以这里也**不做**任何本地重抽逻辑。
 *
 * ## 失败就整块不显示
 *
 * 首页的主角是动态。占卜加载不出来（没网、接口 5xx、没登录态）时静默隐藏，
 * 不占位、不弹错误 —— 一个锦上添花的东西不该让人以为 App 坏了。
 */

type FortuneCard = {
  date: string;
  weekday: number;
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  dos: string[];
  donts: string[];
  horoscope: string;
  ziwei: {
    lunar: string | null;
    ganzhi: string;
    soul: string;
    body: string;
    palaceStar: string | null;
    lu: string;
    quan: string;
    ke: string;
    ji: string;
    assumedHour: boolean;
  } | null;
};

/** 0 = 周日，与 `Date.getDay()` 一致。 */
const WEEKDAY_KEYS = [
  "weekday.sun",
  "weekday.mon",
  "weekday.tue",
  "weekday.wed",
  "weekday.thu",
  "weekday.fri",
  "weekday.sat",
] as const satisfies readonly MsgKey[];

export function DailyFortuneCard() {
  const { t, locale } = useI18n();
  const [card, setCard] = useState<FortuneCard | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await apiFetch<FortuneCard>(
          `/fortune/today?lang=${locale === "en" ? "en" : "zh-CN"}`,
        );
        if (!alive) return;
        /*
         * 校验形状再渲染：接口换字段、网关回一段 HTML、或测试里 mock 成空对象时，
         * 缺一个 `date` 就会在首页崩掉整棵列表。占卜是锦上添花，宁可整块不显示。
         */
        if (!data || typeof data.date !== "string" || !Array.isArray(data.dos)) {
          setHidden(true);
          return;
        }
        setCard(data);
      } catch {
        if (alive) setHidden(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale]);

  if (hidden) return null;
  if (!card) {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator size="small" color={colors.muted} />
      </View>
    );
  }

  const [, month, day] = card.date.split("-");
  const dateLabel =
    locale === "en" ? `${Number(month)}/${Number(day)}` : `${Number(month)}月${Number(day)}日`;
  const weekday = t(WEEKDAY_KEYS[card.weekday] ?? "weekday.sun");

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("fortune.title")}</Text>
        <Text style={styles.date}>
          {dateLabel} · {weekday}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {card.sign ? <Text style={styles.sign}>{card.sign}</Text> : null}
        <Text style={styles.meta}>
          {t("fortune.lucky")} {card.luckyNumbers.join(" · ")}
        </Text>
        <View style={styles.colorChip}>
          <View style={[styles.colorDot, { backgroundColor: card.luckyColor.hex }]} />
          <Text style={styles.meta}>{card.luckyColor.name}</Text>
        </View>
      </View>

      <View style={styles.lineRow}>
        <Text style={[styles.badge, styles.badgeDo]}>{t("fortune.do")}</Text>
        <Text style={styles.lineText} numberOfLines={2}>
          {card.dos.join(" · ")}
        </Text>
      </View>
      <View style={styles.lineRow}>
        <Text style={[styles.badge, styles.badgeDont]}>{t("fortune.dont")}</Text>
        <Text style={styles.lineText} numberOfLines={2}>
          {card.donts.join(" · ")}
        </Text>
      </View>

      <Text style={styles.horoscope}>{card.horoscope}</Text>

      {card.ziwei ? (
        <Text style={styles.ziwei} numberOfLines={2}>
          {t("fortune.ziwei", {
            ganzhi: card.ziwei.ganzhi,
            soul: card.ziwei.soul,
            lu: card.ziwei.lu,
            quan: card.ziwei.quan,
            ke: card.ziwei.ke,
            ji: card.ziwei.ji,
          })}
          {card.ziwei.assumedHour ? `　${t("fortune.assumedHour")}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { paddingVertical: 10, alignItems: "center" },
  card: {
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgSoft,
    gap: 6,
  },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
  date: { fontSize: 12, color: colors.muted },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  sign: { fontSize: 13, fontWeight: "600", color: colors.primaryDark },
  meta: { fontSize: 12, color: colors.muted },
  colorChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  lineRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  badge: {
    minWidth: 22,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    overflow: "hidden",
  },
  badgeDo: { color: colors.primaryDark, backgroundColor: colors.bgTint },
  badgeDont: { color: colors.danger, backgroundColor: colors.dangerSoft },
  lineText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.ink },
  horoscope: { fontSize: 13, lineHeight: 20, color: colors.ink, marginTop: 2 },
  ziwei: { fontSize: 11, lineHeight: 16, color: colors.muted, marginTop: 2 },
});
