import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AppSettingsService, FEEDBACK_EMAIL_KEY, isPlausibleEmail } from "./app-settings.service";
import { FEEDBACK_MAX_BODY, FeedbackService } from "./feedback.service";

/**
 * Feedback submission, the admin reply, and the support-address setting.
 *
 * ## What is worth testing here
 *
 * The rules that a member or an operator can be harmed by: an empty or oversized body,
 * an address that would be advertised but cannot receive mail, a reply that silently
 * overwrites an answer already given, and a settings write that clears a value by
 * accident. Each has a case below.
 *
 * ## NOT RUN
 *
 * No database. `PrismaService` is a stub, so this covers the service's decisions and the
 * shape of its writes, not Prisma's SQL.
 */

type Call = Record<string, unknown>;

function makeService(options: { existing?: Call | null } = {}) {
  const feedback = {
    create: jest.fn(async (_args: Call) => ({ id: "fb-1", createdAt: new Date() }) as unknown),
    findMany: jest.fn(async (_args: Call) => [] as unknown[]),
    count: jest.fn(async (_args: Call) => 0),
    findUnique: jest.fn(async (_args: Call) => (options.existing ?? null) as unknown),
    update: jest.fn(async (_args: Call) => ({ id: "fb-1" }) as unknown),
  };
  const appSetting = {
    findUnique: jest.fn(async (_args: Call) => null as unknown),
    upsert: jest.fn(async (_args: Call) => ({}) as unknown),
    deleteMany: jest.fn(async (_args: Call) => ({ count: 0 }) as unknown),
  };
  const prisma = { feedback, appSetting };
  const settings = new AppSettingsService(prisma as never);
  const service = new FeedbackService(prisma as never, settings);
  return { service, feedback, appSetting, settings };
}

/* -------------------------------------------------------------------------- */
/* Address plausibility                                                       */
/* -------------------------------------------------------------------------- */

describe("isPlausibleEmail", () => {
  it("接受常见有效地址", () => {
    for (const value of [
      "support@talkfirst.ccwu.cc",
      "a@b.co",
      "first.last+tag@sub.example.com",
      "UPPER@EXAMPLE.COM",
    ]) {
      expect(isPlausibleEmail(value)).toBe(true);
    }
  });

  it("拒绝缺少 TLD 的地址（最常见的输入错误）", () => {
    // `name@company` is the typo this check exists to catch: it looks complete to a
    // member and can never receive mail.
    for (const value of ["name@company", "a@b", "admin@localhost"]) {
      expect(isPlausibleEmail(value)).toBe(false);
    }
  });

  it("拒绝空值、空白与多个 @", () => {
    for (const value of ["", "   ", "a b@c.com", "a@@b.com", "a@b@c.com", "@b.com", "a@"]) {
      expect(isPlausibleEmail(value)).toBe(false);
    }
  });

  it("拒绝超过 320 字符的地址", () => {
    expect(isPlausibleEmail(`${"a".repeat(320)}@b.com`)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Submission                                                                 */
/* -------------------------------------------------------------------------- */

describe("FeedbackService.submit — 校验", () => {
  it("拒绝空内容", async () => {
    const { service } = makeService();
    await expect(service.submit("u1", { body: "   " })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("拒绝超过上限的内容", async () => {
    const { service } = makeService();
    await expect(
      service.submit("u1", { body: "x".repeat(FEEDBACK_MAX_BODY + 1) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("正好等于上限时接受", async () => {
    const { service, feedback } = makeService();
    await expect(service.submit("u1", { body: "x".repeat(FEEDBACK_MAX_BODY) })).resolves.toBeDefined();
    expect(feedback.create).toHaveBeenCalled();
  });

  it("拒绝格式错误的联系邮箱", async () => {
    const { service } = makeService();
    await expect(
      service.submit("u1", { body: "hello", contactEmail: "not-an-email" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("未提供联系邮箱时存 null，而不是空字符串", async () => {
    const { service, feedback } = makeService();
    await service.submit("u1", { body: "hello" });
    expect((feedback.create.mock.calls[0]?.[0]?.data as Call).contactEmail).toBeNull();
  });

  it("未知的 kind 归为 OTHER，而不是拒绝提交", async () => {
    /**
     * The kind is a triage aid. Refusing a message over an unrecognised label would lose
     * the content to save a category, which is the wrong trade.
     */
    const { service, feedback } = makeService();
    await service.submit("u1", { body: "hello", kind: "NOT_A_KIND" });
    expect((feedback.create.mock.calls[0]?.[0]?.data as Call).kind).toBe("OTHER");
  });

  it("保留合法的 kind", async () => {
    const { service, feedback } = makeService();
    await service.submit("u1", { body: "hello", kind: "BUG" });
    expect((feedback.create.mock.calls[0]?.[0]?.data as Call).kind).toBe("BUG");
  });

  it("允许无登录用户提交（userId 为 null）", async () => {
    // The schema allows it and nothing here depends on a session, which keeps a future
    // anonymous-submission variant from needing a migration.
    const { service, feedback } = makeService();
    await service.submit(null, { body: "hello" });
    expect((feedback.create.mock.calls[0]?.[0]?.data as Call).userId).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Admin review                                                               */
/* -------------------------------------------------------------------------- */

describe("FeedbackService.review", () => {
  it("不存在的反馈返回 404", async () => {
    const { service } = makeService({ existing: null });
    await expect(service.review("missing", { status: "RESOLVED" }, { adminUserId: null })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("未知状态被拒绝", async () => {
    const { service } = makeService({ existing: { id: "fb-1", status: "OPEN", replyBody: null } });
    await expect(
      service.review("fb-1", { status: "NOT_A_STATUS" }, { adminUserId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("既没有状态也没有回复时拒绝，而不是写一条空更新", async () => {
    const { service, feedback } = makeService({
      existing: { id: "fb-1", status: "OPEN", replyBody: null },
    });
    await expect(service.review("fb-1", {}, { adminUserId: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(feedback.update).not.toHaveBeenCalled();
  });

  it("空字符串回复不会抹掉已给出的回复", async () => {
    /**
     * A status-only change is the common triage action, and an empty `replyBody` must
     * mean "leave it alone" — erasing an answer the member has already read would be a
     * silent data loss with no way to notice from the queue.
     */
    const { service, feedback } = makeService({
      existing: { id: "fb-1", status: "OPEN", replyBody: "already answered" },
    });
    await service.review("fb-1", { status: "CLOSED", replyBody: "   " }, { adminUserId: "a1" });

    const data = feedback.update.mock.calls[0]?.[0]?.data as Call;
    expect(data).toEqual({ status: "CLOSED" });
    expect(data.replyBody).toBeUndefined();
  });

  it("给出回复时记录回复人、时间，并默认转为已解决", async () => {
    const { service, feedback } = makeService({
      existing: { id: "fb-1", status: "OPEN", replyBody: null },
    });
    await service.review("fb-1", { replyBody: "谢谢反馈，已修复" }, { adminUserId: "admin-9" });

    const data = feedback.update.mock.calls[0]?.[0]?.data as Call;
    expect(data.replyBody).toBe("谢谢反馈，已修复");
    expect(data.repliedById).toBe("admin-9");
    expect(data.repliedAt).toBeInstanceOf(Date);
    expect(data.status).toBe("RESOLVED");
  });

  it("同时给出状态与回复时，显式状态优先", async () => {
    const { service, feedback } = makeService({
      existing: { id: "fb-1", status: "OPEN", replyBody: null },
    });
    await service.review("fb-1", { status: "IN_PROGRESS", replyBody: "looking into it" }, { adminUserId: "a1" });
    expect((feedback.update.mock.calls[0]?.[0]?.data as Call).status).toBe("IN_PROGRESS");
  });

  it("超长回复被拒绝", async () => {
    const { service } = makeService({ existing: { id: "fb-1", status: "OPEN", replyBody: null } });
    await expect(
      service.review("fb-1", { replyBody: "x".repeat(FEEDBACK_MAX_BODY + 1) }, { adminUserId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */

describe("FeedbackService — 列表", () => {
  it("管理端只接受已知的状态与类型过滤，未知值被忽略", async () => {
    const { service, feedback } = makeService();
    await service.listForAdmin({ status: "NOT_A_STATUS", kind: "NOT_A_KIND" });

    const where = feedback.findMany.mock.calls[0]?.[0]?.where as Call;
    expect(where.status).toBeUndefined();
    expect(where.kind).toBeUndefined();
  });

  it("管理端应用合法过滤", async () => {
    const { service, feedback } = makeService();
    await service.listForAdmin({ status: "OPEN", kind: "BUG" });

    const where = feedback.findMany.mock.calls[0]?.[0]?.where as Call;
    expect(where).toEqual({ status: "OPEN", kind: "BUG" });
  });

  it("管理端 pageSize 有上限", async () => {
    const { service, feedback } = makeService();
    await service.listForAdmin({ pageSize: 99999 });
    expect(feedback.findMany.mock.calls[0]?.[0]?.take).toBe(200);
  });

  it("成员端只读自己的反馈", async () => {
    const { service, feedback } = makeService();
    await service.listMine("user-7");
    expect((feedback.findMany.mock.calls[0]?.[0]?.where as Call).userId).toBe("user-7");
  });

  it("成员端不返回联系邮箱等内部字段", async () => {
    /**
     * The member already knows what they typed; the projection also keeps `repliedById`
     * and the internal status vocabulary out of a public response.
     */
    const { service, feedback } = makeService();
    await service.listMine("user-7");
    const select = feedback.findMany.mock.calls[0]?.[0]?.select as Call;
    expect(select.contactEmail).toBeUndefined();
    expect(select.repliedById).toBeUndefined();
    expect(select.replyBody).toBe(true);
  });

  it("成员端 pageSize 上限比管理端更紧", async () => {
    const { service, feedback } = makeService();
    await service.listMine("user-7", 1, 9999);
    expect(feedback.findMany.mock.calls[0]?.[0]?.take).toBe(50);
  });
});

/* -------------------------------------------------------------------------- */
/* Support address setting                                                    */
/* -------------------------------------------------------------------------- */

describe("AppSettingsService — 反馈邮箱", () => {
  it("没有存储值时使用默认地址，且不返回空", async () => {
    const { settings } = makeService();
    const email = await settings.supportEmail();
    // A feedback screen with no address is worse than one with a stale address: the
    // member has a problem and no way to report it.
    expect(email).toMatch(/@/);
    expect(email).not.toBe("");
  });

  it("存储值优先于默认值", async () => {
    const { settings, appSetting } = makeService();
    appSetting.findUnique.mockResolvedValue({ value: "ops@example.com" } as never);
    await expect(settings.supportEmail()).resolves.toBe("ops@example.com");
  });

  it("存储值损坏时退回默认值，而不是把坏值显示给用户", async () => {
    const { settings, appSetting } = makeService();
    appSetting.findUnique.mockResolvedValue({ value: "garbage" } as never);
    await expect(settings.supportEmail()).resolves.toMatch(/@/);
  });

  it("读取失败时退回默认值，不抛异常", async () => {
    const { settings, appSetting } = makeService();
    appSetting.findUnique.mockRejectedValue(new Error("db down") as never);
    await expect(settings.supportEmail()).resolves.toMatch(/@/);
  });

  it("写入合法地址时 upsert", async () => {
    const { settings, appSetting } = makeService();
    await expect(settings.setSupportEmail("help@example.com", "admin-1")).resolves.toBe(
      "help@example.com",
    );
    const args = appSetting.upsert.mock.calls[0]?.[0] as Call;
    expect(args.where).toEqual({ key: FEEDBACK_EMAIL_KEY });
    expect((args.create as Call).value).toBe("help@example.com");
    expect((args.create as Call).updatedById).toBe("admin-1");
  });

  it("写入非法地址时拒绝，且不落库", async () => {
    const { settings, appSetting } = makeService();
    await expect(settings.setSupportEmail("nope", "admin-1")).rejects.toThrow();
    expect(appSetting.upsert).not.toHaveBeenCalled();
  });

  it("写入空字符串表示清除覆盖，回到默认值", async () => {
    /**
     * Distinct from omission, and the reason the DTO accepts a blank string: it is how an
     * operator undoes a bad value without database access.
     */
    const { settings, appSetting } = makeService();
    const result = await settings.setSupportEmail("   ", "admin-1");
    expect(appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: FEEDBACK_EMAIL_KEY } });
    expect(appSetting.upsert).not.toHaveBeenCalled();
    expect(result).toMatch(/@/);
  });

  it("无 Prisma 时读取仍可用（仅测试与降级场景）", async () => {
    const settings = new AppSettingsService(undefined as never);
    await expect(settings.supportEmail()).resolves.toMatch(/@/);
  });
});
