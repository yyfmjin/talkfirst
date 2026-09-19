# TALKFIRST ADMIN — PHASE A RESULT

Phase A 范围：RBAC + Admin 安全基线 + 审计基线。
本阶段**已完成并验证**。Dashboard 新指标、Moderation、Risk、Connections、Exchanges、Blocks、Audit Export、System Settings、Announcements、完整 Admin E2E **均未开始**（按 §28/§30 要求停在 Phase A）。

---

## 1. Changed Files

> ⚠️ **§36 的 `git diff --stat` / `git diff` 无法产出。** `D:\文件\网站\TalkFirst` **不是 git 仓库**
> （`fatal: not a git repository (or any of the parent directories): .git`）。
> 已按要求**不伪造**该证据，改为按文件逐项列出。下方清单由文件系统实际状态核对得出。

### 后端 — 新增（5）
| 文件 | 说明 |
|---|---|
| `apps/api/src/admin/permissions.ts` | 权限矩阵单一真源。20 个权限 × 5 角色，TS 常量（**刻意不建 DB 权限表**）。含 `hasPermission()` / `permissionsForRole()` / `ROLE_ALLOWED_STATUS_ACTIONS` / `canSetUserStatus()` |
| `apps/api/src/admin/require-permission.decorator.ts` | `@RequirePermission(permission)`，`SetMetadata`，key = `admin:required-permission` |
| `apps/api/src/admin/permission.guard.ts` | 读 `Reflector.getAllAndOverride`（handler → class），403 `PERMISSION_DENIED` / `ADMIN_REQUIRED` |
| `apps/api/src/admin/admin-rbac.spec.ts` | 35 项测试 |
| `apps/api/src/admin/admin-audit.spec.ts` | 13 项测试 |

### 后端 — 重写 / 修改（5）
| 文件 | 变更 |
|---|---|
| `apps/api/src/admin/admin.guard.ts` | 重写为**只负责身份**。导出 `ResolvedAdmin` / `AdminRequest`。解析顺序 JWT → User → AdminUser → isActive → role。`AdminUser.isActive=false` → 403 `ADMIN_INACTIVE`（**优先于** `isAdmin`）。无 AdminUser 行但 `isAdmin=true` → `SUPER_ADMIN` + `legacy: true` 兼容回退。User.status ≠ ACTIVE → 403 `ADMIN_REQUIRED` |
| `apps/api/src/admin/admin.service.ts` | 重写。新增 `me()`、`recordAudit()`（唯一审计写入口，可传入事务客户端）、`nextStatusState()`。`setStatus()` 落 6 条安全规则。`reviewReport()` 改用 `ResolvedAdmin` + 强制 reason + `targetType:"REPORT"`。`addNote()` 改用 `ResolvedAdmin` |
| `apps/api/src/admin/admin.controller.ts` | 重写。`@UseGuards(AuthGuard("jwt"), AdminGuard, PermissionGuard)`；每个路由声明 `@RequirePermission`；`/admin/me` 不设门（任何已认证管理员可读自己）；新增 `clientIp()` 读取 `x-forwarded-for`；DTO 增加 `suspend` + `expiresAt` + `reason` |
| `apps/api/src/admin/admin.module.ts` | 注册 `PermissionGuard` |
| `apps/api/src/common/validation.pipe.ts` | `validate()` 增加 `whitelist: true` + `forbidNonWhitelisted: true`（关闭 mass-assignment） |

### 数据库（3）
| 文件 | 变更 |
|---|---|
| `prisma/schema.prisma` | `UserStatus` + `SUSPENDED`；新增 `enum AdminRole`；新增 `AdminUser` 模型；`User` 增加 `adminUser` / `auditLogsWritten` / `adminNotesWritten` / `suspendedUntil`；`AdminNote` 增加 `admin` FK（Restrict）+ 索引；`AdminAuditLog` 重写（新增 admin FK、targetType、targetId 加宽、reason、before、after、ip、userAgent + 3 索引） |
| `prisma/migrations/20260917121000_phase17_admin_rbac_enums/migration.sql` | **枚举单独一个迁移** —— PG 的 `ALTER TYPE ... ADD VALUE` 不能与其他 DDL 同事务 |
| `prisma/migrations/20260917121100_phase17_admin_rbac/migration.sql` | 表 / 列 / 索引 / 外键 + 回填 9 个 admin |

### 管理端前端 `apps/admin` — 新增（3）/ 修改（7）
| 文件 | 变更 |
|---|---|
| `src/lib/permissions.ts` | **新增**。前端矩阵镜像 + `ROLE_LABELS` + `canSetUserStatus` |
| `src/lib/session.tsx` | **新增**。`AdminSessionProvider` / `useAdminSession()`，读 `/admin/me`，遇 `ADMIN_REQUIRED` / `ADMIN_INACTIVE` / `UNAUTHORIZED` 重定向 |
| `src/components/confirm-dialog.tsx` | **新增**。**强制非空 reason**；可选确认词（如输入 `BAN`）；可选到期时间（默认 7 天、必须晚于当前）；三项全部满足才可提交；每次打开重置 |
| `src/components/shell.tsx` | 导航项带 `permission`，按 `can()` 过滤；显示管理员身份 + 角色中文名；包裹 `AdminSessionProvider` |
| `src/app/login/page.tsx` | 改为拉取 `AdminIdentity`，对 `ADMIN_INACTIVE` / `ADMIN_REQUIRED` 给出明确拒绝文案 |
| `src/app/users/page.tsx` | 动作按钮由 `canSetUserStatus(role, action)` 生成；全部经 `ConfirmDialog`；显示 `suspendedUntil`；只读角色显示提示 |
| `src/app/reports/page.tsx` | 审核动作由 `reports:write` 门控，经 `ConfirmDialog` 收集 reason |
| `src/app/page.tsx`、`src/app/users/[id]/page.tsx`、`src/app/audit/page.tsx` | 重定向条件加入 `ADMIN_INACTIVE` |

### 用户端去重（1）
| 文件 | 变更 |
|---|---|
| `apps/web/src/app/admin/page.tsx` | **替换**：648 行功能完整的重复后台 → 45 行指路页，只指向 `NEXT_PUBLIC_ADMIN_URL`，**自身不持有任何后台能力** |

去重一致性检查：
- `apps/web/src/components/admin-entry.tsx` 仍被 `apps/web/src/app/discover/page.tsx:9` 引用，链接 `/admin` —— 指路页存在，**链接未断，无 dead import**。
- `apps/web/src/app/me/page.tsx:75` 的「🛡️ Admin 后台」按钮同理仍可解析。
- `apps/web/src/components/tab-bar.tsx:15` 的 `/admin` match 前缀保留。
- **结论：真正 Admin UI 只存在于 `apps/admin`。** `/admin` 路由保留为指路页，不提供任何管理能力。

### 脚本（1）
| 文件 | 说明 |
|---|---|
| `scripts/phaseA-rbac-verify.mjs` | **新增**。真机端到端验证（真实 API + 真实签名 JWT + 真实数据库），44 项断言，自带夹具创建与清理 |

---

## 2. Database

### 迁移前检查（§29 要求，全部通过后才继续）
| 检查项 | 结果 |
|---|---|
| 孤儿行（AdminAuditLog.adminId 指向不存在的 User） | **0** |
| 孤儿行（AdminNote.adminId 指向不存在的 User） | **0** |
| `AdminAuditLog.targetId` 非 UUID 值数量 | **0**（可安全从 UUID 加宽为 VARCHAR） |
| 现有 admin 数量 | **9** |

### 备份（真实、已验证）
`.local-data/backups/pre_admin_rbac_20260917.sql` — **295,972 bytes**。
完整性验证：33 个 `CREATE TABLE`、33 个 `COPY`、结尾完成标记 `\unrestrict` 均存在。
（**未出现** `DATABASE BACKUP COULD NOT BE VERIFIED`，故未暂停。）

### 执行方式
**全部使用 `prisma migrate deploy`。未使用 `prisma migrate dev`，未使用 `prisma migrate reset`。**

| # | 迁移 | 内容 |
|---|---|---|
| 14 | `20260917121000_phase17_admin_rbac_enums` | `CREATE TYPE "AdminRole" AS ENUM (...)`；`ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED'` |
| 15 | `20260917121100_phase17_admin_rbac` | `AdminAuditLog` 加 `after`/`before`(JSONB)、`ip`、`reason`、`targetType`、`userAgent`，`targetId` 改 `VARCHAR(128)`；`User` 加 `suspendedUntil`；建 `AdminUser` 表；6 索引；3 外键（全部 `ON DELETE RESTRICT`）；回填 `INSERT INTO "AdminUser" SELECT ... WHERE u."isAdmin" = true ON CONFLICT ("userId") DO NOTHING` |

### 迁移后验证
| 项 | 结果 |
|---|---|
| `prisma migrate status` | 15 migrations，**Database schema is up to date!** |
| `prisma migrate diff`（datasource → datamodel） | **`-- This is an empty migration.`** → 无漂移 |
| `AdminUser` 行数 / 角色 | **9 行，全部 `SUPER_ADMIN`，全部 `isActive = true`** |
| `User.isAdmin = true` 数量 | **9**（与 AdminUser 一致，兼容字段保留） |
| 外键删除行为 | `AdminUser_userId_fkey` = `r`、`AdminNote_adminId_fkey` = `r`、`AdminAuditLog_adminId_fkey` = `r`（RESTRICT，非 CASCADE） |
| 数据保全 | users **168** / audit **17** / notes **16** / SharedSocialAccount **24** / SocialAccount **28** —— 与迁移前完全一致，**无删除** |

**未使用 `onDelete: Cascade` 于审计链**：`AdminAuditLog.adminId` 与 `AdminNote.adminId` 用 `Restrict`，管理员账号无法被删除而留下悬空审计行。

### 回填策略
9 个既有 admin 全部回填为 `SUPER_ADMIN` —— **不降权**。`User.isAdmin` 保留为兼容回退（无 `AdminUser` 行时按 `SUPER_ADMIN` 放行，`legacy: true` 标记），确保 Phase A 上线瞬间**没有任何现有管理员失去访问**。

---

## 3. RBAC table

### 3.1 权限矩阵（`apps/api/src/admin/permissions.ts` = 单一真源）

| Permission | SUPER_ADMIN | MODERATOR | SUPPORT | ANALYST | CONTENT_MANAGER |
|---|:--:|:--:|:--:|:--:|:--:|
| `dashboard:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `users:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `users:write` | ✅ | ✅ | ✅ | — | — |
| `reports:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `reports:write` | ✅ | ✅ | — | — | — |
| `moderation:read` | ✅ | ✅ | — | — | ✅ |
| `moderation:write` | ✅ | ✅ | — | — | ✅ |
| `risk:read` | ✅ | ✅ | — | ✅ | — |
| `connections:read` | ✅ | — | — | ✅ | — |
| `connections:write` | ✅ | — | — | — | — |
| `exchanges:read` | ✅ | — | — | ✅ | — |
| `exchanges:write` | ✅ | — | — | — | — |
| `blocks:read` | ✅ | — | — | ✅ | — |
| `blocks:write` | ✅ | — | — | — | — |
| `audit:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit:export` | ✅ | — | — | — | — |
| `settings:read` | ✅ | — | — | ✅ | — |
| `settings:write` | ✅ | — | — | — | — |
| `admins:read` | ✅ | — | — | — | — |
| `admins:write` | ✅ | — | — | — | — |

设计要点：
- **ANALYST 全库只读** —— 断言 `granted.filter(p => p.endsWith(":write"))` 为空数组。
- **权限与动作是两个轴**：拥有 `users:write` ≠ 允许永久封禁。见下表。
- 未建 `AdminPermission` / `AdminRolePermission` 表：5 个角色固定、矩阵很小，建表只增加 3 张表 + 每请求一次 join。`hasPermission()` 是唯一入口，未来若需按人授权可平滑升级为 DB 驱动，调用点不变。

### 3.2 用户状态动作矩阵（`ROLE_ALLOWED_STATUS_ACTIONS`）

| Action | SUPER_ADMIN | MODERATOR | SUPPORT | ANALYST | CONTENT_MANAGER |
|---|:--:|:--:|:--:|:--:|:--:|
| `activate` | ✅ | ✅ | ✅ | — | — |
| `disable` | ✅ | ✅ | ✅ | — | — |
| `ban`（永久） | ✅ | — | — | — | — |
| `suspend`（临时，需 expiresAt） | ✅ | ✅ | — | — | — |
| `unban` | ✅ | ✅ | — | — | — |

### 3.3 守卫链（顺序即语义）

```
AuthGuard("jwt")  →  AdminGuard  →  PermissionGuard  →  AdminService 业务规则
   认证             身份           能力               目标/自我保护
   401              403            403                400/403
```

- `AdminGuard`：**只回答"是不是活跃管理员"**，把 `ResolvedAdmin` 挂到 `request.admin`。
- `PermissionGuard`：读 `@RequirePermission` 元数据，回答"这个角色有没有这个能力"。**403 而非 401** —— 调用者已认证且是管理员，只是没有该权限。
- `AdminService`：**§30 要求的 Service 层 Scope Check** —— 目标校验放在 service 而非 controller，任何未来调用方都无法绕过。

### 3.4 路由 → 权限映射

| 路由 | 权限 |
|---|---|
| `GET /admin/dashboard` | `dashboard:read` |
| `GET /admin/me` | （不设门，任何活跃管理员可读自己） |
| `GET /admin/users` | `users:read` |
| `GET /admin/users/:id` | `users:read` |
| `POST /admin/users/:id/status` | `users:write` |
| `POST /admin/users/:id/notes` | `users:write` |
| `GET /admin/reports` | `reports:read` |
| `POST /admin/reports/:id/review` | `reports:write` |
| `GET /admin/audit` | `audit:read` |

---

## 4. Security Fixes

### P0 修复

**① `setStatus()` 无目标校验 → 后台可被一次性整体攻陷**
修复前：管理员可封禁**其他管理员**，甚至**自己**；`reason` 是 `@IsOptional()`，可无原因封禁。
修复后 `AdminService.setStatus()` 强制执行 6 条规则：

| # | 规则 | 违反时 |
|---|---|---|
| 1 | reason 必填且非空白 | 400 `REASON_REQUIRED` |
| 2 | 不得修改自己的状态（自封保护） | 403 `CANNOT_MODIFY_SELF` |
| 3 | 角色必须被允许执行该具体动作 | 403 `ACTION_NOT_ALLOWED_FOR_ROLE` |
| 4 | **活跃管理员目标仅 SUPER_ADMIN 可改** | 403 `CANNOT_MODIFY_ADMIN` |
| 5 | `suspend` 必须带未来 `expiresAt` | 400 `EXPIRES_AT_REQUIRED` / `INVALID_EXPIRES_AT` |
| 6 | 业务变更与审计写入**同一事务** | 审计失败则整体回滚 |

> 规则 4 用 `target.adminUser?.isActive` 判定，因此**已软停用的管理员不算受保护目标**（否则会形成无法清理的死锁）。

**② 完全无 RBAC → 9 个管理员权限完全相同**
修复：`AdminUser` + `AdminRole` + 权限矩阵 + 三层守卫链 + `@RequirePermission`。实机验证 ANALYST / SUPPORT / CONTENT_MANAGER 的越权写入全部 403。

**③ 审计链断裂**
| 修复前 | 修复后 |
|---|---|
| `AdminAuditLog.adminId` / `AdminNote.adminId` **无外键** → 管理员删除后审计行悬空 | 两个 FK，`ON DELETE RESTRICT` |
| 无 ip / userAgent / before / after / targetType / 结构化 reason | 全部补齐 |
| `targetId` 为 `@db.Uuid` → 无法记录 settings key 等非 UUID 目标 | 加宽为 `VARCHAR(128)`，实机验证可写入 `nightly-cleanup-2026-09-17` |
| `reviewReport` 把**被举报人 UUID 塞进 `detail`** 自由文本 | `targetType:"REPORT"` + `targetId = reportId`，实机验证 |
| 举报审核无 reason | 强制 reason，400 `REASON_REQUIRED` |
| 审计写入口散落 | 统一 `recordAudit(input, client?)`，可加入调用方事务 |

**④ Mass-assignment 潜伏风险**
`ValidationPipe` 增加 `whitelist: true` + `forbidNonWhitelisted: true`。实机验证：`{action:"disable", reason:"legit", isAdmin:true, status:"ACTIVE"}` → 400 `VALIDATION_ERROR`，且目标用户 `status` / `isAdmin` **均未被改动**。

### 前端安全基线
- **破坏性操作强制二次确认 + 强制原因**：`ConfirmDialog` 三项校验（reason 非空 / 确认词匹配 / 到期时间在未来）全部满足才启用提交按钮。
- **角色感知**：动作按钮由 `canSetUserStatus(role, action)` 生成 —— SUPPORT 界面上**不存在**封禁按钮（而非点了才报错）；导航按权限过滤。
- **`ADMIN_INACTIVE` 处理**：被软停用的管理员登录被明确拒绝，已登录的立即重定向。

### 明确未做（不在 Phase A 范围）
- ❌ CSRF token
- ❌ 管理员列表的 email 脱敏
- ❌ 完整 Admin E2E

---

## 5. Tests

### 5.1 单元 / 集成测试（Jest）

**新增 48 项**

| 套件 | 数量 | 覆盖 |
|---|---|---|
| `apps/api/src/admin/admin-rbac.spec.ts` | 35 | 权限矩阵（8）、`PermissionGuard`（6）、`AdminGuard`（6）、`setStatus` 安全规则（15） |
| `apps/api/src/admin/admin-audit.spec.ts` | 13 | `recordAudit`（5）、`reviewReport` 审计（4）、`addNote`（3）、分页边界（1） |

关键断言举例：
- 只有 `SUPER_ADMIN` 出现在可执行 `ban` 的角色列表里（`expect(bannable).toEqual(["SUPER_ADMIN"])`）
- ANALYST 的权限列表中 `:write` 后缀项为空数组
- `permissionsForRole()` 返回副本 —— 调用方 push 后矩阵不受污染
- 未知角色 `hasPermission()` 返回 `false`（**默认拒绝**，不是默认放行）
- `AdminGuard`：软停用 AdminUser → `ADMIN_INACTIVE`；无 AdminUser 但 `isAdmin` → `SUPER_ADMIN` + `legacy:true`；BANNED/DISABLED/SUSPENDED 管理员一律拒绝
- `setStatus`：业务变更与审计**在同一次 `$transaction` 内**（断言 `$transaction` 调用 1 次、`tx.user.update` 与 `tx.adminAuditLog.create` 各 1 次）；审计抛错时整个动作失败

**全量结果**
```
Test Suites: 10 passed, 10 total
Tests:       95 passed, 95 total
```
（10 个套件 = 本次新增 2 个 + 既有 8 个：block-guard / discover-filter / exchange-privacy / health / moments-access / safety-autoflag / upload-url / users-avatar）

### 5.2 真机端到端验证

**`scripts/phaseA-rbac-verify.mjs` — 44/44 通过**

真实 API（`localhost:4000`）+ 真实签名 JWT + 真实 PostgreSQL。无 mock、无 stub guard。
创建 10 个一次性账号（5 角色 + 软停用 admin + legacy admin + 普通用户 + 2 个目标用户）+ 1 条举报，跑完断言后**全部清理**。

覆盖矩阵（节选）：
| 类别 | 断言 |
|---|---|
| 认证层 | 无 cookie → 401；普通用户 → 403 `ADMIN_REQUIRED`（列表 / `/me` / 改状态三条路径） |
| 读权限 | ANALYST 可读 users / user detail / audit / reports；SUPPORT 可读 dashboard |
| 写权限 | ANALYST 改状态 → 403 `PERMISSION_DENIED`；ANALYST 审核举报 → 403；CONTENT_MANAGER 两者皆 → 403 |
| 角色动作 | SUPPORT 可 disable / activate，**不可** ban / suspend → `ACTION_NOT_ALLOWED_FOR_ROLE`；MODERATOR **不可** ban |
| reason | 缺失 → 400 `REASON_REQUIRED`；纯空白 → 400 `REASON_REQUIRED` |
| expiry | suspend 无 expiresAt → 400 `EXPIRES_AT_REQUIRED`；过期时间在过去 → 400 `INVALID_EXPIRES_AT`；未来时间 → 201 且落库 `SUSPENDED` + `suspendedUntil` 有值 + `bannedAt` 为 null |
| 自我保护 | 自己封自己 → 403 `CANNOT_MODIFY_SELF` |
| 管理员保护 | MODERATOR 改 SUPER_ADMIN → 403 `CANNOT_MODIFY_ADMIN`；SUPER_ADMIN 改 MODERATOR → 201 |
| **即时吊销** | 管理员被 disable 后，其**已签发的 JWT 立即失效** → 401 `USER_DISABLED` |
| ADMIN_INACTIVE | 软停用 AdminUser（且 `User.isAdmin=true`）→ 403 `ADMIN_INACTIVE`（**压过** `isAdmin` 回退） |
| legacy 回退 | 无 AdminUser 行的 `isAdmin` 账号 → 200，`/me` 返回 `role: SUPER_ADMIN` + `legacy: true` |
| 无泄露 | `/admin/me` 响应不含 `passwordHash` / `password` / `token` |
| mass-assignment | 多余字段 → 400 `VALIDATION_ERROR`，且目标用户未被改动 |
| 审计完整性 | ban 审计行 `targetType=USER` / `targetId` 正确 / `reason` 正确 / `before.status=ACTIVE` / `after.status=BANNED` / `ip` 与 `userAgent` 非空；`adminId` 归因正确 |
| 审计语义 | `REPORT_RESOLVED` 行 `targetType=REPORT`、`targetId=reportId`，**不是**被举报人 UUID |
| 审计计数 | 恰好 +6 条审计（6 个成功的管理动作）；恰好 +5 条 note；**被 400 拒绝的请求不写审计行** |
| 外键完整性 | 无审计行指向不存在的管理员 |
| 清理 | 全部夹具删除，`leftover = 0` |

### 5.3 未测 / 未覆盖
- **完整 Admin E2E（浏览器级）** —— Phase A 明确排除。
- `apps/admin` 的 `npm test` 仍是**静态正则断言**（读源码 `assert.match` 字符串），**不是行为测试**。它通过，但只证明文件里存在某些字符串。已在遗留问题中标注。
- 审计事务的**数据库级回滚语义**由"两次写入位于同一 `$transaction`" + PG 事务语义保证；单测证明的是接线正确，未构造真实失败注入。

---

## 6. Verification

### 6.1 命令结果（全部实际执行）

| 命令 | 范围 | 结果 |
|---|---|---|
| `npx tsc --noEmit` | `apps/api` | **0 errors** |
| `npx eslint "src/**/*.ts"` | `apps/api` | **0 problems** |
| `npx jest` | `apps/api` | **10 suites / 95 tests passed** |
| `npx nest build` | `apps/api` | **成功** |
| `npx tsc --noEmit` | `apps/admin` | **0 errors** |
| `npx next build` | `apps/admin` | **成功**，8 路由 |
| `npm test` | `apps/admin` | 2/2 passed（静态正则，见 5.3） |
| `npx tsc --noEmit` | `apps/web` | **0 errors** |
| `npx next lint` | `apps/web` | **No ESLint warnings or errors** |
| `npx next build` | `apps/web` | **成功**，27 路由 |
| `npm test` | `apps/web` | 5/5 passed（静态正则） |
| `node scripts/phaseA-rbac-verify.mjs` | 真机 E2E | **44/44 passed** |
| `npx prisma migrate status` | DB | **up to date**（15 migrations） |
| `npx prisma migrate diff` | DB | **empty migration**（无漂移） |

构建产物体积佐证去重生效：`apps/web` 的 `/admin` 路由为 **3.06 kB**（原 648 行后台）。

### 6.2 数据库最终状态（与迁移前逐项一致）

| 表 | 数量 |
|---|---|
| `User` | 168 |
| `User` 中 `email LIKE 'phasea.verify%'` 残留 | **0** |
| `AdminUser` | 9（全 `SUPER_ADMIN` / `isActive=true`） |
| `AdminAuditLog` | 17 |
| `AdminNote` | 16 |
| `SharedSocialAccount` | 24 |
| `SocialAccount` | 28 |
| `Report` | 10 |

### 6.3 诚实声明

- ✅ **未使用** `prisma migrate reset`、**未使用** `prisma migrate dev`。
- ✅ 迁移前孤儿检查 = 0，**未触发** STOP 条件。
- ✅ 备份真实存在且已验证，**未出现** `DATABASE BACKUP COULD NOT BE VERIFIED`。
- ✅ 未为了让测试通过而降低任何安全规则。
- ⚠️ **§36 的 `git diff` / `git diff --stat` 无法产出** —— 该目录不是 git 仓库。已如实说明，未伪造输出。
- ⚠️ Phase A **已完成并在此停止**。未越界实现 Phase B–H 的任何内容。

---

## 7. Remaining Issues

### 7.1 必须在 Phase A 之后处理（Phase A 内未做）

| # | 问题 | 严重度 | 建议归属 |
|---|---|---|---|
| 1 | **`apps/admin` 的测试是静态正则断言**，不是行为测试 —— 目前通过不代表后台可用。缺少真实登录 + 权限渲染的组件/浏览器测试 | P1 | Phase A 补强 或 Phase B |
| 2 | **未认证请求的错误码是泛化的 `HTTP_ERROR`** —— `AuthGuard("jwt")` 抛普通 `UnauthorizedException`，`ApiExceptionFilter` 兜底为 `HTTP_ERROR`。客户端**无法区分**「无 token」「token 过期」「token 类型错误」，无法做精准重登提示 | P1 | 需跨端统一，单独一个小阶段 |
| 3 | **`GET /admin/users` 仍返回 email**（列表页）—— 管理员账号被盗即全量邮箱泄露 | P2 | Phase B（用户管理） |
| 4 | **无 CSRF token** —— 依赖 `SameSite=Lax` cookie。对 `POST /admin/*` 的跨站表单提交防护不足 | P2 | 安全专项 |
| 5 | `GET /admin/users/:id` 不存在时返回 200 + `null`（而非 404） | P2 | Phase B |
| 6 | 审计日志对所有具备 `audit:read` 的角色全开，无行级过滤（SUPPORT 能看到 SUPER_ADMIN 的动作） | P2 | Phase F（Audit） |
| 7 | `AdminUser.createdBy` 已建列但**尚无写入路径**（无「授予管理员」接口）—— 当前只能直接改库 | P2 | Phase H（RBAC 管理） |
| 8 | 无 `/admin/admins` 接口 —— 无法在后台查看/调整管理员角色 | P2 | Phase H |

### 7.2 已知结构性风险（非 Phase A 引入）

| # | 问题 | 说明 |
|---|---|---|
| 9 | **`User.isAdmin` 兼容回退仍是后门风险面** | 当前 9 个 admin 都已有 `AdminUser` 行，回退路径**实际处于惰性状态**。但只要有人把 `isAdmin` 置 true 且不建 `AdminUser` 行，就会以 `SUPER_ADMIN` 放行。`isAdmin` 从用户端 API 不可写（已审计确认），风险受控。**建议在 Phase H 移除该回退**，届时所有管理员都有 profile 行 |
| 10 | **无强制二次确认的服务端兜底** | `ConfirmDialog` 是**前端**约束。后端只强制 reason —— 直接调 API 可以跳过确认词。若产品要求「输入 BAN 才可封禁」为硬规则，需下沉到服务端 |
| 11 | **`suspend` 到期后无自动恢复任务** | `suspendedUntil` 已落库，但没有任何调度器把它改回 `ACTIVE`。到期前用户持续被拒（`USER_DISABLED`）。需要定时任务 |
| 12 | **项目不是 git 仓库** | 无版本控制 → 无 diff、无回滚、无审计追溯。本次 Phase A 改动只能靠 `pg_dump` + 文件清单回溯。**强烈建议 `git init` 并提交** |

### 7.3 建议的 Phase B 入口顺序
1. 先补 `apps/admin` 的真实行为测试（当前静态断言是最大盲区）。
2. 统一认证层错误码（问题 2）—— 它阻塞前端的「重新登录」体验。
3. 再做 Phase B 用户管理（列表 email 脱敏、404 语义、分页）。
4. `suspend` 到期自动恢复（问题 11）应尽早做，否则临时封禁会变成事实永久封禁。
