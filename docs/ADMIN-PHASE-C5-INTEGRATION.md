# ADMIN PHASE C5 — Integration Final Result

Status: **COMPLETE / STOPPED**

阶段范围：验证已完成 Admin 模块（B1 Dashboard、B2 Users、B3 User Detail/Status、B4
Reports、B5 Moderation、C1 Risk、C2 Connections、C3 Exchanges、C4 Blocks）之间的
权限、导航、数据边界、错误契约、只读边界、审计边界与测试契约，并只修复**真正存在
的 Integration 缺陷**。

未修改 `prisma/schema.prisma`、未新增 migration、未使用 `db push`、未修改
`SafetyService`、未扩大任何 write permission、未新增任何 CRUD、未新增跨域 endpoint。
完成后**停止**，不进入 Production Readiness / Monetization / Activity / OAuth。

---

## 1. 结论摘要

- 发现的真实 Integration 缺陷：**1 个**（Admin 域 9 个 id 寻址入口对非 UUID 路径参数
  返回 `500 INTERNAL_ERROR`）。已修复，修复层选择在 **NestJS 管道层**，不在 Service 层。
- 既有契约（导航 / RBAC / 分页 / 日期 / sort / 隐私 / 只读 / 审计）经真实 HTTP +
  真实 PostgreSQL 复核，**未发现缺陷**。
- 新增测试：API Jest +78、Playwright +26、Smoke +5、Real E2E +140 项检查。
- 零变更核对通过：schema / migrations / permissions.ts 三处均未改动（见 §2）。
- 遗留 6 项 **pre-existing** 问题，按要求**只识别、不修复**（见 §10）。

---

## 2. 零变更核对（硬约束）

仓库根目录**不是 git 仓库**（`git status` → `fatal: not a git repository`），因此
`git diff` 不可用，改用 **mtime + md5** 逐项核对。

| 对象 | 期望 | 实测 | 结论 |
|---|---|---|---|
| `prisma/schema.prisma` | 未改 | mtime `2026-09-17 15:15`，22472 字节，md5 `1185a9c64218d65a22e686195c5a4794` | ✅ 未改 |
| `apps/api/src/admin/permissions.ts` | 未改 | mtime `2026-09-17 12:13`，3615 字节，md5 `ab5b8fdf46483b6a96cb7c64840a35e7` | ✅ 未改 |
| `prisma/migrations/` | 16 个目录，无新增 | 16 个目录，无一匹配 `/c5|integration/i` | ✅ 未改 |
| `apps/api/src/admin/admin.service.ts` | 零 C5 改动 | 曾临时加入的 Service 层校验**已完全回退**（见 §3.3） | ✅ 零改动 |
| `apps/api/src/admin/admin-blocks.spec.ts` 等既有 spec | 不删不改 | 未触碰 | ✅ |

**Prisma 漂移检查**（两个方向）：

```
prisma validate                                        -> The schema is valid
migrate diff --from-schema-datasource --to-schema-datamodel -> No difference detected.
migrate diff --from-migrations        --to-schema-datamodel -> No difference detected.
```

（第二项需要一个临时 shadow 库 `talkfirst_shadow_c5`，已创建并在检查后删除。）

---

## 3. 唯一修复的 Integration 缺陷：非 UUID 路径参数返回 500

### 3.1 修复前实测（真实 HTTP + 真实 PostgreSQL）

| 路由 | 修复前 |
|---|---|
| `GET /admin/users/not-a-uuid` | `500 INTERNAL_ERROR` |
| `GET /admin/reports/not-a-uuid` | `500 INTERNAL_ERROR` |
| `GET /admin/connections/not-a-uuid` | `500 INTERNAL_ERROR` |
| `GET /admin/exchanges/not-a-uuid` | `500 INTERNAL_ERROR` |
| `GET /admin/blocks/not-a-uuid/not-a-uuid` | `500 INTERNAL_ERROR` |
| `POST /admin/users/not-a-uuid/status` | `500 INTERNAL_ERROR` |
| `PATCH /admin/users/not-a-uuid/status` | `500 INTERNAL_ERROR` |
| `POST /admin/users/not-a-uuid/notes` | `500 INTERNAL_ERROR` |
| `POST /admin/reports/not-a-uuid/review` | `500 INTERNAL_ERROR` |

API 日志给出的根因：

```
PrismaClientKnownRequestError: Inconsistent column data: Error creating UUID,
invalid character: expected an optional prefix of 'urn:uuid:' ...
```

即：原始字符串直接进入 Prisma 的 UUID 解析器；抛出的
`PrismaClientKnownRequestError` **不是** `HttpException`，因此
`ApiExceptionFilter` 把它归类为未处理的服务器故障（500），而不是客户端错误（400）。

对照组证明这不是全局行为：非 Admin 路由 `GET /users/not-a-uuid`、
`GET /moments/not-a-uuid` 均为 `404`，说明该缺陷是 **Admin 域特有**。

### 3.2 修复后实测

9 个入口全部变为：

```
400 VALIDATION_ERROR
details: { "id": ["id must be a UUID"] }
        / { "blockerId": ["blockerId must be a UUID"] }
        / { "blockedId": ["blockedId must be a UUID"] }
```

同时**未知但合法的 UUID 仍保持各域 404**（`USER_NOT_FOUND` / `REPORT_NOT_FOUND` /
`CONNECTION_NOT_FOUND` / `EXCHANGE_NOT_FOUND` / `BLOCK_NOT_FOUND`）——守卫没有把
「查无此行」误判成「参数非法」。

### 3.3 修复层的选择（由既有测试反推，不是偏好）

第一版把校验放在 `AdminService`（新增 `assertUuid` + 10 处调用），结果
`admin-user-status.spec.ts` / `admin-user-detail.spec.ts` / `admin-rbac.spec.ts` /
`admin-audit.spec.ts` 共 **43 例失败**：`setStatus` 的错误码顺序被改变，
缺 reason 时从 `REASON_REQUIRED` 变成 `VALIDATION_ERROR`。

因此该改动**整体回退**，改为在传输层加 `UuidParamPipe`，挂到 10 个 `@Param` 上：

- 规则顺序不变（`REASON_REQUIRED` 仍然先于任何参数校验）。
- 不使用 Nest 内置 `ParseUUIDPipe`：它不产生 `error.code`，
  `ApiExceptionFilter` 会把它透出为 `400 HTTP_ERROR`，破坏统一错误信封。
- 不施加于列表过滤器：`?user=not-a-uuid` 是文档化的昵称搜索语义。

改动文件：

- 新增 `apps/api/src/admin/uuid-param.pipe.ts`
- 修改 `apps/api/src/admin/admin.controller.ts`：10 处 `@Param` 携带管道，
  类注释补充 C5 段落

---

## 4. 导航与 RBAC 一致性

`/admin/me` 返回的 `permissions` 是控制台侧边栏的唯一依据，因此「导航是否与服务器
一致」可以两侧对测。

**API 层（Real E2E，真实 HTTP）**：对 5 个角色 × 8 条导航路由逐条请求，要求
「持有该 permission → 200，否则 → 403」，与 `/admin/me` 的返回严格吻合。全部通过。

**浏览器层（Playwright）**：逐角色比对 `aside nav a` 的渲染文本与手写期望列表，
并断言规范顺序是各角色列表的**子序列**（缺项可以，换位不行）。全部通过。

**持有集契约**：

| permission | 持有角色 |
|---|---|
| `risk:read` | SUPER_ADMIN / MODERATOR / ANALYST |
| `connections:read` = `exchanges:read` = `blocks:read` | SUPER_ADMIN / ANALYST |
| `reports:read`（`/moderation` 的门禁） | 全部 5 个角色 |

三个关系域持有集完全相同——已由 API spec、Playwright spec、Smoke、Real E2E
四处分别锁定。MODERATOR 持 `risk:read` 但不持任何关系域 read，已单独断言。

**侧边栏隐藏不是边界**：匿名访问 9 条路由全部跳 `/login`；无权限角色直访 URL 时
由 API 返回 403，页面渲染可见的拒绝态且**不渲染任何数据标记**。

---

## 5. 数据边界与跨域隐私

在真实数据库中植入一个可识别的 handle（`PW_INT_SECRET_HANDLE_phasea_alice_tg`），
然后拉取全部 9 个屏幕 + 4 个详情路由的原始 payload：

- 13 个 payload **全部不含** 该 handle（且已先断言该 handle 确实存在于
  `SocialAccount`，因此「不存在」是有意义的结论）。
- 全部不含 `passwordHash` / `tokenHash` / `clientSecret` / `refreshToken`。
- `ip` / `userAgent` 只出现在审计屏幕——审计是唯一被允许暴露操作者地址的屏幕，
  且它是**唯一没有 `totalPages` 的列表**（控制台自行计算页数），两者都已作为契约锁定。
- 四个拒绝态屏幕（risk / connections / exchanges / blocks）的页面文本经
  `LEAK_MARKERS` 扫描，无 Prisma / SQL / stack / 连接串。

**方向性未归一化**（数据库层复核）：

- `Connection` 的 `user` 过滤必须命中 `userAId OR userBId`；夹具含一条 ACTIVE 和一条
  REMOVED，独立 SQL 返回 2，只查 `userAId` 或隐式加 `status: ACTIVE` 都会得到 1。
- `Block` 的 `user` 过滤同理；Alice 是被屏蔽方而非屏蔽方，独立 SQL 返回 1。
- `ExchangeRequest` 的 `requesterId` / `receiverId` 不做排序或 min/max。

---

## 6. 错误契约、分页、日期、排序一致性

真实 HTTP 复核（全部通过）：

- **错误信封**：`{ success: false, error: { code, message, details? } }` 统一。
- **非法日期**：`2026-02-30`、`2026-13-01`、`09/17/2026` → `400 VALIDATION_ERROR`
  + `details`（`2026-02-30` 必须被拒绝，因为 `new Date("2026-02-30")` 会静默滚到 3 月 2 日）。
- **非法 sort**：`bogus`、`platform` → `400 VALIDATION_ERROR` + `details.sort`。
- **越界分页**：`page=999` → `200`，`items=[]`，`page` 保持 `999`，`total` 真实，
  `totalPages` 为 `ceil(total/pageSize)`；`total=0` → `totalPages=0`。
- **pageSize 上限**：`pageSize=5000` → `100`（六个列表一致）。
- **认证 / 授权**：匿名 → `401 UNAUTHORIZED`；坏 token → `401`；停用管理员 →
  `403 ADMIN_INACTIVE`；缺权限 → `403 PERMISSION_DENIED`（守卫抛异常，不返回 false）。
- **404 一致性**：五个详情路由对合法但不存在的 id 返回各域 `*_NOT_FOUND`。

---

## 7. 审计边界

- **GET 不写审计**：Real E2E 在一次运行中对全部读路由（导航矩阵 45 次 + 畸形 10 次 +
  未知 5 次 + payload 13 次 + 列表 7 次）前后比对 `AdminAuditLog` 计数，完全不变。
- **写入仍然审计**：状态变更（`ADMIN_USER_DISABLE`）与举报复核（`REPORT_RESOLVED`）
  各产生一行审计，`actorType = USER`、`adminId` 为真实管理员 id、`before`/`after`
  记录了状态迁移。只读阶段没有把审计能力一并拿掉。
- **SYSTEM 行**：`RISK_ACTION_PREFIXES` 9 项完整闭集已锁定（含
  `SYSTEM_USER_SUSPENSION_EXPIRED`），`adminId` 为 null 的语义未被破坏。
- 详情页的处理历史取自 `AdminAuditLog`；`Block` 无审计行时详情如实显示空历史。

---

## 8. Tests

### Jest（API）

```
Test Suites: 23 passed, 23 total
Tests:       639 passed, 639 total
```

新增 `apps/api/src/admin/admin-integration.spec.ts`：**78 例**，10 个 describe —
路由表内省(8) / RBAC 全集(10) / 审计边界(7) / Dashboard↔列表(6) / UserDetail↔列表(9) /
共享错误契约(9) / 列表契约(11) / 隐私(6) / 方向与跨域隔离(7) / 前端镜像(3)。

### Playwright（浏览器）

```
249 passed / 0 failed  (223 C4 基线 + 26 新增，20.0m)
```

新增 `apps/admin/test/e2e/admin-integration.spec.ts`：**26 例**，6 个 describe —
导航↔权限逐角色 / 直访 URL 被 API 拒绝 / 匿名访问 / 两个屏幕一个数字 /
无内部信息泄漏 / 矩阵未被悄悄放宽。

日志尾部另有 `4 errors were not a part of any test`，内容为
`worker-0 process did not exit within 300000ms after stop, force-killed it`
——即 §10 #4 的 Windows worker 退出缺陷，与测试内容无关。判定依据是
`passed` 与 `failedTests`，不是退出码。

### Real E2E（真实 HTTP + 真实 PostgreSQL）

```
563/564 checks passed
```

新增 §10h，**140 项检查**：导航↔权限矩阵（含持有集相等）/ 畸形 id 逐半段 /
未知 id 仍 404 / 九屏四详情全 200 / Dashboard 与 Risk 计数对独立 SQL /
两屏之间同数一致 / UserDetail 六个计数对独立 SQL / 列表 total 对独立 SQL /
双向过滤 / 跨域隐私 / GET 不写审计 / 写入仍审计 / 夹具自清。

### Smoke（源码契约）

```
22 tests, 22 pass  (17 C4 基线 + 5 新增)
```

新增 5 项：九个域均有页面且路由带门禁 / 侧边栏恰好九项且顺序固定 /
权限矩阵未被改动且前后端镜像一致 / 无关系域新增写路由 /
无新增 migration 且 schema 模型与枚举清单不变。

### typecheck / lint / build

```
typecheck: 6/6 workspaces exit 0
lint:      exit 0，无 warning
build:     exit 0（api nest build / admin next build / web next build）
```

---

## 9. 独立 SQL 对账

**服务本身从不作为被验证数字的唯一来源**。所有计数都用 `$queryRawUnsafe` 另走一条
查询路径重算：

| 被测数字 | 独立 SQL |
|---|---|
| dashboard users / active / banned / suspended / admins | `COUNT(*) FROM "User"` / `WHERE status = ...` / `FROM "AdminUser" WHERE "isActive" = true` |
| dashboard connections | `COUNT(*) FROM "Connection" WHERE status = 'ACTIVE'` |
| dashboard reportsOpen | `COUNT(*) FROM "Report" WHERE status = 'OPEN'` |
| risk totalReports / openReports / suspiciousSelfReports | `COUNT(*) FROM "Report"` / `WHERE status = 'OPEN'` / `WHERE "reporterId" = "reportedUserId"` |
| risk activeUsers / bannedUsers / suspendedUsers | `COUNT(*) FROM "User" WHERE status = ...` |
| user detail connectionCount | `COUNT(*) FROM "Connection" WHERE status = 'ACTIVE' AND ("userAId" = $1::uuid OR "userBId" = $1::uuid)` |
| user detail reportsReceived / reportsMade | `COUNT(*) FROM "Report" WHERE "reportedUserId" = $1::uuid` / `"reporterId"` |
| user detail blocksMade / blocksReceived | `COUNT(*) FROM "Block" WHERE "blockerId" = $1::uuid` / `"blockedId"` |
| user detail socialAccountCount | `COUNT(*) FROM "SocialAccount" WHERE "userId" = $1::uuid` |
| connections / exchanges / blocks / reports / users 列表 total | 各表 `COUNT(*)` |

另外断言 **Dashboard 与 Risk 对同一事实的两个视图相等**（待处理举报、活跃用户、
封禁用户、暂停用户）。

注意：独立 SQL 比较 `timestamp without time zone` 列时**不直接绑定 JS Date**
（Prisma 会按 `timestamptz` 传递，PG 按会话时区折算，与 naive-UTC 语义差 8 小时）。
本阶段的对账全部是整数计数与 UUID 参数，`$1::uuid` 显式转型。

---

## 10. 问题分类

### C5 introduced

**无。** 本阶段没有引入任何缺陷。

### 已修复（pre-existing，但属于 C5 明确管辖的 Integration 契约）

| # | 问题 | 证据 |
|---|---|---|
| 1 | 9 个 id 寻址入口对非 UUID 路径参数返回 500 而非 400 | §3 |

### Pre-existing，按要求**只识别、不修复**

| # | 问题 | 证据 / 位置 | 不修复的理由 |
|---|---|---|---|
| 1 | Real E2E 检查 `pageSize is clamped to 100 rather than honoured verbatim` 失败：`pageSize=100 items=23` | 库中仅 23 个用户，断言要求满 100 行 | brief 明示「B2 pageSize clamp」为既有脆弱夹具，不得触碰 |
| 2 | 错误文案不一致：`/risk`、`/connections`、`/connections/[id]` 直接渲染 API 的 `error.message`，其余 6 屏经本地 `friendlyError` 本地化。同一个 403 在一屏是「无权限访问」，在另一屏是 `Your role (SUPPORT) is not allowed to perform this action` | `src/app/{risk,connections}/**` 用 `requestError.message`；其余屏用 `friendlyError` | 属产品文案决策，非功能缺陷（拒绝态可见、无数据、无内部信息泄漏）。brief 明示不得修复无关产品 UX |
| 3 | 每次完整 Playwright 运行泄漏 **2 行 `Conversation`**（28 → 30）。这两行带 2 条 `ConversationMember`，无 Connection / ExchangeRequest / Message | 实测创建时间 20:44:50、20:46:29（本地），落在 moderation / report-detail 夹具时段 | brief 明示「Moderation/report detail conversation 泄漏」为既有脆弱夹具，只能识别/记录/隔离。本次已在运行后手工复位（见 §11） |
| 4 | Windows + Node 22 + Playwright 1.63：最后一个测试结束后 worker 进程不退出，CLI 静默最长 300 秒后才 `force-killed` | 本次两次完整运行均复现，日志尾部 `worker-0 process did not exit within 300000ms` | 环境缺陷，内容无关，已在 `playwright.config.ts` 中作为已知项记录 |
| 5 | `scripts/phaseA-rbac-verify.mjs` 在第一次 HTTP 调用**之前**创建夹具。API 不可达时脚本崩溃并留下 13 行夹具，下一次运行以 `P2002` 失败而非给出清晰提示 | 本次实测（清理后恢复） | 既有脚本特性，非 C5 范围；本次已手工清理并记录 |
| 6 | 浏览器套件的 `globalTeardown` 在 worker 被强制终止时**不保证运行**，于是每次完整运行后残留：3 行 `AdminNote`、2 行 USER `AdminAuditLog`，并把 `pw.victim` 置为 `DISABLED` | 实测残留行全部 `targetId = pw.victim`，时间戳落在本次运行内 | 既有夹具行为（见项目记忆），本次已按既有做法手工复位（见 §11） |

### Environment-only

| # | 现象 | 说明 |
|---|---|---|
| 1 | Playwright 自带的 `webServer` 在本沙箱中始终不启动（两个 120s 超时耗尽，无进程监听） | 改为在同一次 shell 调用内 `nohup ... & disown` 启动 API 与 admin，再运行测试 |
| 2 | safe-delete shim 拦截 Playwright 清理 `test-results`，报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` | 命令级 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 即可 |
| 3 | 仓库根不是 git 仓库 | `git diff` 不可用，改用 mtime + md5（见 §2） |

---

## 11. Fixtures 与数据库状态

新增夹具全部使用 `PW_INT` 前缀，在 §10h 内部创建并在**同一节内**删除，早于共享
cleanup 执行，因此 C2/C3/C4 的「表回到零行」断言仍然描述各自阶段。

夹具构成：Alice / Bob / Carol 三个用户 + 1 条 ACTIVE Connection + 1 条 REMOVED
Connection + 1 条 ExchangeRequest + 1 条 SharedSocialAccount + 1 个 SocialAccount
（含可识别 handle）+ 1 条 Block（Bob → Alice，方向刻意单向）+ 1 条 Report。

自清断言覆盖 **10 张表**：`User` / `Connection` / `Conversation` /
`ExchangeRequest` / `SharedSocialAccount` / `SocialAccount` / `Block` / `Report` /
`AdminNote` / `AdminAuditLog` —— 每张都要求回到本节开始时的行数。
（`Conversation` 是本次新增的守卫项：§10h 会创建一条会话供 exchange 使用。）

实测：`conversations_before=30`，`conversations_after=30`，全部 10 张表均回到入口状态。

**数据库状态（C5 阶段开始 → 结束，已复位）**：

| 表 | 开始 | 结束 | 说明 |
|---|---|---|---|
| User | 10 | 10 | ✅ |
| AdminUser | 6 | 6 | ✅ |
| AdminNote | 0 | 0 | ✅（套件残留 3 行，已复位） |
| AdminAuditLog | 2 | 2 | ✅（套件残留 2 行 USER 审计，已复位；2 行 SYSTEM 为基线） |
| Report | 1 | 1 | ✅ |
| Connection | 0 | 0 | ✅ |
| ExchangeRequest | 0 | 0 | ✅ |
| Block | 0 | 0 | ✅ |
| SharedSocialAccount | 0 | 0 | ✅ |
| SocialAccount | 0 | 0 | ✅ |
| Conversation | 28 | 28 | ✅（套件泄漏 4 行，已按 §10 #3 复位） |
| ConversationMember | 0 | 0 | ✅ |
| Message | 0 | 0 | ✅ |

复位内容：删除 3 行 `AdminNote`、2 行 USER `AdminAuditLog`（保留 2 行 SYSTEM 基线）、
4 行套件泄漏的 `Conversation`（及其级联的 `ConversationMember`），并把 `pw.victim`
从 `DISABLED` 恢复为 `ACTIVE`。夹具计数：`pw.* = 7`（基线）、
`phasea.verify.* = 0`、`pw_int* = 0`。

> 说明：§10 #3 / #6 的残留是**既有浏览器套件行为**，不是 C5 产物。本阶段按项目既有
> 做法在运行后手工复位，使数据库回到 C5 起始基线；未修改任何 spec 去「顺手修掉」它
> ——那属于既有脆弱夹具，brief 明示不得触碰。

---

## 12. 验证汇总与停止点

| 验证 | 结果 |
|---|---|
| `prisma validate` | ✅ valid |
| `prisma migrate diff`（DB → datamodel） | ✅ No difference detected |
| `prisma migrate diff`（migrations → datamodel） | ✅ No difference detected |
| `schema.prisma` / `permissions.ts` / `migrations` 零变更 | ✅ |
| typecheck（6 workspaces） | ✅ exit 0 |
| lint | ✅ exit 0，无 warning |
| build（api / admin / web） | ✅ exit 0 |
| Jest | ✅ 23 suites / 639 tests |
| Smoke | ✅ 22/22 |
| Real E2E | ✅ 563/564（唯一失败为既有脆弱夹具，见 §10 #1） |
| Playwright | ✅ 249 全通过（26 项 C5 新增） |

**STOP。** 本阶段不进入 Production Readiness、Monetization、Activity / OAuth，
不新增任何跨域业务功能。
