import { Animated, Easing } from "react-native";

/**
 * 动效地基（2026-10-31）。
 *
 * ## 为什么要有它
 *
 * 特效一旦各写各的时长，半年后就是十种节奏。这里把时长和曲线与 web 端
 * `design/tokens.ts` 的 `duration` / `ease` 对齐，两端同一套手感：
 *
 *   instant 120ms  按压、开关这类即时反馈
 *   fast    180ms  淡入、箭头旋转
 *   base    240ms  面板、弹层
 *
 * ## 三条硬规则（写在这里，而不是靠记性）
 *
 * 1. **只动 transform / opacity**：动 width/height/top 会触发布局，低端机必掉帧。
 * 2. **一律 `useNativeDriver: true`**：否则动画跑在 JS 线程，滚动时会被卡住。
 * 3. **不回弹**：`Easing.out(Easing.cubic)` 已经够有「落定感」，弹性曲线会让
 *    整个产品显得轻浮 —— 这是设计基线里明令禁止的。
 *
 * 使用方：`DailyFortuneSheet`（面板入场）、`MomentCard`（点赞的心）。
 */
export const MOTION = {
  instant: 120,
  fast: 180,
  base: 240,
} as const;

export const EASE = {
  /** 元素出现/落定。 */
  out: Easing.out(Easing.cubic),
  /** 进出都要平滑。 */
  inOut: Easing.inOut(Easing.cubic),
} as const;

/**
 * 按压反馈：按下缩到 0.96，松开回 1。
 *
 * 返回可直接挂到 `<Animated.View style={{ transform: [{ scale }] }}>` 的 scale
 * 与 `onPressIn/onPressOut` 回调。
 */
export function pressScale(to = 0.96) {
  const value = new Animated.Value(1);
  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [to, 1] });
  return {
    scale,
    onPressIn: () =>
      Animated.timing(value, {
        toValue: 0,
        duration: MOTION.instant,
        easing: EASE.out,
        useNativeDriver: true,
      }).start(),
    onPressOut: () =>
      Animated.timing(value, {
        toValue: 1,
        duration: MOTION.instant,
        easing: EASE.out,
        useNativeDriver: true,
      }).start(),
  };
}

/**
 * 「点一下弹出来」：从 0.92 放大到 1、透明度 0→1。
 *
 * **分成两个函数**是有原因的：`popInStyle` 只算样式（可在 render 里调用，无副作用），
 * `playPopIn` 才真的启动动画（只能在 effect / 事件里调用）。合成一个函数最容易写出
 * 「每次 render 都重启动画」的 bug —— 表现是整个面板一直在抖。
 *
 * 不用弹簧：`spring` 会过冲，在卡片这种大面积元素上会被看成「抖」。
 */
export function popInStyle(value: Animated.Value) {
  return {
    opacity: value,
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
  } satisfies Animated.WithAnimatedObject<Record<string, unknown>>;
}

export function playPopIn(value: Animated.Value) {
  value.setValue(0);
  Animated.timing(value, {
    toValue: 1,
    duration: MOTION.base,
    easing: EASE.out,
    useNativeDriver: true,
  }).start();
}

/**
 * 从上方滑入 + 淡入（提示条用）。
 *
 * `distance` 默认 8px：超过 12px 就会「飞进来」，在列表页会抢注意力；这里要的是
 * 「有个东西出现了」，不是「请你注意」。
 */
export function playSlideIn(value: Animated.Value, distance = 8) {
  value.setValue(0);
  Animated.timing(value, {
    toValue: 1,
    duration: MOTION.fast,
    easing: EASE.out,
    useNativeDriver: true,
  }).start();
  return {
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-distance, 0] }) }],
  };
}

/** 滑入样式的只读版本（render 里用，不启动画）。 */
export function slideInStyle(value: Animated.Value, distance = 8) {
  return {
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-distance, 0] }) }],
  };
}

/** 收起：滑回上方并淡出。 */
export function playSlideOut(value: Animated.Value, distance = 8) {
  return new Promise<void>((resolve) => {
    Animated.timing(value, {
      toValue: 0,
      duration: MOTION.fast,
      easing: EASE.inOut,
      useNativeDriver: true,
    }).start(() => resolve());
  });
}
