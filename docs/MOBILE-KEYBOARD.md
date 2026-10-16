# 键盘把输入框挡住（Android 15 / targetSdk 35+）

状态：**已修**（2026-10-16）。代码：`apps/mobile/src/components/KeyboardAware.tsx`。

## 症状与根因

用户报「聊天输入框不自动调整到能看到的位置」——消息会话页、AI 聊天页、
发动态、登录页四个屏全中，因为它们用的是同一句写法：

```tsx
behavior={Platform.OS === "ios" ? "padding" : undefined}   // ← Android 上什么都不做
```

Android 侧原本指望系统把窗口压小（`adjustResize`），这是**以前**的行为。
**targetSdk 35+ 的 Android 15 起系统强制 edge-to-edge**：软键盘浮在窗口**之上**，
窗口不再变高，于是没人把输入框抬起来。

判断依据（都能自己验一遍，不用猜）：

```bash
# APK 里仍然是 adjustResize……但它不再生效
aapt2 dump xmltree --file AndroidManifest.xml talkfirst.apk | grep -i softinput
# → windowSoftInputMode=0x00000010（adjustResize）
grep -n '"targetSdkVersion"' apps/mobile/app.json    # → 36
```

## 修法

`components/KeyboardAware.tsx`：两端都用 `behavior="padding"` —— 键盘一出现就给自己
加等高的底部内边距，窗口不缩小时这是唯一能让输入框可见的办法。

代价：在「窗口确实被压小」的老设备（Android ≤14）上会多抬一点（输入框与键盘之间多
一条缝）。**可见性优先于那点间距**。

这是 UI 层唯一知道键盘高度的地方：新加带输入框的屏，用 `<KeyboardAware>` 而不是
`KeyboardAvoidingView`，否则就退回「被键盘挡住」。

## 怎么验

模拟器（`D:\Android`，脚本在 `scripts/emulator-ui-helper.sh`）：

```bash
bash scripts/emulator-ui-helper.sh dump      # 看节点与坐标
bash scripts/emulator-ui-helper.sh tap "..."  # 按文字点
```

**踩过的坑**：往 RN 输入框注字用 `adb shell input text` 不稳 —— 会重复插入前几次
的残留（实测出现 `tfrtfrt-a@…`），而且 `secureTextEntry` 的密码框在 uiautomator
里读不到内容。脚本化登录因此不可靠；要么先用 `input keyevent 67`（DEL）清空字段再
一次输入，要么干脆人眼看一眼：**打开会话/设置输入框，键盘弹出时输入框应还在屏幕上**。
