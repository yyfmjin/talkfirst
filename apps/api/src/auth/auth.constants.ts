import { ExtractJwt } from "passport-jwt";
import { Request } from "express";

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

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

export function accessCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  };
}

export function clearCookieOptions() {
  return { ...refreshCookieOptions(), maxAge: undefined, expires: new Date(0) };
}
