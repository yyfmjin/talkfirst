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
 *
 * ## 2026-10-28：为什么结果里要带 `channel` 和 `detail`
 *
 * 运维方反馈「检查更新总是失败，让检查网络」。实测服务端：不带
 * `expo-channel-name` 的请求被 `u.expo.dev` 以 **400** 拒掉（`"channel-name":
 * Required`），而客户端把任何异常都显示成「请检查网络」—— 于是一个**配置问题**
 * 被说成了网络问题，用户反复重试、我们反复排查网络。
 *
 * 现在两件事分开说：渠道为空就是「这个包不能自更新」，和网络无关；真的抛错时
 * 把原始报错带回界面。`channel` 只在弹窗里用，不影响结果分支。
 */

export type UpdateCheckStatus =
  /** 安装包不支持热更新（没带渠道，或本次是开发构建）。 */
  | "unsupported"
  /** 已经是最新。 */
  | "latest"
  /** 新版本已下载，等重启生效。 */
  | "ready"
  /** 检查或下载失败（网络、服务端）。 */
  | "failed";

export type UpdateCheckResult = {
  status: UpdateCheckStatus;
  /**
   * 安装包里烧进去的更新渠道。`null` = 这个包没带渠道：服务端对不带
   * `expo-channel-name` 的请求一律 400，重试多少次都一样，只能重新装包。
   */
  channel: string | null;
  /** 失败时的原始报错（断网、服务端 4xx/5xx 的原文），用来把话说准。 */
  detail?: string;
};

export type UpdateCheckDeps = {
  isEnabled: () => boolean;
  /** 安装包里烧进去的渠道；读不到时返回 null。 */
  channel: () => string | null;
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
    channel: () => updates.channel ?? null,
    checkForUpdate: () => updates.checkForUpdateAsync(),
    fetchUpdate: () => updates.fetchUpdateAsync(),
    reload: () => updates.reloadAsync(),
  };
}

/** 渠道读不到（老包、或 `isEnabled=false`）不应该让「检查更新」整个崩掉。 */
function safeChannel(deps: UpdateCheckDeps): string | null {
  try {
    return deps.channel() || null;
  } catch {
    return null;
  }
}

/** 检查 →（有的话）下载。**不**重启，交给用户决定什么时候。 */
export async function checkForUpdate(
  deps: UpdateCheckDeps = defaultUpdateDeps(),
): Promise<UpdateCheckResult> {
  const channel = safeChannel(deps);
  if (!deps.isEnabled() || !channel) return { status: "unsupported", channel };
  try {
    const result = await deps.checkForUpdate();
    if (!result.isAvailable) return { status: "latest", channel };
    await deps.fetchUpdate();
    return { status: "ready", channel };
  } catch (error) {
    return {
      status: "failed",
      channel,
      detail: error instanceof Error ? error.message : String(error),
    };
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
