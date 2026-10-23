# Google Play 上架手册（TalkFirst）

这份文档只回答一件事：**把 TalkFirst 提到 Google Play 上并被审核通过，需要哪些东西、现在缺什么。**

分两半：
- **A. 代码/产物侧** —— 已经做完的，附证据；以及以后每次发版怎么出包。
- **B. Play Console 侧** —— 只有你能做的（账号、表单、素材、测试轨道），逐项给了可直接照抄的答案。

> 状态时间：2026-10-23。Play 的政策每年都会抬 targetSdk 门槛，重新提交前先看 B.1。

---

## A. 代码与产物

### A.1 已经满足的硬性条件（含证据）

| 要求 | 现状 | 怎么验证的 |
|---|---|---|
| targetSdk 36（2026 年新应用门槛） | `compileSdk/targetSdk = 36` | `app.json` 的 expo-build-properties；合并清单里 `targetSdkVersion="36"` |
| 包名稳定 | `com.talkfirst.app` | `app.json → android.package` |
| versionCode 单调递增 | 当前 `3`（versionName `0.1.3`） | `app.json`；每次发版必须比上一次大 |
| 权限最小化 | 运行时只有 `INTERNET`、`VIBRATE`（+ 库自带的 `ACCESS_NETWORK_STATE`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`） | 见 A.4 的 `aapt2 dump badging` 输出 |
| 无敏感权限（相机/录音/悬浮窗/存储） | 已在 `blockedPermissions` 里移除，prebuild 生成 `tools:node="remove"` | `android/app/src/main/AndroidManifest.xml` |
| 隐私政策：公网可访问、双语 | `https://talkfirst.ccwu.cc/legal/privacy`（英文 `/en/legal/privacy`） | 200；正文 9 节，含第三方、保存期限、18+、权利 |
| 账号删除：应用内 + 网页 | 应用内「我的 → 账号 → 注销账号」；网页 `https://talkfirst.ccwu.cc/delete-account` | `DELETE /users/me` 硬删除（`prisma.user.delete`） |
| UGC 治理（举报 + 拉黑） | 会话页/动态详情页可举报、可拉黑；「我的 → 隐私与安全」可管理 | `SafetyScreen`、`POST /reports`、`DELETE /blocks/:userId` |
| 条款与社区规则 | `/legal/terms`、`/legal/rules`，注册后强制勾选同意 | `/legal` 同意门 |
| 18+ 声明 | 隐私政策 §8；注册时的**强制勾选**「我已年满 18 岁」（web + 移动端） | 未勾选时提交按钮 disabled；词典 `auth.adultConfirm` / `auth.consent` |
| 无广告、无第三方统计 SDK | 依赖里没有 Sentry/Firebase/Amplitude 等 | `package.json` |
| 数据传输加密 | 全站 HTTPS（含 API、WebSocket） | 线上证书 + HSTS |

### A.2 产出物在哪

| 东西 | 路径 |
|---|---|
| AAB（交给 Play 的文件） | `D:\Android\play\talkfirst-0.1.3.aab`（46MB，versionCode 3，targetSdk 36） |
| 上传密钥（upload key） | `D:\Android\keystores\talkfirst-play-upload.keystore`（别名 `talkfirst`，RSA 4096，30 年） |
| 上传密钥证书指纹 | SHA-256 `71:83:AE:DB:E1:47:26:4E:21:89:5C:2F:45:2C:36:8C:7E:DA:A7:A5:41:3C:06:C0:5B:EC:5F:D6:88:8A:F1:2E`（在 Play Console 登记上传证书时对得上） |
| 密钥口令与备份说明 | `D:\Android\keystores\UPLOAD-KEY-README.txt`（chmod 600） |
| gradle 读的口令文件 | `D:\Android\keystores\keystore.properties`（chmod 600，**别提交进仓库**） |
| 商店图标 512×512 | `store/play/icon-512.png` |
| Feature Graphic 1024×500 | `store/play/feature-graphic-1024x500.png` |

> ⚠️ **上传密钥必须备份**：丢了就得找 Google 重置上传密钥（要走申诉流程，几天内发不了版）。
> 备份三份：密码管理器（口令 + 指纹）、离线介质（.keystore 本体）、云盘私密目录。
> 重新生成：`bash scripts/new-upload-key.sh`（已存在则拒绝覆盖，防止误换线上密钥）。
>
> **为什么单独立一把新钥匙**：旧的 `talkfirst-local.keystore` 口令是 `talkfirst-local`，
> 只适合自签名侧载包；拿它当 Play 上传密钥等于把发版权限交给弱口令。
> 新钥匙是随机 32 位口令 + RSA 4096。旧钥匙保留仅用于给老装机用户出同签名更新包，
> 与 Play 无关（Play 侧的应用签名密钥由 Google 保管，侧载安装本来就要换装 Play 版本）。

### A.3 以后每次发版怎么出包

```bash
# 1) 改版本号（app.json）：version 与 android.versionCode 一起抬
#    version 影响 OTA 通道（runtimeVersion=appVersion），versionCode 是 Play 的排序键
# 2) 出 AAB
bash scripts/build-aab-locally.sh
# 产物：D:\Android\play\talkfirst-<version>.aab
```

脚本每次都会 `expo prebuild --clean`，所以 `app.json` 是唯一事实源：
权限、targetSdk、versionCode、图标都从它生效，不再依赖 `android/` 目录里残留的旧配置。

脚本末尾会打印合并后的权限与版本号，**权限里出现相机/录音/存储就直接失败退出**——
这是防止哪天某个依赖偷偷把敏感权限带回来的闸门。

### A.4 自检命令（想复核时用）

```bash
AAPT="/d/Android/sdk/build-tools/36.0.0/aapt2.exe"
"$AAPT" dump badging /d/Android/talkfirst-local.apk | grep -E "^package|uses-permission"
```

---

## B. Play Console 侧（只有你能做）

### B.1 账号与前置条件

1. **Google Play 开发者账号**：一次性 $25，需身份验证（个人账号要身份证件 + 地址）。
2. **新个人账号的封闭测试门槛**（2023-11 之后注册的账号适用）：
   生产发布前必须先跑 **封闭测试，至少 12 名测试者连续 14 天**。
   这意味着「今天提审、明天上架」不可能——**最少要预留 2–3 周**。
   > 公司账号（组织账号）不受这条限制，但要 D-U-N-S 编号，申请也要几天。
3. **开发者公开信息**：开发者名称、支持邮箱（建议 `support@talkfirst.ccwu.cc`）、地址（会公开展示）。

### B.2 商店资料（可直接复制）

**应用名称（≤30 字符）**
- 中文：`TalkFirst — 先聊再交朋友`
- 英文：`TalkFirst: Talk First, Meet Later`

**简短说明（≤80 字符）**
- 中文：`先聊天，再决定要不要做朋友。真人语言交换 + AI 陪练，不露脸也能练口语。`
- 英文：`Talk first, then be friends. Real language-exchange partners plus an AI partner.`

**完整说明（≤4000 字符）**

中文：

```
TalkFirst 是一个「先聊天，再决定要不要成为朋友」的语言交换社区。

和刷脸滑卡的产品不同，这里没有照片墙竞赛，也没有必须秒回的社交压力。
你可以先和一个真人用文字聊几句，觉得聊得来，再决定要不要交换联系方式。

■ 真人语言交换
按母语和想学的语言匹配，找到正在学你母语、而你想学他母语的人。
双方各练一半时间，谁也不吃亏。

■ AI 陪练
还没找到合适的伙伴？先和 AI 练。它不会评价你的口音，也不会嫌你句子短。
说错了就重来，练熟了再去找真人。

■ 动态与视频
发一段语音或视频动态，让别人先听见你的声音、看见你的表达，
而不是先看见一张精修过的头像。

■ 你的资料，你决定谁能看
每个资料字段（照片、国家、简介、语言水平）都能单独设置可见范围：
公开 / 仅连接 / 仅自己。聊天内容只有会话双方可见。

■ 安全
- 一键举报与拉黑，举报会有处理结果
- 仅限 18 岁以上使用
- 不向第三方出售你的个人资料，也不做第三方广告投放
- 随时可以在应用内注销账号，资料随之删除

隐私政策：https://talkfirst.ccwu.cc/legal/privacy
账号删除：https://talkfirst.ccwu.cc/delete-account
联系我们：support@talkfirst.ccwu.cc
```

英文：

```
TalkFirst is a language-exchange community built on one idea: talk first, decide about friendship later.

No photo-first swiping, no wall of polished selfies, no pressure to reply within seconds.
Start with a few lines of text with a real person. If it clicks, decide whether to exchange contacts.

■ Real language exchange
Match by native language and the language you want to learn — you practise their language, they practise yours, half the time each.

■ AI practice partner
No partner free right now? Practise with the AI. It will not judge your accent or mind short sentences. Make mistakes, try again, then go find a human.

■ Voice and video moments
Post a short voice or video moment so people hear how you speak before they see a curated profile picture.

■ You decide who sees what
Every profile field (photo, country, bio, language level) has its own visibility setting: public / connections only / only me. Chats are visible only to the two people in them.

■ Safety
- One-tap report and block, and reports get an outcome
- Adults 18 and over only
- We do not sell your personal information and we do not run third-party ads
- Delete your account in the app at any time; your data goes with it

Privacy policy: https://talkfirst.ccwu.cc/en/legal/privacy
Account deletion: https://talkfirst.ccwu.cc/delete-account
Contact: support@talkfirst.ccwu.cc
```

**图形素材**

| 素材 | 规格 | 现在有没有 |
|---|---|---|
| 应用图标 | 512×512 PNG，无透明圆角 | ✅ `store/play/icon-512.png` |
| Feature Graphic | 1024×500 PNG/JPG，无边框、无「下载/安装」字样 | ✅ `store/play/feature-graphic-1024x500.png` |
| 手机截图 | 至少 2 张，建议 6 张；16:9 或 9:16，短边 ≥320px | ❌ **待补**（见 B.7） |
| 平板截图 | 7"/10" 各至少 1 张（若声明支持平板） | ❌ 可选；当前 `supportsTablet` 只管 iOS |

**其他字段**
- 应用类别：`社交`
- 标签：语言学习、语言交换、朋友
- 联系方式邮箱：`support@talkfirst.ccwu.cc`
- 隐私政策网址：`https://talkfirst.ccwu.cc/legal/privacy`

### B.3 应用访问权限（App access）

审核员打不开登录墙后面的功能，会直接以「功能不可用」驳回。

选「所有功能都需要登录」，然后填一组**专用测试账号**：

```
邮箱：<你新建的测试邮箱>
密码：<强口令>
备注：注册后需在邮箱里点验证链接；如收不到，可在登录页用「重发验证码」。
```

建议：
- 用你能收到的邮箱注册（比如 `reviewer+play@talkfirst.ccwu.cc` 这种别名），密码单独设一个。
- 在备注里写清「AI 陪练在首页 → AI；发动态在底部 → 动态 → +」。
- 这个账号**不要**给真实用户用，也别设成管理员。

### B.4 内容分级（IARC 问卷）

按实际勾选，别为了低分级撒谎（抽查到会下架）：

| 问题 | 答案 |
|---|---|
| 是否包含暴力内容 | 否 |
| 是否包含性内容或裸露 | 否 |
| 是否包含脏话 | 否（但我们允许用户自由聊天，见「用户互动」） |
| 是否包含受管制物品（烟酒毒品） | 否 |
| 是否包含赌博 | 否 |
| 用户能否互相交流 | **是** |
| 用户能否发布/分享用户生成内容（文字、图片、视频） | **是** |
| 用户能否分享精确位置 | 否 |
| 是否含数字商品购买 | 否（送花是免费互动，不涉及支付） |
| 是否有不受限的网页访问 | 否 |
| 是否面向儿童 | 否（目标受众 18+） |

预期结果：**Teen / 17+ 区间**，加上「用户互动、用户生成内容」提示。
目标受众单独选 **18 岁以上**，并在「是否吸引儿童」一栏选「否」。

### B.5 数据安全表单（Data safety）

这张表必须和隐私政策、和 App 实际行为三者一致。TalkFirst 的答案：

**收集的数据**

| 类别 | 具体项 | 用途 | 是否共享 | 可选/必填 |
|---|---|---|---|---|
| 个人信息 | 邮箱地址 | 账号管理、登录验证 | 否 | 必填 |
| 个人信息 | 昵称、头像、国家/城市、简介、语言水平、出生日期 | 应用功能（资料展示、匹配） | 否 | 必填 |
| 照片和视频 | 头像照片、动态里的图片/视频 | 应用功能 | 否 | 可选 |
| 消息 | 站内私信 | 应用功能 | 否 | 必填（使用即产生） |
| 消息 | 与 AI 陪练的对话 | 应用功能 | **是 —— Google（Gemini）** | 可选 |
| 应用活动 | 点赞、送花、举报、拉黑、浏览 | 应用功能、安全与反滥用 | 否 | 必填（使用即产生） |

**安全实践**
- 传输加密：**是**（全站 HTTPS / WSS）
- 用户可请求删除数据：**是** → `https://talkfirst.ccwu.cc/delete-account`（同时在应用内提供）
- 数据是否出售：**否**
- 是否用于广告：**否**

> 为什么把「AI 对话 → Google」填成「共享」：Play 对「共享」的定义是数据离开你的系统到第三方。
> 虽然 Gemini 在这里是受托处理方，但审核员会看到 App 把消息发给了第三方 API，
> 而我们的隐私政策 §5 也已经写明这一点。三者对齐才不会被追问。

### B.6 其他声明

| 声明 | 选择 |
|---|---|
| 应用是否含广告 | **否** |
| 是否为新闻应用 | 否 |
| 是否含 COVID-19 接触追踪 | 否 |
| 是否为政府应用 | 否 |
| 是否面向儿童（Families 政策） | 否 |
| 目标 API 级别 | 36（已满足） |

### B.7 还差什么（按优先级）

1. **手机截图（必须，只能真机出）** —— 至少 2 张，建议 6 张：
   首页/发现、AI 陪练对话、会话列表、动态详情（视频）、我的资料、隐私与安全。
   规格：PNG/JPEG，短边 ≥320px、长边 ≤3840px，比例 16:9 或 9:16（1080×1920 最稳）。
   出图方式二选一：
   - 手机直接截屏（Android 截屏比例就对）→ 拷到 `store/play/screenshots/`；
   - 或插上手机后 `adb exec-out screencap -p > 01-home.png`（逐屏切完再截）。
   > 注意：不要用 web 版页面截图充数 —— 与 App 实际界面不一致，属于「误导性素材」。
2. **测试账号（必须）** —— 审核员要能登录。用专用邮箱在 App 里注册一个
   （建议 `reviewer@talkfirst.ccwu.cc`），把邮箱/密码写进 Play Console 的
   「应用访问权限 → 提供登录信息」，并在备注里写清三条路径：AI 陪练在哪、怎么发动态、怎么举报/拉黑。
3. **封闭测试的 12 名测试者** —— 这条最花时间，建议**现在就开一个封闭轨道**把人凑齐，
   代码这边不影响（后续版本可以继续更新同一个轨道）。
4. ✅ **18+ 显式确认（已完成）** —— web 注册页已有强制勾选「我已年满 18 岁」（未勾选时提交按钮 disabled，
   `handleSubmit` 再拦一次）；移动端 `auth.consent` 勾选框本来就是这个语义。
   未勾选时无法创建账号，属于可核查的年龄确认。
5. **平板截图**（可选）—— 只有在声明支持平板时才需要。
6. **Android 16 边到边（edge-to-edge）真机验收** —— targetSdk 36 下系统会强制边到边，
   RN 0.76 对这块的支持不完整，可能出现状态栏/导航栏遮住内容。**提审前必须在 Android 15/16 真机上
   把六个主页面过一遍**；如果遮了，用 `react-native-safe-area-context` 补顶部/底部内边距即可。

### B.8 提交流程（推荐顺序）

```
创建应用 → 填商店资料 → 上传 AAB（内部测试）→ 自查安装
   → 封闭测试轨道（12 人 / 14 天）
   → 申请生产发布 → 分阶段发布 20% → 观察崩溃率与评价 → 全量
```

**审核期间的两条纪律**
- 不要在审核中推 OTA 改功能：`runtimeVersion = appVersion`，热更新会立刻改变审核员看到的内容，
  容易触发「应用行为与申报不符」。等审核过再推。
- 提审的 AAB 与商店资料里的截图/描述要对应，别写还没上的功能。

---

## C. 一句话总结

代码侧已经到「可以提交」的状态（AAB + 权限干净 + 隐私政策/注销/UGC 治理齐全）；
剩下的是 Play Console 的账号、表单、截图，以及新账号绕不开的 **12 人 × 14 天封闭测试**。
