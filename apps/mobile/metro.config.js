// Metro config for running Expo inside the TalkFirst npm workspace monorepo.
// Node modules are hoisted to the workspace root, so Metro must watch the
// workspace root and resolve modules from both locations.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

/**
 * 2026-10-07 —— 把 `react-native` 钉死在本 app 自己那一份。
 *
 * ## 为什么需要
 *
 * 这个仓库里有**两份 react-native**：本 app 声明的 0.76.7（SDK 52 配套），
 * 以及 npm 在根级自动安装的 0.87.1 —— 后者是那些 expo 包对 `expo` 的宽泛 peer
 * 范围招来的（它们按 peer 依赖抓了最新版 expo，于是顺带抓了它那一代的 RN）。
 *
 * 后果极其难查：**提升到根级的 expo 包 import 到的是 0.87 的 react-native 源码**，
 * 而做 Flow 转译的是本 app 那份 0.76 的 `@react-native/babel-preset` ——
 * 两边对不上，`expo export` / `eas build` 直接挂在一句
 * `EventEmitter.js: ':' or '?' expected in property type annotation`，
 * 看起来像 RN 自己的语法错误，其实是版本错配。
 *
 * 依赖树那边短期修不干净（npm 不重解已有的锁文件；删锁重装会把整棵树重新摇一遍，
 * 那是另一件事的风险），所以在这里做**只影响本 app 打包**的一处定向解析：
 * 无论谁来 import `react-native`，都拿到本 app 的那一份。
 *
 * ## 什么时候可以删掉
 *
 * 根级不再有第二份 react-native 时（`npm ls react-native` 只剩一条），
 * 就可以删掉这段 —— 它是补丁，不是设计。
 */
const reactNativeRoot = path.dirname(
  require.resolve("react-native/package.json", { paths: [projectRoot] }),
);
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "react-native": reactNativeRoot,
};

module.exports = config;
