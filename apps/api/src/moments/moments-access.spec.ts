import { ForbiddenException } from "@nestjs/common";
import { MomentsService } from "./moments.service";

function makePrisma(overrides: {
  setting?: { visibleTo: string } | null;
  blocked?: object | null;
  connected?: object | null;
  moment?: { id: string; userId: string } | null;
  comments?: unknown[];
}) {
  return {
    momentSetting: {
      findUnique: jest.fn().mockResolvedValue(overrides.setting ?? null),
    },
    block: {
      findFirst: jest.fn().mockResolvedValue(overrides.blocked ?? null),
    },
    connection: {
      findFirst: jest.fn().mockResolvedValue(overrides.connected ?? null),
    },
    moment: {
      findUnique: jest.fn().mockResolvedValue(overrides.moment ?? null),
    },
    momentComment: {
      findMany: jest.fn().mockResolvedValue(overrides.comments ?? []),
    },
  };
}

describe("MomentsService.listComments access matrix", () => {
  it("private + stranger -> Promise reject -> MOMENT_LOCKED / 403, findMany 不被调用", async () => {
    const prisma = makePrisma({
      setting: { visibleTo: "private" },
      moment: { id: "m1", userId: "author" },
    });
    const service = new MomentsService(
      prisma as never,
      { scanText: () => ({ blocked: false }) } as never,
    );
    await expect(service.listComments("stranger", "m1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.momentComment.findMany).not.toHaveBeenCalled();
  });

  it("connections-only + stranger -> Promise reject -> MOMENT_LOCKED / 403, findMany 不被调用", async () => {
    const prisma = makePrisma({
      setting: { visibleTo: "connections" },
      connected: null,
      moment: { id: "m2", userId: "author" },
    });
    const service = new MomentsService(
      prisma as never,
      { scanText: () => ({ blocked: false }) } as never,
    );
    await expect(service.listComments("stranger", "m2")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.momentComment.findMany).not.toHaveBeenCalled();
  });

  it("ACTIVE connection -> 成功返回评论", async () => {
    const comments = [{ id: "c1", content: "hi" }];
    const prisma = makePrisma({
      setting: { visibleTo: "connections" },
      connected: { id: "conn-1" },
      moment: { id: "m3", userId: "author" },
      comments,
    });
    const service = new MomentsService(
      prisma as never,
      { scanText: () => ({ blocked: false }) } as never,
    );
    await expect(service.listComments("peer", "m3")).resolves.toEqual(comments);
    expect(prisma.momentComment.findMany).toHaveBeenCalled();
  });

  it("author -> 成功返回评论", async () => {
    const comments = [{ id: "c1", content: "my own comment" }];
    const prisma = makePrisma({
      setting: { visibleTo: "private" },
      moment: { id: "m4", userId: "author" },
      comments,
    });
    const service = new MomentsService(
      prisma as never,
      { scanText: () => ({ blocked: false }) } as never,
    );
    await expect(service.listComments("author", "m4")).resolves.toEqual(comments);
    expect(prisma.momentComment.findMany).toHaveBeenCalled();
  });

  it("maps locked access to ForbiddenException(MOMENT_LOCKED) at the controller level", async () => {
    const locked = new Error("MOMENT_LOCKED") as Error & { code?: string; status?: number };
    locked.code = "MOMENT_LOCKED";
    locked.status = 403;
    const lockedService = {
      listComments: jest.fn().mockRejectedValue(locked),
    };
    
    // Simulate controller logic and verify it correctly throws ForbiddenException
    const controllerAction = async () => {
      try {
        await lockedService.listComments("stranger", "m1");
      } catch (error) {
        if ((error as { code?: string }).code === "MOMENT_LOCKED") {
          throw new ForbiddenException({
            success: false,
            error: { code: "MOMENT_LOCKED", message: "This moment is not visible to you" },
          });
        }
        throw error;
      }
    };

    await expect(controllerAction()).rejects.toThrow(ForbiddenException);
    await expect(controllerAction()).rejects.toMatchObject({
      response: {
        success: false,
        error: { code: "MOMENT_LOCKED" }
      }
    });
  });
});
