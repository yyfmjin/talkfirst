import type { ComponentType } from "react";
import renderer, { act } from "react-test-renderer";
import { AuthProvider } from "../lib/auth-context";
import { I18nProvider } from "../lib/i18n-context";
import { AuthScreen } from "./AuthScreen";
import { ComposeScreen } from "./ComposeScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { MeScreen } from "./MeScreen";
import { MessagesScreen } from "./MessagesScreen";
import { MomentsScreen } from "./MomentsScreen";
import { NotificationsScreen } from "./NotificationsScreen";

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
    return {};
  }),
  apiFetchEnvelope: jest.fn(async () => ({ data: {}, accessToken: "a", refreshToken: "r" })),
  ApiRequestError: class ApiRequestError extends Error {},
  tryRefresh: jest.fn(async () => false),
}));

jest.mock("../lib/storage", () => ({
  saveTokens: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
  getAccessToken: jest.fn(async () => null),
  getRefreshToken: jest.fn(async () => null),
}));

const SCREENS: [string, ComponentType<never>][] = [
  ["AuthScreen", AuthScreen as ComponentType<never>],
  ["MomentsScreen", MomentsScreen as ComponentType<never>],
  ["MessagesScreen", MessagesScreen as ComponentType<never>],
  ["NotificationsScreen", NotificationsScreen as ComponentType<never>],
  ["DiscoverScreen", DiscoverScreen as ComponentType<never>],
  ["MeScreen", MeScreen as ComponentType<never>],
];

async function renderInProviders(node: React.ReactElement) {
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

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });

  it("ComposeScreen（发动态）带 props 也能渲染出来", async () => {
    const tree = await renderInProviders(<ComposeScreen onPublished={() => undefined} onCancel={() => undefined} />);

    expect(tree.toJSON()).toBeTruthy();
    tree.unmount();
  });
});
