import { NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";

/**
 * Phase O2 — the access-log read surface.
 *
 * The properties worth pinning are the ones whose failure is silent:
 *
 *  - **Filtering happens in the database.** If a filter is dropped on the way to
 *    Prisma, the console returns unfiltered rows and `total` describes the wrong
 *    set — it looks like a working screen and lies.
 *  - **An invalid date/status widens nothing.** A typo must not become "no
 *    predicate", which would silently return the whole table.
 *  - **A deleted account is a `null`, not a crash.** `AccessLog.userId` has no
 *    foreign key on purpose, so the id can outlive the account.
 *  - **A missing row is a 404**, not `200 { data: null }`.
 */
type FindManyArgs = Record<string, unknown>;
type CountArgs = { where?: unknown };

function makeService() {
  const accessLog = {
    count: jest.fn(async (_args: CountArgs) => 0),
    findMany: jest.fn(async (_args: FindManyArgs) => [] as unknown[]),
    findUnique: jest.fn(async (_args: FindManyArgs) => null as unknown),
    groupBy: jest.fn(async (_args: FindManyArgs) => [] as unknown[]),
  };
  const user = { findMany: jest.fn(async (_args: FindManyArgs) => [] as unknown[]) };
  const prisma = { accessLog, user };
  const service = new AdminService(prisma as never, {} as never);
  return { service, accessLog, user };
}

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  requestId: "req-1",
  method: "GET",
  path: "/api/v1/users/me",
  queryDigest: "page=2",
  statusCode: 401,
  durationMs: 3,
  userId: "22222222-2222-4222-8222-222222222222",
  authenticated: false,
  isAdmin: false,
  ip: "203.0.113.5",
  deviceHash: null,
  userAgent: "jest-agent",
  referer: null,
  origin: null,
  acceptLanguage: null,
  contentType: null,
  errorCode: "UNAUTHORIZED",
  riskLevel: "LOW",
  createdAt: new Date("2026-10-02T10:00:00.000Z"),
};

describe("AdminService.listAccessLogs — 过滤在数据库执行", () => {
  it("把每个过滤器翻译成 where 条件", async () => {
    const { service, accessLog } = makeService();
    await service.listAccessLogs({
      ip: "203.0.113.5",
      userId: ROW.userId,
      path: "/api/v1/admin",
      statusCode: 403,
      riskLevel: "MEDIUM",
      authenticated: false,
      isAdmin: true,
      createdFrom: "2026-10-01T00:00:00.000Z",
      createdTo: "2026-10-02T00:00:00.000Z",
      page: 2,
      pageSize: 10,
    });

    const where = accessLog.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.ip).toBe("203.0.113.5");
    expect(where.userId).toBe(ROW.userId);
    expect(where.path).toEqual({ contains: "/api/v1/admin", mode: "insensitive" });
    expect(where.statusCode).toBe(403);
    expect(where.riskLevel).toBe("MEDIUM");
    expect(where.authenticated).toBe(false);
    expect(where.isAdmin).toBe(true);
    expect(where.createdAt).toEqual({
      gte: new Date("2026-10-01T00:00:00.000Z"),
      lte: new Date("2026-10-02T00:00:00.000Z"),
    });
    // Same where for the count, or `total` would describe a different set.
    expect(accessLog.count.mock.calls[0]?.[0]?.where).toEqual(where);
  });

  it("空过滤器只剩渠道默认值：默认只看成员流量", async () => {
    /**
     * 2026-10-06：这里本来断言 `{}`（「空过滤器不产生任何条件」）。渠道分流之后，
     * 默认就带一个 `channel = 'USER'` —— 这正是运营方要的：后台自己的操作与
     * 服务器自身的探活 / 运维操作**单独记录、不进默认视图**。
     * 想看全部得显式传 `channel: "ALL"`。
     */
    const { service, accessLog } = makeService();
    await service.listAccessLogs({});
    expect(accessLog.findMany.mock.calls[0]?.[0]?.where).toEqual({ channel: "USER" });
  });

  it("渠道筛选：ADMIN / OPS 各看一类，ALL 回到不过滤，未知值收敛成默认视图", async () => {
    const admin = makeService();
    await admin.service.listAccessLogs({ channel: "ADMIN" });
    expect(admin.accessLog.findMany.mock.calls[0]?.[0]?.where).toEqual({ channel: "ADMIN" });

    const ops = makeService();
    await ops.service.listAccessLogs({ channel: "OPS" });
    expect(ops.accessLog.findMany.mock.calls[0]?.[0]?.where).toEqual({ channel: "OPS" });

    const all = makeService();
    await all.service.listAccessLogs({ channel: "ALL" });
    expect(all.accessLog.findMany.mock.calls[0]?.[0]?.where).toEqual({});

    // 人手拼错的值不该让整页 400：收敛成默认视图。
    const typo = makeService();
    await typo.service.listAccessLogs({ channel: "nonsense" });
    expect(typo.accessLog.findMany.mock.calls[0]?.[0]?.where).toEqual({ channel: "USER" });
  });

  it("非法日期被忽略，而不是放宽成整表", async () => {
    const { service, accessLog } = makeService();
    await service.listAccessLogs({ createdFrom: "not-a-date", createdTo: "2026-10-02" });
    const where = accessLog.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    // Only the valid bound survives; the typo contributes nothing.
    expect(where.createdAt).toEqual({ lte: new Date("2026-10-02") });
  });

  it("分页被夹紧：page >= 1 且 pageSize <= 100", async () => {
    const { service, accessLog } = makeService();
    const result = await service.listAccessLogs({ page: -5, pageSize: 9999 });
    expect(accessLog.findMany.mock.calls[0]?.[0]?.skip).toBe(0);
    expect(accessLog.findMany.mock.calls[0]?.[0]?.take).toBe(100);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it("第 2 页跳过整整一页", async () => {
    const { service, accessLog } = makeService();
    await service.listAccessLogs({ page: 3, pageSize: 20 });
    expect(accessLog.findMany.mock.calls[0]?.[0]?.skip).toBe(40);
  });

  it("用显式 select，且不含任何关系（禁止 include）", async () => {
    const { service, accessLog } = makeService();
    await service.listAccessLogs({});
    const arg = accessLog.findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.include).toBeUndefined();
    expect(arg.select).toBeDefined();
    // The projection must not have grown a relation.
    expect(Object.keys(arg.select as object).sort()).toEqual(
      Object.keys(AdminService.ACCESS_LOG_LIST_SELECT).sort(),
    );
  });
});

describe("AdminService.listAccessLogs — 手工 join 账号", () => {
  it("用一次查询解析本页的全部 userId，并合并进结果", async () => {
    const { service, accessLog, user } = makeService();
    accessLog.findMany.mockResolvedValue([ROW, { ...ROW, id: "other", userId: ROW.userId }]);
    user.findMany.mockResolvedValue([
      { id: ROW.userId as string, nickname: "Yuki", email: "yuki@example.com" },
    ]);

    const result = await service.listAccessLogs({});

    // One query for the whole page, not one per row.
    expect(user.findMany).toHaveBeenCalledTimes(1);
    expect(user.findMany.mock.calls[0]?.[0]?.where).toEqual({ id: { in: [ROW.userId] } });
    expect(result.items[0]?.account).toEqual({
      id: ROW.userId,
      nickname: "Yuki",
      email: "yuki@example.com",
    });
    expect(result.items[1]?.account).toEqual(result.items[0]?.account);
  });

  it("账号已删除 -> account 为 null，而不是崩在 userId.slice 上", async () => {
    const { service, accessLog, user } = makeService();
    accessLog.findMany.mockResolvedValue([ROW]);
    user.findMany.mockResolvedValue([]); // account no longer exists

    const result = await service.listAccessLogs({});
    expect(result.items[0]?.account).toBeNull();
    // The raw id is still reported — it is the audit fact that must survive.
    expect(result.items[0]?.userId).toBe(ROW.userId);
  });

  it("匿名请求（userId 为 null）不触发账号查询", async () => {
    const { service, accessLog, user } = makeService();
    accessLog.findMany.mockResolvedValue([{ ...ROW, userId: null, authenticated: false }]);

    const result = await service.listAccessLogs({});
    expect(user.findMany).not.toHaveBeenCalled();
    expect(result.items[0]?.account).toBeNull();
  });
});

describe("AdminService.accessLogDetail", () => {
  it("未知 id -> 404 ACCESS_LOG_NOT_FOUND（不是 200 + null）", async () => {
    const { service } = makeService();
    await expect(service.accessLogDetail(ROW.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("命中时返回该行并合并账号", async () => {
    const { service, accessLog, user } = makeService();
    accessLog.findUnique.mockResolvedValue(ROW);
    user.findMany.mockResolvedValue([
      { id: ROW.userId as string, nickname: null, email: "x@example.com" },
    ]);

    const result = await service.accessLogDetail(ROW.id);
    expect(result.id).toBe(ROW.id);
    expect(result.account).toEqual({
      id: ROW.userId,
      nickname: null,
      email: "x@example.com",
    });
  });
});

describe("AdminService.accessLogStats", () => {
  it("统计总数、独立 IP，并按状态码排序", async () => {
    const { service, accessLog } = makeService();
    accessLog.count.mockResolvedValue(42);
    accessLog.groupBy.mockImplementation(async (args: Record<string, unknown>) => {
      if (JSON.stringify(args.by) === JSON.stringify(["statusCode"])) {
        return [
          { statusCode: 500, _count: { _all: 2 } },
          { statusCode: 200, _count: { _all: 40 } },
        ];
      }
      if (JSON.stringify(args.by) === JSON.stringify(["riskLevel"])) {
        return [{ riskLevel: "LOW", _count: { _all: 42 } }];
      }
      return [];
    });
    // The distinct-ip probe uses findMany with `distinct`.
    accessLog.findMany.mockResolvedValue([{ ip: "203.0.113.5" }, { ip: "198.51.100.7" }]);

    const result = await service.accessLogStats({});
    expect(result.total).toBe(42);
    expect(result.distinctIpCount).toBe(2);
    expect(result.byStatus).toEqual([
      { statusCode: 200, count: 40 },
      { statusCode: 500, count: 2 },
    ]);
    expect(result.byRisk).toEqual([{ riskLevel: "LOW", count: 42 }]);
  });

  it("独立 IP 用 distinct，而不是把全部行拉进内存", async () => {
    const { service, accessLog } = makeService();
    await service.accessLogStats({});
    const ipQuery = accessLog.findMany.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ipQuery.distinct).toEqual(["ip"]);
    expect(ipQuery.select).toEqual({ ip: true });
  });

  it("统计与列表共用同一个 where 构造（口径一致）", async () => {
    const { service, accessLog } = makeService();
    await service.accessLogStats({ createdFrom: "2026-10-01T00:00:00.000Z" });
    const countWhere = accessLog.count.mock.calls[0]?.[0]?.where;
    // 2026-10-06：这里多了渠道默认值 —— 统计与列表一起只看成员流量。
    // 而这恰好又是「两者共用同一个构造」的证明：改一处，这里和列表的用例一起会红。
    expect(countWhere).toEqual({
      createdAt: { gte: new Date("2026-10-01T00:00:00.000Z") },
      channel: "USER",
    });
  });
});
