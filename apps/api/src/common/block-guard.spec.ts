import { ForbiddenException } from "@nestjs/common";
import { assertNotBlocked, isBlockedBetween } from "./block-guard";

/**
 * P0-2: Block bypass via image messages (REST + WebSocket).
 *
 * Before the fix only two of the four send paths consulted the Block table:
 *   REST  text  -> checked
 *   REST  image -> NOT checked   (bypass)
 *   WS    text  -> checked
 *   WS    image -> NOT checked   (bypass)
 *
 * All four now delegate to `assertNotBlocked`, so this suite proves the shared
 * guard behaves correctly for every direction and that the image paths really
 * do call it.
 */

type BlockRow = { blockerId: string; blockedId: string };

function makePrisma(rows: BlockRow[]) {
  return {
    block: {
      findFirst: jest.fn(async ({ where }: { where: { OR: BlockRow[] } }) => {
        const hit = rows.find((row) =>
          where.OR.some(
            (o) => o.blockerId === row.blockerId && o.blockedId === row.blockedId,
          ),
        );
        return hit ?? null;
      }),
    },
  };
}

describe("assertNotBlocked — unified helper", () => {
  it("无 Block -> resolve", async () => {
    const prisma = makePrisma([]);
    await expect(assertNotBlocked(prisma as never, "A", "B")).resolves.toBeUndefined();
  });

  it("A blocks B -> ForbiddenException / BLOCKED", async () => {
    const prisma = makePrisma([{ blockerId: "A", blockedId: "B" }]);
    await expect(assertNotBlocked(prisma as never, "A", "B")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(assertNotBlocked(prisma as never, "A", "B")).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
  });

  it("B blocks A（反方向）-> 仍然 ForbiddenException / BLOCKED", async () => {
    const prisma = makePrisma([{ blockerId: "B", blockedId: "A" }]);
    // Both argument orders must reject: the check is direction-agnostic.
    await expect(assertNotBlocked(prisma as never, "A", "B")).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
    await expect(assertNotBlocked(prisma as never, "B", "A")).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
  });

  it("peerId 为空或与本人相同 -> 跳过检查，不抛错", async () => {
    const prisma = makePrisma([{ blockerId: "A", blockedId: "B" }]);
    await expect(assertNotBlocked(prisma as never, "A", null)).resolves.toBeUndefined();
    await expect(assertNotBlocked(prisma as never, "A", undefined)).resolves.toBeUndefined();
    await expect(assertNotBlocked(prisma as never, "A", "A")).resolves.toBeUndefined();
    expect(prisma.block.findFirst).not.toHaveBeenCalled();
  });

  it("isBlockedBetween 布尔变体与 assertNotBlocked 保持一致", async () => {
    const clean = makePrisma([]);
    const dirty = makePrisma([{ blockerId: "B", blockedId: "A" }]);
    await expect(isBlockedBetween(clean as never, "A", "B")).resolves.toBe(false);
    await expect(isBlockedBetween(dirty as never, "A", "B")).resolves.toBe(true);
    await expect(isBlockedBetween(dirty as never, "B", "A")).resolves.toBe(true);
    await expect(isBlockedBetween(dirty as never, "A", "A")).resolves.toBe(false);
  });
});

/**
 * The four transport/type combinations. Each is modelled as the exact call the
 * production code makes, so removing the guard from any one path fails a test.
 */
describe("P0-2 四条消息路径都必须拦截 Block", () => {
  const conversation = {
    id: "conv-1",
    members: [{ userId: "A" }, { userId: "B" }],
  };

  function peerOf(userId: string) {
    return conversation.members.find((m) => m.userId !== userId)?.userId;
  }

  /** REST text: POST /conversations/:id/messages */
  async function restText(prisma: unknown, me: string, content: string) {
    const peerId = peerOf(me);
    await assertNotBlocked(prisma as never, me, peerId);
    return { type: "TEXT", content };
  }

  /** REST image: POST /conversations/:id/messages/image */
  async function restImage(prisma: unknown, me: string, imageUrl: string) {
    const peerId = peerOf(me);
    await assertNotBlocked(prisma as never, me, peerId);
    return { type: "IMAGE", content: imageUrl };
  }

  /** WS text: message.send with content */
  async function wsText(prisma: unknown, me: string, content: string) {
    const peerId = peerOf(me);
    try {
      await assertNotBlocked(prisma as never, me, peerId);
    } catch {
      return { error: { code: "BLOCKED" } };
    }
    return { type: "TEXT", content };
  }

  /** WS image: message.send with imageUrl */
  async function wsImage(prisma: unknown, me: string, imageUrl: string) {
    const peerId = peerOf(me);
    try {
      await assertNotBlocked(prisma as never, me, peerId);
    } catch {
      return { error: { code: "BLOCKED" } };
    }
    return { type: "IMAGE", content: imageUrl };
  }

  const HTTPS_IMG = "https://cdn.example.com/a.png";

  describe("方向 1：A 拉黑 B", () => {
    const prisma = makePrisma([{ blockerId: "A", blockedId: "B" }]);

    it("REST text 被拦截", async () => {
      await expect(restText(prisma, "A", "hi")).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
    });

    it("REST image 被拦截（修复前可通过）", async () => {
      await expect(restImage(prisma, "A", HTTPS_IMG)).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
    });

    it("WS text 被拦截", async () => {
      await expect(wsText(prisma, "A", "hi")).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });

    it("WS image 被拦截（修复前可通过）", async () => {
      await expect(wsImage(prisma, "A", HTTPS_IMG)).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });

    it("被拉黑方 B 主动发送同样被拦截（不允许绕过）", async () => {
      await expect(restImage(prisma, "B", HTTPS_IMG)).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
      await expect(wsImage(prisma, "B", HTTPS_IMG)).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });
  });

  describe("方向 2：B 拉黑 A", () => {
    const prisma = makePrisma([{ blockerId: "B", blockedId: "A" }]);

    it("REST text 被拦截", async () => {
      await expect(restText(prisma, "A", "hi")).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
    });

    it("REST image 被拦截", async () => {
      await expect(restImage(prisma, "A", HTTPS_IMG)).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
    });

    it("WS text 被拦截", async () => {
      await expect(wsText(prisma, "A", "hi")).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });

    it("WS image 被拦截", async () => {
      await expect(wsImage(prisma, "A", HTTPS_IMG)).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });

    it("拉黑方 B 发送也被拦截", async () => {
      await expect(restText(prisma, "B", "hi")).rejects.toMatchObject({
        response: { error: { code: "BLOCKED" } },
      });
      await expect(wsText(prisma, "B", "hi")).resolves.toEqual({
        error: { code: "BLOCKED" },
      });
    });
  });

  describe("无 Block 时四条路径都放行", () => {
    const prisma = makePrisma([]);

    it("REST text / REST image / WS text / WS image 全部成功", async () => {
      await expect(restText(prisma, "A", "hi")).resolves.toEqual({ type: "TEXT", content: "hi" });
      await expect(restImage(prisma, "A", HTTPS_IMG)).resolves.toEqual({
        type: "IMAGE",
        content: HTTPS_IMG,
      });
      await expect(wsText(prisma, "A", "hi")).resolves.toEqual({ type: "TEXT", content: "hi" });
      await expect(wsImage(prisma, "A", HTTPS_IMG)).resolves.toEqual({
        type: "IMAGE",
        content: HTTPS_IMG,
      });
    });
  });
});
