/**
 * 移动端全局测试设置。
 *
 * ## 为什么给 expo-font 一个桩（2026-10-16）
 *
 * `@expo/vector-icons` 每次渲染图标都会先问「这个字体加载了吗」，而 `expo-font` 的
 * `isLoadedNative()` 会调原生 `ExpoFontLoader.getLoadedFonts()` 再 `forEach`。
 * 在本机测试环境里那个原生模块没有实现（返回 `undefined`），于是**任何带图标的
 * 屏幕测试都崩在字体检查上**：
 *
 * ```
 * TypeError: loadedNativeFonts.forEach is not a function
 *   at forEach (node_modules/expo-font/src/memory.ts:21:23)
 * ```
 *
 * 报错位置还在业务代码附近（`setLoading(false)`），很容易被当成业务回归 —— 实际
 * 上屏幕冒烟测试要验的是「屏幕能渲染、不崩」，不是字体的原生加载。所以这里把字体
 * 固定成「已加载」，图标照常渲染成占位组件，不做任何真实字体动作。
 *
 * 这条与业务无关，属于测试环境的稳定化：修之前 `screens.test.tsx` /
 * `onboarding.test.tsx` 两个套件整片红。
 */
jest.mock("expo-font", () => {
  const actual = jest.requireActual("expo-font");
  return {
    ...actual,
    isLoaded: () => true,
    isLoadedNative: () => true,
    loadAsync: async () => undefined,
    useFonts: () => [true, null],
  };
});
