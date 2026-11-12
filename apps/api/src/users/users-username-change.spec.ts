import { BadRequestException, ConflictException } from "@nestjs/common";
import { UsersService } from "./users.service";

/**
 * 改登录名（2026-11-12）。
 *
 * 存量账号的名字是注册时随机生成的 10 位串（`k7m2p9x4z8`），没人会去输它——
 * 所以「用户名登录」对老用户本来是空的。这里钉住改名这条路的四条边界：
 * 小写化落库、非法形状、被别人占用、并发撞车。
 */

function make(options: { owner?: { id: string } | null; updateImpl?: () => Promise<unknown> } = {}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(options.owner ?? null),
      // 显式声明参数类型：推断成「无参」时，读 `mock.calls[0][0]` 会在类型层报错。
      update: jest.fn<Promise<unknown>, [unknown]>(options.updateImpl ?? (async () => ({ id: "u1" }))),
    },
  };
  const service = new UsersService(prisma as never, {} as never);
  jest.spyOn(service, "getFullCard").mockResolvedValue({ id: "u1" } as never);
  return { service, prisma };
}

describe("UsersService.updateProfile — 改登录名", () => {
  it("合法名字落库时统一小写", async () => {
    const { service, prisma } = make();

    await service.updateProfile("u1", { username: "MyName123" });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ username: "myname123" }) }),
    );
  });

  it("不传 username 时保持原值（PATCH 仍是部分更新）", async () => {
    const { service, prisma } = make();

    await service.updateProfile("u1", { nickname: "小明" });

    const data = (prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.username).toBeUndefined();
  });

  it("形状不合法 → 400，且不写库", async () => {
    const { service, prisma } = make();

    await expect(service.updateProfile("u1", { username: "abc" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("被别人占用 → 409 USERNAME_TAKEN", async () => {
    const { service } = make({ owner: { id: "someone-else" } });

    await expect(service.updateProfile("u1", { username: "takenname1" })).rejects.toMatchObject({
      response: { error: { code: "USERNAME_TAKEN" } },
    });
  });

  it("名字本来就是自己的 → 允许保存（不算被占用）", async () => {
    const { service, prisma } = make({ owner: { id: "u1" } });

    await service.updateProfile("u1", { username: "myname123" });

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("并发改名撞车（P2002）也翻译成 USERNAME_TAKEN，而不是 500", async () => {
    const { service } = make({
      updateImpl: async () => {
        throw { code: "P2002", meta: { target: ["username"] } };
      },
    });

    await expect(service.updateProfile("u1", { username: "racedname1" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
