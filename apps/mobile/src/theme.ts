import { useColorScheme } from "react-native";

/**
 * 配色（浅色）。深色见下面的 `dark`：**同一套语义键，只换值**。
 *
 * 两套都刻意不写 `as const`：写死字面量会让深色那套因为值不同而类型不兼容。
 */
const light = {
  /**
   * 品牌蓝 = 与图标同一支蓝 `#0B7FFF`（2026-10-28 统一）。
   *
   * 说明：白字压在 `primary` 上是 **3.83**，不到正文级 AA 的 4.5。所以
   * 「浅底上要读的蓝字」用 `primaryDark`（#0063E6，对白 5.34）。深色下反过来：
   * `primaryDark` 提亮成 #4AA6FF，压在深底上是 7.4。
   */
  primary: "#0B7FFF",
  primaryDark: "#0063E6",
  gradientFrom: "#0B7FFF",
  gradientTo: "#4AA6FF",
  /** 页面画布。毛玻璃下是 transparent，底 wash 由 `components/Glass.tsx` 画。 */
  bg: "transparent",
  /** 真·不透明的白（原 `bg` 的值）。需要绝对不透明的地方用它。 */
  bgSolid: "#FFFFFF",
  bgSoft: "#F7FAFF",
  bgTint: "#EFF6FF",

  /* 毛玻璃三档 + 边，不透明度按「离屏幕多远」分。 */
  glass: "rgba(255, 255, 255, 0.58)",
  glassRaised: "rgba(255, 255, 255, 0.80)",
  glassSunken: "rgba(255, 255, 255, 0.38)",
  glassEdge: "rgba(255, 255, 255, 0.66)",
  /** 底 wash 三段（与 web `globals.css` 同一组色）。 */
  washTop: "#F4F8FF",
  washMid: "#EAF2FF",
  washBottom: "#E0EBFF",

  ink: "#1B1B2F",
  /** 次要文字：毛玻璃底上 `#8A8FA3` 只剩 3.1，收到同 web 的 `#5A6478`。 */
  muted: "#5A6478",
  line: "#ECEEF5",
  danger: "#E5484D",
  dangerSoft: "#FDECEC",
  success: "#22A06B",
  white: "#FFFFFF",
};

/** 深色：键与浅色完全一致（少一个键 TypeScript 会报错）。 */
const dark: typeof light = {
  primary: "#0B7FFF",
  primaryDark: "#4AA6FF",
  gradientFrom: "#0B7FFF",
  gradientTo: "#1E5FAF",
  bg: "transparent",
  bgSolid: "#0F1620",
  bgSoft: "#121A24",
  bgTint: "rgba(11, 127, 255, 0.16)",
  glass: "rgba(255, 255, 255, 0.06)",
  glassRaised: "rgba(255, 255, 255, 0.10)",
  glassSunken: "rgba(255, 255, 255, 0.04)",
  glassEdge: "rgba(255, 255, 255, 0.10)",
  washTop: "#0B1219",
  washMid: "#0A1017",
  washBottom: "#080D13",
  ink: "#E9EEF5",
  muted: "#9EAAB8",
  line: "rgba(255, 255, 255, 0.10)",
  danger: "#F87171",
  dangerSoft: "rgba(248, 113, 113, 0.16)",
  success: "#34D399",
  white: "#FFFFFF",
};

export type Palette = typeof light;

/** 当前配色。由根组件的 `useAppearance()` 维护。 */
let currentScheme: "light" | "dark" = "light";

const palette = () => (currentScheme === "dark" ? dark : light);

/**
 * `colors.xxx` 保持原样可读 —— 它是按「当前配色」实时取值的 Proxy。
 *
 * 关键点：Proxy 的 get 在**渲染那一刻**才求值，所以组件里的
 * `<Icon color={colors.muted} />` 会跟着系统深浅色变。
 * 但**模块顶层的常量**（`const X = colors.muted`）只会在加载时求值一次，
 * 那种写法在深色下不会更新 —— 需要时请改成函数或放进组件里。
 */
export const colors = new Proxy({} as Palette, {
  get: (_target, key) => palette()[key as keyof Palette],
  has: (_target, key) => key in light,
  ownKeys: () => Reflect.ownKeys(light),
  getOwnPropertyDescriptor: (_target, key) => ({
    enumerable: true,
    configurable: true,
    value: palette()[key as keyof Palette],
  }),
});

/**
 * 把 `StyleSheet.create({...})` 换成「按配色懒构建」的样式表。
 *
 * 为什么不是每屏改成 `useMemo`：全 App 有 48 个模块级样式表，逐个改成
 * 组件内 hook 要动每个组件的函数体，风险远大于收益。这里让样式表在
 * `styles.foo` 被读到时才按当前配色构建并缓存 —— 调用点一个字都不用改。
 */
export function themed<T>(factory: (palette: Palette) => T): T {
  const cache = new Map<string, T>();
  const build = (): T => {
    const key = currentScheme;
    let made = cache.get(key);
    if (!made) {
      made = factory(palette());
      cache.set(key, made);
    }
    return made;
  };

  return new Proxy({} as T & object, {
    get: (_target, key) => (build() as Record<PropertyKey, unknown>)[key],
    has: (_target, key) => key in (build() as Record<PropertyKey, unknown>),
    ownKeys: () => Reflect.ownKeys(build() as Record<PropertyKey, unknown>),
    getOwnPropertyDescriptor: (_target, key) => ({
      enumerable: true,
      configurable: true,
      value: (build() as Record<PropertyKey, unknown>)[key],
    }),
  }) as T;
}

/**
 * 在根组件调用一次：跟随系统深浅色，并让整棵树重渲染。
 *
 * 这里直接改模块级变量（而不是走 Context），是因为 48 个样式表都在模块作用域，
 * 只有模块级状态能让它们同时切换；Context 只能影响拿得到 hook 的组件。
 */
export function useAppearance(): "light" | "dark" {
  const scheme = useColorScheme();
  currentScheme = scheme === "dark" ? "dark" : "light";
  return currentScheme;
}
