import type * as ExpoUpdates from "expo-updates";

/**
 * 「检查更新」——在线拉取并应用热更新。
 *
 * ## 为什么要有这个按钮
 *
 * 自动检查（`EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS`）只在**启动时**看一眼，
 * 下载完还要等下**一次**启动才生效。用户改完一版想马上看到，就得杀掉重开。
 * 一个手动入口把这三步（检查 → 下载 → 重启应用）变成一次点击。
 *
 * ## 前提：安装包必须带更新渠道
 *
 * `expo-updates` 把渠道当请求头发（`expo-channel-name`），它只从 manifest 的
 * meta-data 读；本地构建脚本 2026-10-16 之前没写这条，那批包发出去的请求会被
 * 服务端以 400 拒掉。所以这里必须先看 `Updates.isEnabled`：
 * 关着的时候**明确告诉用户「这个包要重新装一次」**，而不是给一句「检查失败」——
 * 后者会让人反复点，真正的解决办法一句话都没说。
 *
 * 依赖以参数注入，便于单测把四条 native 调用按顺序断言（见 `update-check.test.ts`）。
 */

export type UpdateCheckResult =
  /** 安装包不支持热更新（没带渠道，或本次是开发构建）。 */
  | "unsupported"
  /** 已经是最新。 */
  | "latest"
  /** 新版本已下载，等重启生效。 */
  | "ready"
  /** 检查或下载失败（网络、服务端）。 */
  | "failed";

export type UpdateCheckDeps = {
  isEnabled: () => boolean;
  checkForUpdate: () => Promise<{ isAvailable: boolean }>;
  fetchUpdate: () => Promise<unknown>;
  reload: () => Promise<unknown>;
};

/**
 * **延迟加载** expo-updates。
 *
 * 它是原生模块，而这个文件会被 `MeScreen` 在**导入期**就拉进模块图 —— 屏幕冒烟测试
 * 渲染整棵树时会真的去加载它，连带把 `@expo/vector-icons` 的字体初始化搞挂
 * （`loadedNativeFonts.forEach is not a function`，2026-10-16 实测）。
 * 改为用户真的点「检查更新」时才 require：导入期零副作用。
 */
function loadUpdates(): typeof ExpoUpdates {
  return require("expo-updates") as typeof ExpoUpdates;
}

export function defaultUpdateDeps(): UpdateCheckDeps {
  const updates = loadUpdates();
  return {
    isEnabled: () => updates.isEnabled,
    checkForUpdate: () => updates.checkForUpdateAsync(),
    fetchUpdate: () => updates.fetchUpdateAsync(),
    reload: () => updates.reloadAsync(),
  };
}

/** 检查 →（有的话）下载。**不**重启，交给用户决定什么时候。 */
export async function checkForUpdate(
  deps: UpdateCheckDeps = defaultUpdateDeps(),
): Promise<UpdateCheckResult> {
  if (!deps.isEnabled()) return "unsupported";
  try {
    const result = await deps.checkForUpdate();
    if (!result.isAvailable) return "latest";
    await deps.fetchUpdate();
    return "ready";
  } catch {
    return "failed";
  }
}

/** 应用已下载的更新（重启到新 bundle）。 */
export async function applyUpdate(
  deps: UpdateCheckDeps = defaultUpdateDeps(),
): Promise<boolean> {
  try {
    await deps.reload();
    return true;
  } catch {
    return false;
  }
}
