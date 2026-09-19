# TALKFIRST — PHASE A+ HARDENING RESULT

范围：① `suspendedUntil` 到期自动恢复 ② `apps/admin` 真实行为级测试基础 ③ Admin 认证错误码统一 ④ 完整验证。

**已完成并验证，现在停止，未进入 Phase B。** 未开发：Dashboard 新指标、用户管理新功能、Moderation、Risk、Connections、Exchanges、Blocks、Audit Export、System Settings、Announcements、Admin 管理页面。

---

## Changed Files

> ⚠️ 与 Phase A 相同：`D:\文件\网站\TalkFirst` **不是 git 仓库**，`git diff` 无法产出。清单由文件系统实际状态核对得出，未伪造。

### 后端 — 新增（5）
| 文件 | 说明 |
|---|---|
| `apps/api/src/users/user-status.scheduler.ts` | `@Cron(EVERY_MINUTE)` 释放到期临时封禁 |
| `apps/api/src/users/user-status.scheduler.spec.ts` | 10 项行为测试 |
| `apps/api/src/auth/jwt-auth.guard.ts` | `JwtAuthGuard`，统一 401 错误码 |
| `apps/api/src/auth/jwt-auth.guard.spec.ts` | 11 项测试 |
| `apps/api/src/common/api-exception.filter.spec.ts` | 6 项测试 |

### 后端 — 修改（13）
| 文件 | 变更 |
|---|---|
| `apps/api/src/app.module.ts` | 注册 `ScheduleModule.forRoot()` |
| `apps/api/src/users/users.module.ts` | 注册 `UserStatusScheduler` |
| `apps/api/src/common/api-exception.filter.ts` | 裸 401 → `UNAUTHORIZED`（兜底，仅改 code） |
| `apps/api/src/admin/admin.controller.ts` | `AuthGuard("jwt")` → `JwtAuthGuard` + 注释更新 |
| `apps/api/src/auth/auth.controller.ts` | 同上 |
| `apps/api/src/chat/presence.controller.ts` | 同上 |
| `apps/api/src/connections/connections.controller.ts` | 同上（7 处） |
| `apps/api/src/discover/discover.controller.ts` | 同上 |
| `apps/api/src/exchange/exchange.controller.ts` | 同上 |
| `apps/api/src/moments/moments.controller.ts` | 同上 |
| `apps/api/src/social/social-safety.controller.ts` | 同上 |
| `apps/api/src/translate/translate.controller.ts` | 同上 |
| `apps/api/src/uploads/uploads.controller.ts` | 同上 |
| `apps/api/src/users/users.controller.ts` | 同上 |

共 16 处 `AuthGuard("jwt")` 全部替换。`apps/api/package.json` 增加 `@nestjs/schedule@^12.0.2`。

### 管理端前端 — 新增（5）
| 文件 | 说明 |
|---|---|
| `apps/admin/playwright.config.ts` | 浏览器测试配置（自拉起 API 4000 + admin 3001） |
| `apps/admin/test/fixtures/admin-roles.ts` | 5 个角色夹具，幂等 upsert + 按前缀清理 |
| `apps/admin/test/e2e/global-setup.ts` | 播种 |
| `apps/admin/test/e2e/global-teardown.ts` | 清理 |
| `apps/admin/test/e2e/admin-rbac.spec.ts` | 5 项浏览器行为测试 |

### 管理端前端 — 修改（3）
| 文件 | 变更 |
|---|---|
| `apps/admin/src/app/users/page.tsx` | **Bug 修复**：拆成外层 `<Shell>` + 内层 `UsersScreen` 消费 session |
| `apps/admin/src/app/reports/page.tsx` | **Bug 修复**：同上（`ReportsScreen`） |
| `apps/admin/package.json` | `+@playwright/test`；`test` = smoke + playwright；新增 `test:e2e` / `test:e2e:build` |

### 其他（2）
| 文件 | 变更 |
|---|---|
| `scripts/phaseA-rbac-verify.mjs` | 扩展：+5 项认证错误码、+4 项真实数据库自动恢复、+1 项 BANNED 不受影响 |
| `scripts/phaseAplus-cron-probe.mjs` | 新增：验证 `@Cron` 在真实进程中自行触发（不手动调用） |
| `.gitignore` | 忽略 Playwright 产物 |

安装依赖前的备份：`.local-data/backups/{package.json,package-lock.json,admin-package.json}.pre-playwright`。

---

## Scheduler

| 项 | 内容 |
|---|---|
| **执行频率** | `@Cron(CronExpression.EVERY_MINUTE)` — 每分钟一次 |
| **查询条件** | `status = 'SUSPENDED' AND suspendedUntil IS NOT NULL AND suspendedUntil <= now` |
| **恢复条件** | `status = 'ACTIVE'`, `suspendedUntil = null`, `bannedAt = null`, `banReason = null` |
| **幂等性** | 见下 |
| 位置 | `apps/api/src/users/user-status.scheduler.ts`，注册于 `UsersModule`，由 `AppModule` 的 `ScheduleModule.forRoot()` 驱动 |

### 基础设施侦察（安装前）
项目**完全没有**定时任务基础设施：无 `@nestjs/schedule`、`SchedulerRegistry`、`Cron`、`BullMQ`、`Bull`、`queue`、`worker`，`apps/api/src` 内也没有任何 `setInterval`。因此按指示采用 NestJS Scheduler，并选用 **`@nestjs/schedule@12.0.2`** —— 其 peer 为 `@nestjs/common@^11 || ^12`，与本项目的 Nest 12 对齐（不是盲装）。

### 恢复后的字段状态 —— 先核对业务语义，未猜
`User` 上与状态相关的列只有三个：`bannedAt` / `banReason` / `suspendedUntil`，无独立的暂停原因列。`AdminService.nextStatusState` 对 `suspend` 写的是 `status=SUSPENDED, bannedAt=null, banReason=reason, suspendedUntil=expiresAt`；对 `activate`/`unban` 写的是 `status=ACTIVE, bannedAt=null, banReason=null, suspendedUntil=null`。

自动恢复采用与 `activate`/`unban` **完全相同的终态**，使「暂停到期」与「管理员手动解封」收敛到同一状态。`banReason` 一并清空（保留历史由审计/日志承担）。**未触碰任何其他字段。**

### 幂等性（两条独立保障）
1. **谓词自消耗**：行一旦被更新，`status` 不再是 `SUSPENDED` 且 `suspendedUntil` 为 `null`，无法再次匹配。不存在 `SUSPENDED → ACTIVE → ACTIVE` 抖动，第二次执行更新 0 行、不重写 `updatedAt`。
2. **在途标志**：慢查询导致的 tick 重叠会被跳过并记 WARN，避免并发重复扫描。

`{ not: null, lte: now }` 显式写出 null 分支：SQL 的 `NULL <= now` 不为真，因此没有截止时间的 `SUSPENDED` 行会被正确保留而不是误释放。

### 定时器真的会触发吗？—— 实测（`scripts/phaseAplus-cron-probe.mjs`，7/7 通过）

单元测试与真机脚本都是**直接调用** `releaseExpiredSuspensions()`，两者都**无法证明 `@Cron` 装饰器真的被接线**：那需要 `ScheduleModule.forRoot()`、provider 注册和运行中的事件循环共同成立。漏掉注册的话，其他测试全绿而线上什么都不会发生。

因此探针**不做任何手动调用** —— 它只创建一条过期封禁，然后等应用自己发现：

| 检查 | 结果 |
|---|---|
| 夹具初始为 `SUSPENDED` 且截止时间已过 | PASS |
| **运行中的 `@Cron` 自行释放了过期封禁（无手动调用）** | PASS |
| 释放后三个状态列全部清空 | PASS |
| 该行确由调度器写入（`updatedAt` 前进） | PASS |
| **自动恢复未写任何审计行**（机器动作，无 system actor） | PASS |
| 实时扫描未触碰 `BANNED` 用户 | PASS |
| 探针夹具已清理 | PASS |

应用自身日志的直接证据（进程启动于 12:58:40）：

```
[InstanceLoader] ScheduleModule dependencies initialized +0ms
[NestApplication] Nest application successfully started +15ms
[UserStatusScheduler] Auto-released 1 expired suspension(s)     ← 12:59:00，整分触发
```

进程运行 2 分钟（≥2 个 tick）后，**`Auto-released` 只出现一次** —— 第二次 tick 匹配 0 行、不产生日志，这正是幂等在真实进程中生效的证明（不是仅在测试里）。

### Audit —— 本阶段**不写** `AdminAuditLog`（重要决策）

先检查了现有审计语义，结论：

- `AdminAuditLog` **唯一写入方**是 `AdminService.recordAudit()`。
- **项目不存在任何 system actor**：无 `SYSTEM_USER`、无 `systemUser`、无 `isSystem`、无 `actorType`，也没有可空 actor 契约。
- `AdminAuditLog.adminId` 是**必填** FK → `User(id) ON DELETE RESTRICT`。

因此只有两条路，**两条都是错的**：
1. 借用某个真实管理员的 UUID —— 伪造审计轨迹，会让某个 SUPER_ADMIN 看起来在凌晨三点执行了操作；
2. 造一个 "system" User 行 —— 这个合成账号会出现在 `/admin/users`、用户总数、Dashboard 的管理员计数里，并且是一个**真实可登录**的身份。这是产品决策，不是调度器能决定的。

这也与项目**既有约定一致**：`SafetyService.recordAutoFlag` 同样拒绝把机器信号写入 `Report`，理由完全相同（`Report.reporterId` 是必填 FK，会把机器动作归因到人类）。**机器动作不进人类动作表。**

所以自动恢复只通过结构化应用日志可观测。补齐这个缺口需要一个 schema 决策（`adminId` 可空 + `actorType` 判别列，或种子 system actor），已列入遗留问题，**未在本阶段偷偷夹带**。

---

## Authentication Codes

### 根因
`AuthGuard("jwt")` 在 token **缺失 / 签名无效 / 过期 / 格式错误**时抛出的是**裸** `UnauthorizedException("Unauthorized")`。`ApiExceptionFilter` 只对**已经带 `error.code`** 的 payload 原样透传，其余一律回落到通用 `HTTP_ERROR`。于是这些认证失败全部塌缩成同一个无语义代码，客户端无法区分「没登录」和「会话过期」。

`JwtStrategy.validate()` 本身**早就**抛结构化领域码（`USER_DISABLED` / `USER_BANNED` / `INVALID_TOKEN` / `USER_NOT_FOUND`），这部分本来是对的 —— 缺的只是「token 本身不成立」那一段。

### 修复
1. 新增 `JwtAuthGuard extends AuthGuard("jwt")`，重写 `handleRequest`：认证失败 → `UNAUTHORIZED`；策略抛出的领域异常**原样重抛**（比 `UNAUTHORIZED` 更具体，不能覆盖）。
2. `ApiExceptionFilter` 增加兜底：任何**裸 401** → `UNAUTHORIZED`。即使将来有人直接写 `@UseGuards(AuthGuard("jwt"))` 也仍然正确。
3. 16 处调用点统一改用 `JwtAuthGuard`。

**只统一 `error.code`**，响应形状保持 `{ success:false, error:{ code, message } }`，成功响应完全未动。

### 完整错误码表（实测）
| code | HTTP | 触发条件 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 无 token / 签名无效 / 已过期 / 格式错误 —— **「没有有效身份认证」** |
| `INVALID_TOKEN` | 401 | token 类型不是 `access`（如误用 refresh token） |
| `USER_DISABLED` | 401 | `User.status` 为 `DISABLED` / `SUSPENDED` 等非 `ACTIVE` 非 `BANNED` 状态 |
| `USER_BANNED` | 401 | `User.status = BANNED` |
| `USER_NOT_FOUND` | 401 | token 有效但用户已不存在 |
| `INVALID_CREDENTIALS` | 401 | 登录邮箱或密码错误 |
| `NO_REFRESH_TOKEN` / `INVALID_REFRESH_TOKEN` | 401 | 刷新流程 token 缺失或失效 |
| `ADMIN_REQUIRED` | 403 | **已认证，但不是管理员** |
| `ADMIN_INACTIVE` | 403 | **`AdminUser.isActive = false`**（优先于 `User.isAdmin` 兼容回退） |
| `PERMISSION_DENIED` | 403 | **管理员身份有效，但角色没有该权限** |
| `ACTION_NOT_ALLOWED_FOR_ROLE` | 403 | 角色不允许该具体状态动作（如 SUPPORT 封禁） |
| `CANNOT_MODIFY_SELF` | 403 | 修改自己的账号状态 |
| `CANNOT_MODIFY_ADMIN` | 403 | 非 SUPER_ADMIN 修改活跃管理员 |
| `REASON_REQUIRED` | 400 | 状态变更 / 举报审核 / 备注缺少非空原因 |
| `EXPIRES_AT_REQUIRED` | 400 | `suspend` 未提供到期时间 |
| `INVALID_EXPIRES_AT` | 400 | 到期时间不是未来时间 |
| `INVALID_ACTION` | 400 | 未知状态动作 |
| `VALIDATION_ERROR` | 400 | DTO 校验失败 / 含多余字段（mass-assignment 已关闭） |
| `HTTP_ERROR` | 其他 | 非 401 的裸 `HttpException`（**未变更**） |
| `INTERNAL_ERROR` | 500 | 未捕获异常（不泄露内部信息） |

### 踩坑记录（只有真正启动 API 才能发现）
`JwtAuthGuard extends AuthGuard("jwt")` 若**不自带构造函数**，Nest 会通过原型链继承 mixin 的 `@Inject(AuthModuleOptions)` 元数据，并在**使用该 guard 的模块**里解析这个依赖 —— 而只有 `AuthModule` 导入了 `PassportModule`。结果是除 AuthModule 外**所有模块启动即 `UnknownDependenciesException`**（Social / Discover / Moments …）。

`npx tsc --noEmit`、`npx jest` 全绿也发现不了，**必须真正 boot API**。

修法：显式声明 `constructor(@Optional() options?: AuthModuleOptions) { super(options); }`，用**自己的** `@Optional()` 元数据覆盖继承来的必填元数据。修复后 API 正常启动（`Nest application successfully started`）。

---

## Admin Browser Tests

### 测试体系侦察
项目**没有任何浏览器测试工具**：Playwright / @playwright/test / Cypress / Vitest / @testing-library/react / @testing-library/dom / jsdom **全部未安装**，也没有 `e2e` / `tests` / `__tests__` 目录。`apps/admin` 只有 `test/smoke.test.mjs`（2 个静态 regex 断言）。按指示选择 **Playwright**（1.63.0 + chromium）。

安装时撞到一个**既有的**依赖问题：根 `@nestjs/throttler@6.5.0` 的 peer 要求 `@nestjs/common@^7||^8||^9||^10||^11`，而根装的是 `@nestjs/common@12` —— `npm install` **直接失败**。也就是说**该项目当前的全新安装本来就是坏的**，与本次改动无关。使用 `--legacy-peer-deps` 绕过（安装前已备份 `package.json` / `package-lock.json`）。

### 实际测试数量与结果
**5 个测试，5 通过，0 失败**（`apps/admin/test/e2e/admin-rbac.spec.ts`，chromium，串行，耗时 9.7s）。

| # | 测试 | 关键断言 |
|---|---|---|
| 1 | **活跃 SUPER_ADMIN 可进入** | `/admin/me` 解析出 `SUPER_ADMIN` + 超级管理员；4 个导航项全可见；Dashboard 真实数据（总用户 / 待审举报）；用户页 4 个状态按钮**全部可见**（解封 / 停用 / 临时封禁 / 永久封禁） |
| 2 | **`AdminUser.isActive = false` 被拒绝** | 显示「该管理员账号已被停用，请联系超级管理员。」；停留 `/login`；**不渲染任何 shell**；直接访问 `/` 也被弹回 `/login`（在真实浏览器中走通 Phase A+ 的 `UNAUTHORIZED` 路径） |
| 3 | **ANALYST 只读** | 审计日志 / 用户 / 举报均可读；用户页显示「只读」提示且 **0 个状态按钮**、无备注输入框；举报页显示「只有查看权限」且 **0 个审核按钮** |
| 4 | **SUPPORT** | 可见 `停用` / `解封`；**不可见** `临时封禁` / `永久封禁`；举报页无审核按钮 |
| 5 | **MODERATOR** | 举报页 `受理` / `处理` / `驳回` 全部可见；用户页 `临时封禁` 可见、`永久封禁` 不可见；导航恰好为 `["仪表盘","用户","举报","审计日志"]` |

夹具：5 个 `pw.*@example.test` 账号（密码哈希真实、角色真实）+ 1 条 OPEN 举报。`globalSetup` 先清理再播种，`globalTeardown` 按前缀清理 —— **实测 removed 5，无残留**。

### ⚠️ 浏览器测试立刻抓到两个真实 Bug（静态 regex 永远抓不到）

**Bug 1 —— Phase A 的「角色感知按钮」实际完全失效**
`AdminSessionProvider` 渲染在 `<Shell>` **内部**，而 `users/page.tsx` 与 `reports/page.tsx` 在**渲染 `<Shell>` 的同一个组件里**调用 `useAdminSession()`。React Context 只向下传递，所以这个 hook 读到的是**默认值** `{ identity: null, can: () => false }`：

- `role` 永远是 `null` → `canSetUserStatus(null, …)` 对**所有角色**返回 false
- `canWrite` 永远是 `false`

结果：**任何角色都看不到任何一个状态按钮，包括 SUPER_ADMIN**。页面上只显示「你的角色（）为只读」—— 角色名是空的，这正是快照暴露出的证据。后端一直是对的（所以 API 层 44/44 全过），**只有真实浏览器测试能发现**。

修复：把每个页面拆成外层 `<Shell>` 包裹 + 内层 screen 组件消费 context（`UsersScreen` / `ReportsScreen`），这是与 provider 作用域相符的正确 React 模式。

**Bug 2 —— `JwtAuthGuard` 导致 API 无法启动**（见上文「踩坑记录」）。

### 边界声明
这些测试**只验证前端呈现**。后端 `PermissionGuard` + `AdminService` 的 scope check 仍然是唯一安全边界 —— **隐藏按钮不是授权控制**。本阶段未删除任何后端检查。后端强制由 `apps/api/src/admin/*.spec.ts` 与 `scripts/phaseA-rbac-verify.mjs` 覆盖。

另需诚实说明：MODERATOR 测试中「settings / audit export 不可见」这两条断言，因为 Phase A 控制台**根本没有**设置页与导出控件，**对任何角色都为真**（vacuous）。它们记录的是契约，等这些模块落地后才会真正产生约束力。

---

## Existing Phase A Regression

| 项 | 结果 |
|---|---|
| **Jest** | **13 suites / 122 tests 全部通过**（Phase A 为 10 suites / 95 tests）—— 原有 95 项全部保留通过，本阶段新增 3 个套件 27 项 |
| **Real E2E** | **53/53 通过**（Phase A 为 44/44）—— 原有 44 项全部保留通过，新增 9 项 |
| **API build** | **PASS**（`npx nest build`） |
| **Admin build** | **PASS**（`npx next build`，8 路由） |
| **Web build** | **PASS**（`npx next build`，27 路由） |
| **Live `@Cron` probe** | **7/7 通过**（`scripts/phaseAplus-cron-probe.mjs`）—— 真实进程中定时器自行触发，未手动调用 |

补充（同样实测）：API `tsc --noEmit` 0 错误、`eslint "src/**/*.ts"` 0 问题；Admin `tsc --noEmit` 0 错误、`npm test` = 2 静态 smoke + 5 浏览器测试全过；Web `tsc --noEmit` 0 错误、`next lint` 无警告、`npm test` 5/5。

### 新增测试明细
| 套件 | 数量 | 覆盖 |
|---|---|---|
| `user-status.scheduler.spec.ts` | 10 | Test 1 过期→ACTIVE；Test 2 未过期→保持；Test 3 重复执行不重写；混合人群只放行过期项；边界 `lte`；无截止时间不释放；`where`/`data` 契约逐字断言；DB 异常被吞；失败后不泄漏在途标志；tick 重叠被跳过 |
| `jwt-auth.guard.spec.ts` | 11 | 无 token / 无 auth token / 过期 / 签名错误 → `UNAUTHORIZED`；信封形状；有效用户直通；4 个领域码原样保留；非 HTTP 异常不被伪装 |
| `api-exception.filter.spec.ts` | 6 | 裸 401 → `UNAUTHORIZED`；结构化 401 保留自有 code；裸 403 仍 `HTTP_ERROR`；结构化 400 透传；未捕获异常 → 500 且不泄露消息 |
| `admin-rbac.spec.ts`（浏览器） | 5 | 见上表 |

### 真机 E2E 新增项（`scripts/phaseA-rbac-verify.mjs`，53/53）- `no cookie → 401 UNAUTHORIZED`
- `invalid token → 401 UNAUTHORIZED`
- `expired token → 401 UNAUTHORIZED`
- `wrong token type → 401 INVALID_TOKEN`（更具体的码未被覆盖）
- `disabled account → 401 USER_DISABLED`（与 `UNAUTHORIZED` 区分开）
- 自动恢复 4 项：**调用 `apps/api/dist` 中编译后的真实调度器**对真实 PostgreSQL 执行 —— 过期行被释放且三个状态列全部清空；未过期行保持 `SUSPENDED` 且截止时间原样；`BANNED` 用户完全不受影响；第二次执行 0 行、`updatedAt` 未变。

> 运行前已确认数据库 **0 个 SUSPENDED 行**，因此真实全表扫描只可能命中夹具，不会改动既有数据。

---

## Database

**No schema migration required.**

| 检查 | 结果 |
|---|---|
| 新增 migration | **无**（本阶段不需要 schema 修改，故未创建无意义 migration） |
| `prisma migrate deploy` | **未执行**（无新迁移） |
| `prisma migrate dev` / `reset` | **未使用**（全程禁止） |
| `prisma migrate status` | `15 migrations found` · **`Database schema is up to date!`** |
| `prisma migrate diff`（datasource → datamodel） | **`-- This is an empty migration.`** → 无漂移 |
| `schema.prisma` | **未修改** |

### Phase A 回归保持（逐项实测）
| 项 | 结果 |
|---|---|
| `AdminUser` | **9 行，全部 `SUPER_ADMIN`，全部 `isActive = true`** |
| `User.isAdmin = true` | **9**（兼容字段**未删除**） |
| `User.isAdmin` 兼容回退 | **保留**（`legacy` 路径实测仍放行，未提前处理 Phase H） |
| `AdminGuard` / `PermissionGuard` | 保留，且新增 16 处 `JwtAuthGuard` 前置认证 |
| 审计 FK | `AdminAuditLog_adminId_fkey` / `AdminNote_adminId_fkey` / `AdminUser_userId_fkey` 全部 `confdeltype = 'r'`（**RESTRICT**） |
| `User` | **168**（与 Phase A 后一致） |
| `AdminAuditLog` / `AdminNote` / `SocialAccount` | **17 / 16 / 28**（均未变） |
| 夹具残留 | `phasea.verify%` = **0**；`pw.%` = **0**；`cronprobe.%` = **0** |
| 残留 `SUSPENDED` 行 | **0** |
| 自动恢复产生的审计行 | **0**（`AdminAuditLog` 仍为 17，与 Phase A 后一致） |

---

## Remaining Issues

只列真实存在的问题。

### 本阶段引入或暴露的
1. **自动恢复没有审计留痕**（设计取舍，非疏漏）。`AdminAuditLog.adminId` 是必填 FK 且项目无 system actor，伪造 adminId 或造 system 用户都是错的，因此选择不写并保持与 `SafetyService.recordAutoFlag` 一致的约定。补齐需要 schema 决策：`adminId` 改为可空 + 增加 `actorType` 判别列，或种子一个明确的 system actor。**这会削弱 Phase A 刚建立的审计完整性保证，因此必须是一次有意识的决策，不能顺手做。**
2. **`apps/admin` 的 `npm test` 现在依赖数据库与已构建产物**。Playwright 会自行拉起 API(4000) 与 admin(3001)，但 `node dist/main.js` 与 `next start` 都需要先构建；数据库也必须在线。相比之前「纯静态断言、零依赖」，这是一个真实的可移植性代价。`npm run test:e2e:build` 提供了一步到位的路径。
3. **项目全新 `npm install` 本来就是坏的** —— 根 `@nestjs/throttler@6.5.0` 的 peer 要求 `@nestjs/common@≤11`，实际装的是 12。本阶段用 `--legacy-peer-deps` 绕过，但**根因未修**。任何人 clone 后直接 `npm install` 都会失败。
4. **`settings` / `audit export` 的浏览器断言目前是 vacuous 的** —— 这两个模块在 Phase A 控制台不存在，所以「不可见」对任何角色都成立。测试已注明，等模块落地后才会真正生效。

### 承继自 Phase A，仍未处理
5. **`apps/admin` 的静态 smoke 测试仍保留**（`test/smoke.test.mjs`）。它们现在与真实浏览器测试并存，价值很低，未来可以删除。
6. **`GET /admin/users` 列表仍返回 email**（P2，未脱敏）。
7. **无 CSRF token**（依赖 `SameSite=Lax`）。
8. **`GET /admin/users/:id` 不存在时返回 200 + `null`** 而非 404。
9. **`AdminUser.createdBy` 已建列但无写入路径**；**无 `/admin/admins` 接口** —— 当前无法在后台管理管理员（属 Phase H）。
10. **未做完整 Admin E2E** —— 本阶段只建立了最小基础（5 个测试，4 个页面中覆盖 3 个），`/users/[id]` 详情页、分页、确认弹窗的交互流程仍未覆盖。
11. **项目不是 git 仓库** —— 无 diff、无回滚、无追溯。本阶段改动只能靠备份与文件清单回溯。
12. **`suspend` 到期自动恢复已实现，但 UI 无任何提示** —— 用户只会发现自己又能登录了，管理员侧也没有「该用户的暂停已自动解除」的记录（见问题 1）。

### 建议的下一步顺序
1. 先决定自动恢复的审计方案（问题 1）—— 它决定了后续所有「系统动作」的写法，越晚定越贵。
2. 修 `@nestjs/throttler` 的 peer 冲突（问题 3）—— 一个 clone 就能复现的坏体验。
3. 补 `/users/[id]` 与确认弹窗的浏览器测试（问题 10），再进入 Phase B。
