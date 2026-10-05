import { DiscoverService } from "./discover.service";

/**
 * PC-1.4 follow-up: Discovery reads the `User` row directly, so it used to
 * publish `bio` / `age` / `country` / `languages` / `interests` / `purposes`
 * regardless of `ProfileFieldVisibility`. A field set to "仅自己可见" was still
 * handed to every stranger in the recommendation card.
 *
 * These tests pin the projection to the same rule set `GET /users/:id` uses:
 * BLOCK > SELF > CONNECTION > PUBLIC, with "no row" meaning PUBLIC.
 */

type VisibilityRow = { fieldKey: string; visibility: string };

type Candidate = {
  id: string;
  nickname?: string | null;
  avatarUrl?: string | null;
  countryCode?: string | null;
  birthDate?: Date | null;
  bio?: string | null;
  gender?: string;
  city?: string | null;
  region?: string | null;
  languages?: Array<{
    languageCode: string;
    type: string;
    level: string;
    language: { name: string; nativeName: string | null };
  }>;
  interests?: Array<{ interest: { slug: string; name: string; nameZh: string | null } }>;
  purposes?: Array<{ purpose: { slug: string; name: string; nameZh: string | null } }>;
  preferredCountries?: Array<{
    countryCode: string;
    country: { name: string; flag: string | null };
  }>;
  fieldVisibilities?: VisibilityRow[];
  lastActiveAt?: Date | null;
};

function makePrisma(opts: {
  candidates: Candidate[];
  current?: Candidate | null;
  blocks?: Array<{ blockerId: string; blockedId: string }>;
  connections?: Array<{ userAId: string; userBId: string }>;
  /** P0-06: relationships already answered with REJECTED, in either direction. */
  declined?: Array<{ senderId: string; receiverId: string }>;
  /** Simulates a future change that loosens the exclusion query. */
  ignoreExclusions?: boolean;
}) {
  const blocks = opts.blocks ?? [];
  const connections = opts.connections ?? [];
  const declined = opts.declined ?? [];

  const hydrate = (c: Candidate) => ({
    id: c.id,
    nickname: c.nickname === undefined ? `nick-${c.id}` : c.nickname,
    avatarUrl: c.avatarUrl === undefined ? null : c.avatarUrl,
    countryCode: c.countryCode === undefined ? "US" : c.countryCode,
    birthDate: c.birthDate === undefined ? new Date("2000-01-01") : c.birthDate,
    bio: c.bio === undefined ? null : c.bio,
    gender: c.gender ?? "UNKNOWN",
    city: c.city === undefined ? null : c.city,
    region: c.region === undefined ? null : c.region,
    lastActiveAt: c.lastActiveAt === undefined ? new Date() : c.lastActiveAt,
    languages: c.languages ?? [],
    interests: c.interests ?? [],
    purposes: c.purposes ?? [],
    preferredCountries: c.preferredCountries ?? [],
    fieldVisibilities: c.fieldVisibilities ?? [],
  });

  return {
    discoverView: { findMany: jest.fn().mockResolvedValue([]) },
    block: {
      findMany: jest.fn(async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const me = where.OR[0].blockerId ?? where.OR[0].blockedId;
        return blocks.filter((b) => b.blockerId === me || b.blockedId === me);
      }),
    },
    connection: {
      findMany: jest.fn(async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const me = where.OR[0].userAId ?? where.OR[0].userBId;
        return connections.filter((c) => c.userAId === me || c.userBId === me);
      }),
    },
    /**
     * P0-06：`getRecommendations` 还会查「已明确拒绝」的关系（`status: "REJECTED"`），
     * 所以桩件也得有。默认空表，需要时用 `declined` 传入。
     */
    connectionRequest: {
      findMany: jest.fn(async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const me = where.OR[0].senderId ?? where.OR[0].receiverId;
        return declined.filter((r) => r.senderId === me || r.receiverId === me);
      }),
    },
    user: {
      findUnique: jest.fn(async () => (opts.current ? hydrate(opts.current) : null)),
      findMany: jest.fn(async ({ where }: { where: { id: { not: string; notIn: string[] } } }) => {
        const excluded = new Set([where.id.not, ...where.id.notIn]);
        const rows = opts.ignoreExclusions
          ? opts.candidates
          : opts.candidates.filter((c) => !excluded.has(c.id));
        return rows.map(hydrate);
      }),
    },
  };
}

const PHOTOGRAPHY = { slug: "photography", name: "Photography", nameZh: "摄影" };
const LANGUAGE_EXCHANGE = { slug: "language-exchange", name: "Language exchange", nameZh: "语言交换" };

/** The viewer shares one interest with most candidates and prefers Japan. */
const viewer: Candidate = {
  id: "A",
  interests: [{ interest: PHOTOGRAPHY }],
  preferredCountries: [{ countryCode: "JP", country: { name: "Japan", flag: "JP" } }],
};

/** The candidate's own country, mirroring how the card resolves name / flag. */
const OWN_COUNTRY = [{ countryCode: "JP", country: { name: "Japan", flag: "JP" } }];

function hasReason(items: Array<{ matchReasons: string[] }>, needle: string) {
  return items.some((item) => item.matchReasons.some((reason) => reason.includes(needle)));
}

function keysOf(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key.toLowerCase());
      keysOf(nested, keys);
    }
  }
  return keys;
}

describe("Discover privacy projection", () => {
  it("PRIVATE 字段：bio 对陌生人不可见，city/region/gender 从不出现在卡片里", async () => {
    const prisma = makePrisma({
      current: viewer,
      candidates: [
        {
          id: "B",
          bio: "秘密简介",
          city: "Tokyo",
          region: "Kanto",
          fieldVisibilities: [
            { fieldKey: "bio", visibility: "PRIVATE" },
            { fieldKey: "city", visibility: "PRIVATE" },
            { fieldKey: "region", visibility: "PRIVATE" },
            { fieldKey: "gender", visibility: "PRIVATE" },
          ],
        },
      ],
    });
    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].bio).toBeNull();
    expect(result.items[0]).not.toHaveProperty("city");
    expect(result.items[0]).not.toHaveProperty("region");
    expect(result.items[0]).not.toHaveProperty("gender");
  });

  it("CONNECTIONS 字段：陌生人看不到 interests/purposes，ACTIVE connection 能看到", async () => {
    const candidate: Candidate = {
      id: "B",
      interests: [{ interest: PHOTOGRAPHY }],
      purposes: [{ purpose: LANGUAGE_EXCHANGE }],
      fieldVisibilities: [
        { fieldKey: "interests", visibility: "CONNECTIONS" },
        { fieldKey: "purposes", visibility: "CONNECTIONS" },
      ],
    };

    const stranger = makePrisma({ current: viewer, candidates: [candidate] });
    const strangerResult = await new DiscoverService(stranger as never).getRecommendations("A", 20);
    expect(strangerResult.items[0].interests).toEqual([]);
    expect(strangerResult.items[0].purposes).toEqual([]);
    // 「共同兴趣：摄影」would otherwise hand over the hidden interest.
    expect(hasReason(strangerResult.items, "共同兴趣")).toBe(false);
    expect(hasReason(strangerResult.items, "交友目的相近")).toBe(false);

    // The exclusion query normally removes connections from the feed entirely,
    // so the stub is told to ignore exclusions to exercise the CONNECTION tier.
    const connected = makePrisma({
      current: viewer,
      candidates: [candidate],
      connections: [{ userAId: "A", userBId: "B" }],
      ignoreExclusions: true,
    });
    const connectedResult = await new DiscoverService(connected as never).getRecommendations("A", 20);
    expect(connectedResult.items[0].interests.map((row) => row.slug)).toEqual(["photography"]);
    expect(connectedResult.items[0].purposes.map((row) => row.slug)).toEqual(["language-exchange"]);
    expect(hasReason(connectedResult.items, "共同兴趣")).toBe(true);
  });

  it("Block 优先于所有层级：被拉黑的人即使进入候选集也完全不投影", async () => {
    const prisma = makePrisma({
      current: viewer,
      candidates: [
        { id: "B", bio: "公开简介", fieldVisibilities: [{ fieldKey: "bio", visibility: "PUBLIC" }] },
      ],
      blocks: [{ blockerId: "A", blockedId: "B" }],
      ignoreExclusions: true,
    });
    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);

    expect(result.items).toEqual([]);
  });

  it("没有 ProfileFieldVisibility row = PUBLIC", async () => {
    const prisma = makePrisma({ current: viewer, candidates: [{ id: "B", bio: "公开简介" }] });
    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);

    expect(result.items[0].bio).toBe("公开简介");
    expect(result.items[0].nickname).toBe("nick-B");
    expect(result.items[0].age).not.toBeNull();
  });
});

describe("Discover privacy projection — per field", () => {
  const candidate: Candidate = {
    id: "B",
    nickname: "Nick B",
    avatarUrl: "https://cdn.test/b.png",
    countryCode: "JP",
    preferredCountries: OWN_COUNTRY,
    bio: "简介",
  };

  it("nickname / avatarUrl / birthDate / countryCode 各自由自己的可见性决定", async () => {
    const hidden = makePrisma({
      current: viewer,
      candidates: [
        {
          ...candidate,
          fieldVisibilities: [
            { fieldKey: "nickname", visibility: "PRIVATE" },
            { fieldKey: "avatarUrl", visibility: "PRIVATE" },
            { fieldKey: "birthDate", visibility: "PRIVATE" },
            { fieldKey: "countryCode", visibility: "PRIVATE" },
          ],
        },
      ],
    });
    const hiddenResult = await new DiscoverService(hidden as never).getRecommendations("A", 20);
    const hiddenItem = hiddenResult.items[0];

    expect(hiddenItem.nickname).toBeNull();
    expect(hiddenItem.avatarUrl).toBeNull();
    expect(hiddenItem.age).toBeNull();
    expect(hiddenItem.countryCode).toBeNull();
    expect(hiddenItem.countryName).toBeNull();
    expect(hiddenItem.countryFlag).toBeNull();
    expect(hasReason(hiddenResult.items, "符合国家偏好")).toBe(false);

    const visible = makePrisma({ current: viewer, candidates: [candidate] });
    const visibleResult = await new DiscoverService(visible as never).getRecommendations("A", 20);
    const visibleItem = visibleResult.items[0];

    expect(visibleItem.nickname).toBe("Nick B");
    expect(visibleItem.avatarUrl).toBe("https://cdn.test/b.png");
    expect(visibleItem.age).not.toBeNull();
    expect(visibleItem.countryCode).toBe("JP");
    expect(visibleItem.countryName).toBe("Japan");
    expect(hasReason(visibleResult.items, "符合国家偏好")).toBe(true);
  });

  it("languages 为 PRIVATE 时返回空数组，且不给出「语言互补」理由", async () => {
    const ja = { languageCode: "JA", type: "NATIVE", level: "NATIVE", language: { name: "Japanese", nativeName: "日本語" } };
    const learning = { ...ja, type: "LEARNING", level: "B1" };
    const current: Candidate = { ...viewer, languages: [learning] };

    const hidden = makePrisma({
      current,
      candidates: [{ id: "B", languages: [ja], fieldVisibilities: [{ fieldKey: "languages", visibility: "PRIVATE" }] }],
    });
    const hiddenResult = await new DiscoverService(hidden as never).getRecommendations("A", 20);
    expect(hiddenResult.items[0].languages).toEqual([]);
    expect(hasReason(hiddenResult.items, "语言互补")).toBe(false);

    const visible = makePrisma({ current, candidates: [{ id: "B", languages: [ja] }] });
    const visibleResult = await new DiscoverService(visible as never).getRecommendations("A", 20);
    expect(visibleResult.items[0].languages.map((row) => row.code)).toEqual(["JA"]);
    expect(hasReason(visibleResult.items, "语言互补")).toBe(true);
  });

  it("响应契约固定，且递归 key 扫描不含敏感字段", async () => {
    const prisma = makePrisma({
      current: viewer,
      candidates: [{ id: "B", bio: "简介", city: "Tokyo", region: "Kanto" }],
    });
    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);

    expect(Object.keys(result.items[0]).sort()).toEqual([
      "age",
      "avatarUrl",
      "bio",
      "countryCode",
      "countryFlag",
      "countryName",
      "id",
      "interests",
      "languages",
      "matchReasons",
      "matchScore",
      "nickname",
      "purposes",
    ]);

    const keys = keysOf(result);
    for (const forbidden of [
      "email",
      "passwordhash",
      "tokenhash",
      "refreshtoken",
      "accesstoken",
      "oauth",
      "handle",
      "isadmin",
      "reviewstatus",
      "definitionid",
      "source",
      "gender",
      "city",
      "region",
      "preferredcountries",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("拒绝过我的人和我拒绝过的人都不再进推荐流（P0-06）", async () => {
    const baseline = makePrisma({ current: viewer, candidates: [{ id: "B" }, { id: "C" }, { id: "D" }] });
    // 没有拒绝关系时三个人都在 —— 否则下面的空结果证明不了是「拒绝」造成的。
    const before = await new DiscoverService(baseline as never).getRecommendations("A", 20);
    expect(before.items.map((item) => item.id).sort()).toEqual(["B", "C", "D"]);

    // 两个方向都要挡：B 拒绝过我，我拒绝过 C。
    const prisma = makePrisma({
      current: viewer,
      candidates: [{ id: "B" }, { id: "C" }, { id: "D" }],
      declined: [
        { senderId: "B", receiverId: "A" },
        { senderId: "A", receiverId: "C" },
      ],
    });

    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);
    expect(result.items.map((item) => item.id).sort()).toEqual(["D"]);
  });

  it("资料完整的候选多得完整度那 5 分（P0-06）", async () => {
    // 两个候选除「完整」外完全一致，所以分数差只可能来自完整度这一项。
    // 「完整」= `isProfileComplete`：nickname + birthDate；`hydrate` 默认给了 birthDate，
    // 所以缺 nickname 的那个就是不完整的那个。
    const prisma = makePrisma({
      current: viewer,
      candidates: [
        { id: "B", nickname: null },
        { id: "C", nickname: "有昵称" },
      ],
    });

    const result = await new DiscoverService(prisma as never).getRecommendations("A", 20);
    const incomplete = result.items.find((item) => item.id === "B")!;
    const complete = result.items.find((item) => item.id === "C")!;

    // COMPLETENESS_SCORE = 5。写死数字是故意的：改了权重这条用例就该红。
    expect(complete.matchScore - incomplete.matchScore).toBe(5);
    expect(hasReason(result.items, "资料较完整")).toBe(true);
    expect(incomplete.matchReasons).not.toContain("资料较完整");
  });
});
