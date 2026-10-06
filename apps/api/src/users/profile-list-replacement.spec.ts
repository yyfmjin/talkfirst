import { UsersService } from "./users.service";

/**
 * FIX (audit P001) — replacing a profile list must never be able to ERASE it.
 *
 * The defect, exactly:
 *
 *   `replaceLanguages` validated the payload with `new Set(codes)` — the set of
 *   DISTINCT CODES — but the database's unique key is
 *   `(userId, languageCode, type)`. A payload such as
 *
 *     [{ code: "en", type: "NATIVE" }, { code: "en", type: "LEARNING" }]
 *
 *   therefore passed validation, and `createMany` then violated
 *   `UserLanguage_userId_languageCode_type_key`. Meanwhile `deleteMany` had
 *   already been sent as its OWN autocommit statement, so every language the
 *   user had was gone by the time the insert failed. The controller wrapped the
 *   whole thing in a bare `catch {}` and reported `UNKNOWN_LANGUAGE_CODE`, so
 *   the failure looked like bad input while the data was permanently lost.
 *
 * These cases pin both halves of the fix: the payload is de-duplicated on the
 * real uniqueness key, and the delete + insert pair is one transaction.
 */

type Args = { data?: Array<Record<string, unknown>>; where?: Record<string, unknown> };

function makePrisma(options: { userRow?: unknown } = {}) {
  const calls: { transactionBodies: number } = { transactionBodies: 0 };
  const prisma = {
    language: { findMany: jest.fn(async ({ where }: { where: { code: { in: string[] } } }) => where.code.in.map((code) => ({ code }))) },
    interest: { findMany: jest.fn(async ({ where }: { where: { slug: { in: string[] } } }) => where.slug.in.map((slug) => ({ id: `i-${slug}`, slug }))) },
    purpose: { findMany: jest.fn(async ({ where }: { where: { slug: { in: string[] } } }) => where.slug.in.map((slug) => ({ id: `p-${slug}`, slug }))) },
    country: { findMany: jest.fn(async ({ where }: { where: { code: { in: string[] } } }) => where.code.in.map((code) => ({ code }))) },
    userLanguage: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) },
    userInterest: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) },
    userPurpose: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) },
    userPreferredCountry: { deleteMany: jest.fn(async () => ({ count: 0 })), createMany: jest.fn(async () => ({ count: 0 })) },
    user: {
      findUnique: jest.fn(async () => options.userRow ?? emptyCard()),
    },
    /**
     * Array form: the service passes `[delete, create]`, which Prisma runs
     * atomically. We resolve it as a unit and count the invocations, which is
     * what distinguishes "one transaction" from "two autocommit statements".
     */
    $transaction: jest.fn(async (arg: unknown) => {
      calls.transactionBodies += 1;
      if (Array.isArray(arg)) return Promise.all(arg as Array<Promise<unknown>>);
      throw new Error("this spec only exercises the array form");
    }),
  };
  return { prisma, calls };
}

function emptyCard() {
  return {
    id: "u1",
    email: "a@example.com",
    emailVerified: true,
    nickname: "A",
    avatarUrl: null,
    birthDate: null,
    countryCode: null,
    city: null,
    region: null,
    gender: "UNKNOWN",
    bio: null,
    isAdmin: false,
    status: "ACTIVE",
    languages: [],
    interests: [],
    purposes: [],
    preferredCountries: [],
    attributes: [],
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>["prisma"]) {
  // 第二个参数是通知：这一组用例不涉及送花，桩够用即可。
  return new UsersService(prisma as never, {
    notify: jest.fn().mockResolvedValue(undefined),
  } as never);
}

describe("replaceLanguages — 数据丢失回归 (audit P001)", () => {
  it("同一语言两种 type：按真实唯一键 (code, type) 去重，不再触发唯一约束", async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);

    await service.replaceLanguages("u1", [
      { code: "en", type: "NATIVE", level: "NATIVE" },
      { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
    ]);

    const created = (prisma.userLanguage.createMany.mock.calls[0] as unknown as Args[])[0];
    expect(created.data).toEqual([
      { userId: "u1", languageCode: "en", type: "NATIVE", level: "NATIVE" },
      { userId: "u1", languageCode: "en", type: "LEARNING", level: "INTERMEDIATE" },
    ]);
    // Two rows, two distinct (code, type) pairs — exactly what the index allows.
    expect(created.data).toHaveLength(2);
  });

  it("完全重复的 (code, type) 被折叠成一行", async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);

    await service.replaceLanguages("u1", [
      { code: "en", type: "NATIVE" },
      { code: "en", type: "NATIVE" },
      { code: "EN", type: "NATIVE" },
    ]);

    const created = (prisma.userLanguage.createMany.mock.calls[0] as unknown as Args[])[0];
    expect(created.data).toHaveLength(1);
    expect(created.data?.[0]).toMatchObject({ languageCode: "en", type: "NATIVE" });
  });

  it("delete + create 在同一次事务里（不是两条 autocommit 语句）", async () => {
    const { prisma, calls } = makePrisma();
    const service = makeService(prisma);

    await service.replaceLanguages("u1", [{ code: "en", type: "NATIVE" }]);

    // One transaction, and both statements exist exactly once.
    expect(calls.transactionBodies).toBe(1);
    expect(prisma.userLanguage.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.userLanguage.createMany).toHaveBeenCalledTimes(1);
  });

  it("未知语言码仍抛 UNKNOWN_LANGUAGE_CODE（控制器据此回 400）", async () => {
    const { prisma } = makePrisma();
    prisma.language.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    await expect(service.replaceLanguages("u1", [{ code: "xx", type: "NATIVE" }])).rejects.toThrow(
      "UNKNOWN_LANGUAGE_CODE",
    );
    // And nothing was deleted: validation happens before the transaction.
    expect(prisma.userLanguage.deleteMany).not.toHaveBeenCalled();
  });
});

describe("replaceInterests / replacePurposes / replacePreferredCountries — 同样原子", () => {
  it("interests：去重后一次事务写入", async () => {
    const { prisma, calls } = makePrisma();
    const service = makeService(prisma);

    await service.replaceInterests("u1", ["music", "music", "travel"]);

    const created = (prisma.userInterest.createMany.mock.calls[0] as unknown as Args[])[0];
    expect(created.data).toEqual([
      { userId: "u1", interestId: "i-music" },
      { userId: "u1", interestId: "i-travel" },
    ]);
    expect(calls.transactionBodies).toBe(1);
  });

  it("purposes：未知 slug 在删除之前被拒绝", async () => {
    const { prisma } = makePrisma();
    prisma.purpose.findMany.mockResolvedValueOnce([]);
    const service = makeService(prisma);

    await expect(service.replacePurposes("u1", ["nope"])).rejects.toThrow("UNKNOWN_PURPOSE_SLUG");
    expect(prisma.userPurpose.deleteMany).not.toHaveBeenCalled();
  });

  it("preferred-countries：大小写归一 + 去重 + 原子写入", async () => {
    const { prisma, calls } = makePrisma();
    const service = makeService(prisma);

    await service.replacePreferredCountries("u1", ["jp", "JP", "kr"]);

    const created = (prisma.userPreferredCountry.createMany.mock.calls[0] as unknown as Args[])[0];
    expect(created.data).toEqual([
      { userId: "u1", countryCode: "JP" },
      { userId: "u1", countryCode: "KR" },
    ]);
    expect(calls.transactionBodies).toBe(1);
  });

  it("preferred-countries：空数组只清空，不写入", async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);

    await service.replacePreferredCountries("u1", []);

    expect(prisma.userPreferredCountry.deleteMany).toHaveBeenCalledTimes(1);
    const created = (prisma.userPreferredCountry.createMany.mock.calls[0] as unknown as Args[])[0];
    expect(created.data).toEqual([]);
  });
});
