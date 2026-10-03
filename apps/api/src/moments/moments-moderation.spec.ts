import { MomentsService, isReviewBlockedForViewer } from "./moments.service";

/**
 * The moderation decision taken at publish time, and who may read a queued moment.
 *
 * ## Why the decision lives in a test rather than in the reviewer's head
 *
 * The rule is "escalate the narrow risk cases, publish everything else" — which is a
 * deliberate anti-pattern-avoider: defaulting to review would put every post behind a
 * human. The three branches (high risk, medium risk from an untrusted account, everything
 * else) are the whole policy, so each is pinned here.
 *
 * ## NOT RUN
 *
 * No database and no real scanner: `SafetyService` is a stub, so this covers
 * `MomentsService`'s use of the scan result, not the scanner's patterns.
 */

type ScanOptions = {
  blocked?: boolean;
  level?: "LOW" | "MEDIUM" | "HIGH";
  reasons?: string[];
  trusted?: boolean;
};

function makeService(options: ScanOptions = {}) {
  const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    id: "m-new",
    createdAt: new Date("2026-10-03T00:00:00.000Z"),
    reviewStatus: (args.data.reviewStatus as string) ?? "APPROVED",
    ...args.data,
  }));

  const service = new MomentsService(
    { moment: { create } } as never,
    {
      scanText: () => ({
        blocked: options.blocked ?? false,
        level: options.level ?? "LOW",
        reasons: options.reasons ?? [],
        hasExternalLink: false,
        hasContactLeak: false,
      }),
      trustedAccount: jest.fn(async () => options.trusted ?? false),
    } as never,
    { notify: jest.fn() } as never,
  );

  return { service, create };
}

/** The `data` the service handed to Prisma on its last create. */
function lastCreate(create: jest.Mock): Record<string, unknown> {
  return create.mock.calls[create.mock.calls.length - 1]?.[0]?.data as Record<string, unknown>;
}

describe("MomentsService.publish — 审核判定", () => {
  it("低风险内容立即公开", async () => {
    const { service, create } = makeService({ level: "LOW" });
    await service.publish("u1", { content: "今天天气不错" });

    expect(lastCreate(create).reviewStatus).toBe("APPROVED");
    expect(lastCreate(create).reviewReasons).toEqual([]);
  });

  it("高风险内容进入待审（PENDING），并记录原因", async () => {
    // A keyword match against the scam/spam lists is the case a human must look at.
    const { service, create } = makeService({
      level: "HIGH",
      reasons: ["疑似投资诈骗"],
    });
    await service.publish("u1", { content: "guaranteed return on investment" });

    expect(lastCreate(create).reviewStatus).toBe("PENDING");
    expect(lastCreate(create).reviewReasons).toEqual(["疑似投资诈骗"]);
  });

  it("中风险内容对不信任账号进入待审", async () => {
    /**
     * A medium signal is a link, a phone number or a handle. Harmless from an established
     * member, and the single most common shape of spam from a fresh account.
     */
    const { service, create } = makeService({
      level: "MEDIUM",
      reasons: ["包含外部链接"],
      trusted: false,
    });
    await service.publish("u1", { content: "看看这个 https://spam.example" });

    expect(lastCreate(create).reviewStatus).toBe("PENDING");
    expect(lastCreate(create).reviewReasons).toEqual(["包含外部链接"]);
  });

  it("同样的中风险内容对信任账号立即公开", async () => {
    /**
     * The exemption is what stops the queue filling with content nobody needs to review.
     * Without it every established member would wait for a human to approve a link.
     */
    const { service, create } = makeService({ level: "MEDIUM", trusted: true });
    await service.publish("u1", { content: "我的主页 https://example.com" });

    expect(lastCreate(create).reviewStatus).toBe("APPROVED");
  });

  it("blocked 内容直接拒绝，不落库", async () => {
    const { service, create } = makeService({ blocked: true });
    await expect(service.publish("u1", { content: "blocked" })).rejects.toMatchObject({
      code: "CONTENT_BLOCKED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("扫描器抛错时按未审核处理并继续发布，而不是阻断发帖", async () => {
    /**
     * The failure mode of an unavailable scanner is "unmoderated" — which is exactly what
     * every moment was before this feature existed. Refusing to publish would turn a
     * scanner defect into a total outage of the composer.
     */
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "m-new",
      createdAt: new Date(),
      ...args.data,
    }));
    const service = new MomentsService(
      { moment: { create } } as never,
      {
        scanText: () => {
          throw new Error("scanner down");
        },
        trustedAccount: jest.fn(async () => false),
      } as never,
      { notify: jest.fn() } as never,
    );

    await expect(service.publish("u1", { content: "hello" })).resolves.toBeDefined();
    expect(lastCreate(create).reviewStatus).toBe("APPROVED");
  });

  it("信任查询失败时按不信任处理（更严，而非更松）", async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "m-new",
      createdAt: new Date(),
      ...args.data,
    }));
    const service = new MomentsService(
      { moment: { create } } as never,
      {
        scanText: () => ({ blocked: false, level: "MEDIUM", reasons: ["包含外部链接"], hasExternalLink: true, hasContactLeak: false }),
        trustedAccount: async () => {
          throw new Error("db down");
        },
      } as never,
      { notify: jest.fn() } as never,
    );

    await service.publish("u1", { content: "link https://x.example" });
    // Falling back to "trusted" here would be the permissive direction on an error, which
    // is the wrong default for a moderation gate.
    expect(lastCreate(create).reviewStatus).toBe("PENDING");
  });

  it("返回体带上 reviewStatus，让发布方能告知用户「审核中」", async () => {
    const { service } = makeService({ level: "HIGH", reasons: ["疑似赌博"] });
    const result = await service.publish("u1", { content: "casino" });
    expect(result).toMatchObject({ reviewStatus: "PENDING" });
  });
});

describe("isReviewBlockedForViewer — 谁能看到未过审内容", () => {
  it("作者本人可以看到自己的待审内容", () => {
    expect(isReviewBlockedForViewer("u1", { userId: "u1", reviewStatus: "PENDING" })).toBe(false);
  });

  it("非作者看不到待审内容", () => {
    expect(isReviewBlockedForViewer("u2", { userId: "u1", reviewStatus: "PENDING" })).toBe(true);
  });

  it("非作者看不到被拒绝的内容", () => {
    expect(isReviewBlockedForViewer("u2", { userId: "u1", reviewStatus: "REJECTED" })).toBe(true);
  });

  it("非作者看不到被下架的内容", () => {
    // HIDDEN is a withdrawal after publication, so it must stop being visible.
    expect(isReviewBlockedForViewer("u2", { userId: "u1", reviewStatus: "HIDDEN" })).toBe(true);
  });

  it("已通过的内容对所有人可见", () => {
    expect(isReviewBlockedForViewer("u2", { userId: "u1", reviewStatus: "APPROVED" })).toBe(false);
  });

  it("缺少 reviewStatus 时按可见处理（查询未加载该列不等于内容被扣）", () => {
    /**
     * The regression this guards: a query that narrows its `select` and omits
     * `reviewStatus` would otherwise make the by-id route return null for public content,
     * silently and with no diagnosable cause.
     */
    expect(isReviewBlockedForViewer("u2", { userId: "u1" })).toBe(false);
    expect(isReviewBlockedForViewer("u2", { userId: "u1", reviewStatus: null })).toBe(false);
  });
});
