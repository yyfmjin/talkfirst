import { ExtractJwt } from "passport-jwt";
import { Request } from "express";
import { isProductionDeployment } from "../common/security-config";

export const JWT_ACCESS_SECRET = "JWT_SECRET";
export const JWT_REFRESH_SECRET = "JWT_REFRESH_SECRET";

export const ACCESS_COOKIE = "tf_access";
export const REFRESH_COOKIE = "tf_refresh";

export const jwtFromRequest = ExtractJwt.fromExtractors([
  (request: Request) => request?.cookies?.[ACCESS_COOKIE] ?? null,
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]);

export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * 改密码的邮箱验证码用途（2026-11-11）。
 *
 * `VerificationCode.purpose` 是冷却与每小时上限的计数维度，不同用途各算各的，所以
 * 它必须是一个独立值，不能复用 `REGISTER`：否则注册时发过的那条码会占掉改密码的
 * 额度，反过来也说不通。
 *
 * 写入方（`AuthService.sendPasswordChangeCode`）与校验方
 * （`AuthService.changePassword`）共用这个常量 —— 两边字符串对不上，码就永远校验不过。
 */
export const PASSWORD_CHANGE_CODE_PURPOSE = "PASSWORD_CHANGE";

/**
 * `secure` used to be `process.env.NODE_ENV === "production"`, which silently
 * shipped session cookies over plain HTTP in any deployment that forgot to set
 * the variable (FIX, audit P007). It is now driven by the same
 * `isProductionDeployment()` decision that gates the JWT-secret assertion, so
 * "the process booted with real secrets" and "the cookies are `Secure`" can no
 * longer disagree. Local development still gets plain-HTTP cookies, because
 * `NODE_ENV=development` is an explicit opt-in.
 */
function cookieSecure(): boolean {
  return isProductionDeployment();
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/api/v1/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

export function accessCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  };
}

export function clearCookieOptions() {
  return { ...refreshCookieOptions(), maxAge: undefined, expires: new Date(0) };
}
