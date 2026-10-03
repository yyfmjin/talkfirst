import { SocialSyncService } from "./social-sync.service";
import { TokenCryptoService } from "./token-crypto.service";
import { SocialProviderError, type ExternalPost } from "./external-post";
import { ProviderUnavailableError } from "./social-sync.config";

/**
 * The sync service: deduplication, token refresh, and state transitions.
 *
 * ## The case that matters most
 *
 * A repeat sync must UPDATE the provider-owned fields and leave `hidden` and
 * `importedMomentId` alone. Those two are the member's decisions, and a naive upsert that
 * wrote the whole row would un-hide a post the member hid and forget an import — every single
 * sync, silently. That is asserted directly.
 *
 * ## NOT RUN
 *
 * No network and no database: `PrismaService` and the adapters are stubs, so this covers the
 * service's decisions and the shape of its writes.
 */

const KEY = "a".repeat(48);

/**
 * The account row the service reads.
 *
 * Typed explicitly rather than inferred so the two nullable columns can be set to null in a
 * case — the inferred type would be `string`, and those cases are exactly the ones worth
 * testing.
 */
type AccountRow = {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  syncLimit: number;
  status: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
};

const ACCOUNT: AccountRow = {
  id: "acct-1",
  userId: "user-1",
  provider: "YOUTUBE",
  providerUserId: "UC123",
  syncLimit: 3,
  status: "ACTIVE",
  accessTokenEnc: "enc:access-token",
  refreshTokenEnc: "enc:refresh-token",
  tokenExpiresAt: null,
};

type Call = Record<string, unknown>;

function post(id: string, overrides: Partial<ExternalPost> = {}): ExternalPost {
  return {
    provider: "YOUTUBE",
    externalPostId: id,
    externalUrl: `https://example.test/${id}`,
    authorId: "UC123",
    authorName: "Me",
    authorAvatar: null,
    text: `text ${id}`,
    title: `title ${id}`,
    mediaType: "VIDEO",
    thumbnailUrl: null,
    mediaUrl: null,
    embedUrl: `https://example.test/embed/${id}`,
    publishedAt: new Date("2026-10-01T00:00:00.000Z"),
    raw: { id },
    ...overrides,
  };
}

function makeService(options: {
  account?: Partial<typeof ACCOUNT> | null;
  existingPostIds?: string[];
  posts?: ExternalPost[];
  refreshThrows?: boolean;
  fetchThrows?: SocialProviderError;
  decryptFails?: boolean;
} = {}) {
  const account = options.account === null ? null : { ...ACCOUNT, ...options.account };

  const existing = new Set(options.existingPostIds ?? []);

  const socialSyncAccount = {
    findUnique: jest.fn(async (_args: Call) => account as unknown),
    update: jest.fn(async (_args: Call) => ({}) as unknown),
    findMany: jest.fn(async (_args: Call) => [] as unknown[]),
  };

  const socialSyncPost = {
    findUnique: jest.fn(async (args: Call) => {
      const where = args.where as { socialAccountId_provider_externalPostId?: { externalPostId?: string } };
      const id = where.socialAccountId_provider_externalPostId?.externalPostId ?? "";
      return existing.has(id) ? { id: `row-${id}` } : null;
    }),
    update: jest.fn(async (_args: Call) => ({}) as unknown),
    create: jest.fn(async (_args: Call) => ({}) as unknown),
  };

  const prisma = { socialSyncAccount, socialSyncPost };

  const crypto = {
    // Round-trips through a marker so the test can assert encryption was used without
    // depending on the real key derivation.
    encrypt: jest.fn((value: string) => `enc:${value}`),
    tryDecrypt: jest.fn((value: string | null) => (options.decryptFails ? null : (value ?? "").replace(/^enc:/, ""))),
  };

  const adapter = {
    provider: "YOUTUBE",
    canReadPosts: true,
    refreshToken: jest.fn(async () => {
      if (options.refreshThrows) {
        throw new SocialProviderError("SOCIAL_TOKEN_REFRESH_FAILED", "no longer valid");
      }
      return {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        scope: "youtube.readonly",
        expiresAt: new Date(Date.now() + 3600_000),
      };
    }),
    getRecentPosts: jest.fn(async () => {
      if (options.fetchThrows) throw options.fetchThrows;
      return options.posts ?? [post("v1"), post("v2")];
    }),
    getAccount: jest.fn(),
    getAuthorizationUrl: jest.fn(),
    revoke: jest.fn(),
    handleCallback: jest.fn(),
  };

  const providers = { require: jest.fn(() => adapter), find: jest.fn(() => adapter), configuration: jest.fn() };

  const service = new SocialSyncService(prisma as never, crypto as never, providers as never);
  return { service, socialSyncAccount, socialSyncPost, crypto, adapter };
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/* -------------------------------------------------------------------------- */
/* Deduplication                                                              */
/* -------------------------------------------------------------------------- */

describe("SocialSyncService.syncAccount — 去重", () => {
  it("首次同步创建新行", async () => {
    const { service, socialSyncPost } = makeService({ existingPostIds: [] });
    const outcome = await service.syncAccount("acct-1");

    expect(outcome).toMatchObject({ created: 2, updated: 0, fetched: 2 });
    expect(socialSyncPost.create).toHaveBeenCalledTimes(2);
    expect(socialSyncPost.update).not.toHaveBeenCalled();
  });

  it("重复同步更新而不是重复创建", async () => {
    /**
     * The deduplication key is `(socialAccountId, provider, externalPostId)`. Without it,
     * every sync would append a second copy of every post.
     */
    const { service, socialSyncPost } = makeService({ existingPostIds: ["v1", "v2"] });
    const outcome = await service.syncAccount("acct-1");

    expect(outcome).toMatchObject({ created: 0, updated: 2 });
    expect(socialSyncPost.create).not.toHaveBeenCalled();
    expect(socialSyncPost.update).toHaveBeenCalledTimes(2);
  });

  it("更新时绝不触碰 hidden 与 importedMomentId（这是用户的选择）", async () => {
    /**
     * The regression this guards: writing the whole row on update would un-hide a post the
     * member hid and erase the record of an import — on every sync, with nothing to notice it
     * by.
     */
    const { service, socialSyncPost } = makeService({ existingPostIds: ["v1"] });
    await service.syncAccount("acct-1");

    const data = socialSyncPost.update.mock.calls[0]?.[0]?.data as Call;
    expect(data).not.toHaveProperty("hidden");
    expect(data).not.toHaveProperty("importedMomentId");
    // The provider-owned fields ARE refreshed.
    expect(data).toHaveProperty("text");
    expect(data).toHaveProperty("publishedAt");
  });

  it("请求条数用账号自己的 syncLimit", async () => {
    const { service, adapter } = makeService({ account: { syncLimit: 1 } });
    await service.syncAccount("acct-1");
    expect(adapter.getRecentPosts).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
  });
});

/* -------------------------------------------------------------------------- */
/* Token handling                                                             */
/* -------------------------------------------------------------------------- */

describe("SocialSyncService.syncAccount — token", () => {
  it("未到期时不刷新", async () => {
    const { service, adapter } = makeService({ account: { tokenExpiresAt: new Date(Date.now() + 3600_000) } });
    const outcome = await service.syncAccount("acct-1");

    expect(adapter.refreshToken).not.toHaveBeenCalled();
    expect(outcome.refreshed).toBe(false);
  });

  it("即将到期时提前刷新，而不是等到 401", async () => {
    /**
     * A token with seconds left expires mid-request, and the resulting 401 is
     * indistinguishable from a revoked grant — so the member would be told to reconnect when
     * a refresh would have sufficed.
     */
    const { service, adapter, socialSyncAccount } = makeService({
      account: { tokenExpiresAt: new Date(Date.now() + 10_000) },
    });
    const outcome = await service.syncAccount("acct-1");

    expect(adapter.refreshToken).toHaveBeenCalled();
    expect(outcome.refreshed).toBe(true);
    const data = socialSyncAccount.update.mock.calls[0]?.[0]?.data as Call;
    expect(String(data.accessTokenEnc)).toMatch(/^enc:/);
  });

  it("刷新后没有新 refresh token 时保留旧的（否则下次刷新会失败）", async () => {
    /**
     * Google never returns a new refresh token on refresh. Overwriting the stored one with
     * null would break the NEXT refresh — the connection would die an hour after a successful
     * sync, which is exactly the kind of failure that is hard to attribute.
     */
    const { service, socialSyncAccount, adapter } = makeService({
      account: { tokenExpiresAt: new Date(Date.now() + 10_000) },
    });
    adapter.refreshToken.mockResolvedValueOnce({
      accessToken: "new-access",
      refreshToken: null,
      scope: null,
      expiresAt: new Date(Date.now() + 3600_000),
    } as never);

    await service.syncAccount("acct-1");

    const data = socialSyncAccount.update.mock.calls[0]?.[0]?.data as Call;
    expect(data.refreshTokenEnc).toBe(ACCOUNT.refreshTokenEnc);
  });

  it("刷新失败时标记 NEEDS_REAUTH 并抛出", async () => {
    const { service, socialSyncAccount } = makeService({
      account: { tokenExpiresAt: new Date(Date.now() + 10_000) },
      refreshThrows: true,
    });

    await expect(service.syncAccount("acct-1")).rejects.toBeInstanceOf(SocialProviderError);
    expect(socialSyncAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_REAUTH" }) }),
    );
  });

  it("无法解密 token 时标记 NEEDS_REAUTH（密钥轮换的场景）", async () => {
    const { service, socialSyncAccount, adapter } = makeService({ decryptFails: true });

    await expect(service.syncAccount("acct-1")).rejects.toMatchObject({ code: "SOCIAL_AUTH_REQUIRED" });
    expect(adapter.getRecentPosts).not.toHaveBeenCalled();
    expect(socialSyncAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NEEDS_REAUTH" }) }),
    );
  });

  it("没有 refresh token 且已到期时要求重新授权", async () => {
    const { service } = makeService({
      account: { tokenExpiresAt: new Date(Date.now() + 10_000), refreshTokenEnc: null },
    });
    await expect(service.syncAccount("acct-1")).rejects.toMatchObject({ code: "SOCIAL_AUTH_REQUIRED" });
  });
});

/* -------------------------------------------------------------------------- */
/* Failure handling                                                           */
/* -------------------------------------------------------------------------- */

describe("SocialSyncService.syncAccount — 失败处理", () => {
  it("读取失败只记录错误码，不强制重新授权（限流是暂时的）", async () => {
    /**
     * A rate limit or a provider outage is transient. Marking the account NEEDS_REAUTH for it
     * would force the member through a consent screen for a problem that resolves itself.
     */
    const { service, socialSyncAccount } = makeService({
      fetchThrows: new SocialProviderError("SOCIAL_RATE_LIMITED", "slow down"),
    });

    await expect(service.syncAccount("acct-1")).rejects.toMatchObject({ code: "SOCIAL_RATE_LIMITED" });

    const update = socialSyncAccount.update.mock.calls[0]?.[0]?.data as Call;
    expect(update.lastSyncError).toBe("SOCIAL_RATE_LIMITED");
    expect(update.status).toBeUndefined();
  });

  it("成功同步后清空 lastSyncError 并刷新 lastSyncedAt", async () => {
    const { service, socialSyncAccount } = makeService({});
    await service.syncAccount("acct-1");

    const calls = socialSyncAccount.update.mock.calls.map((call) => call[0]?.data as Call);
    const final = calls[calls.length - 1];
    expect(final.lastSyncError).toBeNull();
    expect(final.lastSyncedAt).toBeInstanceOf(Date);
    expect(final.status).toBe("ACTIVE");
  });

  it("不存在的账号直接抛出", async () => {
    const { service } = makeService({ account: null });
    await expect(service.syncAccount("missing")).rejects.toThrow();
  });

  it("已解绑的连接拒绝同步", async () => {
    const { service } = makeService({ account: { status: "REVOKED" } });
    await expect(service.syncAccount("acct-1")).rejects.toMatchObject({ code: "SOCIAL_AUTH_REQUIRED" });
  });

  it("平台未配置时抛出可识别的不可用错误", async () => {
    const { service } = makeService({});
    process.env.GOOGLE_CLIENT_ID = "";
    delete process.env.SOCIAL_YOUTUBE_CLIENT_ID;

    await expect(service.syncAccount("acct-1")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("失败时绝不删除已有动态", async () => {
    /**
     * A failed sync must leave the previously synced posts alone. Deleting them would make a
     * transient provider problem look like the member's history vanished.
     */
    const { service, socialSyncPost } = makeService({
      fetchThrows: new SocialProviderError("SOCIAL_PROVIDER_ERROR", "boom"),
    });

    await expect(service.syncAccount("acct-1")).rejects.toBeInstanceOf(SocialProviderError);
    expect(socialSyncPost.create).not.toHaveBeenCalled();
    expect(socialSyncPost.update).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Raw payload                                                                */
/* -------------------------------------------------------------------------- */

describe("SocialSyncService — rawData", () => {
  it("保存原始载荷以便调试，但不在读取接口返回（见 controller 的 select）", async () => {
    const { service, socialSyncPost } = makeService({ existingPostIds: [] });
    await service.syncAccount("acct-1");

    const data = socialSyncPost.create.mock.calls[0]?.[0]?.data as Call;
    expect(data.rawData).toEqual({ id: "v1" });
  });

  it("没有原始载荷时存 null，而不是 undefined", async () => {
    const { service, socialSyncPost } = makeService({
      existingPostIds: [],
      posts: [post("v9", { raw: null })],
    });
    await service.syncAccount("acct-1");

    const data = socialSyncPost.create.mock.calls[0]?.[0]?.data as Call;
    // `undefined` would leave the column untouched on update while `null` clears it; the two
    // must not be distinguishable downstream.
    expect(data.rawData).toBeNull();
  });
});

describe("TokenCryptoService 与同步服务的配合", () => {
  it("写入的 token 一定是密文（列名以 Enc 结尾不是装饰）", async () => {
    const { service, socialSyncAccount, crypto } = makeService({
      account: { tokenExpiresAt: new Date(Date.now() + 10_000) },
    });
    await service.syncAccount("acct-1");

    expect(crypto.encrypt).toHaveBeenCalled();
    const data = socialSyncAccount.update.mock.calls[0]?.[0]?.data as Call;
    expect(String(data.accessTokenEnc).startsWith("enc:")).toBe(true);
  });

  it("TokenCryptoService 真实实现可以往返", () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const real = new TokenCryptoService();
    expect(real.decrypt(real.encrypt("provider-token"))).toBe("provider-token");
  });
});
