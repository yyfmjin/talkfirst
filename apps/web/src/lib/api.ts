export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, string[]>;
};

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  retry?: boolean;
};

let refreshPromise: Promise<boolean> | null = null;

/**
 * Fired when a request comes back 401 *after* the one refresh retry, which is
 * the only honest definition of "the session is gone".
 *
 * This is the one place that knows it, and `SessionProvider` is the one place
 * that reacts — otherwise every protected page would have to repeat the same
 * "if (error.message.includes("Unauthorized")) router.replace("/login")" and
 * the pages that forgot it would keep offering a 重试 button that can never
 * succeed. Exported so the listener and the dispatcher cannot drift apart.
 */
export const UNAUTHORIZED_EVENT = "tf:unauthorized";

/**
 * Single-flight access-token refresh.
 *
 * Exported because the chat socket needs the same guarantee: concurrent
 * callers (several HTTP requests, or a socket retry) must share one refresh
 * instead of each rotating the refresh token on its own.
 */
export async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function doFetch<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: "include",
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const envelope = payload as { success?: boolean; data?: T; error?: ApiError } | null;

  if ((!response.ok || !envelope?.success) && response.status === 401 && options.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return doFetch<T>(path, { ...options, retry: false });
    }
  }

  /*
   * A 401 that survived the refresh retry (or arrived on the retry itself) ends
   * the session. Broadcasting it here keeps that decision out of ~10 pages: the
   * pages only know they got an error, this layer knows the refresh token is
   * dead too. The SSR guard is required because client components are also
   * rendered on the server, where `window` does not exist.
   */
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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

/**
 * Which ways the signed-in member can enter their account.
 *
 * `hasPassword: false` means the account was created through Google sign-in and
 * has no password at all. That distinction is not cosmetic: `POST /auth/password`
 * asks for the CURRENT password only when one exists, so a screen that always
 * demands it makes setting a first password impossible — which is exactly the dead
 * end this endpoint exists to remove.
 *
 * Never carries a credential — booleans and provider names only.
 */
export type AuthMethods = {
  hasPassword: boolean;
  providers: string[];
};

export async function fetchAuthMethods(): Promise<AuthMethods> {
  return doFetch<AuthMethods>("/auth/oauth/me/methods", {});
}
