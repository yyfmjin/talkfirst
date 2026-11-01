import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n-context";
import { playPopIn, popInStyle } from "../lib/motion";
import type { MsgKey } from "../lib/messages";
import { colors } from "../theme";

/**
 * 每日运势（2026-10-31 第三版：按类目聚合）。
 *
 * ## 为什么要重构
 *
 * 上一版把「四化 / 流月 / 流年 / 命盘」平铺成七块，手机上要滚两屏才看得完，
 * 而真正每天要看的只有那几行结论。现在按类目聚合：
 *
 *   顶部     日期 · 农历 · 干支五行 · 星座（一行）
 *   主体     爱情 / 亲情 / 财运 / 行事 —— 2×2 四格，每格「评级 + 一句」
 *   次级     四化 chips、宜、忌、幸运数字与颜色
 *   折叠     本月 / 今年 / 命盘（默认收起，点「更多」展开）
 *
 * ## 类目是怎么来的（不写进界面，但必须有依据）
 *
 * 看当天四化**飞进了哪一宫**：化禄入财帛主进、化忌入田宅主守。所以四类运势不是
 * 另编一套，而是同一天四个四化的归类。没有生日（无命盘）时这块整体不出现。
 */

type FourItem = { star: string; theme: string; hint: string };
type PeriodItem = { ganzhi: string; stars: string[] };
type AspectItem = {
  id: "love" | "family" | "wealth" | "action";
  label: string;
  rating: "good" | "even" | "careful";
  ratingLabel: string;
  note: string;
};

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
  aspects: AspectItem[];
  month: PeriodItem | null;
  year: PeriodItem | null;
  chart: { palaceStars: string[]; soul: string; body: string; fiveElements: string } | null;
};

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
  const [expanded, setExpanded] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;

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
        if (!data || typeof data.date !== "string" || !Array.isArray(data.dos)) {
          setHidden(true);
          return;
        }
        setCard(data);
        playPopIn(enter);
      } catch {
        if (alive) setHidden(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enter, locale]);

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
  const hasMore = Boolean(card.month || card.year || card.chart);

  return (
    /* 入场：0.92→1 + 淡入（240ms）。整个面板一起动，不是逐个元素排队 —— 排队会显得慢。 */
    <Animated.View style={[styles.shell, popInStyle(enter)]}>
      <ScrollView contentContainerStyle={styles.card}>
      <Text style={styles.date}>
        {dateLabel} · {weekday}
      </Text>

      <View style={styles.metaRow}>
        {card.lunar ? <Text style={styles.meta}>{t("fortune.lunar", { text: card.lunar })}</Text> : null}
        <Text style={styles.meta}>{t("fortune.ganzhi", { ganzhi: card.ganzhi, element: card.element })}</Text>
        {card.sign ? <Text style={styles.sign}>{card.sign}</Text> : null}
      </View>

      {card.aspects.length > 0 ? (
        <View style={styles.grid}>
          {card.aspects.map((aspect) => (
            <View
              key={aspect.id}
              style={[
                styles.cell,
                aspect.rating === "good" ? styles.cellGood : null,
                aspect.rating === "careful" ? styles.cellCareful : null,
              ]}
            >
              <View style={styles.cellHead}>
                <Text style={styles.cellLabel}>{aspect.label}</Text>
                <Text
                  style={[
                    styles.cellRating,
                    aspect.rating === "good" ? styles.textGood : null,
                    aspect.rating === "careful" ? styles.textCareful : null,
                  ]}
                >
                  {aspect.ratingLabel}
                </Text>
              </View>
              <Text style={styles.cellNote} numberOfLines={2}>
                {aspect.note}
              </Text>
            </View>
          ))}
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

      {card.four ? (
        <View style={styles.chips}>
          {FOUR_ORDER.map(({ key, label }) => (
            <View key={key} style={[styles.chip, key === "ji" ? styles.chipJi : styles.chipGood]}>
              <Text style={[styles.chipLabel, key === "ji" ? styles.chipLabelJi : null]}>{t(label)}</Text>
              <Text style={styles.chipStar}>{card.four![key].star}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {hasMore ? (
        <>
          <Pressable
            onPress={() => setExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? t("fortune.less") : t("fortune.more")}
            style={styles.moreButton}
          >
            <Text style={styles.moreLabel}>{expanded ? t("fortune.less") : t("fortune.more")}</Text>
          </Pressable>

          {expanded ? (
            <View style={styles.more}>
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
              {card.chart ? (
                <View style={styles.periodRow}>
                  <Text style={styles.periodLabel}>{t("fortune.chart")}</Text>
                  <Text style={styles.periodText}>
                    {t("fortune.palace")} {card.chart.palaceStars.join("·")} · {t("fortune.soul")}{" "}
                    {card.chart.soul} · {t("fortune.body")} {card.chart.body} · {card.chart.fiveElements}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  placeholder: { paddingVertical: 24, alignItems: "center" },
  shell: { maxHeight: 560 },
  card: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
  date: { fontSize: 12, color: colors.muted },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  meta: { fontSize: 12, color: colors.muted },
  sign: { fontSize: 13, fontWeight: "600", color: colors.primaryDark },

  /* 2×2 类目格：一眼扫完，不用滚。 */
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  cell: {
    width: "48%",
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.bgSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cellGood: { backgroundColor: colors.bgTint, borderColor: colors.bgTint },
  cellCareful: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft },
  cellHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cellLabel: { fontSize: 12, fontWeight: "700", color: colors.ink },
  cellRating: { fontSize: 11, fontWeight: "700", color: colors.muted },
  textGood: { color: colors.primaryDark },
  textCareful: { color: colors.danger },
  cellNote: { fontSize: 12, lineHeight: 17, color: colors.ink },

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

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  chipGood: { backgroundColor: colors.bgTint },
  chipJi: { backgroundColor: colors.dangerSoft },
  chipLabel: { fontSize: 11, fontWeight: "700", color: colors.primaryDark },
  chipLabelJi: { color: colors.danger },
  chipStar: { fontSize: 12, fontWeight: "600", color: colors.ink },

  moreButton: { alignSelf: "flex-start", paddingVertical: 4 },
  moreLabel: { fontSize: 12, fontWeight: "600", color: colors.primaryDark },
  more: { gap: 4, paddingTop: 2 },
  periodRow: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  periodLabel: { fontSize: 11, fontWeight: "700", color: colors.muted, minWidth: 30 },
  periodText: { fontSize: 12, color: colors.ink, flexShrink: 1 },
});
