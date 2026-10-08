import { registerRootComponent } from "expo";
import App from "./App";

/**
 * 入口。
 *
 * 2026-10-08 这里临时挂过一个「启动自检」组件（用来定位「装完打开白屏」）：
 * 它先用 `require()` 惰性加载 App，好在屏幕上显示「App 模块加载失败」这类
 * 模块加载期异常。白屏定位完之后已经摘掉 —— 正常入口就该是这两行。
 *
 * （那句诊断留在这里不是怀旧：下次再遇到"屏幕全白、没有任何文字"，第一步仍然是
 * 让 App 的加载失败能在屏上显示出来，而不是继续猜。）
 */
registerRootComponent(App);
