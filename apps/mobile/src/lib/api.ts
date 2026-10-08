import { apiBaseUrl, API_REQUEST_TIMEOUT_MS } from "./config";
import { t } from "./i18n";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./storage";
import type { ApiErrorBody } from "./types";

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(error: ApiErrorBody) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

/** Raised when a request is aborted by our own timeout rather than by the peer. */
class RequestTimeoutError extends Error {
  constructor() {
    super(t("common.timeout"));
    this.name = "RequestTimeoutError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  retry?: boolean;
};

let refreshPromise: Promise<boolean> | null = null;

/**
 * `fetch` with a hard deadline.
 *
 * We use an AbortController instead of `AbortSignal.timeout(...)` on purpose:
 * React Native 0.76's own type declarations
 * (`react-native/Libraries/.../types/modules/globals.d.ts`) describe AbortSignal
 * without the static `timeout` member, so calling it would not type-check under
 * `strict` without a `@ts-ignore`, which this repo forbids. AbortController keeps
 * this portable and type-safe.
 *
 * Without a deadline a request to an unreachable host never settles: the caller
 * stays in its loading state forever and the user sees an endless spinner.
 */
async function fetchWithTimeout(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    // Aborting makes fetch reject with an AbortError. Translate it into a
    // Chinese, user-facing message; otherwise it would surface as the raw
    // English "Aborted" and read like an app crash.
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Single-flight refresh. The refresh token is stored in SecureStore (native
 * apps cannot rely on HttpOnly cookies), sent in the request body, and rotated
 * on success. Concurrent 401s share one refresh instead of each rotating the
 * token on its own.
 */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return false;
      try {
        const response = await fetchWithTimeout(`${apiBaseUrl()}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          accessToken?: string;
          refreshToken?: string;
        };
        if (response.ok && payload.success && payload.accessToken && payload.refreshToken) {
          await saveTokens(payload.accessToken, payload.refreshToken);
          return true;
        }
        await clearTokens();
        return false;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * 接口的响应信封。
 *
 * `data` 是业务数据；**登录类接口把 `accessToken`/`refreshToken` 放在顶层**，
 * 与 `data` 平级 —— 拆信封时会一起丢掉（原生端就靠它们存会话）。
 */
type Envelope<T> = {
  success?: boolean;
  data?: T;
  error?: ApiErrorBody;
  accessToken?: string;
  refreshToken?: string;
};

async function doFetch<T>(
  path: string,
  options: RequestOptions,
  keepEnvelope = false,
): Promise<T | Envelope<T>> {
  /*
   * 基址在**发请求时**才解析（不是模块级常量）：模块级抛错会让整个 bundle 起不来，
   * 用户看到白屏 —— 2026-10-08 的事故就是这么来的，见 `config.ts` 文件头。
   */
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchWithTimeout(`${apiBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const envelope = payload as Envelope<T> | null;

  if ((!response.ok || !envelope?.success) && response.status === 401 && options.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return doFetch<T>(path, { ...options, retry: false }, keepEnvelope);
    }
  }

  if (!response.ok || !envelope?.success) {
    throw new ApiRequestError(
      envelope?.error ?? {
        code: "NETWORK_ERROR",
        // 非 React 代码拿不到 context，所以走模块级 `t()`（见 i18n.ts 的说明）。
        message: t("common.networkError"),
      },
    );
  }

  if (keepEnvelope) return envelope;
  return envelope.data as T;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await doFetch<T>(path, options)) as T;
}

/**
 * 和 `apiFetch` 一样，但**不拆信封**。
 *
 * 登录 / 注册 / 刷新是唯一把 token 放在信封**顶层**的接口
 * （`{ success, data: 用户对象, accessToken, refreshToken }`）。`apiFetch` 只返回 `data`，
 * token 会在这一层被丢掉；而原生端不靠 HttpOnly cookie，token 必须自己存进
 * SecureStore —— 拿不到就等于登录不进去。
 *
 * 2026-10-08 的事故就出在这里：`signIn` 用 `apiFetch` 取信封，拿到的其实是用户对象，
 * `session.accessToken` 是 `undefined`，写 SecureStore 时直接抛错 —— 用户看到「登录失败」
 * 并停在登录页，而服务端日志里那次登录其实返回了 200，/users/me 一个请求都没发。
 */
export async function apiFetchEnvelope<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  return (await doFetch<T>(path, options, true)) as Envelope<T>;
}
