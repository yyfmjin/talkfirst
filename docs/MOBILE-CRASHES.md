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
