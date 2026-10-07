import { Ionicons as IoniconsRaw } from "@expo/vector-icons";
import type { ComponentType } from "react";

/**
 * `@expo/vector-icons` 的类型门面。
 *
 * ## 为什么需要它
 *
 * 这个包的类型是按 **React 19** 的 JSX 命名空间生成的，而这个 app 是 React 18
 * （react-native 0.76 要求）。在一个 npm workspaces 仓库里，根级还住着 web 端
 * （Next 15 → React 19），于是图标组件被实例化成 React 19 的 `Component`，
 * 而本 app 的 JSX 用 React 18 的规则去校验它 —— 每个 `<Ionicons />` 都报 TS2786
 * （`Property 'refs' is missing`）。
 *
 * 这是**纯类型**冲突：运行时用的是 expo 自带的那份图标实现，与 React 版本无关。
 *
 * ## 为什么是一个门面而不是在每个调用点 cast
 *
 * 收口在一处：只要 expo 修好类型（或本 app 升到 React 19），删掉这个文件与
 * `tsconfig.json` 里的 paths 映射即可，不用把散落的 `as unknown as` 一个个找出来。
 * `tsconfig` 的 paths 只影响类型解析，Metro 打包仍然加载真正的包。
 */
type IconProps = {
  /**
   * Ionicon 名称（如 `"compass-outline"`）。
   *
   * 这里放宽成 `string`：真实的名字联合类型随图标包一起坏在 React 19 上，
   * 而把它抄一份进仓库只会立刻过期。写错名字的表现是图标位置空白，
   * 不会崩溃 —— 因此在评审时**看着屏幕确认**，而不是指望编译器。
   */
  name: string;
  size?: number;
  color?: string;
  /** 图标是装饰时传 `false`，避免读屏把图标名当内容念出来。 */
  accessible?: boolean;
  style?: unknown;
};

type IoniconsComponent = ComponentType<IconProps> & {
  /** 仅用于 `keyof typeof Ionicons.glyphMap` 这类取名字类型的写法。 */
  glyphMap: Record<string, number>;
};

export const Ionicons = IoniconsRaw as unknown as IoniconsComponent;
