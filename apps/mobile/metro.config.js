// Metro config for running Expo inside the TalkFirst npm workspace monorepo.
// Node modules are hoisted to the workspace root, so Metro must watch the
// workspace root and resolve modules from both locations.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

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
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
