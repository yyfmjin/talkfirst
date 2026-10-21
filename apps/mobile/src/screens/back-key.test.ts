import fs from "fs";
import path from "path";

/**
 * 预测性返回的回归护栏。
 *
 * ## 为什么要有这一条
 *
 * 2026-10-21 线上反馈：「我的 → 点进小模块 → 按返回直接回桌面」。
 * 页面里的 `useBackHandler` 其实都在，问题是**事件根本没到 JS**：
 * targetSdk 36 默认开启 `enableOnBackInvokedCallback`，系统改走
 * OnBackInvokedCallback，而 RN 0.76 默认不注册它 → 系统直接 finish Activity。
 *
 * 修法是在 `<application>` 上显式写 `android:enableOnBackInvokedCallback="false"`，
 * 由 config plugin（prebuild 时）与本地构建脚本（复用已有 android/ 时）分别保证。
 * 这里把两处都钉住：谁把它删了，跑测试就红，不必再出一次 13 分钟的包去真机上试。
 */
const mobileRoot = path.join(__dirname, "../..");

describe("预测性返回已关闭", () => {
  it("app.json 注册了关闭预测性返回的 config plugin", () => {
    const appJson = fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8");
    expect(appJson).toContain("./plugins/with-disable-predictive-back.js");
  });

  it("插件把 enableOnBackInvokedCallback 设为 false", () => {
    const plugin = fs.readFileSync(
      path.join(mobileRoot, "plugins/with-disable-predictive-back.js"),
      "utf8",
    );
    expect(plugin).toContain("enableOnBackInvokedCallback");
    expect(plugin).toContain('"false"');
  });

  it("本地构建脚本会在复用已有 android/ 工程时补上这个属性", () => {
    const script = fs.readFileSync(
      path.join(mobileRoot, "../../scripts/build-apk-locally.sh"),
      "utf8",
    );
    expect(script).toContain("enableOnBackInvokedCallback");
  });
});
