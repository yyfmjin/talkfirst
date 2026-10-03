import { API_BASE_URL, API_REQUEST_TIMEOUT_MS } from "./config";
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
    super("请求超时。");
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
        const response = await fetchWithTimeout(`${API_BASE_URL}/auth/refresh`, {
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

async function doFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
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

  const envelope = payload as { success?: boolean; data?: T; error?: ApiErrorBody } | null;

  if ((!response.ok || !envelope?.success) && response.status === 401 && options.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return doFetch<T>(path, { ...options, retry: false });
    }
  }

  if (!response.ok || !envelope?.success) {
    throw new ApiRequestError(
      envelope?.error ?? {
        code: "NETWORK_ERROR",
        message: "无法连接服务器，请检查网络后重试。",
      },
    );
  }

  return envelope.data as T;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return doFetch<T>(path, options);
}
