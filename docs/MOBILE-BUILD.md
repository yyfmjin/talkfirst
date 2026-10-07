# 移动端（apps/mobile）：现在能做什么、怎么出安装包

> 2026-10-07。这份文档只回答两件事：**怎么拿到一个能装的 APK（下载链接）**，
> 以及**为什么以前拿不到**。

## 1. 拿安装包：EAS Build（免费，三条命令）

本地这台开发机**没有** Android 工具链（无 JDK / Android SDK / gradle），所以
在这台机器上打不出 APK。EAS Build 在他们的云端跑，免费额度足够，
产出的就是一个可直接下载安装的 **APK 链接**：

```bash
cd apps/mobile
npx eas-cli login                  # 一次性：用你的 Expo 账号登录（免费注册）
npx eas-cli build -p android --profile preview
```

- `--profile preview` 已在 `apps/mobile/eas.json` 里定义好，**产物是 APK**
  （不是 Play 商店要的 AAB）—— 这就是「下载链接」那一步。
- 构建完终端会打印一个 `https://expo.dev/...` 的地址，手机直接打开就能装；
  同时可以在 expo.dev 的构建页里再次下载。
- `production` 档留给以后上架（AAB）。
- 首次构建会问你「是否生成 Android keystore」，选 yes（EAS 帮你托管，
  以后升级同一个包名才不会签名不一致）。

**为什么不在生产服务器上打**：这台服务器只有 2 vCPU / 3.8GB 内存，而
Gradle + Android 构建工具链要几 GB 内存 —— 今天已经因为我的操作中断过两次线上
服务，不值得为省一次登录再赌一次。真要在这台机器上出包，正确做法是
`docker run --memory=…` 限住内存再构建，需要的话我可以做。

## 2. 本地能验证到哪一步

| 手段 | 结果 |
|---|---|
| `npm run typecheck -w @talkfirst/mobile` | **通过** |
| `npx expo export --platform android` | **通过**：595 个模块、1.1MB JS bundle |
| 真机/模拟器运行 | **未做**（本机无设备与工具链）—— 这是本次交付最大的未验证面 |

Windows 上跑 `expo export` 要加 `--no-bytecode`：`hermesc.exe` 在本机写临时文件
会被拒（`permission denied`），这是本机环境问题，Linux/云端构建不受影响。

## 3. 这次修掉的两个「以前根本打不出包」的原因

### 3.1 仓库里有两份 react-native，差一个大版本

`npm ls react-native` 曾经显示：根级 `0.87.1`、app 内 `0.76.7`。

那些 expo 包对 `expo` 的 peer 范围很宽，npm 的 peer 自动安装抓了**最新版**
（expo@57），顺带把它那一代的 `react-native@0.87.1` 装到了根级。于是：
提升到根级的 expo 包 import 到 **0.87 的 RN 源码**，而做 Flow 转译的是 app 那份
**0.76 的 `@react-native/babel-preset`** —— 两边对不上，打包直接挂在一句

```
react-native/Libraries/vendor/emitter/EventEmitter.js: ':' or '?' expected in property type annotation
```

看起来像 RN 自己的语法错误，实际是版本错配。**修法**：根级 `devDependencies`
显式声明 `expo@~52.0.37` + `react-native@0.76.7`（并在根级 `overrides` 里写明），
让 peer 解析到声明版而不是去抓最新。注意 `npm install` 曾经一直在报
**ERESOLVE 失败**，只重装到一半 —— 排查时别只看输出尾部。

`apps/mobile/metro.config.js` 里还留着一处 `extraNodeModules` 把 `react-native`
钉到本 app 那一份，作为**补丁**：等根级不再有第二份 RN 时就可以删掉。

### 3.2 缺 `expo-asset` / `expo-av`

`expo export` 起不来是因为 `expo-asset` 不在依赖里（Metro 的 config 需要它）；
视频流需要 `expo-av`。两者都已按 **SDK 52 的版本**（`expo-asset ~11.0.5`、
`expo-av ~15.0.2`）写进 `apps/mobile/package.json`。

> ⚠️ 不要在这台机器上跑 `npx expo install <包>`：npx 会先下载**最新版** expo CLI，
> 它会按自己那一代（SDK 57）解析版本，把 3.1 那个坑重新踩一遍。
> 要加包就手写版本（照 SDK 52 的对照表），或者先 `npx expo@52 install <包>`。

## 4. 这次给 app 加了什么

| 屏 | 说明 |
|---|---|
| **动态** | 主时间线：文字/图片/视频卡片、点赞（服务端 toggle，不用本地乐观加一）、下拉刷新、上滑翻页 |
| **视频流** | 全屏竖向吸附（`pagingEnabled`），只播当前那条、静音起步、可切声音；从动态里点视频进入，并把它排到最前 |
| **消息** | 会话列表 + 会话内对话 + 发送；打开会话时调 `/read`，顺带清掉该会话的未读通知 |
| **底部导航** | 5 个 tab（发现/动态/消息/通知/我），图标从 **emoji 换成 Ionicons**（emoji 在不同系统字形/颜色/基线都不同，读屏还会念成「指南针」这种无关词） |

`@expo/vector-icons` 的类型是按 React 19 生成的，而本 app 是 React 18 ——
类型解析由 `apps/mobile/src/components/icons.ts` 收口（`tsconfig.json` 的 `paths`
指向它），**只影响类型**，运行时仍是 expo 自带的那份实现。

## 5. 还没做的（按重要性）

1. **真机验证**：以上代码没有任何一条在设备上跑过。第一次 `eas build` 之后请务必过一遍。
2. **实时消息**：现在是「进入会话拉一页 + 发送后重拉」，没有 socket.io 长连接
   （那需要新的原生依赖与生命周期管理，我没法在没有设备的情况下验证）。
3. **发布能力**：发动态、发图片/视频的入口还没做（只有浏览与互动）。
4. **推送通知**：未接（需要 `expo-notifications` + 服务端 push token 存储）。
5. **iOS**：`eas.json` 只配了 Android；iOS 出包需要 Apple 开发者账号（99 美元/年）。
6. **测试**：`apps/mobile` 没有 jest/eslint，`npm test` 只跑 tsc
   （这条是仓库原本的状态，本次没有改变它，但它是真实缺口）。
