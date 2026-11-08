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

/**
 * expo-audio 的桩（2026-10-24，语音动态上线后）。
 *
 * 语音动态让 `MomentsScreen` 间接依赖 `expo-audio`，而它的原生模块在 jsdom 里
 * 加载即崩：整个 `screens.test.tsx` 套件变成 "Cannot read properties of undefined
 * (reading 'prototype')"，79 个用例一条都没跑。
 *
 * 屏幕冒烟测试要验的是「界面能渲染」，不是真录一段音；所以这里给一套最小可用的
 * 假实现：播放器有 play/pause/seekTo，状态恒为未播放，录音器返回 granted 权限。
 * 真要验录音逻辑，得在真机/模拟器上跑，不是这一层能覆盖的。
 */
jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  /* 通知音用的是命令式 API（`createAudioPlayer`），不是 hook —— `useAudioPlayer`
     在非组件上下文里调不了。两者都在这里给桩，屏幕测试才不会碰到原生模块。 */
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    remove: jest.fn(),
  })),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
  }),
  useAudioPlayerStatus: () => ({
    playing: false,
    currentTime: 0,
    duration: 0,
    didJustFinish: false,
  }),
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(),
    stop: jest.fn(async () => undefined),
    uri: null,
  }),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));

/**
 * expo-video / expo-image-manipulator 的桩（2026-11-08，聊天支持图片和视频后）。
 *
 * `MessagesScreen` 在模块顶层 import 了这两个包，而它们的原生模块在 jsdom 里加载即崩：
 * `TypeError: Cannot read properties of undefined (reading 'prototype')`。
 * 结果是 `notification-links.test.ts` 整个套件一条都没跑 —— 报错位置还在 import 行，
 * 看上去像业务代码坏了，实际只是测试环境没有原生实现。
 *
 * 屏幕测试要验的是「界面能渲染、点得到、跳得对」，不是真播一段视频或真压一张图；
 * 所以这里给最小可用实现。真正发图/发视频的链路要在真机或集成测试里验。
 */
jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
  VideoView: () => null,
}));

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({
    uri,
    width: 1600,
    height: 1200,
    base64: "ZmFrZQ==",
  })),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

