import { FortuneService, todayInShanghai, weekdayOf } from "./fortune.service";
import { STAR_DO, STAR_DONT } from "./fortune.copy";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * 每日运势卡片（2026-10-31 第二版）。
 *
 * 这一版的取数原则是：**能算的算，算不出的不编**。所以测试钉的也是这个：
 *
 *   1. 同一个人同一天，两次调用必须一模一样（刷新不能重投）；
 *   2. 幸运数字来自日柱的河图数，落在 1..9 且不重复；
 *   3. 没有出生日期时**明确降级**（four / month / year / chart 全为 null），
 *      而不是拿随机内容冒充命盘；
 *   4. 有出生日期时，四化四项齐全，且「忌」确实取自化忌那颗星对应的条目
 *      —— 这是「有依据」的可回归锚点。
 */

function serviceWith(birthDate: Date | null, gender: "MALE" | "FEMALE" | "UNKNOWN" = "FEMALE") {
  const prisma = { user: { findUnique: async () => ({ birthDate, gender }) } };
  return new FortuneService(prisma as unknown as PrismaService);
}

const BIRTH = new Date("1998-06-15T00:00:00.000Z");
const DAY = "2026-10-31";

describe("FortuneService.today", () => {
  it("同一个人同一天：两次结果完全一致", async () => {
    const service = serviceWith(BIRTH);
    expect(await service.today("u1", "zh-CN", DAY)).toEqual(await service.today("u1", "zh-CN", DAY));
  });

  it("幸运数字：三个、1..9、不乱序、不重复", async () => {
    const card = await serviceWith(BIRTH).today("u1", "zh-CN", DAY);
    expect(card.luckyNumbers).toHaveLength(3);
    expect(new Set(card.luckyNumbers).size).toBe(3);
    expect(card.luckyNumbers).toEqual([...card.luckyNumbers].sort((a, b) => a - b));
    card.luckyNumbers.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(9);
    });
  });

  it("干支与五行非空（2026-10-31 是戊寅日，土木）", async () => {
    const card = await serviceWith(BIRTH).today("u1", "zh-CN", DAY);
    expect(card.ganzhi).toBe("戊寅");
    expect(card.element).toBe("土·木");
    expect(card.weekday).toBe(6); // 周六
  });

  it("没有出生日期：四化/流月/流年/命盘全部为 null，宜忌仍给三条", async () => {
    const card = await serviceWith(null).today("u1", "zh-CN", DAY);
    expect(card.sign).toBeNull();
    expect(card.four).toBeNull();
    expect(card.month).toBeNull();
    expect(card.year).toBeNull();
    expect(card.chart).toBeNull();
    expect(card.dos).toHaveLength(3);
    expect(card.donts).toHaveLength(3);
    card.dos.concat(card.donts).forEach((line) => expect(line.length).toBeGreaterThan(0));
  });

  it("有出生日期：四化四项齐全，流月流年有干支与四星，命盘信息齐全", async () => {
    const card = await serviceWith(BIRTH).today("u1", "zh-CN", DAY);
    expect(card.sign).toBe("双子座");

    const four = card.four!;
    for (const item of [four.lu, four.quan, four.ke, four.ji]) {
      expect(item.star.length).toBeGreaterThan(0);
      expect(item.theme.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
    }

    expect(card.month?.ganzhi).toBeTruthy();
    expect(card.month?.stars).toHaveLength(4);
    expect(card.year?.stars).toHaveLength(4);

    expect(card.chart?.palaceStars.length).toBeGreaterThan(0);
    expect(card.chart?.soul.length).toBeGreaterThan(0);
    expect(card.chart?.body.length).toBeGreaterThan(0);
    expect(card.chart?.fiveElements.length).toBeGreaterThan(0);
  });

  it("宜忌不是随机词：化忌那颗星的针对性条目一定出现在「忌」里", async () => {
    const card = await serviceWith(BIRTH).today("u1", "zh-CN", DAY);
    const jiStar = card.four!.ji.star;
    const specific = STAR_DONT[jiStar]?.zh;
    /* 四化可能在 20 颗星之外（右弼之类已覆盖）；覆盖不到时退化到通用条目，这里只断言「有兜底」。 */
    if (specific) expect(card.donts).toContain(specific);
    else expect(card.donts.length).toBe(3);
  });

  it("「宜」取自化禄/化权/化科三颗星对应的条目", async () => {
    const card = await serviceWith(BIRTH).today("u1", "zh-CN", DAY);
    const four = card.four!;
    const expected = [four.lu.star, four.ke.star, four.quan.star]
      .map((star) => STAR_DO[star]?.zh)
      .filter((text): text is string => Boolean(text));
    expected.forEach((text) => expect(card.dos).toContain(text));
  });

  it("英文：没有中文字符残留（含五行局）", async () => {
    const card = await serviceWith(BIRTH).today("u1", "en", DAY);
    const cjk = /[\u4e00-\u9fff]/;
    const texts = [
      card.ganzhi,
      card.element,
      card.sign ?? "",
      card.luckyColor.name,
      card.chart?.fiveElements ?? "",
      card.chart?.soul ?? "",
      ...card.dos,
      ...card.donts,
      card.four!.lu.star,
      card.four!.ji.star,
    ];
    texts.forEach((text) => expect(cjk.test(text)).toBe(false));
  });

  it("日期参数越界或格式非法时退回今天", async () => {
    const service = serviceWith(BIRTH);
    const today = todayInShanghai();
    expect((await service.today("u1", "zh-CN", "1999-01-01")).date).toBe(today);
    expect((await service.today("u1", "zh-CN", "2026/10/31")).date).toBe(today);
  });
});

describe("日期工具", () => {
  it("weekdayOf 用 UTC 中午算，不受服务器时区影响", () => {
    expect(weekdayOf("2026-10-31")).toBe(6);
    expect(weekdayOf("2026-11-01")).toBe(0);
  });
});
