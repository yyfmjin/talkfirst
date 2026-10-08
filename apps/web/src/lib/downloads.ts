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

/** 当前最新 Android 安装包（EAS 产物）。空串 = 还没有可下载的包，页面会显示「生成中」。 */
export const ANDROID_APK_URL =
  "https://expo.dev/artifacts/eas/I41YmQlfDywVfpERhnwyf3mwOdRkTKkEzbW18-an2c4.apk";

/** 给用户看的固定入口：永远指向"当前最新版"。 */
export const ANDROID_APK_PATH = "/download/android";
