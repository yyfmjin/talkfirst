/**
 * `jest-expo` preset 的本地中转（2026-10-08）。
 *
 * ## 为什么需要这一层
 *
 * 这个仓库是 npm workspaces，依赖被拆成两处：
 *
 *   - `jest-expo` → hoist 到**仓库根**的 node_modules
 *   - `react-native` → 留在 `apps/mobile/node_modules`（版本敏感，没被 hoist）
 *
 * 于是 `jest-expo/jest-preset.js` 内部的 `require("react-native/jest-preset")`
 * 会从**仓库根**往上找，扑空（根目录没有 react-native）。普通（非 workspace）工程里
 * 两者本来就是兄弟目录，不会有这个问题。
 *
 * ## 两件事
 *
 * 1. 用 `NODE_PATH` 把 `apps/mobile/node_modules` 补进 Node 的旧式解析路径 ——
 *    它只在**本次测试进程**里生效，不改动任何依赖布局，也不影响真机构建。
 * 2. 用**绝对路径** require 真正那份 preset：`jest-expo` 的 package.json 有
 *    `exports` 映射，写模块名 `"jest-expo"` 或指向它的目录，jest 都解析不到
 *    `jest-preset.js`（报 "should have jest-preset.js at the root"）。
 */
const path = require("node:path");
const Module = require("node:module");

const MOBILE_NODE_MODULES = path.join(__dirname, "..", "..", "node_modules");
process.env.NODE_PATH = [MOBILE_NODE_MODULES, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

function resolveJestExpoPreset() {
  try {
    // 从**移动端**的位置解析，避免命中 exports 映射挡住的路径。
    const packageJson = require.resolve("jest-expo/package.json", { paths: [MOBILE_NODE_MODULES, __dirname] });
    return path.join(path.dirname(packageJson), "jest-preset.js");
  } catch {
    // 回退：本文件在 apps/mobile/jest/preset/，往上四层是仓库根。
    return path.join(__dirname, "..", "..", "..", "..", "node_modules", "jest-expo", "jest-preset.js");
  }
}

module.exports = require(resolveJestExpoPreset());
