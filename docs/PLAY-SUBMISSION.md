# Google Play 上架清单（TalkFirst · Android）

> 结论先说：**代码侧的门槛已经过了**（target API 36、权限最小化、应用内可达的隐私政策、
> 注册同意闸门、账号可删除），**控制台侧还得你操作**（数据安全表单、内容分级、审核账号…），
> 另有一条**有截止日期、目前未达标**的项：**16 KB 页大小**（见第二节）。

本文只写**核对过的事实**：每条要么有 Play 官方原文，要么有本机实测输出。没核实的会明确标成「待确认」。

---

## 一、代码侧已满足（含证据）

| # | Play 的要求 | 我们的现状 | 证据 |
|---|---|---|---|
| 1 | 2026-08-31 起，**新应用与更新必须 target Android 16（API 36）** | `compileSdk = targetSdk = 36`，buildTools 36.0.0 | `apps/mobile/app.json` 的 `expo-build-properties`；出包后查合并清单得 `targetSdkVersion 36` |
| 2 | 上传格式必须是 **AAB** | `gradlew bundleRelease` 出 `.aab` | `D:\Android\talkfirst-play.aab` |
| 3 | **权限最小化**（敏感权限会被追问） | 清单里原有 13 条，砍掉 6 条一个都没用到的：`RECORD_AUDIO`、`SYSTEM_ALERT_WINDOW`、`CAMERA`、`USE_BIOMETRIC`、`USE_FINGERPRINT`、`WRITE_EXTERNAL_STORAGE` | `apps/mobile/app.json` 的 `android.blockedPermissions`；合并清单复核 |
| 4 | 隐私政策必须**在应用内可达**（不只是商店页） | 「我的 → 关于 → 条款与隐私」：用户协议 / 隐私政策 / 社区规则 / 联系我们 | `apps/mobile/src/screens/LegalScreen.tsx`、`src/lib/legal.ts` |
| 5 | **用户生成内容（UGC）**类应用：注册前必须让用户明确同意条款 | 注册页有同意勾选框 + 可点开的《用户协议》《隐私政策》，**没勾就不发注册请求** | `apps/mobile/src/screens/AuthScreen.tsx`；用例「注册页没勾同意就不发注册请求」 |
| 6 | UGC 类应用：必须能**举报**与**拉黑** | 「我的 → 安全中心」：拉黑列表 / 解除 / 我的举报 | `apps/mobile/src/screens/SafetyScreen.tsx` |
| 7 | 提供**账号与数据删除**（应用内 + 网页入口） | 应用内「我的 → 注销账号」；网页端同功能 | `DeleteAccountScreen.tsx`；`docs/SECURITY-FOLLOWUPS.md` 有相关记录 |
| 8 | `versionCode` 唯一且只增 | 置为 `2`（`versionName` 仍 0.1.2，现有装机用户的热更新通道不断） | `apps/mobile/app.json` |

### 为什么「只在界面上写一行条款」不够

Play 对 UGC 应用的要求是**注册之前**明确同意；界面上写一行字、点不进去，等于没给用户读过
条款的机会。所以第 5 项做成了「勾选框 + 两个可点的链接 + 没勾就不发请求」，
并且有测试钉住（`screens.test.tsx` 的「条款与隐私（Play 上架要求）」）。

---

## 二、未达标：16 KB 页大小（Play 提示截止 2027-02-01）

**要求**：Play 对 16 KB 内存页大小的支持要求（官方页 <https://developer.android.com/guide/practices/page-sizes>），
控制台横幅写的是「app updates must support 16 KB memory page sizes by **February 1, 2027**」。

**我们的现状（本机实测，非推测）**：把当前 APK 里的 `lib/arm64-v8a/*.so` 逐个用 NDK 的
`llvm-readelf -l` 看 LOAD 段对齐 —— 15 个库全是 `0x1000`（4 KB），**没有一个达标**：

```
libappmodules.so        0x1000
libexpo-modules-core.so 0x1000
libhermes.so            0x1000
libreactnative.so       0x1000
…（共 15 个 arm64 库，全部 0x1000）
```

**为什么不能只改一个开关**：ELF 段对齐是**编译期**决定的（`-Wl,-z,max-page-size=16384`）。
`libhermes.so` / `libreactnative.so` 来自 react-native 的预编译产物，Expo SDK 52（RN 0.76）
那批预编译库就是 4 KB。要达标只有两条路：

1. **升到 Expo SDK 53/54**（RN 0.79 / 0.81，官方预编译库已按 16 KB 对齐）——顺带把 targetSdk
   变成 36，不用再靠 `expo-build-properties` 顶；
2. 自己用 NDK r27+ 从源码重编 RN 与 Hermes（工作量大得多，不推荐）。

**建议的排期**：这是一次大版本迁移（RN 0.76→0.81、React 18.3→19，`expo-*` 全家升），
要单独一批做，做完必须重新出包 + 跑一遍真机回归。**在 2027-02-01 之前完成即可**，
它不挡现在的首次上架。

---

## 三、控制台侧待办（只能你在 Play Console 操作）

按顺序做，前 3 项没做完审核根本不会开始：

1. **开发者账号 + 一次性 $25**（若还没注册；用公司主体的话准备营业执照）。
2. **创建应用 → 上传 AAB**：先走「内部测试」轨道（最快能看到真实设备效果），再封闭测试，最后生产。
3. **应用访问权限（App access）**：我们的主体功能在登录后才可见，**必须提供审核用的演示账号**
   （邮箱 + 密码，在控制台填「所有功能需要登录」+ 账号凭据）。不给的话，审核会以
   「无法评估」直接驳回。
4. **数据安全表单（Data safety）**：逐项答案见附录 A。**这是法律性质声明，请按实际数据流核对后再提交。**
5. **内容分级问卷（IARC）**：类别选「社交 / 通讯」，含用户生成内容 = 是，含广告 = 否，
   是否分享位置 = 否。结果通常是 18+。
6. **目标受众与内容**：选 **18 岁以上**（与注册页「仅限 18 岁以上使用」一致），
   不要勾「面向儿童」。
7. **其他声明**：广告（无）、新闻（无）、政府（无）、健康（无）、金融（无）、
   COVID 接触追踪（无）。
8. **商店素材**：图标 512×512、Feature graphic 1024×500、手机截图至少 2 张。
   （截图与图标见 `docs/play-assets/`，说明见该目录的 README。）
9. **隐私政策 URL**：`https://talkfirst.ccwu.cc/legal/privacy`（英文站 `/en/legal/privacy`）。
10. **Play 应用签名**：用 **upload key**（Play 会另发一套签名给最终用户）。
    ⚠️ 官网下载那个 APK 用的是本机密钥 `talkfirst-local.keystore`，
    **不要把它当 upload key 上传**；两条分发渠道签名不同是正常的，互不影响
    （热更新按 runtimeVersion 走，两边都能收到）。

### 关于热更新（expo-updates）

Play 允许推送 **JS 层**的更新（我们走的正是这条），但**不能用它绕过审核去改应用的目的或功能边界**。
所以：文案、界面、接口调用可以热更；新增原生能力（如新权限、新 SDK）必须重新出包走审核。

---

## 四、出包与验证命令（本机，不用 EAS）

```bash
# 1) 克隆必须落在纯 ASCII 路径（仓库原位置含中文，Windows 版 hermesc 会退出码 6）
cd /d/talkfirst && git fetch origin && git reset --hard origin/master
npm ci --legacy-peer-deps

# 2) 生成原生工程（不要 --clean：会连签名密钥库一起删掉）
cd apps/mobile && npx expo prebuild --platform android --no-install

# 3) 官网下载用的 APK（arm64 + v7a，~39MB）
cd android && ./gradlew assembleRelease --no-daemon

# 4) Play 上传用的 AAB（多带 x86_64，Play 按设备下发，不影响手机下载体积）
sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64/' ../gradle.properties
./gradlew bundleRelease --no-daemon
```

产物：`apps/mobile/android/app/build/outputs/{apk,bundle}/release/`

**出包后必须复核的三件事**（三步都在本仓库里做过）：

```bash
# a) 权限真的没了吗（应看不到 RECORD_AUDIO / SYSTEM_ALERT_WINDOW / CAMERA …）
grep -o 'android:name="[^"]*"' app/build/intermediates/merged_manifests/release/*/AndroidManifest.xml \
  | grep -i permission | sort -u

# b) targetSdk 真的是 36
grep -o 'targetSdkVersion[^ ]*' app/build/intermediates/merged_manifests/release/*/AndroidManifest.xml

# c) 签名不是调试密钥（模板默认指向 signingConfigs.debug，是公开密钥 —— 必须确认已换成自己的）
grep -n "signingConfig" app/build.gradle
```

---

## 附录 A：数据安全表单（Data safety）逐项答案草案

**请按实际数据流核对后再提交**；下面每条的「依据」是代码里能查到的位置。凡是我无法从代码
断定的（比如服务端访问日志的实际保留策略），都标了「**待你确认**」。

| 表单里的项 | 建议答案 | 依据 |
|---|---|---|
| 邮箱地址 | 收集（账号管理、应用功能）；传输加密；不共享；用户可申请删除 | `auth.dto` / 注册登录 |
| 昵称、头像、简介、生日、国家/地区、性别 | 收集（应用功能、账号管理）；不共享 | `EditProfileScreen`、`PATCH /users/me` |
| 语言、兴趣、交友目的、交友属性 | 收集（应用功能）；不共享 | `/me/interests`、`/me/attributes` |
| 照片与视频 | 收集（用户主动发布动态时）；不共享 | `POST /uploads/moment-media`、`/uploads/moment-video` |
| 消息（站内私聊） | 收集（应用功能）；不共享 | `conversations/messages` |
| 通讯录 | **不收集** | 未申请任何联系人权限 |
| 位置 | **不收集** | 清单里没有位置权限 |
| 设备或其他 ID | **不收集**（App 端没有接入广告/统计 SDK） | `apps/mobile/package.json` 无相关依赖 |
| 崩溃日志与诊断 | **待你确认**：App 端没有接崩溃上报 SDK；但服务端有访问日志。若按「应用活动」申报更稳妥 | 服务端 nginx / pm2 日志 |
| 数据加密传输 | 是 | 生产接口一律 HTTPS（`src/lib/config.ts` 的 `PRODUCTION_BASE_URL`） |
| 可否删除数据 | 可以：应用内「注销账号」+ 网页入口 | `DeleteAccountScreen` |

---

## 附录 B：还差的、我知道的坑

- **16 KB 页大小**（第二节）—— 有截止日期，需要 SDK 升级。
- **首次提交可能需要多轮**：Play 对社交类应用的审核偏严，尤其「举报/拉黑是否真的可达」
  与「审核账号能否走通主流程」。第一次被驳回是常态，按驳回理由改就行。
- **iOS**：本次完全没做（`app.json` 里 iOS 只有 bundleIdentifier）。要上 App Store 是另一条线。
