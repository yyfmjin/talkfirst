import { registerRootComponent } from "expo";
import { DiagnosticsRoot } from "./src/components/boot-diagnostics";

/**
 * 入口（**临时**：诊断版）。
 *
 * ## 为什么不再直接 `import App from "./App"`
 *
 * 如果 `App.tsx` 的 import 链在**模块加载期**抛错（原生模块缺失、初始化失败、
 * 循环依赖都属此类），直接 import 的写法会让整个 App 起不来：屏幕全白，
 * 没有任何文字，也没有任何线索。现在改成先注册自检组件、由它**惰性**加载 App，
 * 那一行错误就会显示在屏幕上。详见 `src/components/boot-diagnostics.tsx`。
 *
 * ## 定位完之后恢复成
 *
 * ```ts
 * import { registerRootComponent } from "expo";
 * import App from "./App";
 *
 * registerRootComponent(App);
 * ```
 * 并删掉 `src/components/boot-diagnostics.tsx`、把 `app.json` 的名字改回 `TalkFirst`。
 */
registerRootComponent(DiagnosticsRoot);
