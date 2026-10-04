import {
  DiscoverService,
  matchesCategoryKeywords,
  parseCategoryKeywords,
} from "./discover.service";

/**
 * Category keywords, and the fallback that keeps the built-in tabs working.
 *
 * ## Why the fallback has its own cases
 *
 * A fresh deployment has no `DiscoverCategory` rows, and the feature must not make the
 * tabs disappear on the day it ships. The fallback is therefore load-bearing rather than
 * defensive, and the two built-in slugs are pinned so a future edit to the table cannot
 * silently change what an existing client receives.
 *
 * ## NOT RUN
 *
 * No database: `PrismaService` is a stub, so this covers parsing, matching and the
 * fallback decision — not the ranking or the SQL.
 */

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

describe("parseCategoryKeywords", () => {
  it("按逗号切分", () => {
    expect(parseCategoryKeywords("minecraft,steam,gaming")).toEqual(["minecraft", "steam", "gaming"]);
  });

  it("容忍空格，因此手工输入不会产生失效关键词", () => {
    /**
     * An operator typing `a, b ,c` must not end up with the keyword ` b ` — it would never
     * match a slug and the tab would silently be narrower than intended.
     */
    expect(parseCategoryKeywords(" a, b ,  c ")).toEqual(["a", "b", "c"]);
  });

  it("统一小写，避免大小写不同导致匹配失败", () => {
    expect(parseCategoryKeywords("Steam,MINECRAFT")).toEqual(["steam", "minecraft"]);
  });

  it("丢弃空项（连续逗号、结尾逗号）", () => {
    expect(parseCategoryKeywords("a,,b,")).toEqual(["a", "b"]);
  });

  it("null / undefined / 空串都得到空数组", () => {
    expect(parseCategoryKeywords(null)).toEqual([]);
    expect(parseCategoryKeywords(undefined)).toEqual([]);
    expect(parseCategoryKeywords("")).toEqual([]);
    expect(parseCategoryKeywords("  ,  , ")).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Matching                                                                   */
/* -------------------------------------------------------------------------- */

describe("matchesCategoryKeywords", () => {
  const card = {
    interests: [{ slug: "steam" }, { slug: "minecraft" }],
    purposes: [{ slug: "language-exchange" }],
  };

  it("空关键词表示不过滤（而不是过滤掉所有人）", () => {
    /**
     * The distinction that matters: an unconfigured category must not show an empty wall to
     * every member. Empty means "no filter", and the caller treats it as `all`.
     */
    expect(matchesCategoryKeywords([], card)).toBe(true);
  });

  it("命中兴趣 slug", () => {
    expect(matchesCategoryKeywords(["steam"], card)).toBe(true);
  });

  it("命中交友目的 slug", () => {
    expect(matchesCategoryKeywords(["language-exchange"], card)).toBe(true);
  });

  it("任意一个关键词命中即可", () => {
    expect(matchesCategoryKeywords(["nothing", "minecraft"], card)).toBe(true);
  });

  it("全不命中时排除", () => {
    expect(matchesCategoryKeywords(["valorant"], card)).toBe(false);
  });

  it("关键词大小写不影响匹配", () => {
    // The service lower-cases on the way in, but a hand-edited row must still work.
    expect(matchesCategoryKeywords(["STEAM"], card)).toBe(true);
  });

  it("候选没有任何兴趣/目的时不匹配非空关键词，但匹配空关键词", () => {
    const empty = { interests: [], purposes: [] };
    expect(matchesCategoryKeywords(["steam"], empty)).toBe(false);
    expect(matchesCategoryKeywords([], empty)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Tab list and fallback                                                      */
/* -------------------------------------------------------------------------- */

type CategoryRow = { slug: string; label: string; labelZh: string | null; keywords: string };

function makeService(rows: CategoryRow[] = [], options: { fail?: boolean } = {}) {
  const findMany = jest.fn(async () => {
    if (options.fail) throw new Error("db down");
    return rows;
  });
  const findFirst = jest.fn(async (args: { where: { slug: string } }) => {
    if (options.fail) throw new Error("db down");
    return rows.find((row) => row.slug === args.where.slug) ?? null;
  });

  const prisma = {
    discoverCategory: { findMany, findFirst },
    discoverView: { findMany: jest.fn(async () => []) },
    block: { findMany: jest.fn(async () => []) },
    connection: { findMany: jest.fn(async () => []) },
    // P0-06：推荐现在会排除「已明确拒绝」的关系；返回空表，无用例依赖它。
    connectionRequest: { findMany: jest.fn(async () => []) },
    user: {
      // `getRecommendations` refuses an unknown viewer before it does anything else, so the
      // stub has to yield a plausible row for the filter assertions to be reachable.
      findUnique: jest.fn(async () => ({
        id: "u1",
        countryCode: null,
        languages: [],
        interests: [],
        purposes: [],
        fieldVisibilities: [],
      })),
      findMany: jest.fn(async () => []),
    },
  };

  return { service: new DiscoverService(prisma as never), findMany, findFirst, prisma };
}

describe("DiscoverService.listCategories", () => {
  it("始终以「全部」开头，且它不是数据库行", async () => {
    // Storing `all` as a row would let an administrator deactivate the unfiltered view.
    const { service } = makeService([{ slug: "travel", label: "Travel", labelZh: "旅行", keywords: "travel" }]);
    const tabs = await service.listCategories();
    expect(tabs[0]).toMatchObject({ id: "all" });
    expect(tabs[0].keywords).toEqual([]);
  });

  it("有类别行时使用数据库的值", async () => {
    const { service } = makeService([
      { slug: "travel", label: "Travel", labelZh: "旅行", keywords: "travel,backpacking" },
    ]);
    const tabs = await service.listCategories();

    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ id: "travel", label: "旅行" });
    expect(tabs[1].keywords).toEqual(["travel", "backpacking"]);
  });

  it("labelZh 为空时回落到 label", async () => {
    const { service } = makeService([{ slug: "travel", label: "Travel", labelZh: null, keywords: "travel" }]);
    const tabs = await service.listCategories();
    expect(tabs[1].label).toBe("Travel");
  });

  it("没有任何类别行时回落到内置两组", async () => {
    /**
     * The state a fresh deployment is in. Without this the discovery screen would ship with
     * only 「全部」, which is a visible regression from two tabs to one.
     */
    const { service } = makeService([]);
    const tabs = await service.listCategories();

    expect(tabs.map((tab) => tab.id)).toEqual(["all", "language", "gaming"]);
    expect(tabs[1].keywords).toEqual(["language-exchange"]);
    expect(tabs[2].keywords).toContain("minecraft");
  });

  it("读库失败时也回落到内置两组，而不是让页面没有标签", async () => {
    const { service } = makeService([], { fail: true });
    const tabs = await service.listCategories();
    expect(tabs.map((tab) => tab.id)).toEqual(["all", "language", "gaming"]);
  });
});

describe("DiscoverService — filter 解析", () => {
  it("未配置的关键词按不过滤处理，而不是显示空墙", async () => {
    /**
     * An active category with an empty keyword list is "not configured yet". Treating it as
     * a filter that matches nothing would empty the discovery wall for every member until
     * someone finishes typing keywords.
     */
    const { service } = makeService([{ slug: "travel", label: "Travel", labelZh: null, keywords: "" }]);
    const result = await service.getRecommendations("u1", 20, "travel");
    expect(result.filter).toBe("all");
  });

  it("未知 slug 按不过滤处理（陈旧标签页不会报错）", async () => {
    const { service } = makeService([]);
    const result = await service.getRecommendations("u1", 20, "not-a-category");
    expect(result.filter).toBe("all");
  });

  it("内置 slug 在没有数据库行时仍然生效", async () => {
    const { service } = makeService([]);
    const result = await service.getRecommendations("u1", 20, "gaming");
    // The built-in slug is honoured rather than silently downgraded to `all`.
    expect(result.filter).toBe("gaming");
  });

  it("数据库行覆盖内置 slug", async () => {
    const { service } = makeService([
      { slug: "gaming", label: "Games", labelZh: "游戏", keywords: "chess" },
    ]);
    const result = await service.getRecommendations("u1", 20, "gaming");
    expect(result.filter).toBe("gaming");
  });

  it("all 与空值都不过滤", async () => {
    const { service } = makeService([]);
    await expect(service.getRecommendations("u1", 20, "all")).resolves.toMatchObject({ filter: "all" });
    await expect(service.getRecommendations("u1", 20, undefined)).resolves.toMatchObject({ filter: "all" });
  });
});
