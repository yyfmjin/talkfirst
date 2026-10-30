import { Injectable } from "@nestjs/common";
import type { Gender } from "@prisma/client";
import { astro } from "iztro";
import { PrismaService } from "../prisma/prisma.service";
import {
  ADVICE,
  COLORS,
  DONTS,
  DOS,
  SIGNS,
  THEMES,
  ganzhiToEnglish,
  starName,
  type FortuneLang,
} from "./fortune.copy";

export type FortuneCard = {
  /** 用户当地的公历日期 `YYYY-MM-DD`。 */
  date: string;
  /** 0 = 周日。客户端自己决定「周五 /Fri」。 */
  weekday: number;
  /** 太阳星座，按出生日期算；没有出生日期时为 null。 */
  sign: string | null;
  luckyNumbers: number[];
  luckyColor: { name: string; hex: string };
  /** 「宜」两条。 */
  dos: string[];
  /** 「忌」两条，与 `dos` 不重叠。 */
  donts: string[];
  /** 一句话运势。 */
  horoscope: string;
  /** 紫微斗数部分：需要有出生日期。 */
  ziwei: {
    /** 当天农历，如 `二〇二六年九月廿一`；英文环境下为 null。 */
    lunar: string | null;
    /** 当天日柱，如 `丁丑` / `Ding-Chou`。 */
    ganzhi: string;
    soul: string;
    body: string;
    palaceStar: string | null;
    lu: string;
    quan: string;
    ke: string;
    ji: string;
    /**
     * 出生时辰是按午时（11:00–13:00）假定的。
     *
     * 资料里只有「出生日期」，没有时辰；而紫微排盘十二个时辰命宫就落十二个位置，
     * 差一个时辰命盘完全不同。与其假装精确，不如把这个事实交给界面去说。
     */
    assumedHour: boolean;
  } | null;
};

/** 午时（11:00–13:00）在 iztro 的 timeIndex 里是 6。 */
const ASSUMED_TIME_INDEX = 6;
/** 允许客户端指定日期，但只接受前后两天内的（防止预生成/刷历史）。 */
const DATE_WINDOW_DAYS = 2;

@Injectable()
export class FortuneService {
  /** 当天农历/干支与用户无关，按日期缓存，省掉每次请求都排一次盘。 */
  private readonly dayCache = new Map<string, { lunar: string; ganzhi: string }>();

  constructor(private readonly prisma: PrismaService) {}

  async today(userId: string, lang: FortuneLang, requestedDate?: string): Promise<FortuneCard> {
    const date = resolveDate(requestedDate);
    const random = mulberry32(fnv1a(`${userId}|${date}|v1`));

    const [doA, doB] = pickDistinct(random, DOS.length, 2);
    const [dontA, dontB] = pickDistinct(random, DONTS.length, 2);
    const color = COLORS[pick(random, COLORS.length)];
    const theme = THEMES[pick(random, THEMES.length)];
    const advice = ADVICE[pick(random, ADVICE.length)];
    const luckyNumbers = pickDistinct(random, 9, 3).map((index) => index + 1).sort((a, b) => a - b);

    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true, gender: true },
    });

    const day = this.dayInfo(date);

    return {
      date,
      weekday: weekdayOf(date),
      sign: profile?.birthDate ? signOf(profile.birthDate, lang) : null,
      luckyNumbers,
      luckyColor: { name: lang === "zh-CN" ? color.zh : color.en, hex: color.hex },
      dos: [DOS[doA], DOS[doB]].map((item) => (lang === "zh-CN" ? item.zh : item.en)),
      donts: [DONTS[dontA], DONTS[dontB]].map((item) => (lang === "zh-CN" ? item.zh : item.en)),
      horoscope:
        lang === "zh-CN" ? `${theme.zh}：${advice.zh}。` : `${theme.en} — ${advice.en}.`,
      ziwei: profile?.birthDate
        ? this.ziwei(profile.birthDate, profile.gender, date, lang, day)
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
      /* 排盘失败不该让整张卡片挂掉：没有农历就当没有，其余照常。 */
      return { lunar: "", ganzhi: "" };
    }
  }

  private ziwei(
    birthDate: Date,
    gender: Gender,
    date: string,
    lang: FortuneLang,
    day: { lunar: string; ganzhi: string },
  ): NonNullable<FortuneCard["ziwei"]> | null {
    try {
      const birth = isoDate(birthDate);
      const chart = astro.bySolar(
        birth,
        ASSUMED_TIME_INDEX,
        gender === "FEMALE" ? "女" : "男",
        true,
        "zh-CN",
      );
      const soulPalace = chart.palaces.find((palace) => palace.name === "命宫");
      const palaceStar = soulPalace?.majorStars?.[0]?.name ?? null;
      const daily = chart.horoscope(date).daily;
      const [lu, quan, ke, ji] = daily.mutagen ?? [];
      if (!lu || !quan || !ke || !ji) return null;

      return {
        lunar: lang === "zh-CN" ? day.lunar || null : null,
        ganzhi: lang === "zh-CN" ? day.ganzhi : ganzhiToEnglish(day.ganzhi),
        soul: starName(chart.soul, lang),
        body: starName(chart.body, lang),
        palaceStar: palaceStar ? starName(palaceStar, lang) : null,
        lu: starName(lu, lang),
        quan: starName(quan, lang),
        ke: starName(ke, lang),
        ji: starName(ji, lang),
        assumedHour: true,
      };
    } catch {
      return null;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 确定性随机                                                                  */
/* -------------------------------------------------------------------------- */

/** FNV-1a：把 `userId|date` 压成一个 32 位种子。不用 `Math.random`，刷新要稳定。 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32：小而够用的确定性 PRNG。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random: () => number, length: number): number {
  return Math.floor(random() * length) % length;
}

/** 不放回地挑 `count` 个下标 —— 宜和忌不能撞车。 */
export function pickDistinct(random: () => number, length: number, count: number): number[] {
  const pool = Array.from({ length }, (_, index) => index);
  const picked: number[] = [];
  for (let index = 0; index < count && pool.length > 0; index += 1) {
    const at = pick(random, pool.length);
    picked.push(pool.splice(at, 1)[0]);
  }
  return picked;
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

function resolveDate(requested?: string): string {
  const today = todayInShanghai();
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return today;
  const delta = Math.abs(
    (Date.parse(`${requested}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  return delta <= DATE_WINDOW_DAYS ? requested : today;
}

/** 星期几：0 = 周日。用 UTC 中午算，不会被服务器时区推着跨日。 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
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
  /* 从 12 月往回找第一个「出生日在它之后」的起点；1 月初会落到摩羯。 */
  for (let index = SIGNS.length - 1; index >= 0; index -= 1) {
    const [fromMonth, fromDay] = SIGNS[index].from;
    if (month > fromMonth || (month === fromMonth && day >= fromDay)) {
      return lang === "zh-CN" ? SIGNS[index].zh : SIGNS[index].en;
    }
  }
  const capricorn = SIGNS[SIGNS.length - 1];
  return lang === "zh-CN" ? capricorn.zh : capricorn.en;
}
