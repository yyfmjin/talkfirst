import {
  DEFAULT_LOCALE,
  MESSAGES,
  SUPPORTED_LOCALES,
  localeFromAcceptLanguage,
  localeFromLanguageCode,
  localeOrDefault,
  msg,
  renderText,
  resolveLocale,
  t,
} from "./i18n";

/**
 * 服务端下发文案的多语言（`common/i18n.ts`）。
 *
 * 这一层存在的理由是一个真实缺陷：通知的中文与英文是硬编码混用的 ——
 * 消息与连接是英文、点赞与管理员处理结果是中文，于是中文用户被通知
 * 「New message」，英文用户被通知「你的动态收到点赞」。所以这里钉住的不只是
 * 几个字符串，而是「**同一句话在两种语言下都有**」和「**语言怎么定**」。
 */
describe("i18n — 词条", () => {
  it("两种语言的键集合完全一致，且没有空文案", () => {
    const keys = Object.keys(MESSAGES[DEFAULT_LOCALE]).sort();

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(MESSAGES[locale][key as keyof typeof MESSAGES.zh].trim()).not.toBe("");
      }
    }
  });

  it("英文词条里不残留中文，中文词条里不残留成句英文", () => {
    const han = /[\u4e00-\u9fff]/;
    for (const [key, value] of Object.entries(MESSAGES.en)) {
      // 平台名之类本来就不含中文；只要出现汉字就说明漏翻了。
      expect({ key, chinese: han.test(value) }).toEqual({ key, chinese: false });
    }
    for (const key of ["notify.newMessage.title", "notify.requestAccepted.body"] as const) {
      expect(han.test(MESSAGES.zh[key])).toBe(true);
    }
  });
});

describe("i18n — 渲染", () => {
  it("替换占位符", () => {
    expect(t("zh", "notify.sayHello.title", { name: "Ann" })).toBe("Ann 想和你打个招呼");
    expect(t("en", "notify.sayHello.title", { name: "Ann" })).toBe("Ann said hello");
  });

  it("数组参数按语言的列表连接符拼接：中文顿号，英文逗号", () => {
    const params = { name: "Ann", platforms: ["WeChat", "Instagram"] };
    expect(t("zh", "notify.exchangeRequest.body", params)).toBe("Ann 想和你交换 WeChat、Instagram");
    expect(t("en", "notify.exchangeRequest.body", params)).toBe(
      "Ann wants to exchange WeChat, Instagram",
    );
  });

  it("参数缺失时保留 {name} 原样，而不是渲染成 undefined", () => {
    expect(t("en", "notify.sayHello.title")).toBe("{name} said hello");
    expect(t("en", "notify.sayHello.title", { other: "x" })).toBe("{name} said hello");
  });

  it("renderText：字符串是「最终形态」，不再翻译", () => {
    expect(renderText("en", "用户自己写的一句话")).toBe("用户自己写的一句话");
    expect(renderText("en", msg("notify.newMessage.title"))).toBe("New message");
    expect(renderText("zh", msg("notify.newMessage.title"))).toBe("新消息");
    expect(renderText("en", null)).toBeNull();
  });
});

describe("i18n — 语言标签", () => {
  it("归一化语言代码：zh-CN → zh、en_US → en、ja → 认不出", () => {
    expect(localeFromLanguageCode("zh-CN")).toBe("zh");
    expect(localeFromLanguageCode("EN_us")).toBe("en");
    expect(localeFromLanguageCode("ja")).toBeNull();
    expect(localeFromLanguageCode("")).toBeNull();
    expect(localeFromLanguageCode(null)).toBeNull();
  });

  it("解析 Accept-Language：按顺序取第一个受支持的标签", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9")).toBe("zh");
    expect(localeFromAcceptLanguage("ja,en;q=0.5")).toBe("en");
    // 认不出就交给兜底语言，而不是猜成英文。
    expect(localeFromAcceptLanguage("ja-JP")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
  });

  it("localeOrDefault 兜底到中文", () => {
    expect(localeOrDefault("en")).toBe("en");
    expect(localeOrDefault("ja")).toBe(DEFAULT_LOCALE);
    expect(localeOrDefault(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("resolveLocale 的顺序：显式语言 → 母语 → 中文", () => {
    expect(resolveLocale({ locale: "en", languageCodes: ["zh"] })).toBe("en");
    expect(resolveLocale({ locale: null, languageCodes: ["ja", "en"] })).toBe("en");
    expect(resolveLocale({ locale: "ja", languageCodes: ["ja"] })).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });
});
