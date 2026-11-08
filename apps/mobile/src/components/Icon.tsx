import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
import { Text } from "react-native";

/**
 * 图标字体的族名。
 *
 * 必须和 `@expo/vector-icons/build/Ionicons.js` 里
 * `createIconSet(glyphMap, 'ionicons', font)` 的第二个参数**完全一致**。
 * Android 的字体族名大小写敏感：写 `Ionicons` 匹配不上，会回退到系统字体，
 * 而图标码位在私用区（PUA），系统字体没有这些字形 —— 结果就是“什么都不画”。
 */
const FONT_FAMILY = "ionicons";

/**
 * 名字 → 码位。**直接读字形表 JSON**，不经过 `@expo/vector-icons` 的组件模块。
 *
 * 2026-10-15 模拟器打点（把值画在屏幕上读出来）：
 *
 *     f=true  err=-  iso=true  n=-1  add=-1  cmp=undefined
 *
 * 也就是 —— `useFonts` 成功、`isLoaded('ionicons')` 为真（`n`/`add`/`cmp` 来自
 * 那个组件模块：`glyphMap` 取不到、默认导出本身是 `undefined`）。包根入口和
 * 逐字入口在这套 npm workspaces + CJS/ESM 混装下都会塌成 undefined，
 * 于是：
 *
 *   1. 旧版 `Icon` 的 `isRenderable()` 判定失败 → 直接不画；
 *   2. 就算强行渲染，`createIconSet` 造出来的那个组件也会停在
 *      “字体还没加载好”的空 `<Text />` 状态（它在 `componentDidMount` 里对那个
 *      ttf 的 ESM 默认导入调 `Font.loadAsync`，而 Metro 给的是资源对象，
 *      调用必然被拒，`setState` 永远不执行）。
 *
 * 这两条都不会报错、不会崩，只是界面上少几个图标 —— 正是 10-08 / 10-09 /
 * 10-20 / 10-15 反复出现的「按钮只剩一块底色」。
 *
 * 所以这里只依赖两样**不会在打包时变形**的东西：JSON 字形表 + 已经注册好的字体族名。
 * 没有异步、没有状态机；名字不认识就返回 null（图标是装饰性的，按钮有
 * `accessibilityLabel`、底部导航有文字标签，信息不丢）。
 */
const GLYPHS = glyphMap as Record<string, number>;

export type IconName = keyof typeof glyphMap;

export function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  const code = GLYPHS[name];
  if (typeof code !== "number") return null;
  return (
    <Text
      accessible={false}
      /* 系统字号放大不该把图标撑破布局。 */
      allowFontScaling={false}
      style={{
        fontFamily: FONT_FAMILY,
        fontSize: size,
        color,
        /* Android 默认给文字上下留白：图标会显得偏下，小尺寸下还会被裁。 */
        includeFontPadding: false,
        textAlign: "center",
        textAlignVertical: "center",
      }}
    >
      {String.fromCodePoint(code)}
    </Text>
  );
}
