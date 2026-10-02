import {
  API_GLOBAL_PREFIX,
  emailVerificationEnforced,
  isEmailVerificationAllowedPath,
  normalizeApiPath,
} from "./email-verification.policy";

/**
 * SEC-005 — the two decisions the enforcement flag drives:
 *   1. is verification required at all (`emailVerificationEnforced`)?
 *   2. which routes may an unverified account still reach (the allow-list)?
 *
 * The allow-list is deny-by-default, so the failure mode that matters is a
 * business route accidentally reading as "allowed".
 */
describe("emailVerificationEnforced", () => {
  it("仅当 ENFORCE_EMAIL_VERIFICATION 严格等于 \"true\" 时开启", () => {
    expect(emailVerificationEnforced({ ENFORCE_EMAIL_VERIFICATION: "true" })).toBe(true);
    expect(emailVerificationEnforced({ ENFORCE_EMAIL_VERIFICATION: "1" })).toBe(false);
    expect(emailVerificationEnforced({ ENFORCE_EMAIL_VERIFICATION: "TRUE" })).toBe(false);
    expect(emailVerificationEnforced({})).toBe(false);
  });
});

describe("normalizeApiPath", () => {
  it("剥掉全局前缀、查询串与尾斜杠", () => {
    expect(normalizeApiPath(`${API_GLOBAL_PREFIX}/auth/me`)).toBe("/auth/me");
    expect(normalizeApiPath(`${API_GLOBAL_PREFIX}/auth/me?x=1`)).toBe("/auth/me");
    expect(normalizeApiPath(`${API_GLOBAL_PREFIX}/users/me/`)).toBe("/users/me");
  });

  it("对已剥离前缀的路径保持不变", () => {
    expect(normalizeApiPath("/auth/me")).toBe("/auth/me");
  });

  it("对空值返回 undefined", () => {
    expect(normalizeApiPath(undefined)).toBeUndefined();
    expect(normalizeApiPath("")).toBeUndefined();
  });
});

describe("isEmailVerificationAllowedPath（白名单）", () => {
  it("放行验证流程所需的精确路由", () => {
    for (const path of [
      "/auth/me",
      "/auth/refresh",
      "/auth/logout",
      "/auth/send-verification-code",
      "/auth/verify-email",
      "/users/me",
    ]) {
      expect(isEmailVerificationAllowedPath(`${API_GLOBAL_PREFIX}${path}`)).toBe(true);
      expect(isEmailVerificationAllowedPath(path)).toBe(true);
    }
  });

  it("拦截全部业务路由", () => {
    for (const path of [
      "/discover",
      "/messages",
      "/moments",
      "/connections",
      "/exchange",
      "/blocks",
      "/notifications",
      "/meta",
      "/auth/password",
    ]) {
      expect(isEmailVerificationAllowedPath(`${API_GLOBAL_PREFIX}${path}`)).toBe(false);
    }
  });

  it("只放行 /users/me，其余 /users/me/* 全部拦截", () => {
    expect(isEmailVerificationAllowedPath("/api/v1/users/me")).toBe(true);
    expect(isEmailVerificationAllowedPath("/api/v1/users/me/attributes")).toBe(false);
    expect(isEmailVerificationAllowedPath("/api/v1/users/me/avatar")).toBe(false);
    expect(isEmailVerificationAllowedPath("/api/v1/users/me/languages")).toBe(false);
    expect(isEmailVerificationAllowedPath("/api/v1/users/me/social-accounts")).toBe(false);
    expect(isEmailVerificationAllowedPath("/api/v1/users/user-1")).toBe(false);
  });

  it("没有路径上下文（后台任务）时不放行", () => {
    expect(isEmailVerificationAllowedPath(undefined)).toBe(false);
  });
});
