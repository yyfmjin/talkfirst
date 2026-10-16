# 服务端下发文案的多语言

状态：**已实现**（2026-10-16）。相关代码：`apps/api/src/common/i18n.ts`、
`apps/api/src/common/locale.ts`、`apps/api/src/notifications/notification.service.ts`。

## 1. 为什么需要这一层

客户端（app / web）早就双语了，但**由服务端生成的句子**是硬编码的，而且中英混用：

| 场景 | 改前 | 后果 |
| --- | --- | --- |
| 收到消息 / 连接 / 交换请求 | 英文（`New message`、`It's a connection!`） | 中文用户看到英文 |
| 动态点赞 / 评论 / 回复 | 中文（`你的动态收到点赞`） | 英文用户看到中文 |
| 管理员处理结果（封禁、举报） | 中文 | 同上 |
| 验证码邮件 | 中文（主题也是） | 同上 |

为什么不让客户端按 `notification.type` 自己翻译：**决定语言的必须是收件人，而收件人
往往不在请求里** —— 给你发消息的是对方。而且正文混着昵称、消息摘要这些运行时数据，
客户端只拿到 `type` 还原不出来。

## 2. 语言怎么定

`common/locale.ts` 是唯一入口，顺序固定：

1. **账号里显式选择的界面语言**（`User.locale`，`zh` / `en`，客户端上报）；
2. **母语**（`UserLanguage.type = NATIVE`，取第一个受支持的语言）——
   老账号没有 `locale` 字段，母语是唯一可信的信号，不能让英文母语的用户收到中文通知；
3. **中文兜底**（产品基本盘；`DEFAULT_LOCALE`）。

两条不变式：

- **查不到语言不能让通知 / 邮件失败。** 数据库出错就降级到兜底语言，照发。
- **`localeForUserId` 有 60 秒进程内缓存。** 群聊里连着来消息不该每条通知回一次数据库；
  60 秒又短到用户切换语言后下一批通知就跟着变。测试用 `clearLocaleCache()` 隔离用例。

邮件（`localeForEmail`）略有不同：账号存在时按账号设置；**账号还不存在**（注册验证码，
那是最常见的路径）时看 `Accept-Language` 请求头 —— 那是唯一能表达「这个人现在想看什么
语言」的信号。重置密码时账号一定存在，所以走账号设置。

## 3. 加一条新文案

1. 在 `common/i18n.ts` 的 `ZH` 里加一条 `"notify.xxx"`（可带 `{name}` 占位符）；
2. 在 `EN` 里加同名的一条 —— **这是编译期检查**：`EN` 是 `Record<MessageKey, string>`，
   漏了直接编译不过（这是这一层最重要的价值，以前漏翻要等上线才发现）；
3. 产出点传 `msg("notify.xxx", { name })`，不再拼字符串；
4. 跑 `npx jest src/common/i18n.spec.ts`：它还会检查两种语言的键集合一致、没有空文案、
   英文里不残留汉字。

## 4. 什么不该翻译

**用户自己产出的内容**原样保留，传字符串而不是键：消息预览（`content.slice(0, 120)`）、
动态正文、对方手写的招呼语（`trimmedMessage`）。`renderText` 对字符串是直通的 ——
要不要翻译由产出点决定，判断只有一次，且发生在知道来源的地方。

平台名（`WeChat` / `Instagram`）是品牌名，词典里不翻；列表连接符跟着语言走
（中文顿号、英文逗号），由 `t()` 按语言拼数组参数。

打招呼的模板文案（`🗣️ I'd like to practice languages.`）属于系统文案，所以按收件人语言
渲染 —— 它没有落库成消息（`ConnectionRequest.message` 只存自定义内容），不存在
「通知和会话里原文不一致」的问题。

## 5. 客户端怎么上报

- **app**：`api.ts` 每个请求带 `Accept-Language: <当前界面语言>`（覆盖请求期文案）；
  语言变化时、以及每次会话建立后（启动恢复 / 登录 / 注册）调 `reportLocale()` →
  `PATCH /users/me { locale }`。失败一律忽略：没登录、离线、5xx 都不影响界面，
  服务端仍会按母语推断一个合理语言。
- **web**：语言是**路由级**的（`/en/...`），浏览器自带 `Accept-Language`，
  加上母语兜底已经够用；不在网页上自动改账号语言（一次「用英文看看」不该
  把通知语言改掉）。
- 接口契约：`PATCH /users/me` 新增可选字段 `locale: "zh" | "en"`（`@IsIn(SUPPORTED_LOCALES)`）。

## 6. 验证

### 6.1 端到端（真实 HTTP + 真实 PostgreSQL，推荐）

```bash
# 本地库 + 本地 API
cat > /tmp/run-i18n-e2e.sh <<'SH'
cd "D:/文件/网站/TalkFirst"
npm run build -w @talkfirst/api
API_PORT=4100 node --env-file=.env apps/api/dist/main.js
SH
bash .local-data/pc12/withpg.sh /tmp/run-i18n-e2e.sh &

# 用三个临时账号把三条规则各跑一遍
node --env-file=.env scripts/verify-server-i18n.mjs http://127.0.0.1:4100
```

脚本自己建账号、跑完自己删（邮箱域名 `@i18n-check.invalid`）；**只对本地 / 测试库跑**。
它钉住的是 HTTP → JWT → 服务层 → 写库这一整条链：母语兜底、显式语言优先于母语、
用户内容不翻译，以及 `PATCH /users/me { locale }` 的 200 / 400 两种结局。
（注意 API 的端口环境变量是 `API_PORT`，不是 `PORT`。）

### 6.2 单元测试

```bash
npx jest src/common/i18n.spec.ts src/common/locale.spec.ts -w @talkfirst/api
npx jest src/connections src/notifications src/auth/verification-lifecycle.spec.ts
```

### 6.3 线上抽查

```bash
# 英文请求头 → 验证码邮件主题为英文（账号不存在时的路径）
curl -s -X POST https://api.talkfirst.ccwu.cc/api/v1/auth/send-verification-code \
  -H "Content-Type: application/json" -H "Accept-Language: en-US,en;q=0.9" \
  -d '{"email":"new-user@example.com"}'
```
