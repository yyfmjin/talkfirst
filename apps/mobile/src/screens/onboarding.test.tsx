import type { ReactNode } from "react";
import renderer, { act } from "react-test-renderer";
import { OnboardingScreen } from "./OnboardingScreen";

/**
 * 引导流程的行为用例 —— 盯的是**接口契约**，不是像素。
 *
 * ## 为什么值得单独写一套
 *
 * 引导的每一步都在往服务端写同一批字段（昵称/生日/国家、兴趣、语言、目的、想认识的
 * 国家），而 web 端 `/onboarding/*` 写的是**同一批端点**。两端一旦漂开，症状是
 * 「web 上填过的资料，在 app 里重填一遍就丢了」—— 不报错、不上报，只有用户会发现。
 *
 * 所以这里断言的是：走到哪一步、发哪个请求、请求体长什么样、以及本地把哪些非法输入
 * 挡在了请求之前。
 *
 * ## 两处 mock 的用意
 *
 *   - `useI18n` 被换成一个「键即文案」的 t。于是 `accessibilityLabel` 恰好就是
 *     消息键，用例里可以直接写 `"onboarding.next"`，读起来就是流程本身；同时
 *     换语言也不会让这套用例变红（词典完整性由 `Record<MsgKey, string>` 在
 *     typecheck 阶段保证）。
 *   - `useAuth` 直接给一个已登录用户：引导只用到 `user`/`setUser`，没必要为此
 *     拉起真实的 AuthProvider 与 SecureStore。
 */

const mockUser = {
  id: "u1",
  email: "a@b.c",
  emailVerified: true,
  nickname: "",
  avatarUrl: null,
  birthDate: null,
  countryCode: null,
  city: null,
  region: null,
  gender: null,
  bio: null,
  profileCompleted: false,
};

const mockSetUser = jest.fn();

type MockCall = { path: string; options: { method?: string; body?: unknown } };
const mockCalls: MockCall[] = [];
let mockResponses: Record<string, unknown> = {};

jest.mock("../lib/api", () => ({
  reportLocale: jest.fn(),
  apiFetch: jest.fn(async (path: string, options: { method?: string; body?: unknown } = {}) => {
    mockCalls.push({ path, options });
    return mockResponses[path] ?? {};
  }),
  ApiRequestError: class ApiRequestError extends Error {
    code?: string;
  },
  tryRefresh: jest.fn(async () => false),
}));

jest.mock("../lib/auth-context", () => ({
  useAuth: () => ({ user: mockUser, setUser: mockSetUser }),
}));

jest.mock("../lib/i18n-context", () => {
  /* t 与整个 value 必须是**稳定引用**：真实的 I18nContext 用 useMemo/useCallback
     保证了这一点，而引导页的 load() 依赖 `[t]`。如果 mock 每次渲染都新建一个 t，
     effect 会每帧重跑 → setState → 再渲染，直接把内存跑爆。 */
  const t = (key: string) => key;
  const value = {
    t,
    locale: "zh",
    preference: "system",
    setPreference: () => undefined,
  };
  return { useI18n: () => value };
});

/* 社交账号那一步会把 SocialScreen 整段挂进来（第 7 步），它自己要读三类接口；
   这里的默认响应按路径给空形状，免得那一步一挂就崩。 */
function resetApi() {
  mockCalls.length = 0;
  mockSetUser.mockClear();
  mockResponses = {
    "/meta/languages": [
      { code: "zh", name: "Chinese", nativeName: "中文" },
      { code: "en", name: "English", nativeName: "English" },
    ],
    /* 兴趣这一步的校验是 ≥3，所以默认就给三条。用例必须在 render **之前**
       就拿到完整形状：`load()` 在挂载时就并发发了那几个请求，
       render 之后再改响应已经晚了（这正是这套用例最初挂掉的原因）。 */
    "/meta/interests": [
      { id: "i1", slug: "music", name: "Music", nameZh: "音乐", category: "ART" },
      { id: "i2", slug: "film", name: "Film", nameZh: "电影", category: "ART" },
      { id: "i3", slug: "travel", name: "Travel", nameZh: "旅行", category: "LIFE" },
    ],
    "/meta/purposes": [{ slug: "friends", name: "Friends", nameZh: "交朋友" }],
    "/meta/countries": [
      { code: "CN", name: "China", flag: "🇨🇳" },
      { code: "US", name: "United States", flag: "🇺🇸" },
    ],
    "/users/me": {
      ...mockUser,
      languages: [],
      interests: [],
      purposes: [],
      preferredCountries: [],
    },
    /* 第 7 步会把 SocialScreen 整段挂进来，它挂载时就并发读这三个接口；
       形状不对会让那一步直接崩（`providers.length` 打在 undefined 上），
       而不是安静地空着。 */
    "/social-sync/providers": { providers: [] },
    "/social-sync/accounts": { accounts: [] },
    "/moments/bindings": [],
  };
}

function hasText(tree: renderer.ReactTestRenderer, text: string): boolean {
  return tree.root.findAll((node) => node.children.join("") === text).length > 0;
}

/** 按无障碍标签点一个控件（`Button` 与 `Input` 都带 label）。 */
async function press(tree: renderer.ReactTestRenderer, label: string) {
  const target = tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === "function",
  )[0];
  if (!target) throw new Error(`找不到可点击控件：${label}`);
  await act(async () => {
    target.props.onPress();
  });
}

async function type(tree: renderer.ReactTestRenderer, label: string, value: string) {
  const target = tree.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === label && typeof node.props?.onChangeText === "function",
  )[0];
  if (!target) throw new Error(`找不到输入框：${label}`);
  await act(async () => {
    target.props.onChangeText(value);
  });
}

/**
 * 点一个「胶囊」：胶囊本身没有 accessibilityLabel，文案在子节点里。
 * 从文案节点往上找最近的 onPress 祖先，避免为了测试去改组件的可访问性属性。
 *
 * `index` 解的是一处**真实存在的歧义**：语言那一步会把同一门语言画两次 ——
 * 母语候选列里有它，「正在学习」列里也有它。同一个文案因此对应两个可点祖先；
 * 默认取第一个（母语列），要选「正在学习」就传 1。
 *
 * 多个文案节点可能共享同一个可点祖先（组件节点与宿主机节点会有重复匹配），
 * 所以先归一到祖先再去重，序号才等于「第几个胶囊」。
 */
async function pressChip(tree: renderer.ReactTestRenderer, text: string, index = 0) {
  const targets: renderer.ReactTestInstance[] = [];
  for (const node of tree.root.findAll((candidate) => candidate.children.join("") === text)) {
    let current: renderer.ReactTestInstance | null = node;
    while (current && typeof current.props?.onPress !== "function") current = current.parent;
    if (current && !targets.includes(current)) targets.push(current);
  }
  const target = targets[index];
  if (!target) {
    throw new Error(`找不到第 ${index + 1} 个可点的「${text}」（页面上共 ${targets.length} 个）`);
  }
  await act(async () => {
    target.props.onPress();
  });
}

async function renderOnboarding(): Promise<{
  tree: renderer.ReactTestRenderer;
  onExit: jest.Mock;
  onFinish: jest.Mock;
}> {
  const onExit = jest.fn();
  const onFinish = jest.fn();
  let tree: renderer.ReactTestRenderer | null = null;
  await act(async () => {
    tree = renderer.create(<OnboardingScreen onExit={onExit} onFinish={onFinish} />);
  });
  /* 再放一拍：`load()` 里那五个并发请求要落地，界面才会从加载态切到第 1 步。 */
  await act(async () => undefined);
  return { tree: tree as unknown as renderer.ReactTestRenderer, onExit, onFinish };
}

/** 把名字填成合法的，用于「只验证某一条错误」的用例。 */
async function fillValidProfile(tree: renderer.ReactTestRenderer) {
  await type(tree, "onboarding.nickname", "Ann");
  await type(tree, "onboarding.birthDate", "1998-06-30");
  /* 国家是个可搜索的下拉：先展开再点选项。 */
  await press(tree, "onboarding.country");
  await pressChip(tree, "🇨🇳 China");
}

beforeEach(resetApi);

describe("引导流程 · 步骤推进", () => {
  it("第 1 步是头像，且列出的总步数是 7（完成页不计入）", async () => {
    const { tree } = await renderOnboarding();

    expect(hasText(tree, "onboarding.stepAvatar")).toBe(true);
    expect(hasText(tree, "onboarding.progress")).toBe(true);
    tree.unmount();
  });

  it("头像没选图时，「下一步」直接前进且不发任何请求", async () => {
    const { tree } = await renderOnboarding();
    mockCalls.length = 0;

    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.stepProfile")).toBe(true);
    tree.unmount();
  });

  it("第 1 步的「稍后再说」不上传，直接前进", async () => {
    const { tree } = await renderOnboarding();
    mockCalls.length = 0;

    await press(tree, "onboarding.skip");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.stepProfile")).toBe(true);
    tree.unmount();
  });
});

describe("引导流程 · 基本信息（PATCH /users/me）", () => {
  async function toProfileStep() {
    const rendered = await renderOnboarding();
    await press(rendered.tree, "onboarding.next");
    mockCalls.length = 0;
    return rendered;
  }

  it("昵称少于 2 个字符就挡下来，不发请求", async () => {
    const { tree } = await toProfileStep();

    await type(tree, "onboarding.nickname", "A");
    await type(tree, "onboarding.birthDate", "1998-06-30");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errNicknameMin")).toBe(true);
    tree.unmount();
  });

  it("生日格式不对就挡下来，不发请求", async () => {
    const { tree } = await toProfileStep();

    await type(tree, "onboarding.nickname", "Ann");
    await type(tree, "onboarding.birthDate", "1998/06/30");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errBirthDate")).toBe(true);
    tree.unmount();
  });

  it("未满 18 岁就挡下来，不发请求", async () => {
    const { tree } = await toProfileStep();
    const justUnder = new Date();
    justUnder.setFullYear(justUnder.getFullYear() - 17);
    const value = justUnder.toISOString().slice(0, 10);

    await type(tree, "onboarding.nickname", "Ann");
    await type(tree, "onboarding.birthDate", value);
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errAge")).toBe(true);
    tree.unmount();
  });

  it("没选国家就挡下来，不发请求", async () => {
    const { tree } = await toProfileStep();

    await type(tree, "onboarding.nickname", "Ann");
    await type(tree, "onboarding.birthDate", "1998-06-30");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errCountry")).toBe(true);
    tree.unmount();
  });

  it("填好后 PATCH /users/me 带上全部字段，并前进到兴趣", async () => {
    const { tree } = await toProfileStep();

    await fillValidProfile(tree);
    await type(tree, "onboarding.city", "Shanghai");
    await type(tree, "onboarding.nickname", "  Ann  ");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]?.path).toBe("/users/me");
    expect(mockCalls[0]?.options.method).toBe("PATCH");
    expect(mockCalls[0]?.options.body).toEqual({
      nickname: "Ann",
      birthDate: "1998-06-30",
      countryCode: "CN",
      city: "Shanghai",
      gender: "UNKNOWN",
    });
    expect(hasText(tree, "onboarding.stepInterests")).toBe(true);
    tree.unmount();
  });
});

describe("引导流程 · 兴趣 / 语言 / 目的 / 国家", () => {
  /** 从第 1 步推到「兴趣」步（走完头像 + 基本信息）。 */
  async function toInterestsStep() {
    const rendered = await renderOnboarding();
    await press(rendered.tree, "onboarding.next");
    await fillValidProfile(rendered.tree);
    await press(rendered.tree, "onboarding.next");
    mockCalls.length = 0;
    return rendered;
  }

  it("兴趣不足 3 个就挡下来", async () => {
    const { tree } = await toInterestsStep();

    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errInterests")).toBe(true);
    tree.unmount();
  });

  it("兴趣够 3 个时 PUT /users/me/interests，并前进到语言", async () => {
    const { tree } = await toInterestsStep();

    await pressChip(tree, "音乐");
    await pressChip(tree, "电影");
    await pressChip(tree, "旅行");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]?.path).toBe("/users/me/interests");
    expect(mockCalls[0]?.options.method).toBe("PUT");
    expect(mockCalls[0]?.options.body).toEqual({ slugs: ["music", "film", "travel"] });
    expect(hasText(tree, "onboarding.stepLanguages")).toBe(true);
    tree.unmount();
  });

  async function toLanguagesStep() {
    const rendered = await toInterestsStep();
    await pressChip(rendered.tree, "音乐");
    await pressChip(rendered.tree, "电影");
    await pressChip(rendered.tree, "旅行");
    await press(rendered.tree, "onboarding.next");
    mockCalls.length = 0;
    return rendered;
  }

  it("没选母语就挡下来", async () => {
    const { tree } = await toLanguagesStep();

    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errNative")).toBe(true);
    tree.unmount();
  });

  it("选了母语但没选正在学的语言，也挡下来", async () => {
    const { tree } = await toLanguagesStep();

    await pressChip(tree, "中文");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errLearning")).toBe(true);
    tree.unmount();
  });

  it("母语 + 学习语言齐了，PUT /users/me/languages 的载荷是 NATIVE/LEARNING 两段", async () => {
    const { tree } = await toLanguagesStep();

    await pressChip(tree, "中文");
    /* index 1：学习语言那一列（母语列里的 English 是第 0 个）。 */
    await pressChip(tree, "English", 1);
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]?.path).toBe("/users/me/languages");
    expect(mockCalls[0]?.options.method).toBe("PUT");
    expect(mockCalls[0]?.options.body).toEqual({
      items: [
        { code: "zh", type: "NATIVE", level: "NATIVE" },
        { code: "en", type: "LEARNING", level: "INTERMEDIATE" },
      ],
    });
    expect(hasText(tree, "onboarding.stepPurposes")).toBe(true);
    tree.unmount();
  });

  async function toPurposesStep() {
    const rendered = await toLanguagesStep();
    await pressChip(rendered.tree, "中文");
    /* index 1：学习语言那一列（母语列里的 English 是第 0 个）。 */
    await pressChip(rendered.tree, "English", 1);
    await press(rendered.tree, "onboarding.next");
    mockCalls.length = 0;
    return rendered;
  }

  it("目的一个都没选就挡下来", async () => {
    const { tree } = await toPurposesStep();

    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(0);
    expect(hasText(tree, "onboarding.errPurposes")).toBe(true);
    tree.unmount();
  });

  it("选了目的就 PUT /users/me/purposes", async () => {
    const { tree } = await toPurposesStep();

    await pressChip(tree, "交朋友");
    await press(tree, "onboarding.next");

    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]?.path).toBe("/users/me/purposes");
    expect(mockCalls[0]?.options.body).toEqual({ slugs: ["friends"] });
    expect(hasText(tree, "onboarding.stepCountries")).toBe(true);
    tree.unmount();
  });

  it("「想认识谁」一个都不选是合法的（= 全球），会 PUT 空数组", async () => {
    const { tree } = await toPurposesStep();
    await pressChip(tree, "交朋友");
    await press(tree, "onboarding.next");
    mockCalls.length = 0;

    await press(tree, "onboarding.next");

    /* 通过这一步会落到第 7 步，那里 SocialScreen 自己再读三个接口 ——
       所以这里只挑 PUT 看，不把「总调用数」写死。 */
    const puts = mockCalls.filter((call) => call.options.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.path).toBe("/users/me/preferred-countries");
    expect(puts[0]?.options.body).toEqual({ codes: [] });
    expect(hasText(tree, "onboarding.stepSocial")).toBe(true);
    tree.unmount();
  });
});

describe("引导流程 · 收尾", () => {
  it("社交账号那一步的「下一步」不写服务端，推到完成页", async () => {
    const { tree } = await renderOnboarding();
    /* 直接把 7 步走完：每一跳都只关心「能过去」，契约已在上面各段逐一验过。 */
    await press(tree, "onboarding.next");
    await fillValidProfile(tree);
    await press(tree, "onboarding.next");
    await pressChip(tree, "音乐");
    await pressChip(tree, "电影");
    await pressChip(tree, "旅行");
    await press(tree, "onboarding.next");
    await pressChip(tree, "中文");
    await pressChip(tree, "English", 1);
    await press(tree, "onboarding.next");
    await pressChip(tree, "交朋友");
    await press(tree, "onboarding.next");
    await press(tree, "onboarding.next");

    expect(hasText(tree, "onboarding.stepSocial")).toBe(true);
    mockCalls.length = 0;
    await press(tree, "onboarding.next");

    expect(mockCalls.filter((call) => call.options.method !== undefined)).toHaveLength(0);
    expect(hasText(tree, "onboarding.doneTitle")).toBe(true);
    tree.unmount();
  });
});
