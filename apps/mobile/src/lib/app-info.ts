import Constants from "expo-constants";

/**
 * 安装包自身的版本信息（2026-10-28）。
 *
 * ## 为什么要单独一个文件
 *
 * 「检查更新」出问题时，第一件要问的事是「你现在装的是哪一版」。这句话以前
 * 界面上根本看不到 —— 用户只能说「更新失败」，我们只能猜。版本号一旦显示出来，
 * 复现路径就变成一句话：`0.1.10 (10)` 还是 `0.1.9 (9)`，差一个数字就是两条链路。
 *
 * ## 为什么用 expo-constants 而不是 expo-updates
 *
 * `expo-updates` 有原生副作用（见 `update-check.ts` 文件头），不能在渲染路径上直接
 * import；而 `expo-constants` 是 `expo` 包自己的依赖，安装包里本来就有，读的又是
 * 构建期写死的常量，不碰原生模块 —— 所以这个文件可以被任何界面安全调用。
 *
 * `version` 与 `versionCode` 都来自 `app.json`（`version` / `android.versionCode`），
 * 构建时被 Expo 内联进 manifest，OTA 之后也不会变 —— 这正是我们要的「安装包身份」。
 */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0";
}

/** Android versionCode；取不到就返回 null（例如在 Expo Go / Web 里跑）。 */
export function appBuildNumber(): string | null {
  const android = (Constants.expoConfig as { android?: { versionCode?: number } } | null)?.android;
  return typeof android?.versionCode === "number" ? String(android.versionCode) : null;
}

/** `0.1.10 (10)` —— 版本号带构建号，运维和用户看的是同一个字符串。 */
export function formatAppVersion(): string {
  const build = appBuildNumber();
  return build ? `${appVersion()} (${build})` : appVersion();
}
