import type { ComponentType, ReactNode } from "react";
import { Linking } from "react-native";
import renderer, { act } from "react-test-renderer";
import { AuthProvider } from "../lib/auth-context";
import { I18nProvider } from "../lib/i18n-context";
/* 断言用词典里的原文，而不是手抄中文 —— 文案一改，测试跟着改，不会悄悄失真。 */
import { SUPPORT_EMAIL } from "../lib/legal";
import { interpolate, zh } from "../lib/messages";
import { AuthScreen } from "./AuthScreen";
import { AiScreen } from "./AiScreen";
import App from "../../App";
import { AttributesScreen } from "./AttributesScreen";
import { ComposeScreen } from "./ComposeScreen";
import { ConnectionsScreen } from "./ConnectionsScreen";
import { DeleteAccountScreen } from "./DeleteAccountScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { EditProfileScreen } from "./EditProfileScreen";
import { ExchangeScreen } from "./ExchangeScreen";
import { LegalScreen } from "./LegalScreen";
import { MeScreen } from "./MeScreen";
import { MessagesScreen } from "./MessagesScreen";
import { MomentsScreen } from "./MomentsScreen";
import { NotificationsScreen } from "./NotificationsScreen";
import { PasswordScreen } from "./PasswordScreen";
import { SafetyScreen } from "./SafetyScreen";
import { SocialScreen } from "./SocialScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { MomentsSettingsScreen } from "./MomentsSettingsScreen";
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
  // 语言上报（`reportLocale`）在屏幕冒烟测试里不需要真的发请求，
  // 但整个模块被替换了，缺了它 Provider 一挂载就会 TypeError。
  reportLocale: jest.fn(),
  apiFetch: jest.fn(async (path: string) => {
    if (path.startsWith("/conversations")) {
      return path.includes("/messages") ? { items: [], nextCursor: null } : [];
    }
    /* AI 朋友（对齐 web `/ai`）：拉到的是一份已建好的人设与会话。 */
    if (path === "/ai-companion") {
      return {
        companion: {
          id: "companion-1",
          name: "小夏",
          userNickname: "阿杰",
          stylePreset: "gentle",
          personality: null,
          greeting: null,
        },
        conversationId: "conversation-ai",
        messages: [
          {
            id: "ai-message-1",
            senderId: null,
            senderKind: "AI",
            content: "嘿，今天过得怎么样？",
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
    if (path === "/moments/platforms") {
      return [
        { id: "TALKFIRST", label: "TalkFirst", icon: "TF", color: "#6572D8", connectedLabel: "站内动态" },
        { id: "INSTAGRAM", label: "Instagram", icon: "IG", color: "#E1306C", connectedLabel: "已连接用户主页" },
      ];
    }
    if (path === "/moments/bindings") return [];
    if (path === "/moments/settings") {
      return {
        syncEnabled: false,
        visibleTo: "everyone",
        filterSensitive: true,
        showPhotos: true,
        showVideos: true,
        showTexts: true,
        showReels: true,
        showLives: false,
      };
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

jest.mock("expo-image-picker", () => ({
  /* 默认「用户取消了选图」：没安排返回值的用例就不会意外把图传上去。 */
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

const SCREENS: [string, ComponentType][] = [
  ["AuthScreen", AuthScreen],
  ["MomentsScreen", MomentsScreen],
  ["MessagesScreen", MessagesScreen],
  ["NotificationsScreen", NotificationsScreen],
  ["DiscoverScreen", DiscoverScreen],
  ["MeScreen", MeScreen],
];

/**
 * 把渲染树里的可见文字拼起来。
 *
 * 不用 `JSON.stringify(tree.toJSON())`：元素的 props 里有 Provider 这类循环引用，
 * stringify 会直接抛 "Converting circular structure to JSON"。
 */
function renderedText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  const children = (node as { children?: unknown }).children;
  return children === undefined ? "" : renderedText(children);
}

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

  it("整个 App 能挂载（含底部导航的安全区）", async () => {
    /*
     * 2026-10-16 加这条的原因：`useSafeAreaInsets()` 被写在了 `<SafeAreaProvider>` 外面，
     * 真机/模拟器上直接是错误屏，而 typecheck 与其它屏幕单测都是绿的。
     * 把 App 整个渲染一遍才能拦住这类「Provider 层级写错」的问题。
     */
    let tree: renderer.ReactTestRenderer | null = null;
    await act(async () => {
      tree = renderer.create(<App />);
    });
    expect(tree).toBeTruthy();
    await act(async () => {
      tree?.unmount();
    });
  });

  it("AiScreen（AI 朋友）能渲染出人设称呼与已有消息", async () => {
    const tree = await renderInProviders(<AiScreen onBack={() => undefined} />);
    const text = renderedText(tree.toJSON());

    expect(text).toContain("小夏");
    expect(text).toContain("嘿，今天过得怎么样？");

    tree.unmount();
  });

  it("消息页顶部有 AI 朋友入口（与 web /messages 同位）", async () => {
    const tree = await renderInProviders(<MessagesScreen />);
    expect(renderedText(tree.toJSON())).toContain(zh["ai.title"]);
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

  it("LegalScreen（条款与隐私）带 props 也能渲染出来", async () => {
    const tree = await renderInProviders(<LegalScreen onBack={() => undefined} />);

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

  it("MomentsSettingsScreen（动态设置）能渲染出来", async () => {
    const tree = await renderInProviders(<MomentsSettingsScreen onBack={() => undefined} />);

    /* 不只看「没崩」：平台清单是数组、设置是对象，形状错一个这里就会失败 ——
       通用 `/moments` 分支回的是 `{ items, nextCursor }`，正好能拓出这种错误。 */
    const shown = visibleText(tree);
    expect(shown).toContain(zh["momentsSettings.title"]);
    expect(shown).toContain("Instagram");
    tree.unmount();
  });

  /*
   * 设置页真正容易错的地方是**字段名**：控件顺序排错、把「故事」接到 `showReels`
   * 上，界面看不出一点问题，只有服务端默默存了错误的值。这里按「点哪个开关 →
   * 发什么 body」钉住，而不是只看渲染。
   */
  it("MomentsSettingsScreen：点开关发的是对应字段", async () => {
    const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };

    const tree = await renderInProviders(<MomentsSettingsScreen onBack={() => undefined} />);
    api.apiFetch.mockClear();

    /* 可见范围：选「仅连接可见」。 */
    const visibility = tree.root.findAll(
      (node) =>
        String(node.props.accessibilityLabel).startsWith(zh["momentsSettings.visibleConnections"]) &&
        typeof node.props.onPress === "function",
    );
    expect(visibility.length).toBeGreaterThan(0);
    await act(async () => {
      visibility[0].props.onPress();
    });

    /* 内容筛选：「故事」默认关，点一下应该打开 `showLives`。 */
    const stories = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["momentsSettings.showLives"] &&
        node.props.accessibilityRole === "switch" &&
        typeof node.props.onPress === "function",
    );
    expect(stories.length).toBeGreaterThan(0);
    await act(async () => {
      stories[0].props.onPress();
    });

    const patched = api.apiFetch.mock.calls
      .filter(([path]) => path === "/moments/settings")
      .map(([, options]) => options?.body);
    expect(patched).toContainEqual({ visibleTo: "connections" });
    expect(patched).toContainEqual({ showLives: true });
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

/** 找一个带无障碍标签的可点节点并点它（Button / Pressable / 复选框共用）。 */
async function press(tree: renderer.ReactTestRenderer, label: string): Promise<void> {
  const found = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === "function",
  );
  expect(found.length).toBeGreaterThan(0);
  await act(async () => {
    await found[0].props.onPress();
  });
}

/** 找一个输入框（同样靠无障碍标签定位）并输入。 */
async function typeInto(tree: renderer.ReactTestRenderer, label: string, text: string): Promise<void> {
  const found = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === "function",
  );
  expect(found.length).toBeGreaterThan(0);
  await act(async () => {
    found[0].props.onChangeText(text);
  });
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

/* ─────────────────── 交换联系方式（会话内，对齐 web /messages/[id]/connect） ─────────────────── */

/** `GET /conversations/:id/exchange` 的响应，默认是「聊够了、还什么都没发生」。 */
function exchangeEligibility(over: Partial<Record<string, unknown>> = {}) {
  return {
    conversationId: "c1",
    connectionId: "conn1",
    messageCount: 5,
    requiredMessages: 5,
    eligible: true,
    pending: [],
    exchanged: [],
    myAccounts: [],
    ...over,
  };
}

/** 一条交换申请。`platforms` 已是服务端换好的 `{ id, label }`，客户端不再自己拼平台名。 */
function exchangeItem(over: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: "e1",
    connectionId: "conn1",
    conversationId: "c1",
    requesterId: "u1",
    receiverId: "u2",
    platforms: [{ id: "TELEGRAM", label: "Telegram" }],
    message: null,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

/*
 * 交换联系方式。三个钉子都对着「界面上看不出来、真机上才会错」的地方：
 *
 * 1. 未达门槛时，那颗写着「还需 N 条消息」的按钮**必须是禁用的** —— web 那次审计
 *    漏了 `!eligible`，按钮看着像不能点、其实可点，用户点下去要等一个服务端来回
 *    才被拒。这里同时钉住「disabled」与「真按了也不发申请」两层。
 * 2. 方向（谁发起）决定出现哪些控件：收方是接受/拒绝，发起方才是撤回。web 曾把
 *    「撤回我发起的请求」渲染给**每一条**待处理请求，那个按钮在说谎。
 * 3. 接受打 `POST /exchange/:id/respond` + `{ action }`，撤回打 `/cancel`。这两条
 *    路径写反了界面照样不报错（都由服务端收下或一并 404），只有行为不对。
 */
describe("ExchangeScreen（会话内交换联系方式）", () => {
  const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
  const storage = jest.requireMock("../lib/storage") as { getAccessToken: jest.Mock };
  /* describe 体在用例之前执行，此时拿到的是工厂里那版实现，用来在收尾时还原。 */
  const originalFetch = api.apiFetch.getMockImplementation();
  const originalToken = storage.getAccessToken.getMockImplementation();

  afterAll(() => {
    if (originalFetch) api.apiFetch.mockImplementation(originalFetch);
    if (originalToken) storage.getAccessToken.mockImplementation(originalToken);
  });

  beforeEach(() => {
    /* 这一屏要判「这条请求是不是我发起的」（`requesterId === user?.id`），所以必须
       真的有一个登录用户；工厂里的 `/users/me` 分支固定回 `id: "u1"`。 */
    storage.getAccessToken.mockResolvedValue("token");
  });

  /**
   * 按路径分派假响应。
   *
   * 不用 `mockImplementationOnce` 排队：这一屏自己会**依次**打平台清单、资格、已交换的
   * 联系人三个端点，用「第几次调用」来对号入座，加一个请求就全错位了。没安排的路径回
   * 一个形状安全的空值 —— 忘了安排会表现成空界面，而不是伪装成一次成功的加载。
   */
  function mockByPath(map: Record<string, unknown>): void {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (Object.prototype.hasOwnProperty.call(map, path)) return map[path];
      if (path === "/users/me") return { id: "u1", email: "a@b.c", nickname: "Ann" };
      if (path === "/exchange/platforms") return [];
      return { items: [], nextCursor: null };
    });
  }

  it("未达门槛时按钮是禁用的，按下去也不发申请", async () => {
    mockByPath({
      "/exchange/platforms": [{ id: "TELEGRAM", label: "Telegram" }],
      "/conversations/c1/exchange": exchangeEligibility({
        messageCount: 2,
        requiredMessages: 5,
        eligible: false,
      }),
    });

    const tree = await renderInProviders(
      <ExchangeScreen conversationId="c1" onBack={() => undefined} />,
    );

    /* 门槛按服务端给的数字说：2/5。 */
    expect(visibleText(tree)).toContain(
      interpolate(zh["exchange.progressNotReady"], { count: 2, required: 5 }),
    );

    /* 先选中一个平台，让「不能点」不是因为什么都没选。 */
    const chip = tree.root.findAll(
      (node) =>
        node.props.accessibilityState?.selected === false &&
        typeof node.props.onPress === "function",
    );
    expect(chip.length).toBeGreaterThan(0);
    await act(async () => {
      chip[0].props.onPress();
    });

    const submit = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel ===
          interpolate(zh["exchange.submitNeedMore"], { n: 3 }) &&
        typeof node.props.onPress === "function",
    );
    expect(submit.length).toBeGreaterThan(0);
    expect(submit[0].props.disabled).toBe(true);

    /* 就算绕过 Pressable 的 disabled 直接调 onPress，`submit()` 自己也要守住门槛，
       并且**不发**这个请求。 */
    api.apiFetch.mockClear();
    await act(async () => {
      submit[0].props.onPress();
    });
    expect(api.apiFetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
    tree.unmount();
  });

  it("对方发起的请求给接受/拒绝，接受打的是 /exchange/:id/respond", async () => {
    mockByPath({
      "/exchange/platforms": [{ id: "TELEGRAM", label: "Telegram" }],
      "/conversations/c1/exchange": exchangeEligibility({
        eligible: false,
        pending: [
          exchangeItem({
            requesterId: "u2",
            receiverId: "u1",
            requester: { id: "u2", nickname: "Bob", avatarUrl: null, countryCode: "US" },
          }),
        ],
      }),
    });

    const tree = await renderInProviders(
      <ExchangeScreen conversationId="c1" onBack={() => undefined} />,
    );
    const shown = visibleText(tree);

    expect(shown).toContain(
      interpolate(zh["exchange.pendingTheirs"], { name: "Bob", platforms: "Telegram" }),
    );
    expect(shown).toContain(zh["exchange.accept"]);
    expect(shown).not.toContain(zh["exchange.withdraw"]);

    const accept = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["exchange.accept"] &&
        typeof node.props.onPress === "function",
    );
    expect(accept.length).toBeGreaterThan(0);
    await act(async () => {
      accept[0].props.onPress();
    });

    expect(api.apiFetch.mock.calls).toContainEqual([
      "/exchange/e1/respond",
      { method: "POST", body: { action: "accept" } },
    ]);
    tree.unmount();
  });

  it("我发起的请求给的是撤回，不是接受", async () => {
    mockByPath({
      "/exchange/platforms": [],
      "/conversations/c1/exchange": exchangeEligibility({
        eligible: false,
        pending: [exchangeItem()],
      }),
    });

    const tree = await renderInProviders(
      <ExchangeScreen conversationId="c1" onBack={() => undefined} />,
    );
    const shown = visibleText(tree);

    expect(shown).toContain(interpolate(zh["exchange.pendingMine"], { platforms: "Telegram" }));
    expect(shown).toContain(zh["exchange.withdraw"]);
    expect(shown).not.toContain(zh["exchange.accept"]);

    const withdraw = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["exchange.withdraw"] &&
        typeof node.props.onPress === "function",
    );
    expect(withdraw.length).toBeGreaterThan(0);
    await act(async () => {
      withdraw[0].props.onPress();
    });

    expect(api.apiFetch.mock.calls).toContainEqual(["/exchange/e1/cancel", { method: "POST" }]);
    tree.unmount();
  });

  it("已交换时显示对方的账号，并且不再给出申请区", async () => {
    mockByPath({
      "/exchange/platforms": [{ id: "TELEGRAM", label: "Telegram" }],
      "/conversations/c1/exchange": exchangeEligibility({
        eligible: false,
        exchanged: [exchangeItem({ status: "ACCEPTED" })],
      }),
      "/conversations/c1/exchange/contacts": {
        exchanged: true,
        contacts: [
          {
            userId: "u2",
            nickname: "Bob",
            platform: "TELEGRAM",
            label: "Telegram",
            handle: "@bob",
          },
        ],
      },
    });

    const tree = await renderInProviders(
      <ExchangeScreen conversationId="c1" onBack={() => undefined} />,
    );
    const shown = visibleText(tree);

    expect(shown).toContain(zh["exchange.sharedSection"]);
    expect(shown).toContain("@bob");
    /* 已经交换过就不能再申请（服务端会 403 ALREADY_EXCHANGED）—— 所以申请区不该出现。 */
    expect(shown).not.toContain(interpolate(zh["exchange.pickSection"], { n: 3 }));
    tree.unmount();
  });
});

/* ─────────────── 编辑资料（「我的」→ 编辑基本资料，对齐 web /me/edit） ─────────────── */

/** `GET /users/me` 的响应（`SessionUser` 形状），默认是一张填好的名片。 */
function profileUser(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    email: "a@b.c",
    emailVerified: true,
    nickname: "Ann",
    avatarUrl: null,
    birthDate: "1998-05-20T00:00:00.000Z",
    countryCode: "CN",
    city: "上海",
    region: "上海",
    gender: "FEMALE",
    bio: "hi",
    profileCompleted: true,
    ...over,
  };
}

/*
 * 编辑资料。这一屏容易错的地方都不在画面上：
 *
 * 1. **空字段不能照发。** `PATCH /users/me` 对 `birthDate` / `countryCode` 是格式校验
 *    （`YYYY-MM-DD`、两位字母），空字符串会被判成非法输入而不是「清空」。没填过生日
 *    的用户点保存就是 400 —— 只有这一类用户能踩到，而且测不出来就真机才现。
 * 2. **预填以服务端为准。** 会话里的 `user` 是 App 启动时拉的，可能比库里旧（在 web
 *    上改过）。用会话值预填，用户看到的是旧数据，一保存又把旧值写回去。
 * 3. **保存后必须回读。** 只信 PATCH 的返回值，界面上显示的就不是「库里存的东西」。
 * 4. **头像不走 PATCH。** `POST /uploads/avatar` 自己就写库，换完头像不点保存也已经
 *    生效 —— 所以它不该顺带发一个 PATCH。
 */
describe("EditProfileScreen（编辑资料）", () => {
  const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
  const picker = jest.requireMock("expo-image-picker") as { launchImageLibraryAsync: jest.Mock };
  /* describe 体在用例之前执行，此时拿到的是工厂里那版实现，用来在收尾时还原。 */
  const originalFetch = api.apiFetch.getMockImplementation();

  afterAll(() => {
    if (originalFetch) api.apiFetch.mockImplementation(originalFetch);
  });

  /**
   * 没安排的路径的兜底值。
   *
   * 国家清单必须是**数组**（`CountryField` 直接对它 `find`），其余按列表接口给
   * `{ items, nextCursor }`。之前这里一律回后面那个形状，`/meta/countries` 就拿到一个
   * 对象、`find is not a function` 当场把整屏炸掉 —— 正是这套测试想抓的那类「形状
   * 不对」，只是这次错在测试自己。
   */
  function fallback(path: string): unknown {
    if (path === "/meta/countries") return [];
    return { items: [], nextCursor: null };
  }

  /** 按路径分派假响应；没安排的路径回一个形状安全的空值。 */
  function mockByPath(map: Record<string, unknown>): void {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (Object.prototype.hasOwnProperty.call(map, path)) return map[path];
      return fallback(path);
    });
  }

  /** 每一次 `PATCH /users/me` 的请求体。 */
  function patches(): Array<Record<string, unknown>> {
    return api.apiFetch.mock.calls
      .filter(([path, options]) => path === "/users/me" && options?.method === "PATCH")
      .map(([, options]) => options?.body as Record<string, unknown>);
  }

  /** 某个输入框（`Input` 把可读名绑在 TextInput 上）。 */
  function field(tree: renderer.ReactTestRenderer, label: string) {
    const found = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === label && typeof node.props.onChangeText === "function",
    );
    expect(found.length).toBeGreaterThan(0);
    return found[0];
  }

  async function type(tree: renderer.ReactTestRenderer, label: string, text: string) {
    await act(async () => {
      field(tree, label).props.onChangeText(text);
    });
  }

  async function pressSave(tree: renderer.ReactTestRenderer) {
    const buttons = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["me.save"] && typeof node.props.onPress === "function",
    );
    expect(buttons.length).toBeGreaterThan(0);
    await act(async () => {
      buttons[0].props.onPress();
    });
  }

  /** 挂载这一屏。`session` 是会话里那份（可能过时的）用户。 */
  async function mount(session: Record<string, unknown>) {
    const changes: Array<Record<string, unknown>> = [];
    const tree = await renderInProviders(
      <EditProfileScreen
        user={session as never}
        onDone={() => undefined}
        onUserChange={(next) => changes.push(next as never)}
      />,
    );
    return { tree, changes };
  }

  it("预填用服务端的值，而不是会话里那份可能过时的缓存", async () => {
    mockByPath({
      "/users/me": profileUser({ nickname: "新名字", city: "新城市" }),
    });
    const { tree, changes } = await mount(profileUser({ nickname: "旧名字", city: "旧城市" }));

    expect(field(tree, zh["me.nickname"]).props.value).toBe("新名字");
    expect(field(tree, zh["me.city"]).props.value).toBe("新城市");
    /* 服务端那份顺手写回会话：否则「我的」卡上还是旧名字。 */
    expect(changes).toHaveLength(1);
    expect(changes[0].nickname).toBe("新名字");
    tree.unmount();
  });

  it("生日与国家留空时不带这两个字段（空串会被服务端判成非法输入）", async () => {
    mockByPath({ "/users/me": profileUser({ birthDate: null, countryCode: null }) });
    /* 会话里是有生日的：确保「不发」不是因为一开始就没值。 */
    const { tree } = await mount(profileUser());
    api.apiFetch.mockClear();

    await pressSave(tree);

    const body = patches()[0];
    expect(body).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(body, "birthDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "countryCode")).toBe(false);
    /* 可以清空的那几个照发。 */
    expect(body).toMatchObject({
      nickname: "Ann",
      city: "上海",
      region: "上海",
      gender: "FEMALE",
      bio: "hi",
    });
    tree.unmount();
  });

  it("填了生日与国家就照发", async () => {
    mockByPath({ "/users/me": profileUser() });
    const { tree } = await mount(profileUser({ birthDate: null, countryCode: null }));
    api.apiFetch.mockClear();

    await type(tree, zh["me.birthDate"], "1998-05-20");
    await pressSave(tree);

    expect(patches()[0]).toMatchObject({ birthDate: "1998-05-20", countryCode: "CN" });
    tree.unmount();
  });

  it("昵称少于 2 个字就拦下，不发请求", async () => {
    mockByPath({ "/users/me": profileUser({ nickname: null }) });
    const { tree } = await mount(profileUser({ nickname: null }));
    api.apiFetch.mockClear();

    await type(tree, zh["me.nickname"], "A");
    await pressSave(tree);

    expect(patches()).toHaveLength(0);
    expect(visibleText(tree)).toContain(interpolate(zh["me.errNicknameMin"], { n: 2 }));
    tree.unmount();
  });

  it("生日格式不对或不满 18 岁都拦下，不发请求", async () => {
    mockByPath({ "/users/me": profileUser() });
    const { tree } = await mount(profileUser());
    api.apiFetch.mockClear();

    /* `2026-02-30`：格式对、日子不存在。Date 会把它滚到 3 月，必须当无效处理。 */
    await type(tree, zh["me.birthDate"], "2026-02-30");
    await pressSave(tree);
    expect(patches()).toHaveLength(0);
    expect(visibleText(tree)).toContain(zh["me.errBirthDate"]);

    await type(tree, zh["me.birthDate"], "2015-01-01");
    await pressSave(tree);
    expect(patches()).toHaveLength(0);
    expect(visibleText(tree)).toContain(interpolate(zh["me.errAge"], { n: 18 }));
    tree.unmount();
  });

  it("保存后重新读一遍 /users/me，界面显示服务端归一化后的值", async () => {
    let stored: Record<string, unknown> = profileUser();
    api.apiFetch.mockImplementation(
      async (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === "/users/me" && options?.method === "PATCH") {
          /* 服务端会归一化（去空白、大小写等），所以回读的值跟请求体并不相等。 */
          stored = { ...stored, ...(options.body ?? {}), nickname: "Ann（已归一）" };
          return stored;
        }
        if (path === "/users/me") return stored;
        return fallback(path);
      },
    );
    const { tree, changes } = await mount(profileUser({ nickname: "ann" }));
    api.apiFetch.mockClear();

    await pressSave(tree);

    expect(patches()).toHaveLength(1);
    /* 断言真的又读了一遍，而不是拿 PATCH 的返回值描到界面上。 */
    const reads = api.apiFetch.mock.calls.filter(([path, options]) => path === "/users/me" && !options);
    expect(reads.length).toBeGreaterThan(0);
    expect(field(tree, zh["me.nickname"]).props.value).toBe("Ann（已归一）");
    expect(visibleText(tree)).toContain(zh["me.saved"]);
    expect(changes[changes.length - 1].nickname).toBe("Ann（已归一）");
    tree.unmount();
  });

  it("换头像立刻上传并更新会话，不用再点保存", async () => {
    mockByPath({ "/users/me": profileUser() });
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ base64: "AAA", mimeType: "image/png" }],
    });
    api.apiFetch.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/uploads/avatar" && options?.method === "POST") {
          return { avatarUrl: "https://cdn.example/a.png" };
        }
        if (path === "/users/me") return profileUser();
        return fallback(path);
      },
    );
    const { tree, changes } = await mount(profileUser());
    api.apiFetch.mockClear();

    const rows = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["me.avatarChange"] &&
        typeof node.props.onPress === "function",
    );
    expect(rows.length).toBeGreaterThan(0);
    await act(async () => {
      await rows[0].props.onPress();
    });

    const uploads = api.apiFetch.mock.calls.filter(([path]) => path === "/uploads/avatar");
    expect(uploads).toHaveLength(1);
    expect((uploads[0][1].body as { image: string }).image).toBe("data:image/png;base64,AAA");
    /* 头像接口自己写库，不该再叠一个 PATCH。 */
    expect(patches()).toHaveLength(0);
    expect(changes[changes.length - 1].avatarUrl).toBe("https://cdn.example/a.png");
    expect(visibleText(tree)).toContain(zh["me.avatarUpdated"]);
    tree.unmount();
  });

  it("图太大就当场说清楚，不发起上传", async () => {
    mockByPath({ "/users/me": profileUser() });
    /* 服务端上限是 base64 串 7,000,000 字符，超了就一定被拒。 */
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ base64: "A".repeat(7_000_001), mimeType: "image/jpeg" }],
    });
    const { tree } = await mount(profileUser());
    api.apiFetch.mockClear();

    const rows = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === zh["me.avatarChange"] &&
        typeof node.props.onPress === "function",
    );
    await act(async () => {
      await rows[0].props.onPress();
    });

    expect(api.apiFetch.mock.calls.filter(([path]) => path === "/uploads/avatar")).toHaveLength(0);
    expect(visibleText(tree)).toContain(zh["me.avatarTooLarge"]);
    tree.unmount();
  });
});

/*
 * 条款与隐私 —— 这两条盯的是 Google Play 的上架硬要求，不是普通 UI 偏好：
 *
 *   1. 隐私政策必须**在应用内可达**（只在商店页放个链接不够）；
 *   2. 含用户生成内容的应用必须让用户在注册**之前**明确同意条款 ——
 *      界面上写一行字、点不进去，等于没给用户读过条款的机会。
 *
 * 所以这里不靠「看着像对的」：前者断言真的调了 `Linking.openURL` 且地址就是官网上
 * 那三个页面（换域名、改路径都会在这里被拦住），后者断言没勾同意时**一个请求都不发**。
 */
describe("条款与隐私（Play 上架要求）", () => {
  it("LegalScreen 列出三份文档，点开的是官网上对应语言的页面", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const tree = await renderInProviders(<LegalScreen onBack={() => undefined} />);

    const text = visibleText(tree);
    expect(text).toContain(zh["legal.terms"]);
    expect(text).toContain(zh["legal.privacy"]);
    expect(text).toContain(zh["legal.rules"]);

    const links = tree.root.findAll(
      (node) => node.props.accessibilityRole === "link" && typeof node.props.onPress === "function",
    );
    /* 三份文档 + 联系我们，共四个入口。这里不断言精确条数：React Native 的
       Pressable 在测试树里会同时出现合成节点与宿主节点，数出来是 8 —— 真正
       要盯的是下面那四个地址。 */
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      await act(async () => {
        await link.props.onPress();
      });
    }

    const urls = open.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("https://talkfirst.ccwu.cc/legal/terms");
    expect(urls).toContain("https://talkfirst.ccwu.cc/legal/privacy");
    expect(urls).toContain("https://talkfirst.ccwu.cc/legal/rules");
    expect(urls).toContain(`mailto:${SUPPORT_EMAIL}`);

    open.mockRestore();
    tree.unmount();
  });

  it("注册页没勾同意就不发注册请求，并明说要先同意", async () => {
    const api = jest.requireMock("../lib/api") as { apiFetchEnvelope: jest.Mock };
    const tree = await renderInProviders(<AuthScreen />);

    /* 登录页 → 注册页。toggle 用的是无障碍标签，不是文案片段。 */
    await press(tree, zh["auth.toRegister"]);
    api.apiFetchEnvelope.mockClear();

    await typeInto(tree, zh["auth.email"], "new@example.com");
    await typeInto(tree, zh["auth.password"], "password123");
    await press(tree, zh["auth.register"]);

    expect(api.apiFetchEnvelope).not.toHaveBeenCalled();
    expect(visibleText(tree)).toContain(zh["auth.errorConsentRequired"]);

    /* 勾上同意 → 同一套输入就该照发。 */
    await press(tree, zh["auth.consent"]);
    await press(tree, zh["auth.register"]);

    const paths = api.apiFetchEnvelope.mock.calls.map(([path]) => String(path));
    expect(paths).toContain("/auth/register");
    tree.unmount();
  });
});
