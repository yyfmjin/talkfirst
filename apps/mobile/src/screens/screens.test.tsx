import type { ComponentType, ReactNode } from "react";
import renderer, { act } from "react-test-renderer";
import { AuthProvider } from "../lib/auth-context";
import { I18nProvider } from "../lib/i18n-context";
/* 断言用词典里的原文，而不是手抄中文 —— 文案一改，测试跟着改，不会悄悄失真。 */
import { zh } from "../lib/messages";
import { AuthScreen } from "./AuthScreen";
import { AttributesScreen } from "./AttributesScreen";
import { ComposeScreen } from "./ComposeScreen";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { DeleteAccountScreen } from "./DeleteAccountScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { MeScreen } from "./MeScreen";
import { MessagesScreen } from "./MessagesScreen";
import { MomentsScreen } from "./MomentsScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { PasswordScreen } from "./PasswordScreen";
import { SafetyScreen } from "./SafetyScreen";
import { SocialScreen } from "./SocialScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { UserMomentsScreen } from "./UserMomentsScreen";
import { VisibilityScreen } from "./VisibilityScreen";

/*
 * 「每个屏幕都渲染得出来」—— 这一组看着很笨，但它盯的正是 2026-10-08 那次事故：
 *
 *     Element type is invalid: expected a string (for built-in components)
 *     or a class/function (for composite components) but got: undefined.
 *
 * 也就是某个 JSX 标签在运行时是 `undefined`（导入/打包/版本不一致都可能造成），
 * 登录成功后一进主界面就整屏崩。**类型检查对此完全无能为力** —— 它绿着，真机炸着。
 * 渲染一遍就能拦住：任一屏幕拿不到可渲染的组件，这里立刻失败。
 *
 * 接口全部被替换成假实现，返回**每个屏幕期望的形状** —— 形状不对会暴露成
 * 屏幕自己的崩溃，那也正是我们想在这里发现的。
 */

jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(async (path: string) => {
    if (path.startsWith("/conversations")) {
      return path.includes("/messages") ? { items: [], nextCursor: null } : [];
    }
    if (path.startsWith("/moments")) return { items: [], nextCursor: null };
    if (path.startsWith("/notifications")) return { items: [], unread: 0, nextCursor: null };
    if (path.startsWith("/discover")) return { items: [], remaining: 0 };
    /* 「我的」四个新模块的入口数据（阶段①）。 */
    if (path.startsWith("/connections")) return [];
    if (path.startsWith("/social-sync/providers")) return { providers: [] };
    if (path.startsWith("/social-sync/accounts")) return { accounts: [] };
    if (path.startsWith("/blocks")) return [];
    if (path.startsWith("/reports/mine")) return [];
    if (path.startsWith("/users/me/profile-field-visibility")) return [];
    if (path === "/users/me/attributes") return { aboutMe: [], lookingFor: [] };
    if (path === "/meta/attributes") return [];
    if (path === "/auth/oauth/me/methods") return { hasPassword: false, providers: [] };
    /* 引导流程挂载时并发读四个 meta + `GET /users/me`；形状不对会在那一步
       直接崩（`languages.map` 打在 undefined 上），而不是安静地空着。 */
    if (path.startsWith("/meta/")) return [];
    if (path === "/users/me") {
      return {
        id: "u1",
        email: "a@b.c",
        nickname: "Ann",
        languages: [],
        interests: [],
        purposes: [],
        preferredCountries: [],
      };
    }
    return {};
  }),
  apiFetchEnvelope: jest.fn(async () => ({ data: {}, accessToken: "a", refreshToken: "r" })),
  apiUploadMultipart: jest.fn(async () => ({ url: "https://cdn.example/video.mp4" })),
  ApiRequestError: class ApiRequestError extends Error {},
  tryRefresh: jest.fn(async () => false),
}));

/*
 * `storage` 的 mock 必须覆盖它**导出的一切**：Providers 在挂载时会读语言偏好
 * （`getLocalePreference`），少一个函数就是 "(0, _storage.x) is not a function"。
 */
jest.mock("../lib/storage", () => ({
  getAccessToken: jest.fn(async () => null),
  getRefreshToken: jest.fn(async () => null),
  saveTokens: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
  getLocalePreference: jest.fn(async () => null),
  saveLocalePreference: jest.fn(async () => undefined),
}));

/*
 * expo-video 在 import 时就访问 `NativeVideoModule.VideoPlayer.prototype`，
 * jest-expo 的通用原生 mock 顶不住（VideoPlayer 是 undefined）—— 不是 app 的
 * 代码问题，是 expo-video 没有给 jest 提供安全口。这里给个最小假实现：
 * 渲染冒烟只验证我们的 JSX 逻辑（每个卡片一个 player、卸载时 pause），
 * 播放行为属于原生层，本来就不是单测能覆盖的。
 */
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn(() => ({ pause: jest.fn() })),
  VideoView: () => null,
}));

const SCREENS: [string, ComponentType][] = [
  ["AuthScreen", AuthScreen],
  ["MomentsScreen", MomentsScreen],
  ["MessagesScreen", MessagesScreen],
  ["NotificationsScreen", NotificationsScreen],
  ["DiscoverScreen", DiscoverScreen],
  ["MeScreen", MeScreen],
];

async function renderInProviders(node: ReactNode) {
  let tree: renderer.ReactTestRenderer | null = null;
  await act(async () => {
    tree = renderer.create(
      <I18nProvider>
        <AuthProvider>{node}</AuthProvider>
      </I18nProvider>,
    );
  });
  return tree as unknown as renderer.ReactTestRenderer;
}

describe("屏幕冒烟渲染", () => {
  it.each(SCREENS)("%s 能渲染出来", async (_name, Screen) => {
    const tree = await renderInProviders(<Screen />);

    /*
     * 关键就是**这一步之前没抛错**：任一屏幕里出现 undefined 组件，render 会直接以
     * React 的 "Element type is invalid" 失败。这里不断言 `toJSON()` 非空 ——
     * 像 MeScreen 在**没有会话**时本来就渲染空，那是正确行为，不是崩溃；
     * 已登录的那条路径由下一个用例覆盖。
     */
    expect(tree).toBeTruthy();
    tree.unmount();
  });

  it("MeScreen 在已登录状态下能渲染出内容", async () => {
    const storage = jest.requireMock("../lib/storage") as { getAccessToken: jest.Mock };
    const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };

    storage.getAccessToken.mockResolvedValue("token");
    /* 只影响这一次调用：`mockResolvedValue` 会永久替换掉上面的路径分支 mock，
       排在它后面的用例（如四个新子页面）就会拿到错误形状。 */
    api.apiFetch.mockImplementationOnce(async () => ({ id: "u1", email: "a@b.c", nickname: "Ann" }));

    const tree = await renderInProviders(<MeScreen />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("ComposeScreen（发动态）带 props 也能渲染出来", async () => {
    const tree = await renderInProviders(
      <ComposeScreen onPublished={() => undefined} onCancel={() => undefined} />,
    );

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  /*
   * 阶段①新增的四个「我的」子页面。它们都是全屏接管状态（带 onBack），
   * 渲染断言与上面的逐屏冒烟同一目的：任一页面里有 undefined 组件，这里立刻失败。
   */
  it("ConnectionsScreen（我的连接）能渲染出来", async () => {
    const tree = await renderInProviders(<ConnectionsScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("SocialScreen（社交账号）能渲染出来", async () => {
    const tree = await renderInProviders(<SocialScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("VisibilityScreen（资料可见范围）能渲染出来", async () => {
    const tree = await renderInProviders(<VisibilityScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("SafetyScreen（安全中心）能渲染出来", async () => {
    const tree = await renderInProviders(
      <SafetyScreen onBack={() => undefined} onOpenSocial={() => undefined} />,
    );

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("AttributesScreen（交友属性）能渲染出来", async () => {
    const tree = await renderInProviders(<AttributesScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("PasswordScreen（修改密码）能渲染出来", async () => {
    const tree = await renderInProviders(<PasswordScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("DeleteAccountScreen（注销账号）能渲染出来", async () => {
    const tree = await renderInProviders(<DeleteAccountScreen onBack={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("OnboardingScreen（注册后的引导流程）带 props 也能渲染出来", async () => {
    const tree = await renderInProviders(
      <OnboardingScreen onExit={() => undefined} onFinish={() => undefined} />,
    );

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });
});

/** 把渲染树里的可见文本拍平，便于断言「屏幕上说了哪句话」。 */
function visibleText(tree: renderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  function walk(node: unknown): void {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as renderer.ReactTestRendererJSON).children);
  }
  walk(tree.toJSON());
  return out;
}

/** `GET /moments/user/:id` 的响应，默认是「能看、暂时没动态」。 */
function userMoments(over: Partial<Record<string, unknown>> = {}) {
  return {
    author: { id: "u2", nickname: "Bob", avatarUrl: null, countryCode: "US", bio: null },
    setting: { visibleTo: "PUBLIC" },
    bindings: [],
    items: [],
    nextCursor: null,
    locked: false,
    ...over,
  };
}

/** 列表里的一条动态。 */
function userMoment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m1",
    userId: "u2",
    platform: "talkfirst",
    platformName: null,
    content: "hi",
    images: [],
    videoUrl: null,
    durationSec: null,
    tags: [],
    likeCount: 0,
    commentCount: 0,
    liked: false,
    bookmarked: false,
    source: "native",
    isDemo: false,
    syncedAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/*
 * 「某人的动态」（对齐 web `/moments/user/[id]`）。
 *
 * 这一屏比逐屏冒烟多盯两件事：
 *
 * 1. `locked` 与「真的没有动态」必须说**不同的话**。服务端在对方限可见范围时
 *    不返回条目 —— 如果按空列表渲染，界面会说「TA 还没有动态」，等于把「你看
 *    不到」谎报成「没有」。两句话引导用户做的下一件事完全相反。
 * 2. 取消点赞时计数要跟着降。`POST /moments/:id/like` 只回 `{liked}`，计数由
 *    客户端自己加减 —— 这个算法在动态 tab 上曾经写错过一次，这里补上同样的
 *    钉子（参见 docs/MOBILE-CRASHES.md 同类记录）。
 */
describe("UserMomentsScreen（TA 的动态）", () => {
  it("对方限了可见范围时说「限可见范围」，而不是「TA 还没有动态」", async () => {
    const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
    api.apiFetch.mockImplementationOnce(async () => userMoments({ locked: true }));

    const tree = await renderInProviders(
      <UserMomentsScreen userId="u2" onClose={() => undefined} />,
    );
    const shown = visibleText(tree);

    expect(shown).toContain(zh["moments.userLockedTitle"]);
    expect(shown).not.toContain(zh["moments.userEmpty"]);
    tree.unmount();
  });

  it("真的没有动态时说「TA 还没有动态」", async () => {
    const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
    api.apiFetch.mockImplementationOnce(async () => userMoments({ items: [] }));

    const tree = await renderInProviders(
      <UserMomentsScreen userId="u2" onClose={() => undefined} />,
    );
    const shown = visibleText(tree);

    expect(shown).toContain(zh["moments.userEmpty"]);
    expect(shown).not.toContain(zh["moments.userLockedTitle"]);
    tree.unmount();
  });

  it("取消点赞时计数跟着降（服务端只回 {liked}）", async () => {
    const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
    api.apiFetch.mockImplementationOnce(async () =>
      userMoments({ items: [userMoment({ liked: true, likeCount: 5 })] }),
    );
    /* 第二次调用就是点赞端点：服务端点明只回 `{ liked }`。 */
    api.apiFetch.mockImplementationOnce(async () => ({ liked: false }));

    const tree = await renderInProviders(
      <UserMomentsScreen userId="u2" onClose={() => undefined} />,
    );
    expect(visibleText(tree)).toContain("5");

    /* `findAll` 会同时命中复合组件与它展开出的宿主节点，所以再筛一道
       「真的带 onPress」，并且只按头一个。 */
    const heart = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["moments.unlike"] &&
        typeof node.props.onPress === "function",
    );
    expect(heart.length).toBeGreaterThan(0);

    await act(async () => {
      heart[0].props.onPress();
    });

    const after = visibleText(tree);
    expect(after).toContain("4");
    expect(after).not.toContain("5");
    tree.unmount();
  });
});
