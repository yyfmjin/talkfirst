import { Platform } from "react-native";

/**
 * API 基址的解析（移动端）。
 *
 * ## 这个文件踩过两次坑，两条教训都留在这里
 *
 * **① 静默兜底**（早先的版本）：
 *   `process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:4000/api/v1"`
 * `10.0.2.2` 是只在 Android 模拟器里成立的 QEMU 别名；真机上它解析不到任何东西，
 * 每个请求都发进黑洞（不报错、一直转圈，用户看到的错误和真正的原因毫无关系）。
 *
 * **② 模块加载期抛错**（2026-10-08 的白屏事故）：
 * 随后改成"拿不到地址就 `throw`，让失败又响又早"。这个想法在开发机上是对的，
 * 但在**发布版**里是灾难：`API_BASE_URL` 是模块级常量，`api.ts` 在模块级 import 它，
 * 于是 Expo 打包出来的 bundle 在**任何界面渲染之前**就抛异常 —— 用户看到的是
 * 一片空白，没有任何提示，也没法自证原因。第一次 EAS 出包（预览版）就正好是这种
 * 组合：`eas.json` 里没有注入环境变量 + 发布版 `__DEV__ === false` → 白屏。
 *
 * ## 现在的规则
 *
 * 1. **绝不抛错。** 解析函数是纯的、惰性的（`apiBaseUrl()`），调用点在真正发请求的
 *    地方 —— 就算地址真的配错，用户看到的也是"无法连接服务器"这种能读懂的错误，
 *    而不是白屏。
 * 2. **发布版必须能用。** 没有注入环境变量时落到生产地址（`PRODUCTION_API_BASE_URL`），
 *    而不是落在模拟器别名上，也不停下来等配置。
 * 3. **要在真机上连开发机时**，仍然用 `EXPO_PUBLIC_API_BASE_URL` 覆盖；环境变量永远优先。
 *
 * 环境变量的优先级与来源见 `apps/mobile/.env.example`；EAS 构建的注入写在 `eas.json`
 * 的每个 profile 里（显式写出来，不依赖"打的人记得配"）。
 */

const EMULATOR_API_BASE_URL = "http://10.0.2.2:4000/api/v1";

/**
 * 生产基址：走域名的那个地址（Cloudflare → nginx → api 进程）。
 *
 * 用域名而不是源站 IP：源站只放行 Cloudflare（见 `docs/OPS-ORIGIN-LOCKDOWN.md`），
 * 直连 IP 会被 403 —— App 也就不该知道那个 IP。
 */
const PRODUCTION_API_BASE_URL = "https://api.talkfirst.ccwu.cc/api/v1";

/**
 * 单个请求允许挂多久。没有它时，连不上 API 的设备会让请求永远悬着：
 * `fetch` 不 reject，调用方永远出不了 loading 态，用户只看到一个转不完的圈。
 */
export const API_REQUEST_TIMEOUT_MS = 15_000;

/** 配置里的基址，没配则 `null`。 */
function readConfiguredApiBaseUrl(): string | null {
  // Expo 会在打包时把 `EXPO_PUBLIC_*` 替换成字面量；但在 Node（jest / 脚本）里
  // `process` 可能整个不存在，所以要挡住这个全局对象。
  const fromEnv =
    typeof process === "undefined" ? undefined : process.env.EXPO_PUBLIC_API_BASE_URL;
  if (typeof fromEnv !== "string") return null;
  const trimmed = fromEnv.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 解析 API 基址。**永不抛错**（原因见文件头）：
 *
 *   环境变量 → Android 模拟器别名（仅 `__DEV__`）→ 生产域名
 */
export function apiBaseUrl(): string {
  const configured = readConfiguredApiBaseUrl();
  if (configured) return configured;

  if (__DEV__ && Platform.OS === "android") {
    // 唯一一个这个别名确实成立的地方。
    return EMULATOR_API_BASE_URL;
  }

  /*
   * 落到生产域名。**这里刻意不 `console.error` 刷屏**：发布版里这是正常路径
   * （就是没注入变量时该发生的事），而不是错误。诊断信息放在开发期那条 warn 里。
   */
  return PRODUCTION_API_BASE_URL;
}

/**
 * 环境变量到底有没有提供地址。有些界面想据此给出"你还没配地址"的提示
 * （而不是笼统的"连不上服务器"），所以留这个只读布尔值 —— 读它不会抛错。
 */
export const isApiBaseUrlConfigured: boolean = readConfiguredApiBaseUrl() !== null;

if (__DEV__ && !isApiBaseUrlConfigured) {
  console.warn(
    "[config] EXPO_PUBLIC_API_BASE_URL 未设置。Android 模拟器会用 " +
      `${EMULATOR_API_BASE_URL}，其余平台会用生产地址 ${PRODUCTION_API_BASE_URL}。` +
      "要在真机上连开发机，请按 .env.example 设置局域网地址。",
  );
}
