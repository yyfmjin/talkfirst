import { AuditRetentionService } from "./audit-retention.service";

/**
 * Phase O1 — audit retention.
 *
 * The properties worth pinning are the ones whose failure mode is data loss:
 * a window of `0` must mean "keep forever" (never "delete everything"), a typo
 * must not be read as a number, and the sweep must stop as soon as the table is
 * drained rather than looping forever.
 */
type Row = { id: string };

/** Prisma args for the select step, typed so `mock.calls` stays inspectable. */
type FindManyArgs = {
  where: { createdAt: { lt: Date } };
  select: { id: true };
  orderBy: { createdAt: "asc" };
  take: number;
};

function makePrisma(rows: Row[]) {
  const accessLog = {
    findMany: jest.fn(async (_args: FindManyArgs) => rows.splice(0, rows.length)),
    deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    })),
  };
  const securityEvent = {
    findMany: jest.fn(async (_args: FindManyArgs) => [] as Row[]),
    deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    })),
  };
  return { prisma: { accessLog, securityEvent }, accessLog, securityEvent };
}

function serviceFor(prisma: unknown): AuditRetentionService {
  return new AuditRetentionService(prisma as never);
}

describe("AuditRetentionService — 默认保留窗口", () => {
  const previousAccess = process.env.ACCESS_LOG_RETENTION_DAYS;
  const previousEvent = process.env.SECURITY_EVENT_RETENTION_DAYS;

  afterEach(() => {
    if (previousAccess === undefined) delete process.env.ACCESS_LOG_RETENTION_DAYS;
    else process.env.ACCESS_LOG_RETENTION_DAYS = previousAccess;
    if (previousEvent === undefined) delete process.env.SECURITY_EVENT_RETENTION_DAYS;
    else process.env.SECURITY_EVENT_RETENTION_DAYS = previousEvent;
  });

  it("未配置时使用默认窗口：访问日志 30 天、安全事件 180 天", () => {
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
    delete process.env.SECURITY_EVENT_RETENTION_DAYS;
    const service = serviceFor(makePrisma([]).prisma);
    expect(service.accessLogRetentionDays()).toBe(30);
    // Security events are the evidentiary record, so they outlive access logs.
    expect(service.securityEventRetentionDays()).toBe(180);
    expect(service.securityEventRetentionDays()).toBeGreaterThan(service.accessLogRetentionDays());
  });

  it("0 表示永久保留，且不执行任何删除", async () => {
    process.env.ACCESS_LOG_RETENTION_DAYS = "0";
    process.env.SECURITY_EVENT_RETENTION_DAYS = "0";
    const { prisma, accessLog, securityEvent } = makePrisma([{ id: "a" }]);
    const service = serviceFor(prisma);

    const result = await service.sweep();

    expect(result).toEqual({ accessLogs: 0, securityEvents: 0 });
    // The dangerous misreading of `0` is "delete everything" — assert no query ran.
    expect(accessLog.findMany).not.toHaveBeenCalled();
    expect(accessLog.deleteMany).not.toHaveBeenCalled();
    expect(securityEvent.findMany).not.toHaveBeenCalled();
  });

  it("非法配置（如 30d）回退到默认值，而不是当成 0 或 NaN", () => {
    process.env.ACCESS_LOG_RETENTION_DAYS = "30d";
    process.env.SECURITY_EVENT_RETENTION_DAYS = "-5";
    const service = serviceFor(makePrisma([]).prisma);
    expect(service.accessLogRetentionDays()).toBe(30);
    expect(service.securityEventRetentionDays()).toBe(180);
  });

  it("配置生效时可覆盖默认值", () => {
    process.env.ACCESS_LOG_RETENTION_DAYS = "7";
    process.env.SECURITY_EVENT_RETENTION_DAYS = "365";
    const service = serviceFor(makePrisma([]).prisma);
    expect(service.accessLogRetentionDays()).toBe(7);
    expect(service.securityEventRetentionDays()).toBe(365);
  });
});

describe("AuditRetentionService — 分批清理", () => {
  it("删除全部超期行，并以 id 批量删除（deleteMany 无 take，只能先查后删）", async () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { prisma, accessLog } = makePrisma(rows);
    const service = serviceFor(prisma);

    const result = await service.sweep();

    expect(result.accessLogs).toBe(3);
    expect(accessLog.deleteMany).toHaveBeenCalledTimes(1);
    expect(accessLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b", "c"] } } });
  });

  it("表为空时只查一次，不进入删除", async () => {
    const { prisma, accessLog } = makePrisma([]);
    const service = serviceFor(prisma);

    const result = await service.sweep();

    expect(result.accessLogs).toBe(0);
    expect(accessLog.findMany).toHaveBeenCalledTimes(1);
    expect(accessLog.deleteMany).not.toHaveBeenCalled();
  });

  it("裁剪截止时间是 now - 保留天数", async () => {
    process.env.ACCESS_LOG_RETENTION_DAYS = "10";
    const { prisma, accessLog } = makePrisma([]);
    const service = serviceFor(prisma);
    const before = Date.now();

    await service.sweep();

    const where = accessLog.findMany.mock.calls[0]?.[0]?.where as {
      createdAt: { lt: Date };
    };
    const expected = before - 10 * 24 * 60 * 60 * 1000;
    // Allow a couple of seconds of slack for the call itself.
    expect(Math.abs(where.createdAt.lt.getTime() - expected)).toBeLessThan(5000);
    delete process.env.ACCESS_LOG_RETENTION_DAYS;
  });
});
