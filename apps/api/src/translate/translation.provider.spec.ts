import { TranslationProvider, resolveTranslationProviderKind } from "./translation.provider";

/**
 * 翻译通道的选择与解析。
 *
 * 2026-10-06 加 MyMemory（免费、无需注册）通道时补上——这个模块此前**一条测试都没有**。
 * 这一组钉住三件事，每一件都对应一个真实的坑：
 *
 *   1. **不配就不发请求**：默认 `none` 时 `fetch` 一次都不能被调用。否则单元测试与 CI
 *      会在没有网络的环境里真的去打外网（这正是「免费通道必须显式打开」的理由）。
 *   2. **两种响应形状都认**：自建服务可能是 LibreTranslate（`translatedText`），
 *      也可能是 Google Cloud Translation v2（`data.translations[0].translatedText`）。
 *   3. **失败一律退化成 null**，由 `TranslateService` 兜底：非 2xx、坏 JSON、网络异常，
 *      以及 MyMemory **用 HTTP 200 回一句英文警告**表示额度用尽的那种情况 ——
 *      漏了最后这一条，用户看到的「翻译结果」会是一句警告文本。
 */
const OWNED_KEYS = [
  "TRANSLATION_PROVIDER",
  "TRANSLATION_API_URL",
  "TRANSLATION_API_KEY",
  "TRANSLATION_CONTACT_EMAIL",
] as const;

const realEnv = { ...process.env };
const fetchMock = jest.fn();
const realFetch = global.fetch;

function okJson(payload: unknown) {
  return Promise.resolve({ ok: true, json: async () => payload });
}

beforeEach(() => {
  for (const key of OWNED_KEYS) delete process.env[key];
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

afterAll(() => {
  global.fetch = realFetch;
  process.env = realEnv;
});

describe("resolveTranslationProviderKind", () => {
  it("什么都没配 -> none（一个请求都不发）", () => {
    expect(resolveTranslationProviderKind({})).toBe("none");
  });

  it("URL + KEY 配齐 -> external（保持原有行为）", () => {
    expect(
      resolveTranslationProviderKind({
        TRANSLATION_API_URL: "https://translate.example.com/translate",
        TRANSLATION_API_KEY: "k",
      }),
    ).toBe("external");
  });

  it("只配 URL（自建实例，无 key）-> 仍是 external", () => {
    // 自建 LibreTranslate 监听 127.0.0.1，不需要 key。旧规则要求 URL+KEY 同时存在，
    // 结果是「零成本的正式服务」接不进来。
    expect(
      resolveTranslationProviderKind({ TRANSLATION_API_URL: "http://127.0.0.1:5000/translate" }),
    ).toBe("external");
  });

  it("显式开关优先：mymemory / none 都能盖过已配好的 external", () => {
    const withKey = {
      TRANSLATION_API_URL: "https://translate.example.com/translate",
      TRANSLATION_API_KEY: "k",
    };
    expect(resolveTranslationProviderKind({ ...withKey, TRANSLATION_PROVIDER: "mymemory" })).toBe(
      "mymemory",
    );
    expect(resolveTranslationProviderKind({ ...withKey, TRANSLATION_PROVIDER: "none" })).toBe("none");
  });

  it("认不出的取值退回默认判断，而不是抛错", () => {
    expect(resolveTranslationProviderKind({ TRANSLATION_PROVIDER: "deepl" })).toBe("none");
  });
});

describe("TranslationProvider.translateExternal", () => {
  const provider = new TranslationProvider();

  it("none：不调用 fetch", async () => {
    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("external：POST {q,source,target,format} + Bearer，并解析 translatedText", async () => {
    process.env.TRANSLATION_API_URL = "https://translate.example.com/translate";
    process.env.TRANSLATION_API_KEY = "secret";
    fetchMock.mockReturnValue(okJson({ translatedText: "你好" }));

    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toEqual({
      text: "你好",
      provider: "external",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://translate.example.com/translate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(String(init.body))).toEqual({
      q: "Hello",
      source: "en",
      target: "zh",
      format: "text",
    });
  });

  it("external：无 key 时不带 Authorization 头（自建实例的形状）", async () => {
    process.env.TRANSLATION_API_URL = "http://127.0.0.1:5000/translate";
    fetchMock.mockReturnValue(okJson({ translatedText: "你好" }));

    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toEqual({
      text: "你好",
      provider: "external",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      q: "Hello",
      source: "en",
      target: "zh",
      format: "text",
    });
  });

  it("external：也认 Google Cloud v2 的嵌套形状", async () => {
    process.env.TRANSLATION_API_URL = "https://translation.googleapis.com/language/translate/v2";
    process.env.TRANSLATION_API_KEY = "secret";
    fetchMock.mockReturnValue(okJson({ data: { translations: [{ translatedText: "早安" }] } }));

    await expect(provider.translateExternal("Good morning", "en", "zh")).resolves.toEqual({
      text: "早安",
      provider: "external",
    });
  });

  it("mymemory：走 GET，中文语向码补成 zh-CN，解析 responseData.translatedText", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    fetchMock.mockReturnValue(
      okJson({ responseData: { translatedText: "很高兴认识你" }, responseStatus: 200 }),
    );

    await expect(provider.translateExternal("Nice to meet you", "en", "zh")).resolves.toEqual({
      text: "很高兴认识你",
      provider: "mymemory",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain("api.mymemory.translated.net/get?");
    expect(url).toContain("langpair=en%7Czh-CN"); // `|` 会被编码
    expect(url).toContain("q=Nice+to+meet+you");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("mymemory：配了联系邮箱就带上 de 参数（免费额度 1000 -> 10000 词/天）", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    process.env.TRANSLATION_CONTACT_EMAIL = "me@example.com";
    fetchMock.mockReturnValue(okJson({ responseData: { translatedText: "你好" } }));

    await provider.translateExternal("Hello", "en", "zh");
    expect(fetchMock.mock.calls[0][0]).toContain("de=me%40example.com");
  });

  it("mymemory：候选里挑真正像译文的那条（线上实测的真实响应形状）", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    // 2026-10-06 实测：`responseData.translatedText` 就是 `matches[0]`（脏），
    // 而同一个响应里质量 100 的那条才是要展示给用户的。
    fetchMock.mockReturnValue(
      okJson({
        responseData: { translatedText: "359：哈啰 很高兴见到你", match: 1 },
        matches: [
          { translation: "359：哈啰 很高兴见到你", quality: "74", "created-by": "MateCat" },
          { translation: "你好，很高兴认识你...", quality: "74", "created-by": "MateCat" },
          { translation: "你好，很高兴认识你", quality: "100", "created-by": "MateCat" },
        ],
      }),
    );

    await expect(
      provider.translateExternal("Hello, nice to meet you.", "en", "zh"),
    ).resolves.toEqual({ text: "你好，很高兴认识你", provider: "mymemory" });
  });

  it("mymemory：目标语是中日韩时丢掉夹拉丁字母的乱码条，并跳过维基词条释义", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    fetchMock.mockReturnValue(
      okJson({
        responseData: { translatedText: "penian ferein OU潘托斯所有安卓sofou", match: 1 },
        matches: [
          {
            translation: "penian ferein OU潘托斯所有安卓sofou",
            quality: "74",
            "created-by": "MateCat",
          },
          { translation: "你们好。", quality: "74", "created-by": "MateCat" },
          { translation: "问候", quality: "80", "created-by": "Wikipedia" },
        ],
      }),
    );

    await expect(provider.translateExternal("こんにちは", "ja", "zh")).resolves.toEqual({
      text: "你们好。",
      provider: "mymemory",
    });
  });

  it("mymemory：候选全是脏条 -> 判失败，而不是把它自己回的那条端上来", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    fetchMock.mockReturnValue(
      okJson({
        responseData: { translatedText: "junk junk junk" },
        matches: [{ translation: "junk junk junk", quality: "74", "created-by": "MateCat" }],
      }),
    );

    await expect(provider.translateExternal("こんにちは", "ja", "zh")).resolves.toBeNull();
  });

  it("mymemory：把「额度用尽」的警告当译文回（HTTP 200）时必须判失败", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";
    fetchMock.mockReturnValue(
      okJson({
        responseData: {
          translatedText:
            "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 10 HOURS",
        },
        responseStatus: 200,
        quotaFinished: true,
      }),
    );

    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toBeNull();
  });

  it("失败一律退化成 null：非 2xx / 网络异常 / 空译文", async () => {
    process.env.TRANSLATION_PROVIDER = "mymemory";

    fetchMock.mockReturnValue(Promise.resolve({ ok: false, status: 429, json: async () => ({}) }));
    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toBeNull();

    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toBeNull();

    fetchMock.mockReturnValue(okJson({ responseData: { translatedText: "" } }));
    await expect(provider.translateExternal("Hello", "en", "zh")).resolves.toBeNull();
  });
});
