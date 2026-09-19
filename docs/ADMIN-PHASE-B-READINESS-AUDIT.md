# Admin Phase B — Readiness Audit

> 只读审计，基于当前代码库的真实状态。**没有修改任何代码，没有执行任何 migration。**
> 审计日期：2026-09-17 · 基线：API Jest 14/145 · Playwright 14/14 · Real E2E 72/72 · 无漂移

本文件的作用是回答一个问题：**§二 列的 5 个模块，各自距离目标还差多少，以及有哪些前提是错的。**

---

## 0. 最重要的三个结论

1. **`ModerationRecord` 与 `MessageModeration` 在整个代码库里不存在**（schema / API / 前端全无）。
   §十一 把这两个模型列为"现有"，这个前提是错的。见 §5 与 §12-D。
2. **`SafetyService` 不提供任何审核动作**。它是一个关键词风险扫描器
   （`scanText` / `trustedAccount` / `sayHelloLimit` / `extractLinks` / `recordAutoFlag`），
   没有 dismiss / resolve / suspend / ban。§十一 的"如果现有 SafetyService 已经提供动作，请复用"
   无可复用之物。见 §5。
3. **§七 要求的 `PATCH /users/:id/status` 与现有 `POST` 端点冲突**，且现有动作词表
   （`ban|unban|disable|activate|suspend`）与 §七 的状态词表（`ACTIVE|SUSPENDED|BANNED`）不是一套。
   直接改会打破 §一 要求保护的基线。见 §12-A / §12-B。

**这三点都需要你先决策，再进入对应模块。** B1 Dashboard 不受影响，可以立即开始。

---

## 1. 当前 Dashboard 已实现什么

### 后端

`GET /api/v1/admin/dashboard`，权限 `dashboard:read`，实现在 `AdminService.dashboard()`
（`apps/api/src/admin/admin.service.ts:86-100`）。一个 `$transaction` + `Promise.all`，返回 7 个真实计数：

| 字段 | 含义 | 实现 |
| --- | --- | --- |
| `users` | 用户总数 | `tx.user.count()` |
| `activeToday` | 今日活跃 | `lastActiveAt >= 当日 00:00` |
| `messagesToday` | 今日消息 | `createdAt >= 当日 00:00` 且未删除 |
| `connections` | 有效连接 | `status = ACTIVE` |
| `reportsOpen` | 待审举报 | `status = OPEN` |
| `admins` | 管理员 | **`user.count({ isAdmin: true })`** ← 见 §12-E |
| `banned` | 已封禁 | `status = BANNED` |

**全部来自真实 PostgreSQL，无 mock、无 `Math.random()`、无前端静态数字。** 这一点已经达标。

### 前端

`apps/admin/src/app/page.tsx`，路由是 **`/`**（不是 §十二 要求的 `/dashboard`）。7 张 KPI 卡片。
有 loading（`加载中…`）与 error，**没有 empty state，没有 refresh 按钮**。

### 真实数据现状（本次探测）

`ACTIVE 166 / BANNED 2`，**`DISABLED 0`、`SUSPENDED 0`**；`connections 44`、`reportsOpen 0`。
所以 ACTIVE / SUSPENDED / BANNED 三张卡片上线后会显示 `166 / 0 / 2`。

---

## 2. 当前 Users Admin API 已实现什么

`GET /api/v1/admin/users`，权限 `users:read`。`AdminService.searchUsers()`
（`admin.service.ts:135-177`）。

**已支持**：`q`（email + nickname，`contains` 不区分大小写，截断 64 字符）、`status`
（`ACTIVE|DISABLED|BANNED|SUSPENDED`，其他值视为 ALL）、`page`（1–1000）、`pageSize`（1–100）。

**响应**：`{ items, total, page, pageSize }` —— **缺 `totalPages`**。

**列表 select**：`id, email, nickname, countryCode, status, isAdmin, bannedAt, banReason,
suspendedUntil, createdAt, lastActiveAt`。
**没有 `passwordHash`、没有任何 token 字段** —— 这一项已经安全。

**排序**：硬编码 `createdAt desc`，**无 `sort` 参数**。

**前端** `users/page.tsx`：搜索框（`搜索 email / nickname`）、状态下拉、分页、行内状态操作按钮、内部备注框。

---

## 3. 当前 User Detail 已实现什么

`GET /api/v1/admin/users/:id`，权限 `users:read`。`AdminService.userDetail()`
（`admin.service.ts:192-221`）。

**已返回**：`id, email, nickname, avatarUrl, countryCode, status, isAdmin, bannedAt, banReason,
suspendedUntil, createdAt, lastActiveAt`，加 `adminUser{role,isActive}`，
以及 `reportsReceived`(最近 10)、`reportsMade`(最近 10)、`adminNotes`(最近 20)。

**未知 id → 404 `USER_NOT_FOUND`**（Phase A+ 已修，有真实 E2E 断言）。

**敏感字段**：`passwordHash` 未 select；`RefreshToken.tokenHash` 未 select。
当前响应**不含**任何 token / 密码 / OAuth credential —— 达标。

**⚠ 一个潜在泄漏模式**：`reportsReceived` / `reportsMade` / `adminNotes` 三个子查询
**没有 `select`**，因此会返回这三个模型的**全部标量列**。目前这三个模型没有敏感列，所以不是漏洞，
但这是一个"将来给 Report 加一列就会自动泄漏"的结构。加统计时顺手收紧成显式字段列表。

**前端** `users/[id]/page.tsx`：状态按钮 + 二次确认弹窗 + Not Found 状态。

### 一个关键的结构性事实

**没有 `Profile` 模型。** 资料数据内联在 `User` 上（`nickname` / `avatarUrl` / `birthDate` /
`countryCode` / `city` / `gender` / `bio`），加上四个关联表
（`languages` / `interests` / `purposes` / `preferredCountries`）。
所以 §六 的"profile 完成情况"必须**推导**，不能直接读。

---

## 4. 当前 Reports 已实现什么

### 列表

`GET /api/v1/admin/reports`，权限 `reports:read`。`AdminService.listReports()`
（`admin.service.ts:370-392`）。**只支持 `status` + `page` + `pageSize`。**
status 白名单 `OPEN|REVIEWING|RESOLVED|REJECTED`（与 Prisma `ReportStatus` 一致），
其他值视为"全部"。`include` 了 `reporter` 与 `reportedUser`（id/nickname/email[,status]）。
响应 `{items,total,page,pageSize}` —— **缺 `totalPages`**。

### 审核

`POST /api/v1/admin/reports/:id/review`，权限 `reports:write`，DTO
`action: reviewing|resolved|rejected` + **必填 reason**。
`AdminService.reviewReport()`（`admin.service.ts:399-450`）：
校验 reason 非空 → 查报告存在（否则 404 `REPORT_NOT_FOUND`）→
**在一个事务内**更新 `status` 并写 USER 审计行（`targetType=REPORT`、`before/after.status`、reason、ip、ua）。
状态机：`reviewing→REVIEWING`、`resolved→RESOLVED`、`rejected→REJECTED`。

### 缺失

- **`GET /api/v1/admin/reports/:id` 完全不存在**（无 detail 端点）。
- **`apps/admin/src/app/reports/[id]/` 不存在**（只有列表页）。
- 缺 `reason` / `reporter` / `reportedUser` / `createdFrom` / `createdTo` / `targetType` 过滤。

### 两个 schema 层面的约束

1. **`Report` 没有 `updatedAt` / `reviewedAt` / `reviewedBy` / resolution 字段。**
   所以 §九 的"moderation history"**只能从 `AdminAuditLog` 取**
   （`targetType='REPORT' AND targetId=:id`）。这是可行的，而且更符合"审计是唯一真相来源"。
2. **`Report` 没有 `targetType` 列。** 目标只有 `reportedUserId`（永远是人）和可选的 `messageId`。
   所以 §九 的 `targetType` 过滤**没有 schema 支撑**。见 §12-C。
3. **`Report.messageId` 是一个裸 UUID，没有 FK 关系。** 没有引用完整性，
   消息被删就留下悬空 id。内容审核必须手动按 id 查 `Message` 并容忍查不到。
   当前 10 条报告中有 **5 条**带 `messageId`。

### 真实数据现状

`RESOLVED 4 / REVIEWING 6`，**`OPEN 0`、`REJECTED 0`**。
而 Reports 页默认筛选 `status=OPEN` —— **打开就是空列表**。
所以 §十四 要求的 empty state 不是理论问题，是当前就会遇到的第一个画面。

---

## 5. 当前 Moderation 已实现什么

### 结论：几乎为零

| §十一 列出的"现有" | 实际情况 |
| --- | --- |
| `Report` | ✅ 存在 |
| `ModerationRecord` | ❌ **不存在**（全库 grep 无任何命中） |
| `MessageModeration` | ❌ **不存在**（全库 grep 无任何命中） |
| `Block` | ✅ 存在（但见下方范围说明） |
| `UserStatus` | ✅ 存在 |
| `SafetyService` | ⚠️ 存在，但**不是审核动作服务** |

- **`moderation:read` / `moderation:write` 两个权限已在矩阵里**（MODERATOR 与 CONTENT_MANAGER 各持有），
  但**没有任何路由使用它们** —— 全库没有任何 `@RequirePermission("moderation:...")`。
  这两个权限目前是"预留但悬空"的。
- **没有 `/admin/moderation` 端点，没有 `/moderation` 页面。**
- `SafetyService` 的实际能力：`scanText()`（关键词/联系方式/外链风险打分）、
  `trustedAccount()`、`sayHelloLimit()`、`extractLinks()`、`recordAutoFlag()`。
  **没有任何 dismiss / resolve / suspend / ban 动作可供复用。**

### 所以 §十一 的"不要重新设计一套平行 Moderation 系统"必须这样落地

Moderation **没有既有模型可以基于**，因此唯一不"平行"的做法是：
把它做成 **`Report` + `AdminAuditLog` 之上的读+操作视图**，动作全部复用已有的
`AdminService.setStatus()`（suspend / ban）与 `reviewReport()`（resolve / reject）。
**不引入新模型、不写新迁移。**

### ⚠ 顺带发现的一个既有不一致（报告，不在本阶段修）

`SafetyService.recordAutoFlag()`（`safety.service.ts:103-147`）的注释明确写着
"machine signals must not be written into the `Report` table"，
但代码只在 `level === "HIGH"` 时提前返回；其余级别**确实会创建 `Report`**，
且 `reporterId = reportedUserId = userId` —— 即**用户举报了自己**。

这与它自己声明的约束矛盾，且会把机器信号塞进人工审核队列。
这属于**非 Admin 模块**，§十八 明确要求"发现必须改变非 Admin 模块才能继续 → 停止并报告"。
**本阶段只报告，不修改。**

---

## 6. 当前 RBAC 权限矩阵

单一真相来源：`apps/api/src/admin/permissions.ts`（前端 `apps/admin/src/lib/permissions.ts` 是镜像）。
20 个权限 × 5 个角色。**实际矩阵**：

| 权限 | SUPER_ADMIN | MODERATOR | SUPPORT | ANALYST | CONTENT_MANAGER |
| --- | :-: | :-: | :-: | :-: | :-: |
| `dashboard:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users:write` | ✓ | ✓ | ✓ | — | — |
| `reports:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports:write` | ✓ | ✓ | — | — | — |
| `moderation:read` | ✓ | ✓ | — | — | ✓ |
| `moderation:write` | ✓ | ✓ | — | — | ✓ |
| `risk:read` | ✓ | ✓ | — | ✓ | — |
| `connections:read` | ✓ | — | — | ✓ | — |
| `exchanges:read` | ✓ | — | — | ✓ | — |
| `blocks:read` | ✓ | — | — | ✓ | — |
| `audit:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `settings:read` | ✓ | — | — | ✓ | — |
| `audit:export` / `*:write`（其余） | ✓ | — | — | — | — |

**正交的第二轴** `ROLE_ALLOWED_STATUS_ACTIONS`：

| 角色 | 允许的用户状态动作 |
| --- | --- |
| SUPER_ADMIN | `activate, disable, ban, suspend, unban` |
| MODERATOR | `activate, disable, suspend, unban`（**不能永久封禁**） |
| SUPPORT | `activate, disable` |
| ANALYST / CONTENT_MANAGER | 无 |

**守卫链**：`JwtAuthGuard` → `AdminGuard` → `PermissionGuard` → `AdminService` 内部 scope 校验。
错误码：`UNAUTHORIZED` / `USER_DISABLED` / `ADMIN_REQUIRED` / `ADMIN_INACTIVE` / `PERMISSION_DENIED`。

### 与 §八 的对照结论：**没有硬冲突，不需要改矩阵**

- §八 SUPPORT「Dashboard / Users / User Detail / 查看 Reports」→ 与 `dashboard:read + users:read + reports:read` 一致 ✓
- §八 MODERATOR「Dashboard / Users / User Detail / Reports / Moderation」→ 一致 ✓
- §八 ANALYST「Dashboard / 只读统计 / 只读列表」→ 一致（无任何 write）✓
- §八 **完全没有提 CONTENT_MANAGER**，但该角色存在于 schema 且持有 `moderation:read/write`。
  B5 上线后它会**自动**获得 Moderation 访问权。**建议保持现状**（§三.3 不改已有语义），
  但需要你确认这是期望行为。
- §八 的「用户状态修改」在现有实现里被 `ROLE_ALLOWED_STATUS_ACTIONS` 收得更紧
  （MODERATOR 只能临时封禁、SUPPORT 只能停用/启用）—— 这是**更严格**，与 §八
  "禁止修改自己没有权限执行的动作" 一致，**不要动**。

---

## 7. 当前 Audit 记录入口

唯一写入路径（Phase A 建立、Admin Audit Infrastructure 强化）：

| 入口 | actorType | 使用者 |
| --- | --- | --- |
| `AdminService.recordAudit(input, client?)` | `USER`（默认） | 全部人工动作 |
| `AdminService.recordSystemAudit(input, client?)` | `SYSTEM` 固定、`adminId` 固定 `null` | 只有 `UserStatusScheduler` |

DB CHECK `AdminAuditLog_actor_consistency_check` 强制配对，应用层 `assertActorConsistency` 镜像。

**现有 USER 审计生产者**（全部走 `recordAudit`）：

| 动作 | action | targetType | 写入内容 |
| --- | --- | --- | --- |
| `setStatus` | `ADMIN_USER_{BAN\|UNBAN\|DISABLE\|ACTIVATE\|SUSPEND}` | `USER` | before/after 四列状态、reason、ip、ua、detail |
| `reviewReport` | `REPORT_{REVIEWING\|RESOLVED\|REJECTED}` | `REPORT` | before/after.status、reason、ip、ua |
| `addNote` | `ADMIN_USER_NOTE` | `USER` | — |

**唯一 SYSTEM 生产者**：`UserStatusScheduler` → `SYSTEM_USER_SUSPENSION_EXPIRED`。

**对 Phase B 的含义**：

- B1 Dashboard 是**只读**的 → **不产生任何审计行**。§十三 说"Dashboard / Users / Reports /
  Moderation 的动作全部进入 Audit"，Dashboard 没有动作，所以没有需要审计的东西。
- B2 Users 列表是只读；只有状态修改（已有）与备注（已有）产生审计。
- B3 新聚合（connection/report/block/social 计数）都是只读。
- **B4 / B5 的每个写动作都必须走 `recordAudit` 并带 `adminId`**，不得出现 SYSTEM、不得写 null adminId。

### 一个观察（不是 bug，不要修）

现有 17 条审计行的 action 是**小写点号命名**（`user.ban`、`user.note`、`report.resolved`、
`report.reviewing`），而**当前代码写的是大写形式**（`ADMIN_USER_BAN`、`REPORT_RESOLVED`）。
说明这 17 条**早于 Phase A 的动作命名约定**。§三.4 禁止删除历史 →
Dashboard 的"最近审计动作"会显示**混合命名**。建议**按原样显示**，不要重写历史行。

---

## 8. 每一项距离本阶段目标还缺什么

### B1 Dashboard

| 目标项 | 现状 | 缺口 |
| --- | --- | --- |
| 用户总数 | ✅ | — |
| ACTIVE 用户 | ❌ | 新增 count |
| SUSPENDED 用户 | ❌ | 新增 count |
| BANNED 用户 | ✅ `banned` | 改名或保留 |
| 今日新增用户 | ❌ | `createdAt >= dayStart` |
| 最近 7 日新增用户 | ❌ | `createdAt >= 7 天前` |
| 待处理 Reports | ✅ `reportsOpen` | — |
| 最近审计动作 | ❌ | `adminAuditLog.findMany` take N（含 actorType） |
| 最近被处理的举报 | ❌ | `report` where status IN (RESOLVED, REJECTED) |
| 最近系统自动恢复事件 | ❌ | `adminAuditLog` where `actorType=SYSTEM` |
| 前端 4 个列表区 | ❌ | 全部新增 |
| empty state | ❌ | 新增（当前 `OPEN 0` 会立刻遇到） |
| refresh | ❌ | 新增 |
| 路由 `/dashboard` | ❌（在 `/`） | 见 §12-F |

### B2 Users

| 目标项 | 现状 | 缺口 |
| --- | --- | --- |
| `page` / `pageSize` | ✅ | — |
| `search`（含 userId） | ⚠️ 只有 `q`，只搜 email+nickname | 加 userId 搜索；`search` 别名 |
| `status` | ✅ | — |
| `country` | ❌ | `countryCode` 等值过滤 |
| `createdFrom` / `createdTo` | ❌ | `createdAt` 区间 |
| `sort` | ❌ | 白名单字段 + 方向 |
| `totalPages` | ❌ | 补字段 |
| 敏感字段不外泄 | ✅ | 保持 |

### B3 User Detail / Status

| 目标项 | 现状 | 缺口 |
| --- | --- | --- |
| 基础资料 | ✅ | — |
| 用户状态 | ✅ | — |
| 创建时间 / 最近活动 | ✅ | — |
| profile 完成情况 | ❌ | 需推导（无 Profile 模型） |
| connection 数量 | ❌ | `connection.count` |
| report 数量 | ⚠️ 只有最近 10 条，无计数 | 加 count |
| block 相关统计 | ❌ | `blocksMade` / `blocksReceived` count（**只读统计，不是 Block Management**） |
| social account 数量 | ❌ | `socialAccount.count` |
| moderation / audit 摘要 | ❌ | `adminAuditLog` where `targetType='USER' AND targetId=:id` |
| 子查询显式 select | ❌ | 收紧，避免将来自动泄漏 |
| `PATCH` 端点 | ❌（现为 `POST`） | 见 §12-A |
| 状态词表 | ⚠️ action 词表 | 见 §12-B |

### B4 Reports

| 目标项 | 现状 | 缺口 |
| --- | --- | --- |
| 列表 + 分页 | ✅ | — |
| `status` 过滤 | ✅ | — |
| `reason` 过滤 | ❌ | 等值 |
| `targetType` 过滤 | ❌ | **无 schema 支撑**，见 §12-C |
| `reporter` 过滤 | ❌ | id 或 email |
| `reportedUser` 过滤 | ❌ | id 或 email |
| `createdFrom` / `createdTo` | ❌ | 区间 |
| `totalPages` | ❌ | 补字段 |
| **详情端点** | ❌ | 新增 `GET /admin/reports/:id` |
| **详情页** | ❌ | 新增 `reports/[id]/page.tsx` |
| moderation history | ❌ | 从 `AdminAuditLog` 取 |
| review 动作 | ✅ | — |
| 审计 | ✅ | — |

### B5 Moderation

| 目标项 | 现状 | 缺口 |
| --- | --- | --- |
| 数据模型 | ❌ 无 | 见 §12-D |
| 队列端点 | ❌ | 新增（复用 Report 查询） |
| 动作端点 | ❌ | 新增（复用 `setStatus` / `reviewReport`） |
| dismiss / reject | ⚠️ 等价物是 `reviewReport(rejected)` | 包装复用 |
| resolve | ⚠️ 等价物是 `reviewReport(resolved)` | 包装复用 |
| suspend | ⚠️ 等价物是 `setStatus(suspend)` | 包装复用 |
| ban | ⚠️ 等价物是 `setStatus(ban)` | 包装复用 |
| 权限门禁 | ⚠️ 权限已存在但无路由使用 | 新增 `@RequirePermission("moderation:...")` |
| `/moderation` 页面 | ❌ | 新增 |
| 导航项 | ❌ | `shell.tsx` 加一项 |

---

## 9. 每项预计修改文件

| 模块 | 后端 | 前端 | 测试 |
| --- | --- | --- | --- |
| **B1** | `admin.service.ts`(dashboard) | `app/dashboard/page.tsx`(新)、`app/page.tsx`(改 redirect)、`components/shell.tsx` | `admin-dashboard.spec.ts`(新)、Playwright `admin-dashboard.spec.ts`(新)、`phaseA-rbac-verify.mjs` |
| **B2** | `admin.service.ts`(searchUsers)、`admin.controller.ts`(query 参数) | `app/users/page.tsx` | 扩 `admin-rbac.spec.ts` 或新 spec、Playwright、verify |
| **B3** | `admin.service.ts`(userDetail、可选 setStatus PATCH 别名)、`admin.controller.ts` | `app/users/[id]/page.tsx` | 扩 `admin-user-detail.spec.ts`、Playwright `admin-user-detail.spec.ts`、verify |
| **B4** | `admin.service.ts`(listReports 过滤 + 新 `reportDetail`)、`admin.controller.ts`(新 GET) | `app/reports/page.tsx`、`app/reports/[id]/page.tsx`(新) | `admin-reports.spec.ts`(新)、Playwright `admin-reports.spec.ts`(新)、verify |
| **B5** | `admin.service.ts`（或独立 `admin-moderation.service.ts`）、`admin.controller.ts` | `app/moderation/page.tsx`(新)、`components/shell.tsx` | `admin-moderation.spec.ts`(新)、Playwright(新)、verify |

**不动的文件**：`prisma/schema.prisma`（B1–B4 确定不需要；B5 取决于 §12-D）、
`permissions.ts`（矩阵不需要改）、`user-status.scheduler.ts`（§十八 保护）、
`admin.guard.ts` / `permission.guard.ts`（复用）。

---

## 10. 是否需要 Prisma migration

| 模块 | 需要迁移？ | 说明 |
| --- | --- | --- |
| B1 Dashboard | **否** | 全部统计基于已有列与关系 |
| B2 Users | **否** | `countryCode` / `createdAt` / `status` 已有索引：`@@index([status])`、`@@index([countryCode])`、`@@index([createdAt])` |
| B3 User Detail | **否** | 计数基于已有关系 |
| B4 Reports | **否**（推荐） | 现有 `@@index([status, createdAt])`、`@@index([reportedUserId, status])` 覆盖主要查询。仅当要做 `targetType=MESSAGE` 过滤时，可考虑给 `messageId` 加索引 —— 但**不是必须** |
| B5 Moderation | **取决于 §12-D** | 采用"Report + Audit 视图"方案 → **否**；采用新增 `ModerationRecord` 表 → 需要一次**纯新增表**的迁移（对既有数据零风险） |

**明确不需要的迁移**（列出以免被顺手做掉）：
- 给 `Report.messageId` 补 FK —— 会因悬空 id 失败，且不在本阶段范围。
- 给 `AdminAuditLog` 加 `@@index([actorType, createdAt])` —— §十三 明确暂不做筛选。
- 任何 `AdminNote` 的改造 —— §十八 保护项。

---

## 11. 测试缺口

### 现状

| 层 | 数量 | 覆盖 |
| --- | --- | --- |
| API Jest | 14 suites / 145 | RBAC 矩阵(8) + PermissionGuard(6) + AdminGuard(6) + setStatus 规则(7+) + audit(22) + scheduler(18) + userDetail(4) |
| Admin Playwright | 14 | RBAC 5 + user detail 5 + audit UI 4 |
| Real E2E (`phaseA-rbac-verify.mjs`) | 72 | 认证 / 读能力 / 404 / 写能力 / 角色门禁 / reason+expiry / 自我保护 / 软禁用 / payload 加固 / 审计完整性 / SYSTEM schema / 调度器 |
| Admin smoke | 2 | **源码正则**（`assert.match(source, /\/admin\/users\?/)`）—— 不是行为测试 |

### 各模块必须新增（§十四 要求，四层都要）

| 模块 | API Jest | Playwright | Real E2E |
| --- | --- | --- | --- |
| **B1** | 权限（5 角色）、统计正确性（对真实 DB）、**空数据** | 卡片渲染、列表区、empty、error、refresh | `/admin/dashboard` 对 5 角色的 200/403；计数与直接查询一致 |
| **B2** | 分页、search（email/nickname/**userId**）、status、country、日期区间、sort、`totalPages`、**敏感字段不存在断言** | 各筛选控件、empty state | 各查询参数组合、越界 page、非法 sort |
| **B3** | 404（已有）、新聚合、profile 完成度、**敏感字段不存在断言** | 新聚合渲染、只读角色无按钮 | 详情 200/404；响应不含 `passwordHash`/`tokenHash` 等 key |
| **B4** | 列表各过滤、详情 200/404、review 三动作、权限、审计行形状 | 列表筛选、详情页、review 确认弹窗 | 详情端点、过滤组合、review 后审计行断言 |
| **B5** | 队列、resolve/reject/suspend/ban、权限、审计 | 队列渲染、四动作、确认弹窗 | 各动作 200/403 + 审计行 |

### 跨模块必须保持的不变量

- **任何人类路径都不得产生 SYSTEM 行或 null adminId**（现有 `admin-audit.spec.ts` 22 项已覆盖机制，
  需为每个新写动作加断言）。
- **任何新列表/详情响应都不得包含** `passwordHash` / `tokenHash` / `ip` / `userAgent`（除审计行自身）。
- `apps/admin/test/smoke.test.mjs` 的正则断言会因新页面/新查询串而失效，需要同步更新
  —— 或更好：由真实 Playwright 覆盖取代，但**不要删除已有断言而不替换**。

---

## 12. 需要你决策的阻塞项

### A. `PATCH` vs `POST`（阻塞 B3）

§七 要求 `PATCH /api/v1/admin/users/:id/status`；实际是 **`POST`**（`admin.controller.ts:99`）。
现有依赖 `POST` 的地方：`users/page.tsx:104`、`users/[id]/page.tsx`、`admin-rbac.spec.ts`、
`admin-user-detail.spec.ts`、Playwright、`phaseA-rbac-verify.mjs`（多项断言）。

| 方案 | 影响 |
| --- | --- |
| (a) 保持 `POST` | 与 §七 字面不符，但零破坏 |
| **(b) 新增 `PATCH` 作为等价别名，保留 `POST`** ← **建议** | 纯加法，满足 §七，基线不动 |
| (c) `POST` → `PATCH` 迁移 | **会打破 §一 保护的基线，不建议** |

### B. 状态词表（阻塞 B3）

§七 说支持 `ACTIVE / SUSPENDED / BANNED`；实际动作词表是
`ban | unban | disable | activate | suspend`，且 `UserStatus` 有第 4 个值 `DISABLED`（§七 未提）。

现有 `ROLE_ALLOWED_STATUS_ACTIONS`、`canSetUserStatus`、3 个 Playwright 测试、多项 E2E 断言
全部基于这个动作词表。

**建议：保留动作词表**，映射关系为
`ban→BANNED`、`suspend→SUSPENDED`、`activate/unban→ACTIVE`、`disable→DISABLED`。
§七 的三个状态已全部覆盖，`DISABLED` 是既有的、SUPPORT 正在用的状态，不应移除。
**请确认。**

### C. Reports 的 `targetType` 过滤（阻塞 B4 的一个筛选器）

`Report` 没有 `targetType` 列。目标只有 `reportedUserId`（永远是人）和可选 `messageId`
（当前 10 条中 5 条有值，且**无 FK**）。

| 方案 | 说明 |
| --- | --- |
| (a) 不做 | §九 少一个筛选器 |
| **(b) 合成两值 `USER`（全部）/ `MESSAGE`（`messageId != null`）** ← **建议** | 有真实数据支撑，语义诚实 |
| (c) 加 `Report.targetType` 列 | 需要 migration + 历史行回填，**超出必要范围** |

### D. Moderation 的数据模型（阻塞 B5）

§十一 假设 `ModerationRecord` / `MessageModeration` 存在，**实际都不存在**；
`SafetyService` 也不提供任何审核动作。§二 禁止大规模重构，§十八 要求"需要修改核心 Prisma 模型
但无法确认兼容性 → 停止并报告"。

| 方案 | 说明 |
| --- | --- |
| **(a) Report + AdminAuditLog 之上的读+操作视图，动作复用 `setStatus` / `reviewReport`，不建新模型** ← **建议** | 最贴合 §十一 "不要重新设计一套平行 Moderation 系统"；零迁移；零新抽象 |
| (b) 新增 `ModerationRecord` 表 | 需要 migration；引入 §二 警告的"为以后方便而提前建立的抽象" |

### E. Dashboard 的「管理员」计数语义（阻塞 B1 的一个 KPI）

`dashboard()` 用 `user.count({ isAdmin: true })` —— 这是**兼容用的遗留标志**，
不是 `AdminUser` 行数。今天两者都是 9（`isAdminTrue 9 / adminUsers 9 / adminUsersActive 9`），
所以**目前看不出差异**；但一旦某个 AdminUser 被软禁用（`isActive=false`），
或出现只有 `isAdmin` 没有 `AdminUser` 的遗留账号，这个数字就会失真。

| 方案 | 说明 |
| --- | --- |
| **(a) 改为 `adminUser.count({ where: { isActive: true } })`** ← **建议** | 与 RBAC 的真相来源一致 |
| (b) 保留 `isAdmin` 计数 | 保持现状，但与授权模型脱节 |
| (c) 同时返回两个数 | 最透明，但卡片会多一张 |

**这一项会改变一个既有数字的含义，所以需要你确认。**

### F. Dashboard 路由 `/` vs `/dashboard`（阻塞 B1 前端）

§十二 要求 `/dashboard`；实际在 `/`。注意 `apps/admin/test/fixtures/browser.ts` 的
`loginAndLand()` 断言登录后出现「仪表盘」标题 —— 如果只把页面搬到 `/dashboard`，该 helper 会失效。

| 方案 | 说明 |
| --- | --- |
| **(a) 新增 `/dashboard`，`/` 做 redirect** ← **建议** | 满足 §十二，`loginAndLand` 仍可用 |
| (b) 只保留 `/` | 与 §十二 不符 |
| (c) 搬到 `/dashboard` 并改 helper | 可行但要同步改测试夹具 |

### G. 只报告、不修改的既有问题

`SafetyService.recordAutoFlag()` 的注释与实现矛盾（非 HIGH 级别会把机器信号写成
`reporterId = reportedUserId` 的自举报）。属非 Admin 模块，§十八 要求停止并报告。
**本阶段不修。** 需要你决定是否另开一个任务。

---

## 13. 建议的执行顺序

**B1 Dashboard 没有任何阻塞项，可以立即开始**（除 §12-E 的一个 KPI 语义、§12-F 的路由选择，
两者都可以先按建议方案实现，因为它们不改变任何既有 API 语义）。

之后按 §十七：B1 → 验证 → B2 → 验证 → B3 → 验证 → B4 → 验证 → B5 → 完整回归。

**B3 需要先解决 §12-A / §12-B；B4 需要 §12-C；B5 需要 §12-D。**
