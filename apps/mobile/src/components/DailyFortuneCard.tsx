import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";

/**
 * 每日运势（2026-10-31 加强版）。
 *
 * ## 内容从哪来
 *
 * 全部来自服务端，而且是**算出来的**：农历与日柱干支由 iztro 排，四化（禄权科忌）
 * 由当天的流日/流月/流年给出，幸运数字取日柱的河图数，幸运色取日干五行，
 * 宜忌由四化落星映射成具体动作。没有一项是随机抽的。
 *
 * 客户端只负责排版 —— 中英文案也在服务端，避免两个客户端各翻一遍。
 *
 * ## 为什么要有「没有命盘」的分支
 *
 * 四化需要出生日期。没填生日的用户照样能看农历、干支、五行、幸运数与宜忌
 * （这些只依赖当天），但四化/流月/流年/命盘一律不显示 —— 不拿随机内容冒充命盘。
 */

type FourItem = { star: string; theme: string; hint: string };
type PeriodItem = { ganzhi: string; stars: string[] };

type FortuneCard = {
  date: string;
  weekday: number;
  lunar: string | null;
  ganzhi: string;
  element: string;
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  dos: string[];
  donts: string[];
  four: { lu: FourItem; quan: FourItem; ke: FourItem; ji: FourItem } | null;
  month: PeriodItem | null;
  year: PeriodItem | null;
  chart: { palaceStars: string[]; soul: string; body: string; fiveElements: string } | null;
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

const FOUR_ORDER = [
  { key: "lu", label: "fortune.lu" },
  { key: "quan", label: "fortune.quan" },
  { key: "ke", label: "fortune.ke" },
  { key: "ji", label: "fortune.ji" },
] as const satisfies ReadonlyArray<{ key: keyof NonNullable<FortuneCard["four"]>; label: MsgKey }>;

export function DailyFortuneCard() {
  const { t, locale } = useI18n();
  const [card, setCard] = useState<FortuneCard | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        /* 用**本地**日期：接口按北京时间兜底，海外用户夜里会看到「明天」。 */
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate(),
        ).padStart(2, "0")}`;
        const data = await apiFetch<FortuneCard>(
          `/fortune/today?lang=${locale === "en" ? "en" : "zh-CN"}&date=${today}`,
        );
        if (!alive) return;
        /* 形状不对就整块不显示：占卜是锦上添花，不能把首页/弹层拖崩。 */
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
    <ScrollView style={styles.scroll} contentContainerStyle={styles.card} showsVerticalScrollIndicator>
      <Text style={styles.date}>
        {dateLabel} · {weekday}
      </Text>

      <View style={styles.metaRow}>
        {card.lunar ? (
          <Text style={styles.meta}>{t("fortune.lunar", { text: card.lunar })}</Text>
        ) : null}
        <Text style={styles.meta}>{t("fortune.ganzhi", { ganzhi: card.ganzhi, element: card.element })}</Text>
        {card.sign ? <Text style={styles.sign}>{card.sign}</Text> : null}
      </View>

      {card.four ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{t("fortune.four")}</Text>
          <View style={styles.chips}>
            {FOUR_ORDER.map(({ key, label }) => {
              const item = card.four![key];
              return (
                <View key={key} style={[styles.chip, key === "ji" ? styles.chipJi : styles.chipGood]}>
                  <Text style={[styles.chipLabel, key === "ji" ? styles.chipLabelJi : null]}>
                    {t(label)}
                  </Text>
                  <Text style={styles.chipStar}>{item.star}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.lineRow}>
        <Text style={[styles.badge, styles.badgeDo]}>{t("fortune.do")}</Text>
        <Text style={styles.lineText}>{card.dos.join(" · ")}</Text>
      </View>
      <View style={styles.lineRow}>
        <Text style={[styles.badge, styles.badgeDont]}>{t("fortune.dont")}</Text>
        <Text style={styles.lineText}>{card.donts.join(" · ")}</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {t("fortune.lucky")} {card.luckyNumbers.join(" · ")}
        </Text>
        <View style={styles.colorChip}>
          <View style={[styles.colorDot, { backgroundColor: card.luckyColor.hex }]} />
          <Text style={styles.meta}>{card.luckyColor.name}</Text>
        </View>
      </View>

      {card.month || card.year ? (
        <View style={styles.block}>
          {card.month ? (
            <View style={styles.periodRow}>
              <Text style={styles.periodLabel}>{t("fortune.month")}</Text>
              <Text style={styles.periodText}>
                {card.month.ganzhi} · {card.month.stars.join(" ")}
              </Text>
            </View>
          ) : null}
          {card.year ? (
            <View style={styles.periodRow}>
              <Text style={styles.periodLabel}>{t("fortune.year")}</Text>
              <Text style={styles.periodText}>
                {card.year.ganzhi} · {card.year.stars.join(" ")}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {card.chart ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{t("fortune.chart")}</Text>
          <View style={styles.periodRow}>
            <Text style={styles.periodLabel}>{t("fortune.palace")}</Text>
            <Text style={styles.periodText}>{card.chart.palaceStars.join("·")}</Text>
          </View>
          <View style={styles.periodRow}>
            <Text style={styles.periodLabel}>{t("fortune.soul")}</Text>
            <Text style={styles.periodText}>{card.chart.soul}</Text>
            <Text style={[styles.periodLabel, styles.periodLabelGap]}>{t("fortune.body")}</Text>
            <Text style={styles.periodText}>{card.chart.body}</Text>
            <Text style={[styles.periodLabel, styles.periodLabelGap]}>{card.chart.fiveElements}</Text>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  placeholder: { paddingVertical: 24, alignItems: "center" },
  /* 弹层里内容可能超过一屏：自己滚，不要把面板撑出屏幕。 */
  scroll: { maxHeight: 520 },
  card: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  date: { fontSize: 12, color: colors.muted },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  meta: { fontSize: 12, color: colors.muted },
  sign: { fontSize: 13, fontWeight: "600", color: colors.primaryDark },
  block: { gap: 6, marginTop: 2 },
  blockTitle: { fontSize: 12, fontWeight: "700", color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  chipGood: { backgroundColor: colors.bgTint },
  chipJi: { backgroundColor: colors.dangerSoft },
  chipLabel: { fontSize: 11, fontWeight: "700", color: colors.primaryDark },
  chipLabelJi: { color: colors.danger },
  chipStar: { fontSize: 12, fontWeight: "600", color: colors.ink },
  hint: { fontSize: 13, lineHeight: 20, color: colors.ink },
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
  colorChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  colorDot: { width: 8, height: 8, borderRadius: 4 },
  periodRow: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  periodLabel: { fontSize: 11, fontWeight: "700", color: colors.muted, minWidth: 30 },
  periodLabelGap: { marginLeft: 12 },
  periodText: { fontSize: 12, color: colors.ink },
});
