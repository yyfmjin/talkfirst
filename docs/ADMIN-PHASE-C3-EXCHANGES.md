# ADMIN PHASE C3 — Contact Exchange Management / 交换管理

**Status: COMPLETE — STOPPED BEFORE C4 (Blocks)**

前置：B1 / B2 / B3 / B4 / B5 / C1 / C2 全部完成。
本阶段严格只读，未进入 C4，未启用 `exchanges:write`，未新增任何迁移。

---

## §1 Schema 实际结构（读取自 `prisma/schema.prisma`，非假设）

### `ExchangeRequest`

```prisma
model ExchangeRequest {
  id             String           @id @default(uuid()) @db.Uuid
  connectionId   String           @db.Uuid          // ← 无 FK，裸 UUID
  conversationId String           @db.Uuid          // ← 非空 + 真实 FK
  conversation   Conversation     @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  requesterId    String           @db.Uuid
  requester      User             @relation("ExchangeSent",     fields: [requesterId], references: [id], onDelete: Cascade)
  receiverId     String           @db.Uuid
  receiver       User             @relation("ExchangeReceived", fields: [receiverId],  references: [id], onDelete: Cascade)
  platforms      SocialPlatform[]
  message        String?          @db.VarChar(200)
  status         ExchangeStatus   @default(PENDING)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  shares         SharedSocialAccount[]
  @@index([conversationId, status]) @@index([requesterId, status]) @@index([receiverId, status])
}
```

**与 brief 假设的三处差异，均已按真实 schema 实现：**

| brief 假设 | 真实情况 | 影响 |
|---|---|---|
| `conversationId` 有真实 FK | ✅ 且**非空**（`String`，不是 `String?`） | 夹具必须建真实 `Conversation`；详情页永远显示 id，不存在「未关联」分支 |
| `connectionId` 无 FK | ✅ 确认 | 详情必须做独立、可失败的查询，`connectionAvailable` 处理 |
| `platforms: SocialPlatform[]` | ✅ 确认，默认 `[]` | 筛选语义为「数组包含」，非相等 |

### `SharedSocialAccount`（本阶段最关键的表）

```prisma
model SharedSocialAccount {
  id String @id @default(uuid()) @db.Uuid
  ownerId         String @db.Uuid   // owner User @relation("SharesGranted")
  viewerId        String @db.Uuid   // viewer User @relation("SharesReceived")
  platform        SocialPlatform
  socialAccountId String @db.Uuid   // SocialAccount FK, onDelete: Cascade
  exchangeId      String @db.Uuid   // ExchangeRequest FK, onDelete: Cascade
  createdAt       DateTime @default(now())
  @@unique([ownerId, viewerId, platform])
}
```

Schema 自带注释即为本阶段的授权模型定义：

> Per-pair authorization: owner grants viewer the right to see ONE account.
> This is the single source of truth for "who may see whose handle".
> Visibility on SocialAccount is only the account's default state and must
> never be treated as proof that a specific viewer is authorized.

### `SocialAccount`

```prisma
model SocialAccount {
  id String @id @default(uuid()) @db.Uuid
  userId String @db.Uuid
  platform SocialPlatform
  handle String @db.VarChar(128)   // ← 敏感：真实世界标识
  syncEnabled Boolean @default(false)
  createdAt / updatedAt
  @@unique([userId, platform])
}
```

**无任何 OAuth / token / credential 列。** 但 `handle` 本身敏感。

### `SocialPlatform` 真实枚举（12 个，非猜测）

`INSTAGRAM` `TELEGRAM` `WHATSAPP` `DISCORD` `X` `TIKTOK` `WECHAT` `QQ` `STEAM` `YOUTUBE` `FACEBOOK` `TALKFIRST`

brief 提示「不要假设 Instagram/Telegram/WhatsApp/WeChat/Discord/X/TikTok 一定都存在」——实际 12 个，多出 `QQ`/`STEAM`/`YOUTUBE`/`FACEBOOK`/`TALKFIRST`。因此平台白名单**从生成的 Prisma 枚举派生**（`Object.values(SocialPlatform)`），而非手写。

### `ExchangeStatus`

`PENDING` `ACCEPTED` `REJECTED` `CANCELLED` —— 仅此四个，无 `EXPIRED`/`COMPLETED`/`REVOKED`。

---

## §2 Exchange List API

`GET /api/v1/admin/exchanges`，权限 `exchanges:read`。

- `AdminService.listExchanges(query)`，`count` + `findMany` 在同一 `$transaction` 内共享同一个 `where`，总数与页面永不可能不一致。
- 返回 `{ items, total, page, pageSize, totalPages }`，`totalPages = ceil(total / pageSize)`。
- 响应字段（`EXCHANGE_LIST_SELECT`，显式具名，无 `include`）：
  `{ id, status, platforms, createdAt, requester: {id, nickname}, receiver: {id, nickname} }`
- 明确不含：`message`（详情页职责）、`shares`/`SharedSocialAccount`、`conversation`、`connection`、`email`。
- 控制器只转发参数，默认值 / 校验 / 白名单全部在 `AdminService`。

---

## §3 Exchange Detail API

`GET /api/v1/admin/exchanges/:id`，权限 `exchanges:read`。

响应结构：

```
{
  exchange: { id, connectionId, conversationId, platforms, message, status, createdAt, updatedAt },
  requester: { id, nickname },
  receiver:  { id, nickname },
  sharedAccounts: [ { ownerId, viewerId, platform, createdAt } ],
  connectionAvailable: boolean,
  connection: { id, status, createdAt, conversationId, userA {id,nickname}, userB {id,nickname} } | null,
  history: [ ... ]
}
```

- `EXCHANGE_DETAIL_SELECT` / `SHARED_SOCIAL_SELECT` / `EXCHANGE_HISTORY_SELECT` 三个显式 select 常量，均 `satisfies Prisma.*Select`。
- 四个独立读取用 `Promise.all` 并发，无 N+1。
- 未知 id → **404 `EXCHANGE_NOT_FOUND`**，消息 `"Exchange request not found"` —— **复用** `apps/api/src/exchange/exchange.service.ts` 中正常用户服务已有的同一错误码，未新造。
- 从不返回 `200 { data: null }`。

---

## §4 Query 参数

`page` `pageSize` `status` `platform` `user` `createdFrom` `createdTo` `sort`

全部可选，控制器仅转发，规则集中在 `AdminService.buildExchangeWhere()` / `parseDateBoundary()` / `clampPage()` / `clampPageSize()` / `resolveExchangeSort()`。

---

## §5 status 语义

白名单 `EXCHANGE_STATUSES = ["PENDING","ACCEPTED","REJECTED","CANCELLED"]`。

- 大小写不敏感（`trim().toUpperCase()`）。
- 未知值**被忽略**（等于不筛选），与 `USER_STATUSES`/`REPORT_STATUSES`/`CONNECTION_STATUSES` 既有策略一致。
- `EXPIRED`/`COMPLETED`/`REVOKED` 不被接受，也不被发明——它们不是可存储状态，接受它们会让人以为交换能到达数据库无法表达的状态。

---

## §6 platform 数组语义

`ExchangeRequest.platforms` 是 `SocialPlatform[]`，因此筛选为**数组包含**：

```ts
{ platforms: { has: platform as SocialPlatform } }   // → PostgreSQL @>
```

- 相等的两种错误写法都被排除：`{ platforms: value }` 无法通过类型检查；`{ platforms: { equals: [value] } }` 只会匹配**恰好只要这一个平台**的请求，会静默隐藏所有多平台请求。
- 独立 SQL 校验用 `$1 = ANY("platforms"::text[])`，与 Prisma 的 `has` 是**两条不同路径**表达同一谓词。
- 夹具刻意把 `DISCORD` 放在两元素数组的**第二位**，所以相等实现会返回 0 并被抓住。
- 12 个真实枚举成员逐个验证均可作为筛选值。

---

## §7 user 过滤语义

- `Connection` 无 owner 列；`ExchangeRequest` **有具名两侧**（`requesterId` / `receiverId` 由谁发起决定，不是 UUID 排序）。
- 但「某人涉及的全部交换」仍跨两列，故过滤为 `requesterId = X OR receiverId = X`。
- UUID → 两侧精确匹配；其他文本 → 两侧 `nickname` 的 `contains`（大小写不敏感）。
- **默认不搜 email**：用户列表才是搜地址的界面；交换列表若悄悄按 email 匹配，其披露面会超过响应体本身。
- 夹具刻意让 Alice 是一条的 requester、另一条的 receiver，所以单列实现会返回 1 而非 2。

---

## §8 日期语义

- `createdAt gte/lte`，复用 B2/B4/C2 的 `parseDateBoundary()`。
- `not-a-date` → 400 `VALIDATION_ERROR` + `details`。
- `2026-02-30` → 400。`new Date("2026-02-30")` **不会**返回 `Invalid Date`，而是静默滚到 3 月 2 日；日历检查（`daysInMonth`）是阻止「筛选悄悄变成另一天」的关键。
- 前端 `createdTo` 补 `T23:59:59.999Z`，与 Users / Reports / Moderation 三页一致。
- 独立 SQL 绑定用 naive-UTC 字符串（`createdAt` 是 `timestamp without time zone`）；直接绑 JS `Date` 会被 PG 当 `timestamptz` 并按会话时区折算，两侧相差 8 小时。

---

## §9 分页

- `page` 1–1000，`pageSize` 1–100（复用既有 clamp）。
- `totalPages = ceil(total/pageSize)`；`total = 0` → `totalPages = 0`。
- 越界页 → **200 + `items: []`**，`total` 与 `page` 原样回显，**不自动跳到最后一页**（静默移动调用方比空页更糟，会让过期链接看起来生效）。
- 浏览器验证：创建 21 条额外夹具后 `共 N 条`、首页 20 行、第 2 页剩余行数、`第 2 / 2 页` 全部断言，且测试内 `finally` 自清。

---

## §10 排序

`EXCHANGE_SORT_ORDERS` 白名单 8 个键：`createdAt_desc/asc`、`status_asc/desc`、`requester_nickname_asc/desc`、`receiver_nickname_asc/desc`。

- 客户端字符串**永不**直接进入 `orderBy`——先查白名单，命中后交出常量本身。
- 未知键 → **400**，绝不静默回退到默认排序。
- 4 个昵称键均带 `nulls: "last"`：`User.nickname` 可空，而 PostgreSQL `ORDER BY … DESC` 默认 NULLS FIRST，降序会把无昵称的行排在最前。
- 默认 `createdAt_desc`。

---

## §11 SharedSocialAccount 授权模型

**`SharedSocialAccount` 是「谁可以把哪个账号给谁看」的唯一真相。**

- 本阶段**不**读 `SocialAccount.visibility`（该列已在 `phase16_drop_social_visibility` 迁移中删除）。
- 本阶段**不**重新实现 owner/viewer 鉴权，也**不**从 `SocialAccount.userId + platform` 推断共享关系。
- 详情只查询 `sharedSocialAccount.findMany({ where: { exchangeId }, select: SHARED_SOCIAL_SELECT })`。
- **方向按存储原样上报**：`ownerId` 授予、`viewerId` 接收。夹具同时包含 `Alice → Bob`（TELEGRAM）与 `Bob → Alice`（WHATSAPP），因此「归一化配对」或「交换两侧」的实现都会失败。独立 SQL 用复合键 `ownerId|viewerId|platform` 做一一比对，且额外断言「不存在 owner=Bob 且 platform=TELEGRAM 的倒置行」。

### 为何 `SHARED_SOCIAL_SELECT` 不含 `socialAccountId`

`socialAccountId` 指向 `SocialAccount`，其 `handle` 是真实世界标识。读取它就是朝「join handle」迈出一步，因此在源头拒绝该 join。共享关系本身已经足够有意义：「Alice 已与 Bob 共享 TELEGRAM」。

### 为何不返回「账号是否仍存在」标志

`SharedSocialAccount.socialAccountId` 是**真实外键且 `onDelete: Cascade`**，共享行不可能比它的 `SocialAccount` 活得更久——数据库在同一条语句里就删掉了。因此 `available: true` 会是一个常量，常量不是信息。这与 `ExchangeRequest.connectionId` 恰好相反：后者无外键，**可以**悬空，故详情用 `connectionAvailable` 显式处理。

---

## §12 connectionId 悬空行为

`connectionId` 无 FK，值只是「声明」而非「保证」。

- Prisma **无法** `include` 一个未声明的relation，因此唯一正确读法是独立、可失败的查询。
- `connection.findUnique({ where: { id: exchange.connectionId } })`，其 `null` 是**正常数据而非错误**。
- 结果：`connectionAvailable: false` + `connection: null`，HTTP **200**，绝不 500，绝不 404。
- 前端渲染「连接记录不可用（原连接已不存在）」。交换本身仍完整可读——运维不该因为一个过期链接而被挡住。
- 夹具用固定 UUID `deadbeef-0000-4000-8000-00000000c3c3`（合法格式但库中不存在）。

---

## §13 conversation 处理

- `conversationId` 是**非空真实 FK**，必然可解析，因此永远只返回 id，不存在 null 分支。
- **不 join `Conversation`**：join 意味着 `Message` 与 `ConversationMember`，即参与者的私聊。这既非需求所需，也非需求所许。
- `message`（`String? @db.VarChar(200)`）**会**返回——它是请求方写给接收方关于这次交换的备注，是交换自己的字段，且长度已被数据库限制。它**不是** `Message` 行。
- 验证：夹具向会话写入一条真实 `Message`（内容为可识别字面量 `PA_C3_PRIVATE_CHAT_BODY_MUST_NOT_BE_RETURNED`），断言它既不出现在 API 响应里，也不出现在浏览器 DOM 里。

---

## §14 隐私策略

深度递归扫描（遍历全部键路径）列表与详情响应，禁用字段：

`passwordHash` `tokenHash` `refreshToken` `accessToken` `oauth` `secret` `clientSecret` `ip` `userAgent` **`handle`**

除键名扫描外，还扫描**字面值**：`PW_EXCHANGE_SECRET_HANDLE_*` 必须既不在 API 响应中、也不在浏览器 DOM 中（键名扫描会漏掉「改了字段名的泄漏」，字面量扫描不会）。

另断言响应中不含 `@example.test`（邮箱）与 `$2a$10$`（bcrypt 前缀）。

---

## §15 handle 保护

- 列表**完全不涉及** `SharedSocialAccount`，因此不可能触及 `handle`。
- 详情只返回共享关系元数据（owner / viewer / platform / createdAt），**不返回** `handle`，也不返回 `socialAccountId`。
- 最强形式的保证：`SocialAccount` 表**从未被这两个方法查询过**——`handle` 不是被过滤掉的，而是从未被取出。Jest 用 `expect(prisma.socialAccount).toBeUndefined()` 钉住这一点，任何未来加入该查询的改动都会在此失败。
- 明确拒绝：不因为调用者是管理员就展示 `@username`、手机号、Telegram ID 或微信号。若未来产品需要可见性，那是**独立的隐私需求**，本阶段不扩张。

---

## §16 RBAC

读取自 `apps/api/src/admin/permissions.ts`（真实矩阵，非假设）：

| 角色 | `exchanges:read` |
|---|---|
| SUPER_ADMIN | ✅ |
| ANALYST | ✅ |
| MODERATOR | ❌ |
| SUPPORT | ❌ |
| CONTENT_MANAGER | ❌ |

- 与 `connections:read` 的持有者集合**完全相同**，且严格窄于 `risk:read`（后者含 MODERATOR）。已断言「MODERATOR 不会因持有 `moderation:read` 而获得交换访问权」。
- 未持有者 → 403 `PERMISSION_DENIED`（守卫抛异常，不返回 false）；匿名 → 401 `UNAUTHORIZED`。
- `exchanges:write` 仅 SUPER_ADMIN 持有，**本阶段未启用**：控制器上不存在任何 POST/PATCH/PUT/DELETE，`POST /admin/exchanges` 与 `POST /admin/exchanges/:id` 均返回 404。
- **未修改** `permissions.ts`（mtime 仍为 2026-09-17 12:13:17）。

---

## §17 导航

`apps/admin/src/components/shell.tsx` 新增：

```ts
{ href: "/exchanges", label: "交换", permission: "exchanges:read" }
```

位于「连接」与「审计日志」之间。前端隐藏只是 UX，API 仍会 403。

同步更新了**全部三处**穷尽导航断言（`grep "aside nav"` 找齐）：

| 文件 | 变更 |
|---|---|
| `admin-connections.spec.ts` | 列表插入 `"交换"` |
| `admin-risk.spec.ts` | 列表插入 `"交换"` |
| `admin-rbac.spec.ts` | `NAV_LABELS` 8 项；`MODERATOR_NAV_LABELS` 保持 6 项（MODERATOR 既无 `connections:read` 也无 `exchanges:read`，故短 **两项**） |

**全部保持严格相等，未弱化为子集断言。** 这是本项目第三次踩到该陷阱，MEMORY.md 中已有记录。

---

## §18 改动文件

### 新增

| 文件 | 说明 |
|---|---|
| `apps/api/src/admin/admin-exchanges.spec.ts` | 82 项 Jest |
| `apps/admin/src/app/exchanges/page.tsx` | 列表页 |
| `apps/admin/src/app/exchanges/[id]/page.tsx` | 详情页 |
| `apps/admin/test/e2e/admin-exchanges.spec.ts` | 40 项浏览器测试 |
| `docs/ADMIN-PHASE-C3-EXCHANGES.md` | 本文档 |

### 修改

| 文件 | 变更 |
|---|---|
| `apps/api/src/admin/admin.service.ts` | 新增 `AdminExchangeListQuery`、`EXCHANGE_SORT_ORDERS`、`EXCHANGE_LIST_SELECT`、`EXCHANGE_DETAIL_SELECT`、`SHARED_SOCIAL_SELECT`、`EXCHANGE_HISTORY_SELECT`、`resolveExchangeSort()`、`listExchanges()`、`buildExchangeWhere()`、`exchangeDetail()`；import 增加 `SocialPlatform` 运行时值 |
| `apps/api/src/admin/admin.controller.ts` | 新增两条 GET 路由 |
| `apps/admin/src/components/shell.tsx` | 新增导航项 |
| `apps/admin/test/e2e/admin-{connections,risk,rbac}.spec.ts` | 穷尽导航断言同步 |
| `apps/admin/test/smoke.test.mjs` | 新增 2 项 C3 源码契约测试（12 → 14） |
| `scripts/phaseA-rbac-verify.mjs` | 新增 §10f C3 段（79 项检查）+ 清理段 |
| `apps/api/src/admin/admin-connections.spec.ts` | 见 §30.1（**改写了一条已失效的代理断言，未删除、未弱化**） |

### 明确未改动（mtime 仍为 2026-09-17）

`prisma/schema.prisma`（15:15:30）、`prisma/migrations/*`（16 个目录）、`permissions.ts`（12:13:17）、`admin.guard.ts`、`permission.guard.ts`、`connections.service.ts`、`safety.service.ts`、`user-status.scheduler.ts`、`exchange.service.ts`。

---

## §19 夹具清理

- 唯一标记：`PW_EXCH_UI_` 昵称前缀 + `pw-exch-ui.invalid` 邮箱域（`ExchangeRequest` 无可标记的文本列，故标记落在参与者上）。
- 幂等：`beforeAll` 先清理再建，崩溃的上一轮不会留下残骸。
- `afterAll` 断言**四项**计数回到基线：`exchangeRequest` / `sharedSocialAccount` / `socialAccount` / **`conversation`**。
  - 会话计数是刻意加的：`conversationId` 是必填外键，所以本套件必须建一个 `Conversation`，而它正是粗心清理最容易留下的孤儿行——且孤儿会话对其它所有断言都是不可见的。计数它，才能把静默泄漏变成失败测试。
- Real E2E 脚本的清理段同样断言三张表归零。
- 实测：C3 spec 单独运行后 `Conversation` 计数**零增量**。

---

## §20 Jest（API）

```
Test Suites: 21 passed, 21 total
Tests:       496 passed, 496 total
```

- 基线（本阶段开始时实测）：20 suites / 414 tests。
- C3 新增 `admin-exchanges.spec.ts` 82 项，覆盖 §四十一 列举的全部 57 个编号场景（含 RBAC 1–6、list 7–25、排序与形状 26–33、detail 34–45、privacy 46–55、audit 56–57），并额外补充：
  - `41b` 共享方向取自存储行而非从交换双方推断（第三方的共享，Carol → Alice）
  - `42b` `SHARED_SOCIAL_SELECT` 不含 `socialAccountId`
  - `54` `SocialAccount` 从未被查询
- 既有 414 项**全部保留**，无删除、无弱化。

---

## §21 Playwright（浏览器）

```
190 ok, 0 failed, 0 flaky
```

- 基线：150。C3 新增 40 项，全部通过。
- 覆盖 §四十六 列举的全部 30 项行为，另含分页（21 条临时夹具，测试内自清）、审计零写入、无变更控件等。
- 关键断言：
  - 第 8 项：两平台请求**两个徽章都在**（渲染 `platforms[0]` 会通过单平台行却静默丢掉 DISCORD）
  - 第 16 项：Alice 同时在两侧，断言 2 行且与 SQL 一致
  - 第 29 项：`Alice → Bob` 与 `Bob → Alice` 两个方向都按存储显示
  - 第 30 项：拦截 API 响应，断言其中不含 handle 字面量、不含 `"handle"` 键、不含凭据；再断言 `main` 可见文本不含 `handle`
  - 第 32 项：悬空 `connectionId` 显示「连接记录不可用」，状态仍为 PENDING，无错误面板
  - 第 33 项：会话显示 id，私聊内容 `PA_C3_PRIVATE_CHAT_BODY_*` 不出现
- 运行结束时报 `worker-0 process did not exit within 300000ms after stop, force-killed it` —— **既有 Windows 环境缺陷**，按 §五十五 以 `ok`/`failedTests` 判定，业务代码未为它改动。

---

## §22 Real E2E（真实 HTTP + 真实 PostgreSQL）

```
363/364 checks passed
```

- 基线：285（284 过）。C3 新增 **79 项检查**，**全部通过**。
- 唯一失败为**既有脚本缺陷**（见 §30.2），非 C3 引入。
- C3 覆盖：7 项 RBAC（含详情路由同门禁）、未过滤总数 vs SQL、四个真实状态逐一 vs SQL、未知状态被忽略、平台数组包含 vs 独立 `= ANY(...)` SQL、`DISCORD` 处于第二位、12 个枚举成员逐一可用、user UUID/昵称两侧 vs SQL join、空结果、日期区间 vs SQL、非法日期 400、未知排序 400、分页不重叠、`totalPages` 上取整、越界页、默认与升序排序、详情各字段、requester/receiver 具名两侧、`platforms` 完整、`message` null、共享行与 SQL 复合键一一比对、倒置行不存在、连接存在/悬空、会话 id 且无私聊、404、GET-only（POST/PATCH/DELETE 均 404）、递归禁用字段扫描、handle 字面量扫描、无邮箱、读取零审计、历史诚实为空、清理后三表归零。

---

## §23 typecheck

六个 workspace 全部 exit 0：`api`、`admin`、`web`、`config`、`types`、`validation`。

---

## §24 lint

- `apps/api`：`eslint "src/**/*.ts"` 无错误无警告（过程中曾报 `'CAROL' is assigned a value but never used`，已通过**使用**该夹具而非删除它来修复——见 §20 的 `41b`）。
- `apps/admin` / `apps/web`：`✔ No ESLint warnings or errors`。
- `packages/*`：pass-through。

---

## §25 build

- `apps/api`：`nest build` exit 0。
- `apps/admin`：`next build` exit 0，产物含新路由：

```
├ ○ /exchanges        4.95 kB   111 kB
├ ƒ /exchanges/[id]   4.47 kB   111 kB
```

---

## §26 prisma validate

```
The schema at prisma\schema.prisma is valid 🚀
```

---

## §27 migrate status

```
16 migrations found in prisma/migrations
Following migrations have not yet been applied: (16 listed)
```

这是 `:5433` 本地库的**既有状态**：该库由 `db push` 建成，没有 `_prisma_migrations` 表，因此 status 必然报告「未应用」。**不能据此认定 schema drift**（见 §28）。迁移目录数仍为 16，未新增。

---

## §28 migrate diff（双向）

```
方向1  schema → DB :  -- This is an empty migration.
方向2  DB → schema :  -- This is an empty migration.
```

**零 schema 漂移。** `schema.prisma` mtime 仍为 `2026-09-17 15:15:30`。

---

## §29 数据库计数

| 表 | 本阶段开始 | 本阶段结束 |
|---|---|---|
| `User` | 10 | 10 |
| `Connection` | 0 | 0 |
| `ExchangeRequest` | 0 | 0 |
| `SharedSocialAccount` | 0 | 0 |
| `SocialAccount` | 0 | 0 |
| `Conversation` | 28 | 28 |
| `Message` | 0 | 0 |
| `AdminAuditLog` | 2 | 2 |
| `AdminUser` | 6 | 6 |
| `AdminNote` | 0 | 0 |
| `Report` | 1 | 1 |

真实库 `ExchangeRequest = 0`、`SharedSocialAccount = 0`、`SocialAccount = 0` 已确认，因此真实列表如实显示「暂无交换记录」。生产数据未被人为填充。

---

## §30 未解决问题

### 30.1 `admin-connections.spec.ts` §38 的断言已失效（**已按不变弱的方式处理**）

原断言：

```ts
for (const name of ["exchanges", "exchangeDetail", "connectionExchanges"]) {
  expect(proto[name]).toBeUndefined();
}
```

它真正守护的不变量是「**Connections 表面不暴露 Exchange 数据**」，而「控制器上不存在任何 exchange 路由」只是 C3 未实现时的一个**代理**。C3 被明确要求新建这两条路由，代理前提按设计失效。

处理方式：**保留**测试、**保留并加强**真实不变量（`connectionExchanges`/`connectionExchangeDetail` 仍不存在、C2 三个 select 常量仍不含 `exchange`、`CONNECTION_LIST_SELECT` 一并加入检查），并**新增**一条旧形式无法表达的断言——两条路由携带**不同**权限（`connections:read` vs `exchanges:read`）。测试数仍为 53，无删除、无弱化。

### 30.2 `pageSize clamp` 脚本缺陷（**既有，未修**）

```
FAIL  pageSize is clamped to 100 rather than honoured verbatim   <-- pageSize=100 items=23
```

按 §五十四 保持原样。它与 C3 无关：该断言用 `items.length` 判断 clamp，而 `items.length` 在总行数少于 pageSize 时永远等于总行数。已明确区分：这是**既有脚本缺陷**，不是 C3 回归。

### 30.3 Real E2E 清理顺序（**已修**）

首次运行时 `C2 connections: fixtures removed and the connection table is back to zero rows` 失败（`count=1`）——因为 C3 夹具也建了一条 `Connection`，而 C2 的归零断言在其清理之前执行。这是**我引入的清理顺序错误**，已把 C3 的连接删除移到该断言之前。断言本身未改。

### 30.4 浏览器套件的既有会话泄漏（**既有，未修，需裁决**）

`admin-moderation.spec.ts:77` 与 `admin-report-detail.spec.ts:84` 各自创建一个 `Conversation`，但**从不删除**（这两个文件中没有任何 `conversation.deleteMany`）。结果是**每次完整 Playwright 运行泄漏 2 条孤儿会话**。

- 定位方式：单独运行 C3 spec，`Conversation` 计数**零增量**；全量运行时 +2，而全量中只有这两个 spec 会建会话且不清理。
- 影响：仅污染测试库，不影响产品行为；但违反「夹具自建自清」。
- 本次已把全量运行新增的 2 条孤儿会话删除，`Conversation` 恢复为 28。
- **未修**：属于 C2/B5 既有测试，且 §五十三 要求 C3 只增不改。建议在后续阶段单独处理。

### 30.5 Windows Playwright worker 退出缺陷导致 `globalTeardown` 不运行（**既有**）

`globalTeardown` 未运行 ⇒ 套件结束时 `pw.` 夹具账号仍在库中，且 B5/A+ 用例写入 `pw.victim` 的 2 条 USER 审计行 + 3 条 `AdminNote` 残留、`pw.victim` 被置为 `DISABLED`。本次已手工清理并复位（`id::text` 转型比较 `varchar` 与 `uuid`），数据库恢复基线。

### 30.6 尚未实现（**按设计**）

- `exchanges:write` 未启用；无任何交换变更接口。
- 无 `ExchangeAuditRecord` / `AdminExchangeRecord`，处理历史读 `AdminAuditLog` 中 `targetType = 'EXCHANGE'` 的行，当前诚实地返回空。
- `SafetyService` 的关键词扫描与 `recordAutoFlag` 自举报潜伏缺陷未触及。

---

## 停止

C3 完成。**STOP。未进入 C4 Blocks。**
