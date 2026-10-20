import fs from "fs";
import path from "path";

/**
 * 图标字体的回归护栏。
 *
 * ## 为什么要专门盯这件事
 *
 * 2026-10-08、10-09、10-20 三次线上反馈是同一个形状：**按钮只剩一块颜色，里面
 * 什么都没有**。每次的真因都在「图标组件拿到的是 undefined」或「.ttf 没进包」，
 * 而这两种失败**都不会让测试变红**：类型检查全绿、界面照常渲染、图标位置就是空的。
 * 只能靠真机截图发现，成本极高（一次构建 20-40 分钟）。
 *
 * 所以这里把三个必须同时成立的静态事实钉住：
 *
 *   1. `Icon.tsx` 从**逐字入口** `@expo/vector-icons/Ionicons` 取组件
 *      （包根入口是懒加载的 `IconsLazy`，具名导出在这套依赖布局下会变 undefined）；
 *   2. 那个 .ttf 真的在依赖里、且是一个像样的字体文件（不是空文件/占位）；
 *   3. `App.tsx` 用族名 `Ionicons` 注册了它 —— 族名写错等于没加载，而字形仍然空白。
 *
 * ## 为什么断言源码而不是 `import` 之后看类型
 *
 * 尝试过直接 `import Ionicons from "@expo/vector-icons/Ionicons"` 再断言它是
 * 函数：单跑这个文件能过，整套跑就时好时坏 —— jest 的模块注册表与 Metro 不是
 * 同一回事，拿它当运行时的证据反而会误报。这里验的是**代码里写的那个入口**，
 * 而运行时真实表现由出包后的真机/模拟器确认。
 */
describe("图标字体", () => {
  it("Icon.tsx 从逐字入口取 Ionicons，而不是包根", () => {
    const source = fs.readFileSync(path.join(__dirname, "Icon.tsx"), "utf8");
    expect(source).toContain('from "@expo/vector-icons/Ionicons"');
    expect(source).not.toContain('from "@expo/vector-icons"');
  });

  it("Ionicons.ttf 真实存在且不是空壳", () => {
    const packageDir = path.dirname(require.resolve("@expo/vector-icons/package.json"));
    const ttf = path.join(
      packageDir,
      "build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf",
    );
    expect(fs.existsSync(ttf)).toBe(true);
    // 真实字体是 400KB 上下；几百字节说明拿到的是占位物。
    expect(fs.statSync(ttf).size).toBeGreaterThan(100_000);
  });

  it("App.tsx 用族名 Ionicons 把它注册给 useFonts", () => {
    // 以测试文件自身定位 App.tsx：从仓库根或 apps/mobile 里跑都成立。
    const source = fs.readFileSync(path.join(__dirname, "../../App.tsx"), "utf8");
    // 直接 require 资源，打包器才会把 ttf 放进 APK；从 Ionicons.font 取可能拿到 undefined。
    expect(source).toContain(
      'require("@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf")',
    );
    expect(source).toContain("useFonts({ Ionicons: IONICONS_TTF })");
  });
});
