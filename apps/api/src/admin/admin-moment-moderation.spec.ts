import { NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import type { ResolvedAdmin } from "./admin.guard";

/**
 * The moment moderation queue and its decisions.
 *
 * ## Why the queue order is asserted
 *
 * A moderation queue is worked from the front. Listing newest-first leaves the earliest
 * flagged content permanently at the bottom, which is the failure mode that makes a queue
 * look busy while nothing gets cleared. The `createdAt: "asc"` order is therefore part of
 * the contract, not a detail.
 *
 * ## NOT RUN
 *
 * No database: `PrismaService` is a stub, so this covers the service's decisions and the
 * shape of its writes.
 */

type Call = Record<string, unknown>;

const ADMIN: ResolvedAdmin = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  adminUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "MODERATOR",
  isActive: true,
  legacy: false,
};

function makeService(options: { existing?: Call | null } = {}) {
  const moment = {
    findMany: jest.fn(async (_args: Call) => [] as unknown[]),
    count: jest.fn(async (_args: Call) => 0),
    findUnique: jest.fn(async (_args: Call) => (options.existing ?? null) as unknown),
    update: jest.fn(async (_args: Call) => ({ id: "m1", reviewStatus: "APPROVED" }) as unknown),
  };
  const adminAuditLog = { create: jest.fn(async (_args: Call) => ({}) as unknown) };

  const prisma = { moment, adminAuditLog } as Record<string, unknown> & {
    $transaction?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);

  const ipBans = { invalidate: jest.fn() };
  const service = new AdminService(prisma as never, {} as never, ipBans as never);
  return { service, moment, adminAuditLog };
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                      */
/* -------------------------------------------------------------------------- */

describe("AdminService.listMomentQueue", () => {
  it("默认只列待审内容，且按最早优先", async () => {
    const { service, moment } = makeService();
    await service.listMomentQueue({});

    const args = moment.findMany.mock.calls[0]?.[0] as Call;
    expect(args.where).toEqual({ reviewStatus: "PENDING" });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("未知状态被忽略并回落到待审队列", async () => {
    const { service, moment } = makeService();
    const result = await service.listMomentQueue({ status: "NOT_A_STATUS" });

    expect((moment.findMany.mock.calls[0]?.[0] as Call).where).toEqual({ reviewStatus: "PENDING" });
    // The response states which queue was actually served, so a typo cannot look like an
    // empty queue.
    expect(result.status).toBe("PENDING");
  });

  it("接受合法状态", async () => {
    const { service, moment } = makeService();
    await service.listMomentQueue({ status: "REJECTED" });
    expect((moment.findMany.mock.calls[0]?.[0] as Call).where).toEqual({ reviewStatus: "REJECTED" });
  });

  it("pageSize 有上限", async () => {
    const { service, moment } = makeService();
    await service.listMomentQueue({ pageSize: 100000 });
    expect((moment.findMany.mock.calls[0]?.[0] as Call).take).toBe(200);
  });

  it("非法分页参数回落到默认值", async () => {
    const { service, moment } = makeService();
    await service.listMomentQueue({ page: Number.NaN, pageSize: -1 });
    const args = moment.findMany.mock.calls[0]?.[0] as Call;
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
  });

  it("列表投影不返回作者邮箱以外的敏感字段", async () => {
    // The reviewer needs to know who posted it; nothing else about the account.
    const { service, moment } = makeService();
    await service.listMomentQueue({});
    const select = (moment.findMany.mock.calls[0]?.[0] as Call).select as Call;
    expect(select.user).toEqual({
      select: { id: true, nickname: true, email: true, status: true },
    });
  });
});

describe("AdminService.momentQueueCounts", () => {
  it("统计待审、拒绝、下架三类", async () => {
    const { service, moment } = makeService();
    moment.count.mockResolvedValueOnce(3 as never).mockResolvedValueOnce(1 as never).mockResolvedValueOnce(2 as never);

    await expect(service.momentQueueCounts()).resolves.toEqual({ pending: 3, rejected: 1, hidden: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* Decisions                                                                  */
/* -------------------------------------------------------------------------- */

describe("AdminService.reviewMoment", () => {
  it("通过时置为 APPROVED 并清空扫描原因", async () => {
    const { service, moment } = makeService({ existing: { id: "m1", reviewStatus: "PENDING", userId: "u1" } });
    await service.reviewMoment("m1", "approve", ADMIN);

    const data = moment.update.mock.calls[0]?.[0]?.data as Call;
    expect(data.reviewStatus).toBe("APPROVED");
    // The column answers "why is this flagged", so a cleared flag must clear the reasons.
    expect(data.reviewReasons).toEqual([]);
    expect(data.reviewedAt).toBeInstanceOf(Date);
  });

  it("拒绝时置为 REJECTED，并保留扫描原因供追溯", async () => {
    const { service, moment } = makeService({ existing: { id: "m1", reviewStatus: "PENDING", userId: "u1" } });
    await service.reviewMoment("m1", "reject", ADMIN, "广告");

    const data = moment.update.mock.calls[0]?.[0]?.data as Call;
    expect(data.reviewStatus).toBe("REJECTED");
    expect(data.reviewReasons).toBeUndefined();
  });

  it("下架与拒绝是不同状态（已公开内容被撤回）", async () => {
    const { service, moment } = makeService({ existing: { id: "m1", reviewStatus: "APPROVED", userId: "u1" } });
    await service.reviewMoment("m1", "hide", ADMIN);

    expect((moment.update.mock.calls[0]?.[0]?.data as Call).reviewStatus).toBe("HIDDEN");
  });

  it("不存在的动态返回 404", async () => {
    const { service } = makeService({ existing: null });
    await expect(service.reviewMoment("missing", "approve", ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("写入审计，记录前后状态以便复核", async () => {
    const { service, adminAuditLog } = makeService({
      existing: { id: "m1", reviewStatus: "PENDING", userId: "u1" },
    });
    await service.reviewMoment("m1", "reject", ADMIN, "垃圾广告");

    const data = adminAuditLog.create.mock.calls[0]?.[0]?.data as Call;
    expect(data).toMatchObject({
      actorType: "USER",
      adminId: ADMIN.adminUserId,
      action: "moment_reject",
      targetType: "MOMENT",
      targetId: "m1",
      reason: "垃圾广告",
      before: { reviewStatus: "PENDING" },
      after: { reviewStatus: "REJECTED" },
    });
  });

  it("审计与状态变更在同一事务内", async () => {
    // A decision that happened without a record of who made it is exactly what this
    // feature must not produce.
    const { service } = makeService({ existing: { id: "m1", reviewStatus: "PENDING", userId: "u1" } });
    const spy = jest.spyOn(
      (service as unknown as { prisma: { $transaction: unknown } }).prisma as never,
      "$transaction" as never,
    );
    await service.reviewMoment("m1", "approve", ADMIN);
    expect(spy).toHaveBeenCalled();
  });
});
