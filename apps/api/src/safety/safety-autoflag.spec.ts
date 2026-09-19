import { SafetyService } from "./safety.service";

describe("SafetyService.recordAutoFlag product rules", () => {
  let created: Array<Record<string, unknown>>;
  let prisma: {
    report: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };
  let service: SafetyService;

  beforeEach(() => {
    created = [];
    prisma = {
      report: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "new-report-id", ...data };
        }),
      },
    };
    service = new SafetyService(prisma as never);
  });

  it("A. HIGH risk + any source -> 不写入 Report，reportId === null", async () => {
    const result = await service.recordAutoFlag({
      userId: "user-1",
      reasons: ["疑似加密/空投诈骗"],
      messageId: "msg-1",
      source: "auto-flag",
      level: "HIGH",
    });

    expect(result).toEqual({ reportId: null, deduped: false });
    expect(prisma.report.findFirst).not.toHaveBeenCalled();
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("B. Say Hello + HIGH -> 机审信号不入人工队列（不创建 Report）", async () => {
    const result = await service.recordAutoFlag({
      userId: "user-1",
      reasons: ["疑似钓鱼链接诱导"],
      messageId: "msg-1",
      source: "Say Hello",
      level: "HIGH",
    });

    expect(result).toEqual({ reportId: null, deduped: false });
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("C. chat message + HIGH -> 机审信号不入人工队列（不创建 Report）", async () => {
    const result = await service.recordAutoFlag({
      userId: "user-1",
      reasons: ["疑似色情内容"],
      messageId: "msg-2",
      source: "chat message",
      level: "HIGH",
    });

    expect(result).toEqual({ reportId: null, deduped: false });
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("D. socket message + HIGH -> 机审信号不入人工队列（不创建 Report）", async () => {
    const result = await service.recordAutoFlag({
      userId: "user-1",
      reasons: ["疑似赌博"],
      messageId: "msg-3",
      source: "socket message",
      level: "HIGH",
    });

    expect(result).toEqual({ reportId: null, deduped: false });
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("E. deduplication -> 保持原有行为 (相同的 userId, reason 和 messageId)", async () => {
    prisma.report.findFirst.mockResolvedValueOnce({ id: "auto-existing" });

    await expect(
      service.recordAutoFlag({
        userId: "user-1",
        reasons: ["疑似加密/空投诈骗"],
        messageId: "msg-1",
        source: "Say Hello",
        level: "MEDIUM",
      }),
    ).resolves.toEqual({ reportId: "auto-existing", deduped: true });

    expect(prisma.report.findFirst).toHaveBeenCalledWith({
      where: {
        reportedUserId: "user-1",
        reason: "疑似加密/空投诈骗",
        messageId: "msg-1",
      },
      select: { id: true },
    });
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("F. 非 HIGH 信号 -> 落库为 OPEN，等待人工判定", async () => {
    const result = await service.recordAutoFlag({
      userId: "user-1",
      reasons: ["疑似站外引流"],
      messageId: "msg-4",
      source: "chat message",
      level: "MEDIUM",
    });

    expect(result).toEqual({ reportId: "new-report-id", deduped: false });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      reporterId: "user-1",
      reportedUserId: "user-1",
      reason: "疑似站外引流",
      messageId: "msg-4",
      status: "OPEN",
    });
  });
});
