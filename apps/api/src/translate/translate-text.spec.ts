import { TranslateService } from "./translate.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { TranslationProvider } from "./translation.provider";

/**
 * 动态正文翻译（`translateText`）。
 *
 * 这条方法存在的意义是「别再复制一份消息翻译的降级逻辑」，所以测试重点也在
 * 它与消息路径的**两处差异**上：
 *
 *   1. 拿不到外部翻译时返回 `null`，**不能**返回 `[en] 原文（演示翻译：…）`
 *      那种占位串 —— 那句是消息页的兜底，贴在动态卡片上就是噪声；
 *   2. 不写 `MessageTranslation`（这张表以 messageId 为主键）。这里用一个
 *      「一碰就炸」的 prisma 替身来证明它真的没被用到。
 */

const explodingPrisma = new Proxy(
  {},
  {
    get() {
      throw new Error("translateText 不应该访问数据库");
    },
  },
) as PrismaService;

function serviceWith(
  translateExternal: (text: string, from: string, to: string) => Promise<
    { text: string; provider: string } | null
  >,
) {
  const provider = { translateExternal: jest.fn(translateExternal) } as unknown as TranslationProvider;
  return { service: new TranslateService(explodingPrisma, provider), provider };
}

describe("TranslateService.translateText", () => {
  it("空文本：直接返回 null，不打外部通道", async () => {
    const { service, provider } = serviceWith(async () => ({ text: "x", provider: "test" }));
    await expect(service.translateText("   ", "en")).resolves.toBeNull();
    expect(provider.translateExternal).not.toHaveBeenCalled();
  });

  it("目标语言与原文一致：原样返回，不调外部通道", async () => {
    const { service, provider } = serviceWith(async () => ({ text: "x", provider: "test" }));
    const result = await service.translateText("今天天气不错", "zh");
    expect(result).toMatchObject({ text: "今天天气不错", provider: "local-passthrough" });
    expect(provider.translateExternal).not.toHaveBeenCalled();
  });

  it("本地词典命中：不发请求", async () => {
    const { service, provider } = serviceWith(async () => ({ text: "x", provider: "test" }));
    const result = await service.translateText("hello", "zh");
    expect(result).toMatchObject({ text: "你好", provider: "local-dictionary" });
    expect(provider.translateExternal).not.toHaveBeenCalled();
  });

  it("外部通道命中：用它的译文与 provider 名", async () => {
    const { service } = serviceWith(async (text, from, to) => {
      expect(to).toBe("en");
      expect(from).toBe("zh");
      return { text: "The weather is nice today", provider: "external" };
    });
    const result = await service.translateText("今天天气很好", "en");
    expect(result).toMatchObject({ text: "The weather is nice today", provider: "external" });
  });

  it("外部通道不可用：返回 null —— 绝不返回「演示翻译」占位串", async () => {
    const { service } = serviceWith(async () => null);
    const result = await service.translateText("今天天气很好", "en");
    expect(result).toBeNull();
  });

  it("目标语言缺省时按原文语言推断方向（中文→英文）", async () => {
    const { service } = serviceWith(async (text, from, to) => {
      expect(from).toBe("zh");
      expect(to).toBe("en");
      return { text: "ok", provider: "external" };
    });
    const result = await service.translateText("今天天气很好");
    expect(result?.targetLang).toBe("en");
  });
});
