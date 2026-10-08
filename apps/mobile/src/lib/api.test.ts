import { ApiRequestError, apiFetch, apiFetchEnvelope } from "./api";

/*
 * 登录/注册/刷新这三个接口把 token 放在响应信封的**顶层**，而 `apiFetch` 只返回 `data`。
 * 2026-10-08 的事故就是 `signIn` 用 `apiFetch` 去取信封：拿到的其实是用户对象，
 * `session.accessToken` 是 `undefined`，写 SecureStore 时抛错 —— 用户看到"登录失败"
 * 并停在登录页，而服务端那次登录其实返回了 200。
 *
 * 这组测试锁住的就是这条分界：**要 data 用 `apiFetch`，要信封用 `apiFetchEnvelope`。**
 */

// 真机上 token 存在 SecureStore；测试里把它换成一个可断言的假实现。
jest.mock("./storage", () => ({
  saveTokens: jest.fn(async () => undefined),
  clearTokens: jest.fn(async () => undefined),
  getAccessToken: jest.fn(async () => null),
  getRefreshToken: jest.fn(async () => null),
}));

/** 服务端 `POST /auth/login` 的真实形状（见 apps/api/src/auth/auth.controller.ts）。 */
const loginEnvelope = {
  success: true,
  data: { id: "u1", email: "a@b.c" },
  accessToken: "ACCESS-TOKEN",
  refreshToken: "REFRESH-TOKEN",
};

function stubFetch(payload: unknown, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

beforeAll(() => {
  // 基址在发请求时才解析（config.ts 有意如此）；测试里给一个固定的即可。
  process.env.EXPO_PUBLIC_API_BASE_URL = "https://api.example.test/api/v1";
});

describe("响应信封的处理", () => {
  it("apiFetch 只返回 data —— token 会在这一层被丢掉（这就是事故机制）", async () => {
    stubFetch(loginEnvelope);

    const result = await apiFetch<{ id: string }>("/auth/login", { method: "POST", body: {} });

    expect(result).toEqual({ id: "u1", email: "a@b.c" });
    expect((result as { accessToken?: string }).accessToken).toBeUndefined();
  });

  it("apiFetchEnvelope 保留顶层 token，并给出用户对象（修复点）", async () => {
    stubFetch(loginEnvelope);

    const session = await apiFetchEnvelope("/auth/login", { method: "POST", body: {} });

    expect(session.accessToken).toBe("ACCESS-TOKEN");
    expect(session.refreshToken).toBe("REFRESH-TOKEN");
    expect(session.data).toEqual({ id: "u1", email: "a@b.c" });
  });

  it("信封里缺 token 时当场报错，而不是把 undefined 交给存储层", async () => {
    stubFetch({ success: true, data: { id: "u1" } });

    await expect(
      apiFetchEnvelope("/auth/login", { method: "POST", body: {} }),
    ).rejects.toThrow(ApiRequestError);
  });

  it("服务端返回错误信封时抛出带 code 的错误（错误码要能被界面识别）", async () => {
    stubFetch(
      {
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Email, username or password is incorrect" },
      },
      401,
    );

    await expect(
      apiFetchEnvelope("/auth/login", { method: "POST", body: {} }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});
