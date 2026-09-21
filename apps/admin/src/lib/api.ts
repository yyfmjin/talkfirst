export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export type ApiError = { code: string; message: string };

export class ApiRequestError extends Error {
  readonly code: string;
  constructor(error: ApiError) {
    super(error.message);
    this.code = error.code;
  }
}

let refreshPromise: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
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

async function doFetch<T>(path: string, options: RequestInit & { retry?: boolean } = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: T;
    error?: ApiError;
  } | null;

  if (response.status === 401 && options.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return doFetch<T>(path, { ...options, retry: false });
  }

  if (!response.ok || !payload?.success) {
    throw new ApiRequestError(payload?.error ?? { code: "NETWORK_ERROR", message: "无法连接服务器，请检查网络后重试。" });
  }
  return payload.data as T;
}

export function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return doFetch<T>(path, options);
}

export function apiSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  return doFetch<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
