# TalkFirst Mobile（Android / iOS）

基于 Expo + React Native + TypeScript 的原生 App。当前为 MVP：登录/注册、发现、通知、我的四个主流程，复用 TalkFirst 现有 API。

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

需要本机安装 JDK 17+ 与 Android SDK（`ANDROID_HOME` 已配置）。当前开发机尚未安装，需先配置：

```bash
java -version        # 需 JDK 17+
adb version          # 需 Android SDK platform-tools
echo $ANDROID_HOME   # 需指向 Android SDK
```

满足后：

```bash
# 本地构建（连真机/模拟器）
npm run android -w @talkfirst/mobile

# 或云端打包（需 EAS 账号）
npx eas build -p android --profile preview
```

## 认证说明

原生 App 无法使用 HttpOnly Cookie，因此后端做了最小扩展（保持 Web Cookie 逻辑不变）：

- `POST /auth/login`、`/auth/register`、`/auth/refresh`、`/auth/password` 的响应现在附带顶层 `accessToken` / `refreshToken`。
- `POST /auth/refresh`、`/auth/logout` 现在支持从请求体 `refreshToken` 或 `x-refresh-token` 头读取刷新令牌（Cookie 仍优先）。

App 端用 `expo-secure-store` 持久化令牌，401 时自动单飞刷新并重试（见 `src/lib/api.ts`）。

## 目录

```
src/
  lib/       API 客户端、令牌存储、认证上下文、类型
  components/ Screen / Button / Input / Avatar / Logo
  screens/   登录注册、发现、通知、我的、个人名片
```

## 未实现（后续阶段）

- 聊天 / Socket.IO 实时
- Moments 动态、上传
- 连接 / 交换联系方式
- 个人资料编辑与隐私设置
- 通知点击跳转到具体目标页
