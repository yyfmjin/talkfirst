import { Injectable } from "@nestjs/common";
import type { Gender } from "@prisma/client";
import { astro } from "iztro";
import { PrismaService } from "../prisma/prisma.service";
import {
  ASPECT_LABEL,
  ASPECT_NOTE,
  ASPECT_NOTE_PLAIN,
  ASPECT_PALACES,
  BRANCH_ELEMENT,
  ELEMENT_COLORS,
  ELEMENT_NUMBERS,
  FIVE_ELEMENTS_CLASS_DIGIT,
  FIVE_ELEMENTS_CLASS_EN,
  FOUR_THEME,
  SIGNS,
  STAR_DO,
  RATING_LABEL,
  STAR_DONT,
  STEM_ELEMENT,
  priorityOf,
  ratingOf,
  ganzhiToEnglish,
  starName,
  type AspectId,
  type AspectKind,
  type Element,
  type FortuneLang,
} from "./fortune.copy";

/**
 * 每日运势卡片的数据（2026-10-31 加强版）。
 *
 * ## 与上一版最大的区别：不再随机
 *
 * 上一版用 `userId|date` 做种子抽宜忌、幸运数字、幸运色。看起来「稳定」，但本质
 * 仍是随机 —— 任何人都能问一句「凭什么」，答案是「抽到的」。这一版全部改成**推导**：
 *
 *   - 幸运数字 ← 日柱天干/地支的五行，按河图数（一六水、二七火、三八木、四九金、五十土）
 *   - 幸运色   ← 日干五行对应的五色
 *   - 宜       ← 当日四化中的禄/权/科，落在哪颗星就给哪条建议
 *   - 忌       ← 当日化忌落在哪颗星就给哪条对应的禁忌
 *   - 本月/今年 ← iztro 算出的流月、流年四化
 *   - 命盘     ← 命宫主星、命主、身主、五行局（固定，不随日期变）
 *
 * 所以「同一个人同一天刷新不变」这件事是**天然成立**的，不再依赖 PRNG。
 *
 * ## 没有出生日期时
 *
 * 紫微要排盘，排盘要生日。缺生日时退化成「只讲当天干支五行」的通用版（宜忌来自
 * 五行的行事倾向），并明确告诉客户端 `chart: null` —— 不假装算过命盘。
 */

export type FortuneCard = {
  /** 用户当地的公历日期 `YYYY-MM-DD`。 */
  date: string;
  /** 0 = 周日。 */
  weekday: number;
  /** 当天农历，如 `二〇二六年九月廿一`；拿不到为 null。 */
  lunar: string | null;
  /** 当天干支，如 `戊寅` / `Wu-Yin`。 */
  ganzhi: string;
  /** 当天五行，如 `土·木` / `earth · wood`。 */
  element: string;
  /** 太阳星座，按出生日期算；没有生日时为 null。 */
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  /** 「宜」三条。 */
  dos: string[];
  /** 「忌」三条。 */
  donts: string[];
  /** 当日四化；没有生日（无命盘）时为 null。 */
  four: {
    lu: FourItem;
    quan: FourItem;
    ke: FourItem;
    ji: FourItem;
  } | null;
  /** 流月四化。 */
  month: PeriodItem | null;
  /** 流年四化。 */
  year: PeriodItem | null;
  /**
   * 分类运势：爱情 / 亲情 / 财运 / 行事。
   *
   * 依据是「当日四化飞进了哪一宫」——化禄入财帛主进、化忌入田宅主守，这是紫微里
   * 判断单件事顺不顺的基本方法。没有命盘（无生日）时为空数组。
   */
  aspects: AspectItem[];
  /** 命盘上的固定信息。 */
  chart: {
    palaceStars: string[];
    soul: string;
    body: string;
    fiveElements: string;
  } | null;
};

type FourItem = { star: string; theme: string; hint: string };
type AspectItem = {
  id: AspectId;
  label: string;
  rating: "good" | "even" | "careful";
  /** 服务端出好的评级词（吉 / 平 / 慎），客户端不翻译。 */
  ratingLabel: string;
  note: string;
};
type PeriodItem = { ganzhi: string; stars: string[] };

/** 午时（11:00–13:00）在 iztro 的 timeIndex 里是 6。资料里没有时辰，统一按它排。 */
const ASSUMED_TIME_INDEX = 6;
/** 允许客户端指定日期，但只接受前后两天内的。 */
const DATE_WINDOW_DAYS = 2;

const ELEMENT_LABEL: Record<FortuneLang, Record<Element, string>> = {
  "zh-CN": { wood: "木", fire: "火", earth: "土", metal: "金", water: "水" },
  en: { wood: "wood", fire: "fire", earth: "earth", metal: "metal", water: "water" },
};

/**
 * 没有命盘时的「宜」（按当天日干五行给行事倾向）。
 *
 * 五行不是随口配的：木主生发（开始、学习）、火主外显（表达、见人）、土主承载
 * （整理、收尾）、金主决断（取舍、清算）、水主流通（沟通、走动）。
 */
const ELEMENT_DO: Record<FortuneLang, Record<Element, string>> = {
  "zh-CN": {
    wood: "起一个新头",
    fire: "把想法说出去",
    earth: "整理手上的事",
    metal: "做个取舍",
    water: "找人聊两句",
  },
  en: {
    wood: "start something new",
    fire: "put the idea out loud",
    earth: "tidy up what you have",
    metal: "decide and cut",
    water: "talk to someone",
  },
};

const ELEMENT_DONT: Record<FortuneLang, Record<Element, string>> = {
  "zh-CN": {
    wood: "硬拽着不放",
    fire: "话说太满",
    earth: "拖着不动",
    metal: "优柔寡断",
    water: "凭空猜别人的意思",
  },
  en: {
    wood: "forcing it to grow",
    fire: "promising too much",
    earth: "putting it off",
    metal: "dithering",
    water: "guessing what people mean",
  },
};

@Injectable()
export class FortuneService {
  /** 当天农历/干支与用户无关，按日期缓存。 */
  private readonly dayCache = new Map<string, { lunar: string; ganzhi: string }>();

  constructor(private readonly prisma: PrismaService) {}

  async today(userId: string, lang: FortuneLang, requestedDate?: string): Promise<FortuneCard> {
    const date = resolveDate(requestedDate);
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true, gender: true },
    });

    const day = this.dayInfo(date);
    const stem = day.ganzhi.charAt(0);
    const branch = day.ganzhi.charAt(1);
    const stemElement = STEM_ELEMENT[stem];
    const branchElement = BRANCH_ELEMENT[branch];
    const elements = [stemElement, branchElement].filter((value): value is Element => Boolean(value));

    const chart = profile?.birthDate
      ? this.chart(profile.birthDate, profile.gender, date, lang)
      : null;

    /* 幸运数字：日干 + 日支的河图数；不足三个时用五行局补位，再不够按 1..9 顺序补。 */
    const classDigit = chart ? FIVE_ELEMENTS_CLASS_DIGIT[chart.fiveElementsRaw] : undefined;
    const numbers = new Set<number>();
    elements.forEach((element) => ELEMENT_NUMBERS[element].forEach((n) => numbers.add(n)));
    /*
     * 五行局的数字只在**不够三个**时才补位。早先的写法是无条件加进来再 slice(0,3)，
     * 结果「土·木」这种本该是 3·5·8 的组合被挤成 3·4·5 —— 真实的那个 8 被砍掉了。
     */
    if (numbers.size < 3 && classDigit) numbers.add(classDigit);
    for (let candidate = 1; numbers.size < 3; candidate += 1) numbers.add(candidate);
    const luckyNumbers = [...numbers].sort((a, b) => a - b).slice(0, 3);

    /* 幸运色取日干（日主）的五行色 —— 日干是「我」，比日支更贴「今天怎么穿」。 */
    const colorElement = stemElement ?? branchElement ?? "earth";
    const color = ELEMENT_COLORS[colorElement];

    const four = chart?.four ?? null;

    /*
     * 宜忌各三条。四化那三条可能撞车（比如化忌落在天机，「临时改计划」既是星曜条目
     * 又是通用条目），去重后会少一条 —— 所以最后统一用五行倾向补齐到三条，
     * 而不是让卡片上出现「只有两条」的空格。
     */
    const elementDo = [colorElement, elements[1] ?? colorElement, elements[0] ?? "earth"];
    const dos = padTo(
      four
        ? dedupe([pick(STAR_DO, four.lu.star, lang), pick(STAR_DO, four.ke.star, lang), pick(STAR_DO, four.quan.star, lang)])
        : dedupe(elementDo.map((element) => ELEMENT_DO[lang][element])),
      Object.values(ELEMENT_DO[lang]),
      3,
    );
    const donts = padTo(
      four
        ? dedupe([
            pick(STAR_DONT, four.ji.star, lang),
            lang === "zh-CN" ? "争执" : "arguing",
            lang === "zh-CN" ? "熬夜" : "staying up late",
          ])
        : dedupe([
            ELEMENT_DONT[lang][colorElement],
            lang === "zh-CN" ? "熬夜" : "staying up late",
            lang === "zh-CN" ? "争执" : "arguing",
          ]),
      Object.values(ELEMENT_DONT[lang]),
      3,
    );

    return {
      date,
      weekday: weekdayOf(date),
      lunar: lang === "zh-CN" ? day.lunar || null : null,
      ganzhi: lang === "zh-CN" ? day.ganzhi : ganzhiToEnglish(day.ganzhi),
      element: elements.map((element) => ELEMENT_LABEL[lang][element]).join(lang === "zh-CN" ? "·" : " · "),
      sign: profile?.birthDate ? signOf(profile.birthDate, lang) : null,
      luckyNumbers,
      luckyColor: { name: lang === "zh-CN" ? color.zh : color.en, hex: color.hex },
      dos,
      donts,
      four,
      aspects: chart ? aspectsOf(chart.fourRaw, chart.starPalace, lang) : [],
      month: chart?.month ?? null,
      year: chart?.year ?? null,
      chart: chart
        ? {
            palaceStars: chart.palaceStars,
            soul: chart.soul,
            body: chart.body,
            fiveElements: chart.fiveElements,
          }
        : null,
    };
  }

  /** 当天的农历与日柱（不需要出生信息）。 */
  private dayInfo(date: string): { lunar: string; ganzhi: string } {
    const cached = this.dayCache.get(date);
    if (cached) return cached;
    try {
      const chart = astro.bySolar(date, ASSUMED_TIME_INDEX, "男", true, "zh-CN");
      /* `chineseDate` 形如 `丙午 戊戌 丁丑 丙午`：年月日时四柱，取日柱。 */
      const dayPillar = chart.chineseDate.split(" ")[2] ?? "";
      const info = { lunar: chart.lunarDate ?? "", ganzhi: dayPillar };
      this.dayCache.set(date, info);
      return info;
    } catch {
      return { lunar: "", ganzhi: "" };
    }
  }

  /** 排命盘 + 取流日/流月/流年四化。任何一步失败都退化成 null，不影响卡片其余部分。 */
  private chart(
    birthDate: Date,
    gender: Gender,
    date: string,
    lang: FortuneLang,
  ): {
    four: NonNullable<FortuneCard["four"]>;
    month: PeriodItem;
    year: PeriodItem;
    palaceStars: string[];
    soul: string;
    body: string;
    fiveElements: string;
    fiveElementsRaw: string;
    /** 中文星名 → 所在宫名（iztro 的宫名不带「宫」字）。 */
    starPalace: Record<string, string>;
    fourRaw: Record<AspectKind, string>;
  } | null {
    try {
      const chart = astro.bySolar(
        isoDate(birthDate),
        ASSUMED_TIME_INDEX,
        gender === "FEMALE" ? "女" : "男",
        true,
        "zh-CN",
      );
      const horoscope = chart.horoscope(date);
      const daily = horoscope.daily.mutagen ?? [];
      const monthly = horoscope.monthly?.mutagen ?? [];
      const yearly = horoscope.yearly?.mutagen ?? [];
      const [lu, quan, ke, ji] = daily;
      if (!lu || !quan || !ke || !ji) return null;

      const soulPalace = chart.palaces.find((palace) => palace.name === "命宫");
      const palaceStars = (soulPalace?.majorStars ?? []).map((star) => starName(star.name, lang));

      /* 星曜落在哪一宫 —— 分类运势全靠这张表。主星与辅星都算。 */
      const starPalace: Record<string, string> = {};
      for (const palace of chart.palaces) {
        for (const star of [...palace.majorStars, ...palace.minorStars]) {
          starPalace[star.name] = palace.name;
        }
      }

      return {
        four: {
          lu: buildFour("lu", lu, lang),
          quan: buildFour("quan", quan, lang),
          ke: buildFour("ke", ke, lang),
          ji: buildFour("ji", ji, lang),
        },
        month: {
          ganzhi: lang === "zh-CN" ? pillar(horoscope.monthly) : ganzhiToEnglish(pillar(horoscope.monthly)),
          stars: monthly.map((star: string) => starName(star, lang)),
        },
        year: {
          ganzhi: lang === "zh-CN" ? pillar(horoscope.yearly) : ganzhiToEnglish(pillar(horoscope.yearly)),
          stars: yearly.map((star: string) => starName(star, lang)),
        },
        palaceStars,
        starPalace,
        fourRaw: { lu, quan, ke, ji },
        soul: starName(chart.soul, lang),
        body: starName(chart.body, lang),
        fiveElements:
          lang === "zh-CN"
            ? chart.fiveElementsClass
            : FIVE_ELEMENTS_CLASS_EN[chart.fiveElementsClass] ?? chart.fiveElementsClass,
        fiveElementsRaw: chart.fiveElementsClass,
      };
    } catch {
      return null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 小工具                                                                      */
/* -------------------------------------------------------------------------- */

function buildFour(kind: "lu" | "quan" | "ke" | "ji", star: string, lang: FortuneLang): FourItem {
  const table = kind === "ji" ? STAR_DONT : STAR_DO;
  const fallback = FOUR_THEME[kind];
  return {
    star: starName(star, lang),
    theme: lang === "zh-CN" ? fallback.zh : fallback.en,
    hint: table[star] ? (lang === "zh-CN" ? table[star].zh : table[star].en) : lang === "zh-CN" ? fallback.zh : fallback.en,
  };
}

function pick(
  table: Readonly<Record<string, { zh: string; en: string }>>,
  star: string,
  lang: FortuneLang,
): string {
  const entry = table[star];
  if (entry) return lang === "zh-CN" ? entry.zh : entry.en;
  return lang === "zh-CN" ? "顺其自然" : "let it be";
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function pillar(period: { heavenlyStem?: string; earthlyBranch?: string } | undefined): string {
  return `${period?.heavenlyStem ?? ""}${period?.earthlyBranch ?? ""}`;
}

/* -------------------------------------------------------------------------- */
/* 日期                                                                        */
/* -------------------------------------------------------------------------- */

/** 以北京时间算「今天」——主要用户在 +8 区，服务器可能是 UTC。 */
export function todayInShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 星期几：0 = 周日。用 UTC 中午算，不会被服务器时区推着跨日。 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function resolveDate(requested?: string): string {
  const today = todayInShanghai();
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return today;
  const delta = Math.abs(
    (Date.parse(`${requested}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return delta <= DATE_WINDOW_DAYS ? requested : today;
}

function isoDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function signOf(birthDate: Date, lang: FortuneLang): string {
  const month = birthDate.getUTCMonth() + 1;
  const day = birthDate.getUTCDate();
  for (let index = SIGNS.length - 1; index >= 0; index -= 1) {
    const [fromMonth, fromDay] = SIGNS[index].from;
    if (month > fromMonth || (month === fromMonth && day >= fromDay)) {
      return lang === "zh-CN" ? SIGNS[index].zh : SIGNS[index].en;
    }
  }
  const capricorn = SIGNS[SIGNS.length - 1];
  return lang === "zh-CN" ? capricorn.zh : capricorn.en;
}

/** 补到 n 条：优先用池子里没出现过的，其次直接补到长度够（池子本身有 5 条，够用）。 */
function padTo(list: string[], pool: ReadonlyArray<string>, n: number): string[] {
  const result = [...list];
  for (const item of pool) {
    if (result.length >= n) break;
    if (!result.includes(item)) result.push(item);
  }
  return result.slice(0, n);
}

/**
 * 把当天的四化按「飞进哪一宫」归到四个类目。
 *
 * 同一类目可能命中多个四化（比如财帛宫同时有禄和忌），按 `ji → lu → ke → quan`
 * 取一条：**先说坏消息**，因为「别大额支出」比「财上有进」更需要被看见。
 */
function aspectsOf(
  fourRaw: Record<AspectKind, string>,
  starPalace: Record<string, string>,
  lang: FortuneLang,
): AspectItem[] {
  const ids: AspectId[] = ["love", "family", "wealth", "action"];
  const kinds: AspectKind[] = ["lu", "quan", "ke", "ji"];

  return ids.map((id) => {
    const palaces = ASPECT_PALACES[id];
    const hits = kinds
      .map((kind) => ({ kind, palace: starPalace[fourRaw[kind]] }))
      .filter((hit) => Boolean(hit.palace) && palaces.includes(hit.palace))
      .sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind));

    const label = lang === "zh-CN" ? ASPECT_LABEL[id].zh : ASPECT_LABEL[id].en;
    const plainRating: AspectItem["rating"] = "even";
    if (hits.length === 0) {
      return {
        id,
        label,
        rating: plainRating,
        ratingLabel: lang === "zh-CN" ? RATING_LABEL[plainRating].zh : RATING_LABEL[plainRating].en,
        note: lang === "zh-CN" ? ASPECT_NOTE_PLAIN[id].zh : ASPECT_NOTE_PLAIN[id].en,
      };
    }

    const kind = hits[0].kind;
    const rating = ratingOf(kind);
    return {
      id,
      label,
      rating,
      ratingLabel: lang === "zh-CN" ? RATING_LABEL[rating].zh : RATING_LABEL[rating].en,
      note: lang === "zh-CN" ? ASPECT_NOTE[id][kind].zh : ASPECT_NOTE[id][kind].en,
    };
  });
}
