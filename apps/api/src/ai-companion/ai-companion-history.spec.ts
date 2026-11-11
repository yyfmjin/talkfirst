import { AiCompanionService } from "./ai-companion.service";

/**
 * 2026-11-11 — 「退出 AI 聊天再进来，记录没了」。
 *
 * 根因不在前端：`getForUser` 以前是 `orderBy createdAt asc` + `take: 50`，也就是取
 * **最早**的 50 条。一段对话超过 50 条之后，重新进入看到的是几十条之前的旧记录，
 * 刚聊过的整段消失。
 *
 * 这里钉住两件事：查询必须取最近（desc + take），交给客户端时必须回到时间正序。
 */

function row(id: string, iso: string) {
  return {
    id,
    conversationId: "conv-1",
    senderId: null,
    senderKind: "AI",
    content: id,
    type: "TEXT",
    createdAt: new Date(iso),
    deletedAt: null,
  };
}

function make(rows: ReturnType<typeof row>[]) {
  const prisma = {
    aiCompanion: { findUnique: jest.fn().mockResolvedValue({ id: "comp-1" }) },
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: "conv-1" }) },
    message: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const service = new AiCompanionService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe("AI 聊天记录 —— 取最近 N 条", () => {
  it("按时间倒序取 50 条（升序 + take 拿到的是最早的 50 条）", async () => {
    const { service, prisma } = make([row("m1", "2026-11-11T10:00:00Z")]);

    await service.getForUser("u1");

    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("返回给客户端时翻回时间正序：最新一条在最后", async () => {
    // 数据库按 desc 返回（最新在前）。
    const { service } = make([
      row("m3", "2026-11-11T12:00:00Z"),
      row("m2", "2026-11-11T11:00:00Z"),
      row("m1", "2026-11-11T10:00:00Z"),
    ]);

    const state = await service.getForUser("u1");

    expect(state?.messages.map((message) => message.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("没有 AI 朋友时返回 null，而不是空对象", async () => {
    const prisma = {
      aiCompanion: { findUnique: jest.fn().mockResolvedValue(null) },
      conversation: { findFirst: jest.fn() },
      message: { findMany: jest.fn() },
    };
    const service = new AiCompanionService(prisma as never, {} as never, {} as never);

    await expect(service.getForUser("u1")).resolves.toBeNull();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});
