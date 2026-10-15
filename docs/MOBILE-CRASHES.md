# 移动端崩溃记录（MOBILE-CRASHES）

> 用途：把真机上出现过的红屏/闪退，连同**根因、修法、怎么防住**记下来。
> 以后每修一个崩溃，就在下面追加一条，别只改代码不记录——同一个坑踩第二次是最亏的。

---

## 1. 视频播放器红屏：`VideoPlayer.pause` 打在已释放的共享对象上

- **日期**：2026-10-12
- **提交**：`76a8b30`
- **现场报错**（真机红屏原文）：

  ```
  Call to function 'VideoPlayer.pause' has been rejected.
  Caused by: The 1st argument cannot be cast to type
  expo.modules.video.playerVideoPlayer (received class java.lang.Integer)
  Caused by: Cannot use shared Object that was already released
  in MomentVideo
  ```

### 根因

expo-video 的 `useVideoPlayer` 内部用 `useReleasingSharedObject`：组件卸载时会先
`release()` 释放原生播放器。而我们自己的 `useEffect` 清理函数里又调了
`player.pause()`。React 按**声明顺序**跑清理函数，`useVideoPlayer` 的 release 声明在
前、我们的 pause 声明在后，于是顺序变成：

```
release()（先，原生播放器已释放）
pause()  （后，打在一个已释放的共享对象上 → 抛错）
```

「received class java.lang.Integer」就是这条链的典型特征：JS 侧还攥着共享对象 ID（一个
整数），但原生侧按这个 ID 已经找不到播放器了。

### 修法

**不要在卸载清理里手动 `pause()`**。`release()` 本身就会停掉播放并释放音频焦点，
再 `pause()` 纯属多余且会崩。删除三处清理里的 `pause()`：

| 文件 | 组件 |
|---|---|
| `apps/mobile/src/screens/MomentsScreen.tsx` | 动态卡片 `MomentVideo` |
| `apps/mobile/src/screens/MomentDetailScreen.tsx` | 详情页 `MomentVideo` |
| `apps/mobile/src/screens/VideosScreen.tsx` | 全屏视频流 `VideoPage` |

保留 `VideoPage` 里 `active` 变化时的 `play()/pause()`（那是滚动切换，播放器还活着，
不是卸载竞态）。

顺带修回：删 `pause()` 清理时上一次把 `useEffect` 从 import 里一起删了，而这两个文件
别处仍在用 `useEffect`，导致 tsc 报 `Cannot find name 'useEffect'`。已补回。

### 验证

- 移动端 `tsc --noEmit` ✓；`jest` 3 套件 / 20 条全绿 ✓
- 本机出包 `BUILD SUCCESSFUL`（39MB，arm64-v8a + armeabi-v7a）
- APK 三重校验：zip 完整 ✓ / 签名=本机密钥 `TalkFirst Local` ✓ / ABI ✓
- 已上传服务器 `public/apk/talkfirst.apk`，`sha256` 本地=服务器一致；官网
  `/download/android` → 302 到新包，HEAD `200 / 41149728` 字节 ✓
- 真机验收：运营方确认恢复正常 ✓

### 防住（下次同类问题怎么避免）

1. **任何依赖「共享对象 + 原生释放」的模块**（expo-video、expo-av、expo-camera 等），
   不要在 `useEffect` 卸载清理里调实例方法，除非你亲自管理 `release()` 的时机。
2. 判断口诀：报错里出现 **`Cannot use shared Object that was already released`** 或
   **`received class java.lang.Integer`**，就是在已释放的原生对象上又调了方法——去查
   是不是清理函数里多了 `pause()/stop()/close()` 这类调用。

---

## 2. 一打开就是错误屏：`useSafeAreaInsets()` 写在了 `SafeAreaProvider` 外面

- **日期**：2026-10-16
- **提交**：`92e419b`（修）/ `90b57e7`（引入）
- **怎么发现的**：**模拟器实测**。typecheck 全绿、逐屏单测 81 条全绿，装到模拟器上
  打开就是这个错误屏。
- **现场报错**（App 自己的错误边界显示在屏幕上）：

  ```
  No safe area value available. Make sure you are rendering `<SafeAreaProvider>` at the top of your app.
  in Root
      in AuthProvider
      in ErrorBoundary
      in I18nProvider
  ```

### 根因

`SafeAreaProvider` 在这个 app 里是**在 `Root` 内部**、按分支渲染的（未登录 / 引导 /
主界面各一层）。而我在 `Root` 里调了 `useSafeAreaInsets()` 去算底部 tab 的留白 ——
`Root` 本身在那个 Provider **外面**，context 为空，直接抛错。

### 修法

把「取安全区」的那一步下移到**渲染在 Provider 内部**的组件里：新增 `TabBar` 组件，
它在 `SafeAreaProvider` 里面调 `useSafeAreaInsets()`，`Root` 只负责 `tab` 状态。

### 防住

1. **凡是 hook 读 context（safe-area、i18n、auth…），先确认它的调用点在提供者内部**。
   Provider 写在某个组件自己 return 里的写法（本 app 就是这样）最容易踩。
2. 补了一条回归测试：`整个 App 能挂载（含底部导航的安全区）`—— 把 `<App />` 整个
   渲染一遍。**typecheck 与逐屏单测都拦不住 Provider 层级错**，只有真渲染才拦得住。
3. 改动 App 根部结构（Provider、导航、安全区、tabs）后，**必须装到模拟器/真机看一眼**，
   别只看测试绿。

---

## 3. 系统返回键直接退出 app（子页面回不去）

- **日期**：2026-10-15 ~ 10-16
- **提交**：`90b57e7`
- **运营方反馈**：「有些界面点开后没法返回上一页，返回会直接退出 app」

### 根因

这个 app 没有路由库：子页面是**全屏接管状态**（`MeScreen` 的 `open`、`MessagesScreen`
的 `openId`、`MomentsScreen` 的 `detail`…），返回靠页面自己画的「返回」按钮。
而**整个 App 一处都没有接管系统返回键** —— 于是 Android 把返回键当成「退出到桌面」。

（`ProfilePreview` / `UserMomentsScreen` 那两个 `Modal` 例外：它们本来就有 `onRequestClose`。）

### 修法

新增 `apps/mobile/src/lib/back-stack.ts`：

- 每个打开的层用 `useBackHandler(active, onBack)` 注册，`active` 就是「这一层开没开」；
- 按**「最近变得可见」**排序（不是挂载顺序）—— 嵌套时最上面那层才是最后打开的那个；
- `App.tsx` 装一个 `BackHandler` 监听交给 `handleHardwareBack()`；**没人接管就返回
  `false`**，退回系统默认行为（在主界面退出 app）；
- 回调用 `ref` 包一层：注册/注销只在 `active` 变化时发生，否则每次渲染都重注册、
  顺序会被打乱。

接入的层：我的（子页 / 引导）、动态（发布 / 详情 / 视频流 / 设置）、消息（会话 /
交换）、AI 朋友（设定 → 聊天 → 关掉）、引导流程（返回上一步，第一步才退出）。

### 验证（模拟器实测，逐条按下返回键看结果）

| 场景 | 期望 | 实测 |
|---|---|---|
| 我的 → 编辑资料 → 返回 | 回「我的」 | ✅ 回「我的」 |
| 动态 → 视频流 → 返回 | 回时间线 | ✅ 回时间线 |
| 消息 → AI 朋友 → 返回 | 回消息列表 | ✅ 回消息列表 |
| 主界面（时间线）→ 返回 | 退出 app | ✅ 退出到桌面 |

工具：`scripts/emulator-ui-helper.sh`（按界面文字定位、读输入框、按返回键）。

两个实测中的坑记一下：

1. **`uiautomator dump` 会返回过期内容**，而且脚本里的重试逻辑会因为本地旧文件直接返回
   上一轮的界面 —— 每次 dump 前先删本地文件。
2. **有 `SurfaceView`（视频）的界面，a11y 树会滞后**：视频流那屏按返回已经生效，但树里
   还留着上一屏。判定要看**截图 md5 是否变化**，别只看 a11y 树。

