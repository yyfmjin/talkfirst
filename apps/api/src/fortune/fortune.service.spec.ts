import { FortuneService, fnv1a, mulberry32, pickDistinct, todayInShanghai, weekdayOf } from "./fortune.service";
import { DONTS, DOS } from "./fortune.copy";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * 每日占卜卡片（2026-10-30）。
 *
 * 这一组测试钉住的是**可信度**，不是排版：
 *
 *   1. **刷新不能重投**。同一个人同一天，连调两次必须字节一致 —— 否则用户刷新
 *      一次「宜忌」就变一次，这东西立刻从「占卜」变成「抽奖」。
 *   2. **宜忌不能撞车**。同一句话既「宜」又「忌」是纯 bug，但随机取样的写法很容易
 *      不小心放进来。
 *   3. **没有出生日期也要能用**。老用户里有一部分没填生日，卡片要降级（星座/紫微
 *      为 null），而不是 500。
 *   4. **中英切换不改变内容**。两种语言必须是同一张卡的两个译本（幸运数字一致），
 *      而不是各抽一次。
 */

function serviceWith(birthDate: Date | null, gender: "MALE" | "FEMALE" | "UNKNOWN" = "FEMALE") {
  const prisma = {
    user: { findUnique: async () => ({ birthDate, gender }) },
  };
  return new FortuneService(prisma as unknown as PrismaService);
}

const BIRTH = new Date("1998-06-15T00:00:00.000Z");

describe("FortuneService.today", () => {
  it("同一个人同一天：两次结果完全一致（刷新不重投）", async () => {
    const service = serviceWith(BIRTH);
    const first = await service.today("user-a", "zh-CN", "2026-10-30");
    const second = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(second).toEqual(first);
  });

  it("换一天会变（不然就是一张写死的卡）", async () => {
    const service = serviceWith(BIRTH);
    const base = await service.today("user-a", "zh-CN", "2026-10-30");
    const others = await Promise.all(
      ["2026-10-31", "2026-11-01", "2026-10-29"].map((date) =>
        service.today("user-a", "zh-CN", date),
      ),
    );
    const same = others.filter(
      (card) =>
        card.horoscope === base.horoscope &&
        card.luckyNumbers.join() === base.luckyNumbers.join() &&
        card.dos.join() === base.dos.join(),
    );
    expect(same).toHaveLength(0);
  });

  it("不同用户同一天：不是同一张卡", async () => {
    const service = serviceWith(BIRTH);
    const a = await service.today("user-a", "zh-CN", "2026-10-30");
    const b = await service.today("user-b", "zh-CN", "2026-10-30");
    expect(JSON.stringify(b)).not.toEqual(JSON.stringify(a));
  });

  it("宜忌各两条，各自来自自己的池子（不再共用一个池）", async () => {
    const service = serviceWith(BIRTH);
    const card = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(card.dos).toHaveLength(2);
    expect(card.donts).toHaveLength(2);
    const dos = DOS.map((item) => item.zh);
    const donts = DONTS.map((item) => item.zh);
    expect(new Set(card.dos).size).toBe(2);
    expect(new Set(card.donts).size).toBe(2);
    card.dos.forEach((item) => expect(dos).toContain(item));
    card.donts.forEach((item) => expect(donts).toContain(item));
    /* 两个池子本身不能有交集，不然「忌 早点睡」那种语病会回来。 */
    expect(dos.filter((item) => donts.includes(item))).toHaveLength(0);
  });

  it("幸运数字：三个、1..9、去重、升序", async () => {
    const service = serviceWith(BIRTH);
    const card = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(card.luckyNumbers).toHaveLength(3);
    expect(new Set(card.luckyNumbers).size).toBe(3);
    expect(card.luckyNumbers).toEqual([...card.luckyNumbers].sort((x, y) => x - y));
    card.luckyNumbers.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(9);
    });
  });

  it("星期几算对：2026-10-30 是周五", async () => {
    const service = serviceWith(BIRTH);
    const card = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(card.date).toBe("2026-10-30");
    expect(card.weekday).toBe(5);
  });

  it("没有出生日期：星座与紫微为 null，其余照常", async () => {
    const service = serviceWith(null);
    const card = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(card.sign).toBeNull();
    expect(card.ziwei).toBeNull();
    expect(card.dos).toHaveLength(2);
    expect(card.luckyNumbers).toHaveLength(3);
    expect(card.horoscope.length).toBeGreaterThan(0);
  });

  it("有出生日期：紫微四化齐全，时辰标记为推定", async () => {
    const service = serviceWith(BIRTH, "FEMALE");
    const card = await service.today("user-a", "zh-CN", "2026-10-30");
    expect(card.sign).toBe("双子座");
    expect(card.ziwei).not.toBeNull();
    const ziwei = card.ziwei!;
    expect(ziwei.assumedHour).toBe(true);
    expect(ziwei.soul.length).toBeGreaterThan(0);
    expect(ziwei.body.length).toBeGreaterThan(0);
    expect([ziwei.lu, ziwei.quan, ziwei.ke, ziwei.ji].every((star) => star.length > 0)).toBe(true);
    expect(ziwei.ganzhi.length).toBeGreaterThan(0);
    /* 中文环境下农历要有；拿不到时是 null —— 两种都允许，但不能是空串。 */
    expect(ziwei.lunar === null || ziwei.lunar.length > 0).toBe(true);
  });

  it("英文：内容里没有中文，紫微用拼音", async () => {
    const service = serviceWith(BIRTH);
    const card = await service.today("user-a", "en", "2026-10-30");
    const cjk = /[\u4e00-\u9fff]/;
    expect(card.sign).toBe("Gemini");
    expect(card.dos.concat(card.donts, [card.horoscope, card.luckyColor.name]).some((text) => cjk.test(text))).toBe(false);
    expect(card.ziwei).not.toBeNull();
    expect(cjk.test(card.ziwei!.soul)).toBe(false);
    expect(card.ziwei!.lunar).toBeNull();
    expect(card.ziwei!.ganzhi).toMatch(/^[A-Za-z]+(-[A-Za-z]+)?$/);
  });

  it("中英是同一张卡：幸运数字与宜忌条数一致", async () => {
    const service = serviceWith(BIRTH);
    const zh = await service.today("user-a", "zh-CN", "2026-10-30");
    const en = await service.today("user-a", "en", "2026-10-30");
    expect(en.luckyNumbers).toEqual(zh.luckyNumbers);
    expect(en.luckyColor.hex).toBe(zh.luckyColor.hex);
    expect(en.dos).toHaveLength(zh.dos.length);
  });

  it("日期参数超出窗口或格式非法时退回今天", async () => {
    const service = serviceWith(BIRTH);
    const today = todayInShanghai();
    expect((await service.today("user-a", "zh-CN", "1999-01-01")).date).toBe(today);
    expect((await service.today("user-a", "zh-CN", "2026/10/30")).date).toBe(today);
    expect((await service.today("user-a", "zh-CN")).date).toBe(today);
  });
});

describe("确定性随机的底座", () => {
  it("fnv1a 稳定且区分输入", () => {
    expect(fnv1a("a|b")).toBe(fnv1a("a|b"));
    expect(fnv1a("a|b")).not.toBe(fnv1a("a|c"));
  });

  it("mulberry32 同种子同序列", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("pickDistinct 不放回", () => {
    const random = mulberry32(7);
    const picked = pickDistinct(random, 10, 4);
    expect(new Set(picked).size).toBe(4);
    picked.forEach((index) => {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(10);
    });
  });

  it("weekdayOf 用 UTC 中午，不受时区影响", () => {
    expect(weekdayOf("2026-10-30")).toBe(5);
    expect(weekdayOf("2026-11-01")).toBe(0);
  });
});
