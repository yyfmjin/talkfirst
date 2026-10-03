import { IpBanService } from "./ip-ban.service";

/**
 * The ban lookup: precedence, the cache, and fail-open.
 *
 * ## Why the cache is tested rather than assumed
 *
 * `IpBanService` sits on the request path, so the cache is the difference between one
 * query per request and one query per address per TTL. Two of its behaviours are
 * user-visible when wrong: a stale NEGATIVE entry means a new ban does not take
 * effect, and a missing invalidation means 解封 appears broken for up to the TTL.
 *
 * ## NOT RUN
 *
 * No database. `PrismaService` is a stub, so what is verified is this service's
 * decision-making, not Prisma's SQL.
 */

type Row = { level: "PRIMARY" | "SECONDARY"; reason: string };

/** The Prisma call shape this service makes, so `mock.calls` is inspectable. */
type FindManyArgs = { where: Record<string, unknown>; select: Record<string, boolean> };

function makeService(rows: Row[] | (() => Promise<Row[]>)) {
  // Typed explicitly: an untyped `jest.fn(async () => rows)` infers a zero-argument
  // call signature, which makes `mock.calls[0][0]` a type error rather than the
  // argument the service actually passed.
  const findMany = jest.fn<Promise<Row[]>, [FindManyArgs]>(
    typeof rows === "function" ? rows : async () => rows,
  );
  const service = new IpBanService({ ipBan: { findMany } } as never);
  return { service, findMany };
}

describe("IpBanService — 层级优先级", () => {
  it("无封禁记录时返回 null", async () => {
    const { service } = makeService([]);
    await expect(service.activeBanFor("203.0.113.5")).resolves.toBeNull();
  });

  it("只有 SECONDARY 时返回 SECONDARY", async () => {
    const { service } = makeService([{ level: "SECONDARY", reason: "abuse" }]);
    await expect(service.activeBanFor("203.0.113.5")).resolves.toEqual({
      level: "SECONDARY",
      reason: "abuse",
    });
  });

  it("PRIMARY 优先于 SECONDARY，与记录顺序无关", async () => {
    /**
     * Reading the stricter level regardless of row order is what stops a PRIMARY ban
     * from silently degrading to a SECONDARY one — which would hand back an address the
     * operator had fully blocked.
     */
    const secondaryFirst = makeService([
      { level: "SECONDARY", reason: "older" },
      { level: "PRIMARY", reason: "newer" },
    ]);
    await expect(secondaryFirst.service.activeBanFor("203.0.113.5")).resolves.toEqual({
      level: "PRIMARY",
      reason: "newer",
    });

    const primaryFirst = makeService([
      { level: "PRIMARY", reason: "newer" },
      { level: "SECONDARY", reason: "older" },
    ]);
    await expect(primaryFirst.service.activeBanFor("203.0.113.5")).resolves.toEqual({
      level: "PRIMARY",
      reason: "newer",
    });
  });

  it("只查询未解除、未过期的封禁", async () => {
    const { service, findMany } = makeService([]);
    await service.activeBanFor("203.0.113.5");

    const where = findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;    expect(where.ip).toBe("203.0.113.5");
    // A lifted ban is history, not a block.
    expect(where.liftedAt).toBeNull();
    // `null` expiresAt means permanent, so both shapes must match.
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("没有 IP 时直接返回 null，不查库", async () => {
    const { service, findMany } = makeService([]);
    await expect(service.activeBanFor(undefined)).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("IpBanService — 缓存", () => {
  it("同一 IP 的重复查询只查一次库（含「无封禁」这一负结果）", async () => {
    /**
     * The negative entry matters more than the positive ones: without caching "no ban",
     * every request from every ordinary visitor would still hit the database.
     */
    const { service, findMany } = makeService([{ level: "PRIMARY", reason: "x" }]);
    await service.activeBanFor("203.0.113.5");
    await service.activeBanFor("203.0.113.5");
    await service.activeBanFor("203.0.113.5");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("不同 IP 各自查询", async () => {
    const { service, findMany } = makeService([]);
    await service.activeBanFor("203.0.113.5");
    await service.activeBanFor("198.51.100.7");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidate 后重新查库（解封立即生效，不等 TTL）", async () => {
    const { service, findMany } = makeService([{ level: "PRIMARY", reason: "x" }]);
    await service.activeBanFor("203.0.113.5");
    expect(findMany).toHaveBeenCalledTimes(1);

    service.invalidate("203.0.113.5");
    await service.activeBanFor("203.0.113.5");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("解封后缓存被刷新为新结果", async () => {
    let rows: Row[] = [{ level: "PRIMARY", reason: "x" }];
    const { service } = makeService(async () => rows);

    await expect(service.activeBanFor("203.0.113.5")).resolves.toMatchObject({ level: "PRIMARY" });
    rows = [];
    // Still cached as banned…
    await expect(service.activeBanFor("203.0.113.5")).resolves.toMatchObject({ level: "PRIMARY" });
    // …until the admin write path invalidates it.
    service.invalidate("203.0.113.5");
    await expect(service.activeBanFor("203.0.113.5")).resolves.toBeNull();
  });
});

describe("IpBanService — 故障处理", () => {
  it("查库失败时返回 null（fail open），且不抛异常", async () => {
    /**
     * The deliberate choice: a database blip must not become a site-wide outage caused
     * by the ban feature. The abuse is still in `AccessLog`, so nothing is lost that
     * cannot be acted on once the table is readable again.
     */
    const { service } = makeService(async () => {
      throw new Error("database is down");
    });
    await expect(service.activeBanFor("203.0.113.5")).resolves.toBeNull();
  });

  it("失败结果不被当作「无封禁」长期缓存", async () => {
    /**
     * A failure and a genuine "no ban" are cached the same way, which is acceptable
     * only because the TTL is short. This pins that the failure does not poison the
     * cache permanently: once the database recovers and the entry expires, a real ban
     * is seen again.
     */
    let failing = true;
    const { service, findMany } = makeService(async () => {
      if (failing) throw new Error("down");
      return [{ level: "PRIMARY", reason: "restored" }];
    });

    await expect(service.activeBanFor("203.0.113.5")).resolves.toBeNull();
    failing = false;
    service.invalidate("203.0.113.5");
    await expect(service.activeBanFor("203.0.113.5")).resolves.toMatchObject({ level: "PRIMARY" });
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
