import { MomentsService } from "./moments.service";

/**
 * C5（`docs/P0-00-BASELINE.md` §C）—— 通知去重的**产品口径**：不看时间窗口，看**是不是同一个事件**。
 *
 * 用户 2026-10-05 定的口径是一句话：「**每次点赞都提醒**」。
 * 这一句直接排除了最省事的做法 —— 在 `(收件人, 类型, 目标)` 上建唯一索引：
 * 那样**同一条动态被两个不同的人点赞会合成一条**，恰好把要的行为去掉。所以去重键若真要建，
 * 也必须把点赞人算进去；而对点赞本身，正确行为就是「一次点赞事件 = 一条通知」。
 *
 * 这套用例把这句口径钉成契约，因为它很容易在后面的「优化」里被无声改掉：
 *
 * | 发生的事 | 期望 |
 * |---|---|
 * | 一次真实的点赞 | **恰好一条**通知（不管点赞的是谁、同一动态被点几次） |
 * | 取消赞 | **不产生**通知——它不是一次「点赞」 |
 * | 取消后重新点赞 | 是**新的一次**点赞事件 → 再提醒一次（不是被去重掉） |
 * | 给自己的动态点赞 | **不提醒**（没人需要被通知自己刚做的事） |
 *
 * 为什么现在没有「重复投递」需要去重：写通知的 13 个生产者里，事件型的（点赞、评论、回复、
 * 消息、请求）都以**新建行**为触发，行本身唯一；状态型的（封禁到期释放）用自消耗谓词 +
 * 条件认领，第二次 tick 匹配不到行。这条推理写在 `docs/P0-00-FIXES.md` 的 FIX-9 里。
 */

const AUTHOR = "author-1";
const LIKER = "liker-1";
const OTHER_LIKER = "liker-2";

/**
 * 点赞路径需要的桩件。
 *
 * `like` 是**可变的**：`toggleLike` 靠「有没有已存在的赞」决定这是点赞还是取消，
 * 所以用例要能在两次调用之间改变它 —— 这正是「取消后重新点赞」的场景。
 */
function makeHarness() {
  const state: { like: unknown } = { like: null };
  const prisma = {
    moment: {
      findUnique: jest.fn(async () => ({ id: "m1", userId: AUTHOR, content: "hello world" })),
      update: jest.fn(async () => ({})),
    },
    momentLike: {
      findUnique: jest.fn(async () => state.like),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "like-1", ...data })),
      delete: jest.fn(async () => ({})),
    },
    momentSetting: { findUnique: jest.fn(async () => null) },
    block: { findFirst: jest.fn(async () => null) },
    connection: { findFirst: jest.fn(async () => null) },
    // `$transaction` 收到的是**已经被调用**的 promise 数组，按原样 await 即可。
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };
  const notifications = { notify: jest.fn() };
  const service = new MomentsService(
    prisma as never,
    { scanText: () => ({ blocked: false }) } as never,
    notifications as never,
  );
  return {
    service,
    prisma,
    notifications,
    setLiked: (liked: boolean) => {
      state.like = liked ? { momentId: "m1", userId: LIKER } : null;
    },
  };
}

describe("MomentsService.toggleLike —— 每次点赞都提醒（C5 的口径）", () => {
  it("两个不同的人点赞同一条动态 → 两条通知，不折叠", async () => {
    const harness = makeHarness();
    harness.setLiked(false);

    await harness.service.toggleLike(LIKER, "m1");
    await harness.service.toggleLike(OTHER_LIKER, "m1");

    // 这是本条用例的全部意义：如果按 `(收件人, 类型, 目标)` 去重，这里只会有一条。
    expect(harness.notifications.notify).toHaveBeenCalledTimes(2);

    const [first, second] = harness.notifications.notify.mock.calls.map(
      (call) => call[0] as { userId: string; type: string; data: { actorId: string; targetId: string } },
    );
    expect(first.userId).toBe(AUTHOR);
    expect(second.userId).toBe(AUTHOR);
    expect(first.data.actorId).toBe(LIKER);
    expect(second.data.actorId).toBe(OTHER_LIKER);
    // 客户端靠这两项跳转，所以它们必须都对到那条动态上。
    expect(first.type).toBe("MOMENT_LIKE");
    expect(first.data.targetId).toBe("m1");
  });

  it("取消赞不产生通知 —— 它不是一次「点赞」", async () => {
    const harness = makeHarness();
    harness.setLiked(true);

    const result = await harness.service.toggleLike(LIKER, "m1");

    expect(result).toEqual({ liked: false });
    expect(harness.notifications.notify).not.toHaveBeenCalled();
  });

  it("取消后重新点赞 → 是新的一次点赞事件，再提醒一次", async () => {
    const harness = makeHarness();

    harness.setLiked(false);
    await harness.service.toggleLike(LIKER, "m1"); // 点赞

    harness.setLiked(true);
    await harness.service.toggleLike(LIKER, "m1"); // 取消

    harness.setLiked(false);
    await harness.service.toggleLike(LIKER, "m1"); // 又点赞

    // 两次「点赞事件」= 两条通知。若按 `(收件人, 类型, 目标)` 或按人+目标永久去重，
    // 第二次点赞会被静默吞掉 —— 那正是这条用例要挡住的行为。
    expect(harness.notifications.notify).toHaveBeenCalledTimes(2);
  });

  it("给自己的动态点赞不提醒", async () => {
    const harness = makeHarness();
    harness.setLiked(false);

    await harness.service.toggleLike(AUTHOR, "m1");

    expect(harness.notifications.notify).not.toHaveBeenCalled();
  });
});
