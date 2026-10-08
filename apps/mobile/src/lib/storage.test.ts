import * as SecureStore from "expo-secure-store";
import { clearTokens, saveTokens } from "./storage";

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
}));

describe("会话 token 的存取", () => {
  it("正常写入两个键", async () => {
    await saveTokens("ACCESS", "REFRESH");

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(2);
  });

  it("token 是空串时报错，而不是写进存储", async () => {
    await expect(saveTokens("", "REFRESH")).rejects.toThrow(/non-empty/);
    await expect(saveTokens("ACCESS", "")).rejects.toThrow(/non-empty/);
  });

  it("token 是 undefined 时报错 —— 复现并锁住 2026-10-08 的登录事故", async () => {
    /*
     * 当时 `signIn` 拿到的是被拆掉信封的用户对象，于是传进来的是 `undefined`，
     * SecureStore 抛的是 "Value ... is not a string" —— 报错指向存储层，
     * 完全看不出真正的原因在调用方。现在这里会明确说清楚。
     */
    const undefinedToken = undefined as unknown as string;

    await expect(saveTokens(undefinedToken, "REFRESH")).rejects.toThrow(/non-empty/);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("登出清掉两个键", async () => {
    await clearTokens();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  });
});
