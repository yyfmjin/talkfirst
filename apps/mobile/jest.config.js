/**
 * App 端自动化测试配置（2026-10-08）。
 *
 * ## 为什么要加这套东西
 *
 * 这个 app 在 2026-10-08 之前**一个自动化测试都没有**：`npm test` 只是跑一遍
 * `tsc --noEmit`，再打印一句"没有行为测试"。结果同一天连着出了两个只有真机才能
 * 发现的问题 ——
 *
 *   1. 登录响应信封被拆掉，token 变成 `undefined` 写进 SecureStore 直接抛错，
 *      用户看到"登录失败"却停在登录页（服务端日志里是 200）；
 *   2. 主界面某个组件在运行时是 `undefined`，一进 App 就是 React 的
 *      "Element type is invalid ... but got: undefined"。
 *
 * 两个都是**纯行为**问题：类型检查全绿，真机才炸。所以补一套能在本机跑的测试，
 * 让"改完先跑测试"能替代一部分"改完出个包去真机试"。
 *
 * ## 三个只有在这个仓库里才成立的坑
 *
 * **① 有两份 React。** 移动端 `apps/mobile/node_modules/react` = 18.3.1（Expo SDK 52），
 * 仓库根 `node_modules/react` = 19.3.0（网页端 Next 用的）。而 `react-test-renderer`
 * 是 hoist 到根目录的，它按自己的位置 `require("react")` 会拿到 **19** —— 拿 19 的
 * 渲染器去渲染 18 的树是错的（装上时的 ERESOLVE 冲突就是这个）。`moduleNameMapper`
 * 把它显式指回移动端那份。
 *
 * **② preset 只能走本地中转。** `jest-expo` hoist 在仓库根、且带 `exports` 映射，
 * 写模块名或指向它的目录都拿不到 `jest-preset.js`。preset 指向 `./jest/preset`
 * （本地目录，内部用绝对路径转出真身）。
 *
 * **③ 依赖被拆成两处。** `jest-expo` 在仓库根，`react-native` 留在了
 * `apps/mobile/node_modules` —— jest-expo 内部（含它的 setup 文件）按自己的位置
 * 往上找 `react-native/...` 会扑空。`NODE_PATH` 对 jest **无效**（jest 有自己的
 * 解析器），要靠 jest 的 `modulePaths` 把移动端的 node_modules 显式加进搜索路径。
 */
module.exports = {
  preset: "./jest/preset",
  modulePaths: ["<rootDir>/node_modules"],
  moduleNameMapper: {
    "^react$": "<rootDir>/node_modules/react",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
  },
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  clearMocks: true,
};
