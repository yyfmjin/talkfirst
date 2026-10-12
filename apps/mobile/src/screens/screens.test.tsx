import type { ComponentType, ReactNode } from "react";
import renderer, { act } from "react-test-renderer";
import { AuthProvider } from "../lib/auth-context";
import { I18nProvider } from "../lib/i18n-context";
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
});
