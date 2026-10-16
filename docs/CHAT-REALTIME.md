# 聊天实时消息

状态：**已实现**（2026-10-16）。代码：`apps/api/src/chat/*`、
`apps/mobile/src/lib/chat-socket.ts`、`apps/web/src/lib/chat-socket.ts`。

## 1. 现在谁实时了

| 端 | 状态 |
| --- | --- |
| web | 早就走 socket（`message.send` 发送 + 事件接收） |
| **App** | 2026-10-16 接入：**接收实时**，发送仍走 REST |

App 之前是「进会话拉一页 + 手动下拉刷新」，对方发来的消息要手动刷新才看得到。
现在打开会话即时到，会话列表也会自己更新（预览/未读/排序）。

## 2. 协议（服务端与两端共用）

- 命名空间：`<origin>/chat`（socket.io）。`origin` 由 API 基址去掉 `/api/v1` 得到
  （`apps/mobile/src/lib/config.ts` 的 `socketBaseUrl()`）—— 不另配一个环境变量，
  两个地址各配一次迟早有人只改一半，症状是「接口通、实时不通」。
- 握手鉴权：`auth.token`（App 没有 cookie）→ `Authorization` 头 → `cookie tf_access`
  三级回退（`chat-auth.service.ts`）。
- 房间：
  - `conversation:<id>`：靠客户端 `conversation.join` 进入，收 `message.new`；
  - `user:<id>`：连接时**自动加入**，收 `conversation.activity`（列表用）。
- 事件：`message.new`、`conversation.activity`、`typing`、`presence`、
  `conversation.joined`、`ready`、`error`。客户端可发：`conversation.join/leave`、
  `message.send`、`typing`、`presence.get`。

## 3. 一条必须记住的约束：广播只有一处

消息有**两条写入路径**：

1. socket 的 `message.send`（web 用）；
2. REST 的 `POST /conversations/:id/messages`（**App 用**）。

广播（`message.new` / `conversation.activity`）必须两条路径都发 —— 只写一条会出现
「用 web 发的消息对方即时收到，用 App 发的消息对方收不到」。这个缺口在真实后端上被
`scripts/verify-chat-realtime.mjs` 抓到过一次，所以现在**唯一**的广播口是
`apps/api/src/chat/chat-events.ts`：网关的 socket 发送与 social 控制器的 REST 发送
都调它。房间名与负载形状也只有那一份。

为什么是模块级函数而不是 Nest provider：它包住的 socket.io `server` 在进程里本来就
只有一份，「注入」不带来隔离，却会让每个用到它的测试都多写一个 provider 替身。
没有 socket 层时**静默跳过**：广播尽力而为，消息已经写进库。

## 4. 客户端要点（`chat-socket.ts`，App）

- **只接收**：发送仍走 REST（能明确报错、区分 AI 会话）。自己发的那条会同时从
  REST 返回、又随 `message.new` 广播回来，所以按 `id` 去重（`appendMessageOnce`）。
- **一个连接服务两个位置**：列表与打开的会话共用同一条 socket；
  切会话只 emit `conversation.join/leave`，**不重连**。
- **重连纪律**（与 web 同源，这些数字背后是一次真实事故）：
  - 退避与抖动交给 socket.io 的 Manager；
  - 服务端主动断开（`io server disconnect`）由自己有限次重连（≤5，退避递增）；
  - `UNAUTHORIZED` **每个会话最多刷新一次**令牌；会话真正建立（`conversation.joined`）
    后才恢复预算 —— 否则会退化成「每秒几十次握手 + 同时刷新令牌」的死循环；
  - `USER_BANNED` / `USER_DISABLED` 直接停下，不重试。
- **断线期间的消息不会补发广播**：重新连上时补拉一次（列表 + 正在看的会话），
  会话内容是**合并**而不是替换（不把用户正在看的旧消息抽走）。
- 列表预览：图片消息显示本地化的「[图片]」，不显示图片 URL。
- 连接不健康时只在顶部显示一行状态（正常连着不占地方）。

## 5. 验证

```bash
# 1) 客户端逻辑（App，16 条：连接参数/事件过滤/去重/重连预算/换会话/关闭）
npm test -w @talkfirst/mobile

# 2) 服务端广播契约（房间、负载、无 server 时不抛错）
npx jest src/chat/chat-events.spec.ts -w @talkfirst/api

# 3) 真实后端端到端：两条通道分开断言
node scripts/seed-chat-test-accounts.cjs        # 见文件头（默认拒绝执行，需显式开关）
node scripts/verify-chat-realtime.mjs           # 默认打生产域名，--base 可换
```

`verify-chat-realtime.mjs` 断言的是「App 到底能不能实时看到」这件事的**服务端那一半**：
打开会话时同时收到 `message.new` 与 `conversation.activity`；离开房间（只在列表页）时
只收到 `conversation.activity`。这两条分开断言，才能区分「服务端没发」与「客户端没处理」。

## 6. 已知边界

- **不做历史补发**：断线期间的消息靠重连后补拉最新一页，不做服务端事件重放。
  会话很长且断线很久时，中间那段要靠「加载更早的消息」往下找。
- **typing 是尽力而为**：4 秒无输入自动发一次 `typing: false`，丢一个包就会多显示
  几秒「正在输入」。
- 发送仍走 REST：socket 的 `message.send` 只有 web 在用，两条路径的**广播**已统一，
  但**发送**没有合并。
