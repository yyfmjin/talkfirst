import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * IP ban administration: normalisation, the self-lockout refusals, and audit.
 *
 * ## The cases that matter most
 *
 * `isNonRoutableAddress` and the admin-IP refusal are the only things standing between
 * an operator and a ban they cannot undo through the console — a PRIMARY ban refuses
 * every request from an address, so blocking the address you are using ends your access
 * permanently and requires database surgery. Those two refusals are tested from the
 * outside (`createIpBan`) rather than by reaching for the private helper, so the test
 * covers the path an operator actually takes.
 *
 * ## NOT RUN
 *
 * No database. `PrismaService` is a stub, so what is verified is this service's
 * decisions and the shape of its writes — not Prisma's SQL or the real transaction.
 */

type Call = Record<string, unknown>;

const ADMIN: ResolvedAdmin = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  adminUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "SUPER_ADMIN",
  isActive: true,
  legacy: false,
};

function makeService(overrides: { existingBan?: Call | null; adminIpInLog?: boolean } = {}) {
  const ipBan = {
    findMany: jest.fn(async (_args: Call) => [] as unknown[]),
    findFirst: jest.fn(async (_args: Call) => (overrides.existingBan ?? null) as unknown),
    findUnique: jest.fn(async (_args: Call) => (overrides.existingBan ?? null) as unknown),
    create: jest.fn(async (_args: Call) => ({ id: "new-ban" }) as unknown),
    update: jest.fn(async (_args: Call) => ({ id: "updated-ban" }) as unknown),
    count: jest.fn(async (_args: Call) => 0),
  };
  const adminAuditLog = { create: jest.fn(async (_args: Call) => ({}) as unknown) };
  const accessLog = {
    findFirst: jest.fn(async (_args: Call) =>
      (overrides.adminIpInLog ? { id: "log-1" } : null) as unknown),
  };
  const adminUser = { findMany: jest.fn(async (_args: Call) => [] as unknown[]) };

  const prisma = {
    ipBan,
    adminAuditLog,
    accessLog,
    adminUser,
  } as Record<string, unknown> & {
    $transaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };

  /**
   * The service writes the ban and its audit row inside `$transaction`; this stub runs
   * the callback with the same client so the audit write is observable.
   *
   * Assigned after the literal rather than inside it: a self-reference in the
   * initializer makes TypeScript infer the object's type from its own definition,
   * which it reports as an implicit `any` rather than as a cycle.
   */
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);

  const invalidate = jest.fn();
  const service = new AdminService(prisma as never, {} as never, { invalidate } as never);
  return { service, ipBan, adminAuditLog, accessLog, invalidate };
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                              */
/* -------------------------------------------------------------------------- */

describe("AdminService.createIpBan — 地址归一化", () => {
  it("封禁前用 normalizeIp 归一化，与 AccessLog.ip 键一致", async () => {
    /**
     * The ban lookup and the audit trail must key on the same string. If this endpoint
     * stored `::ffff:203.0.113.5` while `AccessLog` stored `203.0.113.5`, the ban would
     * exist and silently match nothing — a ban that does not ban.
     */
    const { service, ipBan } = makeService();
    await service.createIpBan({ ip: "::ffff:203.0.113.5", level: "PRIMARY", reason: "x" }, ADMIN);

    const data = ipBan.create.mock.calls[0]?.[0]?.data as Call;
    expect(data.ip).toBe("203.0.113.5");
  });

  it("去掉 IPv4 端口", async () => {
    const { service, ipBan } = makeService();
    await service.createIpBan({ ip: "203.0.113.5:54321", level: "PRIMARY", reason: "x" }, ADMIN);
    expect((ipBan.create.mock.calls[0]?.[0]?.data as Call).ip).toBe("203.0.113.5");
  });

  it("拒绝空的 reason", async () => {
    const { service } = makeService();
    await expect(
      service.createIpBan({ ip: "203.0.113.5", level: "PRIMARY", reason: "   " }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("拒绝无效的 expiresAt", async () => {
    const { service } = makeService();
    await expect(
      service.createIpBan(
        { ip: "203.0.113.5", level: "PRIMARY", reason: "x", expiresAt: "not-a-date" },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/* -------------------------------------------------------------------------- */
/* Self-lockout refusals                                                      */
/* -------------------------------------------------------------------------- */

describe("AdminService.createIpBan — 防自锁", () => {
  it("拒绝回环地址", async () => {
    for (const ip of ["127.0.0.1", "::1", "localhost"]) {
      const { service } = makeService();
      await expect(
        service.createIpBan({ ip, level: "PRIMARY", reason: "x" }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("拒绝内网与 CGNAT 地址段", async () => {
    /**
     * Blocking 10/8 or 192.168/16 silences an entire office or container network,
     * because every machine behind a NAT appears as its own private address. 100.64/10
     * is a mobile carrier's whole subscriber pool.
     */
    for (const ip of [
      "10.0.0.1",
      "172.16.5.4",
      "172.31.255.254",
      "192.168.1.1",
      "169.254.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "fd00::1",
      "fe80::1",
    ]) {
      const { service } = makeService();
      await expect(
        service.createIpBan({ ip, level: "PRIMARY", reason: "x" }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("放行公网地址（含 172.32 这种紧邻私网段的边界）", async () => {
    /**
     * 172.16/12 ends at 172.31. 172.32 is public, and an off-by-one in the range check
     * would refuse a legitimate ban while still passing every private-range case above.
     */
    for (const ip of ["203.0.113.5", "8.8.8.8", "172.32.0.1", "2001:db8::1"]) {
      const { service, ipBan } = makeService();
      await expect(
        service.createIpBan({ ip, level: "PRIMARY", reason: "x" }, ADMIN),
      ).resolves.toBeDefined();
      expect(ipBan.create).toHaveBeenCalled();
    }
  });

  it("拒绝曾用于访问管理后台的地址（否则管理员会把自己锁在外面）", async () => {
    const { service } = makeService({ adminIpInLog: true });
    let caught: unknown = null;
    try {
      await service.createIpBan({ ip: "203.0.113.5", level: "PRIMARY", reason: "x" }, ADMIN);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({
      error: { code: "IP_BAN_REFUSED_ADMIN_IP" },
    });
  });

  it("拒绝空地址", async () => {
    const { service } = makeService();
    await expect(
      service.createIpBan({ ip: "", level: "PRIMARY", reason: "x" }, ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("没有 AdminUser 记录时拒绝，而不是写一条无行为人的审计", async () => {
    /**
     * The legacy compatibility path resolves an admin with no `AdminUser` row.
     * `IpBan.createdById` references `AdminUser`, so proceeding would either violate the
     * foreign key or record a moderation action with no actor — the exact guarantee this
     * feature exists to provide.
     */
    const { service } = makeService();
    await expect(
      service.createIpBan(
        { ip: "203.0.113.5", level: "PRIMARY", reason: "x" },
        { ...ADMIN, adminUserId: null, legacy: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

describe("AdminService.createIpBan — 审计", () => {
  it("新建封禁时写入审计，记录行为人、目标地址与原因", async () => {
    const { service, adminAuditLog } = makeService();
    await service.createIpBan({ ip: "203.0.113.5", level: "PRIMARY", reason: "scraping" }, ADMIN);

    const data = adminAuditLog.create.mock.calls[0]?.[0]?.data as Call;
    expect(data).toMatchObject({
      actorType: "USER",
      adminId: ADMIN.adminUserId,
      action: "ip_ban_create",
      targetType: "IP",
      targetId: "203.0.113.5",
      reason: "scraping",
    });
    expect(data.after).toMatchObject({ level: "PRIMARY" });
  });

  it("已有生效封禁时改为更新，并在审计里保留 before", async () => {
    /**
     * Two active rows for one address would make "why is this blocked" ambiguous and
     * make lifting it a guess about which row to close.
     */
    const { service, ipBan, adminAuditLog } = makeService({
      existingBan: { id: "old-ban", level: "SECONDARY", reason: "older" },
    });
    await service.createIpBan({ ip: "203.0.113.5", level: "PRIMARY", reason: "escalated" }, ADMIN);

    expect(ipBan.create).not.toHaveBeenCalled();
    expect(ipBan.update).toHaveBeenCalled();

    const data = adminAuditLog.create.mock.calls[0]?.[0]?.data as Call;
    expect(data.action).toBe("ip_ban_update");
    expect(data.before).toMatchObject({ level: "SECONDARY", reason: "older" });
  });

  it("写入后让缓存失效，封禁立即生效", async () => {
    const { service, invalidate } = makeService();
    await service.createIpBan({ ip: "203.0.113.5", level: "PRIMARY", reason: "x" }, ADMIN);
    expect(invalidate).toHaveBeenCalledWith("203.0.113.5");
  });
});

/* -------------------------------------------------------------------------- */
/* Lifting                                                                    */
/* -------------------------------------------------------------------------- */

describe("AdminService.liftIpBan", () => {
  it("解封是标记 liftedAt，不删行（历史必须留存）", async () => {
    const { service, ipBan, adminAuditLog, invalidate } = makeService({
      existingBan: { id: "ban-1", ip: "203.0.113.5", level: "PRIMARY", reason: "x", liftedAt: null },
    });
    await service.liftIpBan("ban-1", ADMIN, "appeal upheld");

    const data = ipBan.update.mock.calls[0]?.[0]?.data as Call;
    expect(data.liftedAt).toBeInstanceOf(Date);
    expect(data.liftedById).toBe(ADMIN.adminUserId);
    // No delete call exists on the stub at all, which is the point.
    expect(adminAuditLog.create).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith("203.0.113.5");
  });

  it("解封审计记录原因与 before", async () => {
    const { service, adminAuditLog } = makeService({
      existingBan: { id: "ban-1", ip: "203.0.113.5", level: "PRIMARY", reason: "x", liftedAt: null },
    });
    await service.liftIpBan("ban-1", ADMIN, "appeal upheld");

    const data = adminAuditLog.create.mock.calls[0]?.[0]?.data as Call;
    expect(data).toMatchObject({ action: "ip_ban_lift", targetId: "203.0.113.5", reason: "appeal upheld" });
  });

  it("不存在的封禁返回 404", async () => {
    const { service } = makeService({ existingBan: null });
    await expect(service.liftIpBan("missing", ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("重复解封被拒绝", async () => {
    const { service } = makeService({
      existingBan: { id: "ban-1", ip: "203.0.113.5", level: "PRIMARY", reason: "x", liftedAt: new Date() },
    });
    let caught: unknown = null;
    try {
      await service.liftIpBan("ban-1", ADMIN);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      error: { code: "IP_BAN_ALREADY_LIFTED" },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

describe("AdminService.listIpBans", () => {
  it("默认只看生效中的封禁（liftedAt 为 null）", async () => {
    const { service, ipBan } = makeService();
    await service.listIpBans({});

    const where = ipBan.findMany.mock.calls[0]?.[0]?.where as Call;
    expect(where.liftedAt).toBeNull();
  });

  it("includeLifted 时不做 liftedAt 过滤", async () => {
    const { service, ipBan } = makeService();
    await service.listIpBans({ includeLifted: true });

    const where = ipBan.findMany.mock.calls[0]?.[0]?.where as Call;
    expect(where.liftedAt).toBeUndefined();
  });

  it("按 IP 过滤时归一化输入", async () => {
    const { service, ipBan } = makeService();
    await service.listIpBans({ ip: "::ffff:203.0.113.5" });
    expect((ipBan.findMany.mock.calls[0]?.[0]?.where as Call).ip).toBe("203.0.113.5");
  });

  it("pageSize 有上限，避免一次拉取整表", async () => {
    const { service, ipBan } = makeService();
    await service.listIpBans({ pageSize: 100000 });
    expect(ipBan.findMany.mock.calls[0]?.[0]?.take).toBe(200);
  });

  it("非法分页参数回落到默认值", async () => {
    const { service, ipBan } = makeService();
    await service.listIpBans({ page: Number.NaN, pageSize: -5 });
    const args = ipBan.findMany.mock.calls[0]?.[0] as Call;
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });
});
