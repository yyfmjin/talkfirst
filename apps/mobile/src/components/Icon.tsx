import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * 画一个图标；**拿不到图标组件时就不画**。
 *
 * ## 为什么要有这一层
 *
 * 2026-10-08：装完 APK、登录成功之后，主界面一渲染就崩 —— 错误是 React 的
 * `Element type is invalid: expected a string ... but got: undefined`，
 * 也就是某个 JSX 标签在运行时是 `undefined`。把整个移动端过了一遍：没有循环依赖、
 * 没有未绑定的标签、`tsc` 干净，第三方组件的版本与 SDK 也对得上 —— 唯一**只在登录后
 * 才会被渲染**的第三方组件就是 `@expo/vector-icons` 的 `Ionicons`
 * （登录页完全不用图标，所以它从来不炸）。
 *
 * 在真机上复现的成本很高（一次构建 40 分钟），所以这里两头都做：
 *
 *   1. 图标本来就是**装饰性**的 —— 底部导航的文字标签、`accessibilityLabel`、
 *      卡片上的数字都还在，信息一个不少。既然如此，就没必要为了一个画不出来的图标
 *      把整个 App 拖死。**坏掉的依赖不该让应用崩。**
 *   2. 万一真崩在别处，`ErrorBoundary` 现在会把 React 的组件栈也显示出来，
 *      下一次截图就能直接指出是哪个组件。
 *
 * 注意这里是**判断能不能当组件用**，不是"包一层 try/catch 把错误藏起来"：
 * 如果图标解析不出来，界面上确实会少几个图标 —— 那是看得见的、可解释的降级。
 */
export function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  if (!isRenderable(Ionicons)) return null;
  return <Ionicons name={name} size={size} color={color} accessible={false} />;
}

/** React 能当元素类型用的：函数（函数组件/类）或对象（`forwardRef` / `memo` 的产物）。 */
function isRenderable(value: unknown): boolean {
  return typeof value === "function" || (typeof value === "object" && value !== null);
}
