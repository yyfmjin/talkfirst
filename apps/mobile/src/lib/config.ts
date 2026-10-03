import { Platform } from "react-native";

/**
 * API base URL for the mobile app.
 *
 * `10.0.2.2` is a QEMU alias that ONLY exists inside the Android emulator: on a
 * physical device (Expo Go) and on the iOS simulator it resolves to nothing, so
 * the previous unconditional
 *   `process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:4000/api/v1"`
 * silently sent every request into a black hole (requests hang, the UI spins
 * forever, and the error the user finally sees has nothing to do with the real
 * cause). EXPO_PUBLIC_API_BASE_URL was also declared in no env file in this
 * repo, so the fallback was the only branch that ever ran.
 *
 * The fallback is therefore now applied ONLY where it is provably correct
 * (`__DEV__` + Android). Everywhere else a missing variable fails loud and
 * early, with instructions, instead of turning into a mysterious network error.
 * See `apps/mobile/.env.example` and `ASSETS-REQUIRED.md` for the LAN setup.
 */

const EMULATOR_API_BASE_URL = "http://10.0.2.2:4000/api/v1";

/**
 * How long a single request may stay open before we abort it. Without this, a
 * device that cannot reach the API (the exact failure mode above) leaves the
 * request open forever: `fetch` never rejects, so callers never leave their
 * loading state and the user stares at a spinner with no explanation.
 */
export const API_REQUEST_TIMEOUT_MS = 15_000;

/** The configured base URL, or `null` when we have to fall back to guesses. */
function readConfiguredApiBaseUrl(): string | null {
  // Expo inlines `EXPO_PUBLIC_*` as a string literal at bundle time, but in Node
  // (jest / scripts) `process` may be missing entirely, so guard the global.
  const fromEnv =
    typeof process === "undefined" ? undefined : process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof fromEnv !== "string") return null;
  const trimmed = fromEnv.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the base URL, or throw something a developer can act on.
 *
 * Throws rather than returning a placeholder because a placeholder produces
 * exactly the defect this function exists to remove: a request that fails
 * somewhere deep in the network stack with a message that points at the wrong
 * thing. Being loud at the point of configuration points at the right thing.
 */
function resolveApiBaseUrl(): string {
  const configured = readConfiguredApiBaseUrl();
  if (configured) return configured;

  if (__DEV__ && Platform.OS === "android") {
    // The one case where the hard-coded alias can actually work.
    return EMULATOR_API_BASE_URL;
  }

  throw new Error(
    `API 地址未配置。请设置环境变量 EXPO_PUBLIC_API_BASE_URL，例如 ` +
      `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:4000/api/v1，然后重启 Metro（npm run start -w @talkfirst/mobile）。` +
      ` 手机与开发机必须处于同一局域网，且用开发机的局域网 IP，不能用 localhost。` +
      ` （当前平台：${Platform.OS}；10.0.2.2 只在 Android 模拟器内可用。）`,
  );
}

/**
 * Whether EXPO_PUBLIC_API_BASE_URL supplied the value. Callers that want to show
 * a setup hint (instead of a generic "cannot reach server") can check this; it
 * is deliberately a plain boolean so reading it never throws.
 */
export const isApiBaseUrlConfigured: boolean = readConfiguredApiBaseUrl() !== null;

/**
 * The API base URL. Throws when the environment variable is missing outside the
 * Android emulator, so the failure is immediate and names its own fix.
 */
export const API_BASE_URL: string = resolveApiBaseUrl();

if (__DEV__ && !isApiBaseUrlConfigured) {
  console.warn(
    "[config] EXPO_PUBLIC_API_BASE_URL 未设置，正在使用 Android 模拟器默认地址 " +
      `${EMULATOR_API_BASE_URL}。iOS 模拟器与真机请按 .env.example 设置局域网地址。`,
  );
}
