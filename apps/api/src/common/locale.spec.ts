import type { PrismaService } from "../prisma/prisma.service";
import { clearLocaleCache, localeForEmail, localeForUserId } from "./locale";

/**
 * 「服务端该用哪种语言给这个人发文案」。
 *
 * 通知与邮件共用这一层，所以两条最容易被忽略的性质必须钉住：
 * 老账号没有 `locale` 字段时按**母语**推断（否则英文母语的老用户从此收到中文），
 * 以及查询失败时**降级**而不是抛异常（否则一条通知或一封验证码邮件会直接消失）。
 */

function fakePrisma(
  row: unknown,
  options: { throws?: boolean } = {},
): { prisma: PrismaService; findUnique: jest.Mock } {
  const findUnique = jest.fn(async () => {
    if (options.throws) throw new Error("db down");
    return row;
  });
  return { prisma: { user: { findUnique } } as unknown as PrismaService, findUnique };
}

beforeEach(() => clearLocaleCache());

describe("localeForUserId", () => {
  it("显式选择的界面语言优先于母语", async () => {
    const { prisma } = fakePrisma({
      locale: "en",
      languages: [{ languageCode: "zh", type: "NATIVE" }],
    });
    expect(await localeForUserId(prisma, "u1")).toBe("en");
  });

  it("没有显式语言时按母语推断（老账号没有 locale 字段）", async () => {
    const { prisma } = fakePrisma({
      locale: null,
      languages: [
        { languageCode: "zh", type: "LEARNING" },
        { languageCode: "en", type: "NATIVE" },
      ],
    });
    expect(await localeForUserId(prisma, "u1")).toBe("en");
  });

  it("母语优先于列表顺序：母语排在后面也算数", async () => {
    const { prisma } = fakePrisma({
      locale: null,
      languages: [
        { languageCode: "en", type: "LEARNING" },
        { languageCode: "zh", type: "NATIVE" },
      ],
    });
    expect(await localeForUserId(prisma, "u1")).toBe("zh");
  });

  it("认不出的语言（日语等）落到中文兜底", async () => {
    const { prisma } = fakePrisma({
      locale: "ja",
      languages: [{ languageCode: "ja", type: "NATIVE" }],
    });
    expect(await localeForUserId(prisma, "u1")).toBe("zh");
  });

  it("用户不存在或查询失败都不抛异常，只降级到兜底语言", async () => {
    const missing = fakePrisma(null);
    expect(await localeForUserId(missing.prisma, "u1")).toBe("zh");

    const broken = fakePrisma(null, { throws: true });
    expect(await localeForUserId(broken.prisma, "u1")).toBe("zh");
  });

  it("同一用户 60 秒内只查一次库；清缓存后重新查", async () => {
    const { prisma, findUnique } = fakePrisma({ locale: "en", languages: [] });

    await localeForUserId(prisma, "u1");
    await localeForUserId(prisma, "u1");
    expect(findUnique).toHaveBeenCalledTimes(1);

    clearLocaleCache();
    await localeForUserId(prisma, "u1");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("缓存按用户分开：一个人的语言不会串到另一个人身上", async () => {
    const english = fakePrisma({ locale: "en", languages: [] });
    const chinese = fakePrisma({ locale: "zh", languages: [] });

    expect(await localeForUserId(english.prisma, "u1")).toBe("en");
    expect(await localeForUserId(chinese.prisma, "u2")).toBe("zh");
  });
});

describe("localeForEmail", () => {
  it("账号存在时按账号设置，忽略请求头", async () => {
    const { prisma } = fakePrisma({ locale: "zh", languages: [] });
    expect(await localeForEmail(prisma, "alice@example.com", "en-US,en;q=0.9")).toBe("zh");
  });

  it("账号不存在时按 Accept-Language（注册验证码的路径）", async () => {
    const { prisma } = fakePrisma(null);
    expect(await localeForEmail(prisma, "bob@example.com", "en-US,en;q=0.9")).toBe("en");
    expect(await localeForEmail(prisma, "bob@example.com", "zh-CN")).toBe("zh");
  });

  it("账号不存在且没有请求头时兜底中文；查库失败也仍能发信", async () => {
    const missing = fakePrisma(null);
    expect(await localeForEmail(missing.prisma, "bob@example.com")).toBe("zh");

    const broken = fakePrisma(null, { throws: true });
    expect(await localeForEmail(broken.prisma, "bob@example.com", "en")).toBe("en");
    expect(await localeForEmail(broken.prisma, "bob@example.com")).toBe("zh");
  });
});
