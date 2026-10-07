# TalkFirst Mobile（Android / iOS）

基于 Expo + React Native + TypeScript 的原生 App，复用 TalkFirst 现有 API。当前为 MVP：
**动态 / 消息 / 通知 / 发现 / 我的**五个 tab（底部导航）。

服务端响应统一包在 `{ success, data }` 里，客户端 `apiFetch`（`src/lib/api.ts`）已经拆掉外层信封，
所以各屏幕里 `apiFetch<T>()` 拿到的就是 `data` 那一层。

## 运行

```bash
# 首次（在仓库根目录，已安装依赖后可跳过）
npm install

# 启动 Metro（可用 Expo Go 扫码，或按 a 打开 Android 模拟器）
npm run start -w @talkfirst/mobile
```

## API 地址

默认指向 Android 模拟器宿主机别名：

```
http://10.0.2.2:4000/api/v1
```

- Android 模拟器：无需改动（`10.0.2.2` 即宿主机）。
- iOS 模拟器 / 真机：改成宿主机 IP。通过环境变量覆盖：

```bash
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:4000/api/v1 npm run start -w @talkfirst/mobile
```

API 端口默认 `4000`，与 `apps/api` 一致。

## 打包 APK

本机**没有** Android 工具链（无 JDK / Android SDK / gradle），所以本地 `expo run:android` 走不通；
当前可用的路径是 **EAS 云端打包**：

```bash
cd apps/mobile
npx eas login          # 需要 Expo 账号
npx eas init           # 首次：把 projectId 写进 app.json（仓库里还没有，必须由账号持有人做一次）
npx eas build -p android --profile preview    # preview = 直接产出 APK
```

`eas.json` 已经配好三个 profile：`development`（dev client）、`preview`（**APK**，内部安装）、
`production`（AAB + 自动递增版本号）。

### 打包链路里的两个坑（都已踩过，别再踩）

1. **`expo` 必须待在仓库根级，不能嵌在本 app 目录下**（已修）。
   锁文件原本把 expo 装在 `apps/mobile/node_modules/expo`，而根级住着它自己的一部分包
   （`babel-preset-expo` / `@expo/metro-config` / `@expo/vector-icons`），
   它们要解析 `expo/config`、`expo-asset` 这些东西 —— 从根级往上找永远找不到，于是打包依次报：
   `The required package \`expo-asset\` cannot be found`（Metro config）→
   `[BABEL]: Cannot find module 'expo/config'`（babel-preset-expo）。
   现在锁文件里 expo 与它自带的 5 个依赖（`expo-asset` / `expo-constants` / `expo-file-system` /
   `expo-font` / `expo-keep-awake`）都在**根级** `node_modules/` 下，
   且 `package.json` 里显式声明了 `expo-asset` / `expo-font`（它们是打包要不要的基础件）。
   **版本一个没动**（改动前后都是 1510 个 name@version，只是少数条目换了位置）。

2. **不要在这个仓库跑裸的 `npm install`**。
   `expo-asset` 之类包的 peer 是 `expo: "*"`。只要 expo 不在根级（或将来又被嵌回去），
   npm 为了满足 peer 会**在根级再装一份最新 expo**。
   实测后果：一次 `npm install` 多出 192 个包，包含 `expo@57` 与 `react-native@0.87.1`，
   而本 app 是 SDK 52 / RN 0.76 —— 打包会挂在
   `ViewConfig.js: ':' or '?' expected in property type annotation`（看起来像 RN 语法错，其实是版本错配）。
   部署那边用 `npm ci`（本仓库的部署脚本就是 `npm ci`），它严格按锁文件安装，不会重解依赖树。

把整棵依赖树重新生成一遍仍然值得做（现在这份布局是手工改出来的），
但那会连带换掉 api/web 的依赖版本 —— 属于单独一件事，不要混在功能提交里做。

### 验证情况（2026-10-07）

- ✅ 干净 `npm ci` → `prisma generate` → `nest build`（api）通过：锁文件改动不影响部署链路
- ✅ `npm run typecheck -w @talkfirst/mobile`
- ✅ `expo export --platform android`（JS bundle）：**579 模块 / 1.06 MB**
  （本机 Windows 需 `--no-bytecode`：hermesc 写临时文件被拒，属本机环境问题）
- ❌ 未验证：真机 / 模拟器运行（本机无 Android 工具链，打不出 APK）；
  也就是说「能打包」不等于「跑起来是好的」

## 认证说明

原生 App 无法使用 HttpOnly Cookie，因此后端做了最小扩展（保持 Web Cookie 逻辑不变）：

- `POST /auth/login`、`/auth/register`、`/auth/refresh`、`/auth/password` 的响应现在附带顶层 `accessToken` / `refreshToken`。
- `POST /auth/refresh`、`/auth/logout` 现在支持从请求体 `refreshToken` 或 `x-refresh-token` 头读取刷新令牌（Cookie 仍优先）。

App 端用 `expo-secure-store` 持久化令牌，401 时自动单飞刷新并重试（见 `src/lib/api.ts`）。

## 目录

```
src/
  lib/       API 客户端、令牌存储、认证上下文、类型
  components/ Screen / Button / Input / Avatar / Logo / icons（图标类型门面）
  screens/   登录注册、发现、动态、消息、通知、我的、个人名片
```

### 一些实现约定

- **动态里的视频不播放**：卡片只显示封面图。全屏播放器要 `expo-av` / `expo-video`，
  两者都是原生依赖，而本机连一版构建都出不来（更别说真机验证）—— 所以先不引入。
  已实现过的版本在提交 `ce4015f` 的 `src/screens/VideosScreen.tsx` 里，构建链路通了再接回来。
- **消息不实时**：进入会话拉一页 + 下拉刷新 + 发送后重拉。socket.io 客户端涉及新的
  原生依赖与生命周期，留到下一步。
- **点赞不做乐观更新**：等 `POST /moments/:id/like` 返回再改。服务端**只回 `{ liked }`**，
  计数由客户端自己 ±1（与 web 同一算法）。
- 图标走 `src/components/icons.ts` 这个类型门面，原因是 React 18/19 的类型冲突，
  文件顶部写了原因与删除条件。

## 语言（中文 / English）

默认**跟随手机的系统语言**，认不出的语言显示英文（这个产品面向国际市场，默认中文会让
绝大多数新用户一进来就看不到看得懂的界面）。也可以在「我的 → 界面语言」里手动指定
（跟随系统 / 中文 / English），选择存在 SecureStore（`talkfirst.locale`）。

四块文件，责任分开：

| 文件 | 做什么 |
|---|---|
| `src/lib/locale.ts` | 纯函数：从系统语言标签判定 `zh` / `en`。**不引 `expo-localization`** —— 它是原生模块，而 `Intl` 已经够用（理由写在文件顶部） |
| `src/lib/messages.ts` | 词典。`zh` 是源语言；`en` 的类型是 `Record<MsgKey, string>` —— **漏翻一条就编译不过**，而不是等用户在界面上碰到半句中文 |
| `src/lib/i18n-context.tsx` | `I18nProvider` + `useI18n()`；读系统语言、读/存手动选择 |
| `src/lib/i18n.ts` | 非 React 代码（`api.ts` 的超时/断网文案）用的模块级 `t()` |

约定：文案一律**整句进词典、变量用 `{n}` 占位**，不在代码里拼字符串（中文「5 分钟前」、
英文「5 min ago」，语序不同）。纯函数（`relativeTime` / `compactTime`）把 `t` 当参数传入，
不在里面直接 import —— 否则语言变了，已经渲染出去的列表不会重算。

**已验证**：112 条文案，`zh`/`en` 键名与占位符逐条比对一致（`npx tsx` 跑 20 项断言）；
语言判定覆盖 `zh-Hans-CN` / `zh_TW` / `en-US` / `ja-JP` / 空值；`expo export` 通过。

### 语言的未完成部分（重要）

1. **服务端下发的文字仍然只有中文**，目前有四处会直接显示给用户：
   通知的 `title` / `body`（如「你的动态收到点赞」）、验证码邮件、接口错误码的 `message`
   （登录失败提示等）、以及审核相关的系统消息。做法：App 每个请求带 `Accept-Language`，
   服务端按它选文案；通知要按**接收者**所留的语言偏好生成（不能按发送者）。
2. **web 端还没做 i18n**（30+ 页面）。要和 app 共用一份词典的话，可以把 `messages.ts`
   提成 `packages/i18n` —— 但现在不要动，换 workspace 会牵动锁文件（见本文上面的打包坑）。
3. **繁中（`zh-TW` / `zh-HK`）目前走简体**：还没有真正的繁体词典，不做半成品。
4. 词典只覆盖了**现有界面**。新加文案时两边都要补：`en` 漏了是编译错误，`zh` 漏了
   同样是编译错误（`en` 是基准类型）。

## 未实现（后续阶段）

- 服务端文案的多语言（见上，含通知与邮件）
- web 端的英文版
- 视频流全屏播放（见上）
- 聊天 Socket.IO 实时
- 通知点击跳转到具体目标页
- 连接 / 交换联系方式
- 个人资料编辑与隐私设置
