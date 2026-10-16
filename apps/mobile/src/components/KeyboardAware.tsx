import { KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

/**
 * 键盘遮挡的处理，一处收口。
 *
 * ## 为什么所有屏都写错了同一件事
 *
 * 原来的写法是 `behavior={Platform.OS === "ios" ? "padding" : undefined}` ——
 * Android 上什么都不做，指望系统把窗口缩小（`adjustResize`）。这在 **targetSdk 35+
 * 的 Android 15 上不再成立**：系统强制 edge-to-edge，软键盘**浮在**窗口之上而不是
 * 把窗口压小（APK 里 `windowSoftInputMode=0x10` 仍然是 adjustResize，但没用了）。
 * 结果是聊天输入框被键盘挡住 —— 2026-10-16 用户报的就是这个。
 *
 * ## 为什么两端都用 `padding`
 *
 * 键盘一出现就给自己加等高底部内边距：窗口不再变小时这是唯一让输入框可见的办法。
 * 代价：在「窗口确实被压小」的老设备上会多抬一点（输入框离键盘多出一条缝），
 * 但**可见性**优先于那点间距。
 *
 * ## 改这里要注意
 *
 * 这是 UI 层唯一知道键盘高度的地方。`ScrollView` 形式的表单（AI 设定页）也用它 ——
 * 少用它，就回到「键盘挡住输入框」。
 */
export function KeyboardAware({
  children,
  style,
  /** iOS 上顶部有自定义头部时用得上；Android 由 padding 处理，无需偏移。 */
  iosOffset = 0,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  iosOffset?: number;
}) {
  return (
    <KeyboardAvoidingView
      style={style}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? iosOffset : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
