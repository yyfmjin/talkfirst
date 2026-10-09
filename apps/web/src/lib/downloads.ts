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
 * ⚠️ 2026-10-09：**临时退回到上一个验证可用、且不含热更（expo-updates）的包**。
 *
 * 原因：接 expo-updates 后，我发布的「热更」是 `--no-bytecode` 的纯 JS 包，
 * 而 App 是 Hermes 引擎 —— 手机上第二次启动加载它就会闪退。这个包（构建 dbaf6bd2 /
 * 提交 0c44fc7）是运营方实际用过、确认能打开的那一版。
 *
 * 之后：等把「热更只发 Hermes 字节码」这条路真正跑通（本机项目路径含中文，
 * Windows 版 hermesc 处理不了，需要换发布机），再把入口指向带热更的新包。
 *
 * 当前最新 Android 安装包（EAS 产物）。空串 = 还没有可下载的包，页面会显示「生成中」。
 */
export const ANDROID_APK_URL =
  "https://expo.dev/artifacts/eas/QhjgFTAx75JSp6injvOoji7NIIqlO5gU1X_uSNQVUKI.apk";

/** 给用户看的固定入口：永远指向"当前最新版"。 */
export const ANDROID_APK_PATH = "/download/android";
