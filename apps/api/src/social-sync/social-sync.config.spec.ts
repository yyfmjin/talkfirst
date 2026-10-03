import {
  SOCIAL_PROVIDERS,
  allProviderConfigurations,
  providerConfiguration,
  requireProviderConfig,
  socialCallbackUri,
  isSocialProvider,
  ProviderUnavailableError,
} from "./social-sync.config";
import { ProviderManager } from "./providers/provider-manager";

/**
 * Provider configuration: availability, credential resolution, and the callback URI.
 *
 * ## Why the availability rules are pinned
 *
 * They decide what a member is told. Reporting a platform that needs a developer-programme
 * approval as "not configured" would tell an operator to add credentials that cannot help;
 * reporting an unconfigured platform as available produces a button that fails on the
 * callback. Each transition is a case below.
 *
 * ## NOT RUN
 *
 * No network and no database: this covers configuration reading only.
 */

const GOOGLE_ID = "test-google-client-id.apps.googleusercontent.com";
const GOOGLE_SECRET = "GOCSPX-test-secret";

describe("isSocialProvider", () => {
  it("接受五个已声明的平台（大小写不敏感由调用方处理）", () => {
    for (const provider of SOCIAL_PROVIDERS) {
      expect(isSocialProvider(provider)).toBe(true);
    }
  });

  it("拒绝未知值与非法类型", () => {
    for (const value of ["FACEBOOK", "weibo", "", null, undefined, 42, {}]) {
      expect(isSocialProvider(value)).toBe(false);
    }
  });
});

describe("providerConfiguration — availability", () => {
  it("YouTube 复用 GOOGLE_* 凭证，因此无需单独的 SOCIAL_YOUTUBE_*", () => {
    /**
     * YouTube is a Google API, so requiring a second client would make an operator duplicate
     * an OAuth application for no reason. This is what makes YouTube connectable on a
     * deployment that already has Google sign-in configured.
     */
    const config = providerConfiguration("YOUTUBE", { GOOGLE_CLIENT_ID: GOOGLE_ID, GOOGLE_CLIENT_SECRET: GOOGLE_SECRET });
    expect(config.availability).toBe("AVAILABLE");
    expect(config.clientId).toBe(GOOGLE_ID);
  });

  it("专用的 SOCIAL_YOUTUBE_* 优先于共享的 GOOGLE_*", () => {
    const config = providerConfiguration("YOUTUBE", {
      GOOGLE_CLIENT_ID: GOOGLE_ID,
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
      SOCIAL_YOUTUBE_CLIENT_ID: "dedicated-id",
      SOCIAL_YOUTUBE_CLIENT_SECRET: "dedicated-secret",
    });
    expect(config.clientId).toBe("dedicated-id");
  });

  it("缺少任一凭证时 YouTube 为 NOT_CONFIGURED（不做半配置）", () => {
    expect(providerConfiguration("YOUTUBE", { GOOGLE_CLIENT_ID: GOOGLE_ID }).availability).toBe("NOT_CONFIGURED");
    expect(providerConfiguration("YOUTUBE", { GOOGLE_CLIENT_SECRET: GOOGLE_SECRET }).availability).toBe(
      "NOT_CONFIGURED",
    );
    expect(providerConfiguration("YOUTUBE", {}).availability).toBe("NOT_CONFIGURED");
  });

  it("空白字符串不算已配置", () => {
    // An operator who cleared a variable leaves it defined-but-empty; treating that as
    // configured would produce a request with an empty client_id.
    expect(
      providerConfiguration("YOUTUBE", { GOOGLE_CLIENT_ID: "   ", GOOGLE_CLIENT_SECRET: GOOGLE_SECRET }).availability,
    ).toBe("NOT_CONFIGURED");
  });

  it("需要审批的平台即使有凭证也报 REQUIRES_APPROVAL", () => {
    /**
     * The ordering that matters: approval outranks credentials. X, TikTok, Instagram and 抖音
     * each need a developer-programme review, and no variable makes them work — so adding
     * credentials must NOT flip them to available.
     */
    for (const provider of ["X", "TIKTOK", "INSTAGRAM", "DOUYIN"] as const) {
      const config = providerConfiguration(provider, {
        SOCIAL_X_CLIENT_ID: "a",
        SOCIAL_X_CLIENT_SECRET: "b",
        SOCIAL_TIKTOK_CLIENT_KEY: "a",
        SOCIAL_TIKTOK_CLIENT_SECRET: "b",
        SOCIAL_INSTAGRAM_CLIENT_ID: "a",
        SOCIAL_INSTAGRAM_CLIENT_SECRET: "b",
        SOCIAL_DOUYIN_CLIENT_KEY: "a",
        SOCIAL_DOUYIN_CLIENT_SECRET: "b",
      });
      expect({ provider, availability: config.availability }).toEqual({
        provider,
        availability: "REQUIRES_APPROVAL",
      });
    }
  });

  it("需要审批且未配置时仍然报 REQUIRES_APPROVAL，而不是 NOT_CONFIGURED", () => {
    // "Add credentials" is the wrong instruction for a platform awaiting review.
    expect(providerConfiguration("TIKTOK", {}).availability).toBe("REQUIRES_APPROVAL");
  });

  it("每个平台都声明了端点与 scope", () => {
    for (const config of allProviderConfigurations({})) {
      expect(config.authorizationEndpoint).toMatch(/^https:\/\//);
      expect(config.tokenEndpoint).toMatch(/^https:\/\//);
      expect(config.scopes.length).toBeGreaterThan(0);
      expect(config.label.length).toBeGreaterThan(0);
    }
  });

  it("scope 都是只读的（不申请写入权限）", () => {
    /**
     * Requesting more than is used is how an integration is rejected in review and how a
     * member is asked to grant rights the product never exercises.
     */
    for (const config of allProviderConfigurations({})) {
      for (const scope of config.scopes) {
        expect(scope).not.toMatch(/write|upload|publish|manage/i);
      }
    }
  });
});

describe("requireProviderConfig", () => {
  it("可用时返回配置", () => {
    const config = requireProviderConfig("YOUTUBE", {
      GOOGLE_CLIENT_ID: GOOGLE_ID,
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    });
    expect(config.clientId).toBe(GOOGLE_ID);
  });

  it("不可用时抛出带 availability 的类型化错误", () => {
    // The caller turns `availability` into a distinct client code; a plain Error would lose it.
    let caught: unknown = null;
    try {
      requireProviderConfig("YOUTUBE", {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderUnavailableError);
    expect((caught as ProviderUnavailableError).availability).toBe("NOT_CONFIGURED");

    try {
      requireProviderConfig("TIKTOK", {});
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect((error as ProviderUnavailableError).availability).toBe("REQUIRES_APPROVAL");
    }
  });
});

describe("socialCallbackUri", () => {
  it("派生自 API_PUBLIC_URL，并带平台名", () => {
    const uri = socialCallbackUri("YOUTUBE", { API_PUBLIC_URL: "https://api.example.com" });
    expect(uri).toBe("https://api.example.com/api/v1/social-sync/youtube/callback");
  });

  it("与登录回调路径不同（两个都必须登记到控制台）", () => {
    // Sharing the path would mean one console entry serving two different scope sets, and a
    // mismatch would surface as redirect_uri_mismatch naming neither.
    const social = socialCallbackUri("YOUTUBE", { API_PUBLIC_URL: "https://api.example.com" });
    expect(social).not.toContain("/auth/oauth/");
  });

  it("去掉结尾斜杠，避免双斜杠路径", () => {
    expect(socialCallbackUri("YOUTUBE", { API_PUBLIC_URL: "https://api.example.com/" })).toBe(
      "https://api.example.com/api/v1/social-sync/youtube/callback",
    );
  });

  it("未设置时回落到本地默认值", () => {
    expect(socialCallbackUri("X", {})).toContain("localhost:4000");
  });
});

describe("ProviderManager", () => {
  it("五个平台都有 adapter（缺一个会在启动时抛错）", () => {
    const manager = new ProviderManager();
    for (const provider of SOCIAL_PROVIDERS) {
      expect(manager.find(provider)).toBeDefined();
    }
  });

  it("未知平台返回 undefined，而不是当成已支持", () => {
    const manager = new ProviderManager();
    expect(manager.find("FACEBOOK")).toBeUndefined();
    expect(manager.find("")).toBeUndefined();
  });

  it("require 对未知平台抛出（调用方应先校验输入）", () => {
    const manager = new ProviderManager();
    expect(() => manager.require("NOT_A_PROVIDER")).toThrow();
  });

  it("adapter 的 provider 字段与注册键一致", () => {
    const manager = new ProviderManager();
    for (const provider of SOCIAL_PROVIDERS) {
      expect(manager.find(provider)?.provider).toBe(provider);
    }
  });

  it("目录里永远不包含 client secret", () => {
    /**
     * The catalogue is served to an authenticated member's browser. A secret reaching it would
     * be a full application compromise, so the redaction is asserted rather than assumed.
     */
    const manager = new ProviderManager();
    const catalogue = manager.catalogue({
      GOOGLE_CLIENT_ID: GOOGLE_ID,
      GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    });
    for (const entry of catalogue) {
      expect(entry.clientSecret).toBe("");
    }
    expect(JSON.stringify(catalogue)).not.toContain(GOOGLE_SECRET);
  });

  it("目录标注每个平台能否读取动态", () => {
    const manager = new ProviderManager();
    const catalogue = manager.catalogue({});
    // Every adapter has a real implementation, so the approval state is what gates a member,
    // not this flag.
    expect(catalogue.every((entry) => entry.canReadPosts)).toBe(true);
  });
});
