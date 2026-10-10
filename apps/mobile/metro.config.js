// Metro config for running Expo inside the TalkFirst npm workspace monorepo.
// Node modules are hoisted to the workspace root, so Metro must watch the
// workspace root and resolve modules from both locations.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const appNodeModules = path.resolve(projectRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

/*
 * **追加**而不是赋值：`getDefaultConfig()` 已经放进了它自己那套 watchFolders
 * （项目目录等），直接赋值会把它们丢掉 —— `expo-doctor` 报的
 * “watchFolders does not contain all entries from Expo's defaults” 就是这一条。
 * 丢掉不一定会立刻报错，而是变成「某些路径不被监听」：改了不生效、或资源解析不到，
 * 属于最难查的一类问题。
 */
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  appNodeModules,
  path.resolve(workspaceRoot, "node_modules"),
];

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * **React 必须钉死一份**（2026-10-09 的空白/崩溃事故，根因就在下面）
 *
 * 这个仓库同时装着两份 React：
 *   - 移动端：`apps/mobile/node_modules/react`   = 18.3.1（Expo SDK 52 要的）
 *   - 仓库根：`node_modules/react`               = 19.3.0（网页端 Next 用的）
 *
 * 而 Metro 默认会**从"发起 require 的那个包"的位置往上找**。像 `@expo/vector-icons`
 * 这种被 hoist 到仓库根的包，它 `require("react")` 时就从根目录往上找 —— 拿到 **19**；
 * 而 App 自己的代码拿到 18。一个 bundle 里两份 React，症状是五花八门的运行时怪错：
 *
 *   - `TypeError: Cannot read property 'useState' of null`  ← react 解析成了 null
 *   - `Ionicons` 是 `undefined` → `Element type is invalid` / 读 `.font` 抛错
 *
 * 解决就是两件事：
 *   1. `disableHierarchicalLookup`：禁止"从包自己的位置往上找"，只认上面列出的
 *      `nodeModulesPaths`（先项目、后仓库根）—— 让所有包都从同一个地方解析依赖；
 *   2. `extraNodeModules` 把 react / scheduler 明确指向移动端那一份（兜底，防止将来
 *      再被别的布局变化绕过）。
 *
 * 备注：测试侧（`jest.config.js`）早就为同一个问题做了 `moduleNameMapper`，两处要对齐。
 * ─────────────────────────────────────────────────────────────────────────────
 */
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.resolve(appNodeModules, "react"),
  scheduler: path.resolve(appNodeModules, "scheduler"),
};

module.exports = config;
