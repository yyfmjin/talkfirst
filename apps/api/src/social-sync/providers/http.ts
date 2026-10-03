import { SocialProviderError } from "../external-post";

/**
 * The one place an adapter talks to the network.
 *
 * ## Why every provider call goes through here
 *
 * Four things have to be true of every outbound call, and five adapters hand-rolling
 * `fetch` would get at least one of them wrong:
 *
 *  1. **A timeout.** A provider that accepts the connection and never answers would hold a
 *     request handler open indefinitely. `AbortSignal.timeout` bounds it.
 *  2. **A status-to-code mapping.** A 401, a 403, a 429 and a 500 mean four different things
 *     to the caller — re-authorize, no permission, back off, retry — and they arrive as
 *     bare numbers otherwise.
 *  3. **Provider detail kept out of `message`.** Provider error bodies name endpoints,
 *     tokens and internal ids. They are recorded in `detail` for the server log and never in
 *     the message a client could receive.
 *  4. **No `User-Agent` omission.** Some providers reject a request with no UA; the default
 *     Node agent sends none.
 *
 * ## Why `fetch` and not a client library
 *
 * Node 22 has a complete fetch implementation with `AbortSignal` support, and this API
 * already uses it for the Google token exchange. Adding an HTTP client would be a dependency
 * for capabilities that are already present.
 */

const TIMEOUT_MS = 15_000;

/** Identifies the integration honestly; some providers require a contactable UA. */
const USER_AGENT = "TalkFirst-SocialSync/1.0 (+https://talkfirst.ccwu.cc)";

export type HttpRequest = {
  method?: "GET" | "POST";
  /** Form-encoded body, as OAuth token endpoints expect. */
  form?: Record<string, string>;
  /** JSON body, as most REST APIs expect. */
  json?: unknown;
  headers?: Record<string, string>;
  /** Appended as a query string; values are `encodeURIComponent`-ed. */
  query?: Record<string, string | number | undefined>;
  /** Overrides the default timeout for a slow endpoint. */
  timeoutMs?: number;
};

function buildUrl(url: string, query: HttpRequest["query"]): string {
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  if (!suffix) return url;
  return url.includes("?") ? `${url}&${suffix}` : `${url}?${suffix}`;
}

/**
 * Maps an HTTP status onto a provider-neutral code.
 *
 * `401` and `403` are separated because they lead to different actions: a 401 means the
 * token is no longer accepted (refresh, or re-authorize), while a 403 means the token is
 * valid but the grant or the API does not allow this call — refreshing will not help, and
 * telling a member to reconnect would send them in a circle. YouTube returns 403 for
 * "YouTube Data API not enabled", which is precisely a case where re-authorizing cannot
 * succeed.
 */
function codeForStatus(status: number): ConstructorParameters<typeof SocialProviderError>[0] {
  if (status === 401) return "SOCIAL_TOKEN_EXPIRED";
  if (status === 403) return "SOCIAL_PERMISSION_DENIED";
  if (status === 429) return "SOCIAL_RATE_LIMITED";
  return "SOCIAL_PROVIDER_ERROR";
}

/** Trims a body for logging: long HTML error pages are noise, not signal. */
function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Performs a request and returns the parsed JSON body.
 *
 * Throws `SocialProviderError` for every non-2xx response and for a transport failure, so
 * an adapter never has to check a status itself.
 */
export async function providerRequest<T>(url: string, request: HttpRequest = {}): Promise<T> {
  const method = request.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...request.headers,
  };

  let body: string | undefined;
  if (request.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(request.form).toString();
  } else if (request.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.json);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(url, request.query), {
      method,
      headers,
      body,
      // Not `redirect: "follow"`: a token endpoint that answers with a redirect is a
      // misconfiguration, and following it would send the client secret to wherever it
      // points.
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    throw new SocialProviderError(
      "SOCIAL_PROVIDER_ERROR",
      isTimeout ? "The provider did not respond in time" : "Could not reach the provider",
      error instanceof Error ? error.message : undefined,
    );
  }

  const raw = await response.text().catch(() => "");

  if (!response.ok) {
    throw new SocialProviderError(
      codeForStatus(response.status),
      `The provider refused the request (HTTP ${response.status})`,
      truncate(raw),
    );
  }

  if (!raw) return {} as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // A 200 with a non-JSON body: an HTML error page from a misconfigured proxy, say.
    throw new SocialProviderError(
      "SOCIAL_PROVIDER_ERROR",
      "The provider returned a response that is not JSON",
      truncate(raw),
    );
  }
}
