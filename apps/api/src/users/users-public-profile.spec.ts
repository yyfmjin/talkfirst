import { UsersService } from "./users.service";

/**
 * 送花会产出通知，但这一组用例不涉及它 —— `UsersService` 的第二个依赖
 * 只需要一个够用的桩。
 */
const noopNotifications = () => ({ notify: jest.fn().mockResolvedValue(undefined) }) as never;

type UserRow = {
  id: string;
  email: string;
  status: string;
  nickname: string | null;
  avatarUrl: string | null;
  birthDate: Date | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  gender: string;
  bio: string | null;
  languages: Array<{ languageCode: string; type: string; level: string; language: { code: string; name: string; nativeName: string | null } }>;
  interests: Array<{ interest: { slug: string; name: string; nameZh: string | null; category: string } }>;
  purposes: Array<{ purpose: { slug: string; name: string; nameZh: string | null } }>;
  preferredCountries: Array<{ countryCode: string; country: { code: string; name: string; flag: string | null } }>;
  // PC-1.3: the public-profile query also loads the viewer-visible attribute
  // surface and the target's per-field visibility rows.
  attributes: Array<Record<string, unknown>>;
  fieldVisibilities: Array<{ fieldKey: string; visibility: string }>;
  /** 送花（虚拟礼物）：读资料时会投影收到花的朵数。 */
  flowerCount: number;
};

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "target-1",
    email: "target@example.com",
    status: "ACTIVE",
    nickname: "Alice",
    avatarUrl: "https://cdn.example.com/a.png",
    birthDate: new Date("1995-01-01"),
    countryCode: "US",
    city: null,
    region: null,
    gender: "FEMALE",
    bio: "hi",
    languages: [{ languageCode: "en", type: "NATIVE", level: "NATIVE", language: { code: "en", name: "English", nativeName: "English" } }],
    interests: [{ interest: { slug: "gaming", name: "Gaming", nameZh: null, category: "Hobby" } }],
    purposes: [{ purpose: { slug: "language-exchange", name: "Language exchange", nameZh: null } }],
    preferredCountries: [{ countryCode: "JP", country: { code: "JP", name: "Japan", flag: "🇯🇵" } }],
    attributes: [],
    fieldVisibilities: [],
    flowerCount: 0,
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(makeUser()),
    },
    block: { findFirst: jest.fn().mockResolvedValue(null) },
    userFlower: { findUnique: jest.fn().mockResolvedValue(null) },
    connection: { findFirst: jest.fn().mockResolvedValue({ id: "conn-1" }) },
    country: { findUnique: jest.fn().mockResolvedValue({ code: "US", name: "United States", flag: "🇺🇸" }) },
    ...overrides,
  };
}

describe("UsersService.getPublicProfile", () => {
  it("returns a sanitized profile with no email / admin / status fields", async () => {
    const prisma = makePrisma();
    const service = new UsersService(prisma as never, noopNotifications());
    const profile = await service.getPublicProfile("target-1", "viewer-1");

    expect(profile.id).toBe("target-1");
    expect(profile.nickname).toBe("Alice");
    expect(profile.age).toBeGreaterThan(0);
    expect(profile.countryName).toBe("United States");
    expect(profile.relationship.isConnected).toBe(true);
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("emailVerified");
    expect(profile).not.toHaveProperty("isAdmin");
    expect(profile).not.toHaveProperty("status");
  });

  it("rejects a blocked target in either direction", async () => {
    const prisma = makePrisma({ block: { findFirst: jest.fn().mockResolvedValue({ id: "b1" }) } });
    const service = new UsersService(prisma as never, noopNotifications());
    await expect(service.getPublicProfile("target-1", "viewer-1")).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
  });

  it("treats a non-ACTIVE target as not found", async () => {
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue(makeUser({ status: "BANNED" })) },
    });
    const service = new UsersService(prisma as never, noopNotifications());
    await expect(service.getPublicProfile("target-1", "viewer-1")).rejects.toMatchObject({
      response: { error: { code: "USER_NOT_FOUND" } },
    });
  });

  it("allows self to view their own profile regardless of status", async () => {
    const prisma = makePrisma({
      user: { findUnique: jest.fn().mockResolvedValue(makeUser({ status: "DISABLED" })) },
      block: { findFirst: jest.fn() },
      connection: { findFirst: jest.fn() },
    });
    const service = new UsersService(prisma as never, noopNotifications());
    const profile = await service.getPublicProfile("target-1", "target-1");
    expect(profile.relationship.isSelf).toBe(true);
    expect(prisma.block.findFirst).not.toHaveBeenCalled();
  });

  /**
   * P0-04 的矩阵里唯一缺的一格：**本人**读自己的 PRIVATE 字段。
   * `docs/P0-04-PRIVACY.md` §3 把它列为「唯一建议补的一处（未做）」——
   * 当时只有 E2E 覆盖，API 级没有断言。
   *
   * 两个视角读的是同一行 fixture，所以能让结果不同的是视角本身，
   * 而视角正是 `canViewField` 负责的那一处（BLOCK > SELF > CONNECTION > PUBLIC）。
   * 顺带把它不是「连上了就能看」也钉住：stranger 在这里确实是 connected，PRIVATE 依旧不可见。
   */
  it("owner reads their own PRIVATE fields; a connected stranger reading the same row does not", async () => {
    const prisma = makePrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue(
          makeUser({
            bio: "only for me",
            fieldVisibilities: [
              { fieldKey: "bio", visibility: "PRIVATE" },
              { fieldKey: "languages", visibility: "PRIVATE" },
            ],
          }),
        ),
      },
    });
    const service = new UsersService(prisma as never, noopNotifications());

    const own = await service.getPublicProfile("target-1", "target-1");
    expect(own.relationship.isSelf).toBe(true);
    expect(own.bio).toBe("only for me");
    expect(own.languages.map((row) => row.code)).toEqual(["en"]);

    // `makePrisma` 默认给出 connection，所以这里同时是「已连接但不是本人」。
    const stranger = await service.getPublicProfile("target-1", "viewer-1");
    expect(stranger.relationship).toEqual({ isSelf: false, isConnected: true });
    expect(stranger.bio).toBeNull();
    expect(stranger.languages).toEqual([]);
  });
});
