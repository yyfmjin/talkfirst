/**
 * App 下载地址的**唯一真源**。
 *
 * ## 为什么要固定入口，不直接把 EAS 的产物地址写进页面
 *
 * EAS 每次构建产出的地址都带一个新哈希（`…/KsKyxFhB….apk`），所以"把链接写进页面"
 * 意味着**每出一版就要改一次代码**：改漏一次，官网上挂着的就是上一版、甚至是那个
 * 装完打不开的版本。实际情况已经发生过一次。
 *
 * 现在页面只引用 `/download/android` 这个固定入口，由它 302 到最新包：
 *   - 用户可以收藏 / 转发同一个链接，永远拿到最新版；
 *   - 出新版只需要跑 `npm run sync:apk`（改下面这一个常量），不需要动页面。
 *
 * ## 谁改这个文件
 *
 * `scripts/sync-latest-apk.mjs` —— 它问 EAS 要最近一次**成功**的 Android 构建，
 * 把地址写到这里。手改也可以，但要和那个脚本保持同样的格式（它按行匹配）。
 */

/**
 * ⚠️ 2026-10-10：**退回运营方验证过能打开的那一版**
 * （构建 `dbaf6bd2` / 提交 `0c44fc7`）。
 *
 * 为什么退：模拟器验证（`D:\Android`，WHPX 加速）连着抓出两层真因 ——
 *
 *   1. `@expo/vector-icons` 的 `Ionicons` 运行时是 `undefined` → 我在 App 里读 `.font`
 *      抛错 → **打开空白**；
 *   2. 修掉第 1 层后露出第 2 层：`TypeError: Cannot read property 'useState' of null`
 *      —— bundle 里的 **`react` 解析成了 null**。
 *
 * 两层同一个病根：`apps/mobile/metro.config.js` 把两处 node_modules 都列进了解析路径，
 * 而 Metro 默认"从包自己的位置往上找"，于是 hoist 到仓库根的包抓到了**根目录的 React 19.3.0**，
 * App 自己用 18.3.1 —— **一个 bundle 里两份 React**。已用
 * `disableHierarchicalLookup` + `extraNodeModules` 钉死一份，并在本地验证
 * （bundle 里只剩 18.3.x）。
 *
 * 新包出来、且在模拟器里确认能开后，`npm run sync:apk` 会自动把这里换过去。
 *
 * 当前最新 Android 安装包（本机出包，自托管）。空串 = 还没有可下载的包，页面会显示「生成中」。
 */
export const ANDROID_APK_URL =
  "https://talkfirst.ccwu.cc/apk/talkfirst.apk";

/** 给用户看的固定入口：永远指向"当前最新版"。 */
export const ANDROID_APK_PATH = "/download/android";
