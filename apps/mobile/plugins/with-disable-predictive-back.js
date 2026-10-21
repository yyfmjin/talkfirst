const { withAndroidManifest } = require("expo/config-plugins");

/**
 * 关掉 Android 的预测性返回（predictive back）。
 *
 * ## 为什么必须关
 *
 * 这个 app 的返回键**全靠 JS**：`BackHandler` 收事件 → `back-stack` 找最上面那层
 * 子页 → 关掉它（见 `src/lib/back-stack.ts`）。而 `app.json` 把 targetSdk 钉在 36：
 * 从 Android 15（API 35）起，`android:enableOnBackInvokedCallback` 对 targetSdk ≥ 35
 * 的应用**默认是 true**，系统于是走 `OnBackInvokedCallback` 这条新通路，不再调用
 * 旧的 `onBackPressed()`。
 *
 * React Native 0.76 默认**没有**注册 OnBackInvokedCallback（要显式打开 feature flag），
 * 结果就是：JS 里的 `BackHandler` 一次都收不到事件，用户在任何一层按返回，
 * 系统直接 finish 掉 Activity —— 回到桌面。
 *
 * 2026-10-21 线上反馈「我的 → 小模块 → 返回直接回桌面」就是这么来的：
 * 页面里其实注册了处理器，只是那条通路根本没通。
 *
 * ## 代价
 *
 * 没有预测性返回的「返回预览」动画。换回来的是**各层返回都正常**——这个取舍是
 * 刻意的：动画是锦上添花，返回键坏了是功能性问题。
 *
 * ## 什么时候可以删
 *
 * 升级到默认开启（或显式打开）`enableOnBackInvokedCallback` 的 RN 版本，并且
 * `back-stack` 在真机上验证过每一层都还能返回之后。
 */
module.exports = function withDisablePredictiveBack(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) {
      application.$ = application.$ ?? {};
      application.$["android:enableOnBackInvokedCallback"] = "false";
    }
    return config;
  });
};
