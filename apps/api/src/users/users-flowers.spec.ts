import { UsersService } from "./users.service";

/**
 * 送花（虚拟礼物，2026-10-06）—— 点赞式的人对人动作。
 *
 * 这一组钉住三件事：
 *
 *   1. **守卫**：给自己送、被拉黑、目标非 ACTIVE，三种情况都不该产生一朵花；
 *   2. **行与计数一起变**：`UserFlower` 的行和 `User.flowerCount` 必须同进同退，
 *      并且收回时计数不会掉到负数（冗余值漂移过也不能显示「-1 朵」）；
 *   3. **通知只发给收花**：送花产生一条 `FLOWER_RECEIVED`；**收回不产生** ——
 *      否则「点错了再点一下」会在对方那里留下两条骚扰记录。
 *
 * 守卫的取值刻意与 `getPublicProfile` 对齐（同一套判断），所以这里也顺带钉住
 * 「资料页看不到的人，不能给他送花」这类不变量。
 */
const SENDER = "sender-1";
const RECEIVER = "receiver-1";

function makePrisma(options: { status?: string; blocked?: boolean; hasRow?: boolean; flowerCount?: number } = {}) {
  const state = { flowerCount: options.flowerCount ?? 0 };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: RECEIVER, status: options.status ?? "ACTIVE" }),
      update: jest.fn(async ({ data }: { data: { flowerCount: { increment?: number; decrement?: number } } }) => {
        const delta = data.flowerCount.increment ?? -(data.flowerCount.decrement ?? 0);
        state.flowerCount += delta;
        return { flowerCount: state.flowerCount };
      }),
    },
    block: { findFirst: jest.fn().mockResolvedValue(options.blocked ? { blockedId: RECEIVER } : null) },
    userFlower: {
      findUnique: jest.fn().mockResolvedValue(options.hasRow ? { senderId: SENDER } : null),
      create: jest.fn().mockImplementation(async ({ data }: { data: unknown }) => data),
      delete: jest.fn().mockResolvedValue({ senderId: SENDER }),
    },
    // 与 `toggleLike` 同一形状：数组式事务，逐个 await。
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };

  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  return { prisma, notifications, state };
}

function service(prisma: unknown, notifications: unknown) {
  return new UsersService(prisma as never, notifications as never);
}

describe("UsersService.toggleFlower", () => {
  it("送出一朵花：写行 + 计数 +1 + 通知收花人", async () => {
    const { prisma, notifications, state } = makePrisma();
    const result = await service(prisma, notifications).toggleFlower(SENDER, RECEIVER);

    expect(result).toEqual({ sent: true, flowerCount: 1 });
    expect(state.flowerCount).toBe(1);
    expect(prisma.userFlower.create).toHaveBeenCalledWith({
      data: { senderId: SENDER, receiverId: RECEIVER },
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: RECEIVER, type: "FLOWER_RECEIVED" }),
    );
  });

  it("再点一次是收回：删行 + 计数 -1，且**不**再发通知", async () => {
    const { prisma, notifications, state } = makePrisma({ hasRow: true, flowerCount: 1 });
    const result = await service(prisma, notifications).toggleFlower(SENDER, RECEIVER);

    expect(result).toEqual({ sent: false, flowerCount: 0 });
    expect(state.flowerCount).toBe(0);
    expect(prisma.userFlower.delete).toHaveBeenCalledTimes(1);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("计数是冗余值：收回时不会掉到负数", async () => {
    // 模拟历史漂移：有行、但计数已经是 0。
    const { prisma, notifications } = makePrisma({ hasRow: true, flowerCount: 0 });
    const result = await service(prisma, notifications).toggleFlower(SENDER, RECEIVER);

    expect(result).toEqual({ sent: false, flowerCount: 0 });
  });

  it("给自己送花：拒绝（不写行、不通知）", async () => {
    const { prisma, notifications } = makePrisma();
    await expect(service(prisma, notifications).toggleFlower(SENDER, SENDER)).rejects.toMatchObject({
      response: { error: { code: "FLOWER_SELF" } },
    });
    expect(prisma.userFlower.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("被拉黑（任一方向）：拒绝", async () => {
    const { prisma, notifications } = makePrisma({ blocked: true });
    await expect(service(prisma, notifications).toggleFlower(SENDER, RECEIVER)).rejects.toMatchObject({
      response: { error: { code: "BLOCKED" } },
    });
    expect(prisma.userFlower.create).not.toHaveBeenCalled();
  });

  it("目标不存在或非 ACTIVE：返回 null（控制器译成 404）", async () => {
    for (const status of ["BANNED", "DISABLED", "PENDING"]) {
      const { prisma, notifications } = makePrisma({ status });
      await expect(service(prisma, notifications).toggleFlower(SENDER, RECEIVER)).resolves.toBeNull();
    }
  });
});

describe("UsersService.getPublicProfile — 送花投影", () => {
  it("把收到花的朵数投影出去，并告诉查看者自己有没有送过", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: RECEIVER,
          email: null,
          status: "ACTIVE",
          nickname: "Bob",
          avatarUrl: null,
          birthDate: null,
          countryCode: null,
          city: null,
          region: null,
          gender: "MALE",
          bio: null,
          languages: [],
          interests: [],
          purposes: [],
          preferredCountries: [],
          attributes: [],
          fieldVisibilities: [],
          flowerCount: 7,
        }),
      },
      block: { findFirst: jest.fn().mockResolvedValue(null) },
      connection: { findFirst: jest.fn().mockResolvedValue(null) },
      country: { findUnique: jest.fn().mockResolvedValue(null) },
      userFlower: { findUnique: jest.fn().mockResolvedValue({ senderId: SENDER }) },
    };

    const profile = await service(prisma, { notify: jest.fn() }).getPublicProfile(RECEIVER, SENDER);
    expect(profile.flowerCount).toBe(7);
    expect(profile.flowerFromViewer).toBe(true);
  });

  it("本人看自己的资料：不查花的关系行，按钮状态为 false", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: SENDER,
          email: null,
          status: "ACTIVE",
          nickname: "Me",
          avatarUrl: null,
          birthDate: null,
          countryCode: null,
          city: null,
          region: null,
          gender: "FEMALE",
          bio: null,
          languages: [],
          interests: [],
          purposes: [],
          preferredCountries: [],
          attributes: [],
          fieldVisibilities: [],
          flowerCount: 3,
        }),
      },
      block: { findFirst: jest.fn() },
      connection: { findFirst: jest.fn() },
      country: { findUnique: jest.fn().mockResolvedValue(null) },
      userFlower: { findUnique: jest.fn() },
    };

    const profile = await service(prisma, { notify: jest.fn() }).getPublicProfile(SENDER, SENDER);
    expect(profile.flowerCount).toBe(3);
    expect(profile.flowerFromViewer).toBe(false);
    expect(prisma.userFlower.findUnique).not.toHaveBeenCalled();
  });
});
