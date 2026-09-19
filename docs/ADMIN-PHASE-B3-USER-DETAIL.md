# TALKFIRST — ADMIN PHASE B3 / User Detail + Status API

**前置：** B1 Dashboard ✅ / B2 Users ✅  
**本阶段范围：** User Detail 聚合增强 + PATCH status endpoint + 前端渲染 + 完整测试

---

## 1. 修改文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `apps/api/src/admin/admin.service.ts` | 改 | `userDetail()` 重写为聚合查询；新增 `USER_DETAIL_SELECT` / `USER_DETAIL_AUDIT_SELECT`；新增 `profileCompletionOf` 复用规则 |
| `apps/api/src/admin/admin.controller.ts` | 改 | 新增 `@Patch("users/:id/status")` → `patchStatus()`；POST 保留不变；两者共用 `applyStatus()` |
| `apps/api/src/users/profile-completion.ts` | **新增** | 单一来源的 `profileCompletionOf()` + `isProfileComplete()`；被 API / Web 同时复用 |
| `apps/api/src/auth/auth.service.ts` | 改 | 用 `isProfileComplete()` 替换内联 `Boolean(nickname && birthDate)` |
| `apps/api/src/users/users.service.ts` | 改 | 同上 |
| `apps/api/src/admin/admin-user-detail.spec.ts` | **新增/扩展** | 24 项（原 5 → 现 24） |
| `apps/api/src/admin/admin-user-status.spec.ts` | **新增** | 32 项 PATCH + POST/PATCH 等价测试 |
| `apps/admin/src/app/users/[id]/page.tsx` | 改 | 新增资料完整度、6 张统计卡片、审计摘要、发出举报列表 |
| `apps/admin/test/e2e/admin-user-detail.spec.ts` | **新增/扩展** | 12 项浏览器行为（原 5 → 现 12） |
| `apps/admin/test/smoke.test.mjs` | 追加 | 1 项：B3 聚合字段与审计 actor 类型 |
| `scripts/phaseA-rbac-verify.mjs` | 追加 | User Detail 聚合验证 + PATCH 权限/成功/审计验证 |

**未改**（§三十七）：`prisma/schema.prisma`、`prisma/migrations/*`、`permissions.ts`、`admin.guard.ts`、`permission.guard.ts`、`user-status.scheduler.ts`、`safety.service.ts`。

---

## 2. User Detail 最终 response schema

```ts
{
  id, email, nickname, avatarUrl, countryCode,
  status, isAdmin, bannedAt, banReason, suspendedUntil,
  createdAt, lastActiveAt,
  adminUser: { role, isActive } | null,
  // B3 新增
  profileCompletion: { completed, total, percentage, missing },
  connectionCount: number,
  reportsReceivedCount: number,
  reportsMadeCount: number,
  blocksMadeCount: number,
  blocksReceivedCount: number,
  socialAccountCount: number,
  // 保留的最近列表（显式 select）
  reportsReceived: Array<{ id, reason, status, createdAt }>,
  reportsMade:   Array<{ id, reason, status, createdAt }>,
  adminNotes:    Array<{ id, body, adminId, createdAt }>,
  auditSummary:  Array<{ id, action, targetType, targetId, actorType, adminId, reason, detail, before, after, createdAt }>,
}
```

404 保持 `USER_NOT_FOUND`，未改回 `200 + data: null`。

---

## 3. 每个统计值的 Prisma/SQL 来源

| 字段 | 来源 | 条件 |
|---|---|---|
| `connectionCount` | `tx.connection.count({ status: "ACTIVE", OR: [{ userAId }, { userBId }] })` | 任一侧参与且状态 ACTIVE |
| `reportsReceivedCount` | `tx.report.count({ reportedUserId })` | 无额外过滤 |
| `reportsMadeCount` | `tx.report.count({ reporterId })` | 无额外过滤 |
| `blocksMadeCount` | `tx.block.count({ blockerId })` | 无额外过滤 |
| `blocksReceivedCount` | `tx.block.count({ blockedId })` | 无额外过滤 |
| `socialAccountCount` | `tx.socialAccount.count({ userId })` | 无额外过滤 |
| `profileCompletion` | `profileCompletionOf(user)` | 见 §4 |
| `auditSummary` | `tx.adminAuditLog.findMany({ targetType: "USER", targetId, orderBy: { createdAt: "desc" }, take: 10 })` | 显式 select 白名单 |

所有计数在**同一事务**内执行，与 `user.findUnique` 共享一个 `tx`。

---

## 4. profileCompletion 具体定义

复用项目既有规则（`auth.service.ts` / `users.service.ts` 中的 `Boolean(nickname && birthDate)`），提取为共享函数：

```ts
const REQUIRED_PROFILE_FIELDS = ["nickname", "birthDate"] as const;
export function profileCompletionOf(user) {
  const missing = REQUIRED_PROFILE_FIELDS.filter((k) => !user[k]);
  return { completed: REQUIRED_PROFILE_FIELDS.length - missing.length, total: REQUIRED_PROFILE_FIELDS.length, percentage: Math.round(...), missing };
}
```

- **completed / total**：`nickname` + `birthDate` = 2 项
- **percentage**：`Math.round((completed / total) * 100)`
- **missing**：字符串数组，如 `["birthDate"]`
- Dashboard 与 User Detail 使用**同一套规则**，禁止各自一套标准

---

## 5–8. reports / blocks / connection / socialAccount count 定义

均使用 Prisma `count()`，条件见 §3。禁止：
- JS 全表统计
- 前端统计
- mock / fake / random

---

## 9. auditSummary 定义

- 范围：`targetType = "USER"` 且 `targetId = user.id`
- 排序：`createdAt desc`
- 数量：最近 10 条
- select 白名单：`id, action, targetType, targetId, actorType, adminId, reason, detail, before, after, createdAt`
- 禁止：`ip`, `userAgent`

---

## 10. explicit select 清单

User Detail 查询使用 `USER_DETAIL_SELECT`（19 字段）+ `USER_DETAIL_AUDIT_SELECT`（11 字段）。**无 `include`、无裸 `findMany`**。

三个旧 relation（`reportsReceived` / `reportsMade` / `adminNotes`）在 B3 中全部加上了内层 `select`，彻底消除关系泄漏风险。

---

## 11. PATCH endpoint

```
PATCH /api/v1/admin/users/:id/status
```

- 调用 `applyStatus()` → `AdminService.setStatus()`
- 与 POST **同一实现**，无复制逻辑
- 同一 `UserStatusDto`、同一 `@RequirePermission("users:write")`、同一 `@Throttle`

---

## 12. POST endpoint 保留证明

`POST /api/v1/admin/users/:id/status` 原样保留：
- 路由装饰器未动
- controller 方法 `setStatus` 未改名、未删
- 返回值与 PATCH 一致
- 前端 `page.tsx` 中仍使用 `` `/admin/users/${userId}/status`, "POST" ``

---

## 13. POST/PATCH service 复用证明

两者均调用 controller 上的私有方法：

```ts
private applyStatus(request, id, dto) {
  return this.adminService.setStatus({ targetUserId: id, action: dto.action, reason: dto.reason, expiresAt: dto.expiresAt, admin: request.admin!, ip: clientIp(request), userAgent: request.headers["user-agent"] ?? null })
    .then((data) => ({ success: true as const, data }));
}
```

Jest 测试 §28 直接比较两者的 `tx.user.update.mock.calls[0][0].data`、`tx.adminAuditLog.create.mock.calls[0][0].data.action/before/after`，证明结果一致。

---

## 14. RBAC 结果

| 角色 | users:read | users:write | PATCH disable | PATCH ban | PATCH suspend |
|---|---|---|---|---|---|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| MODERATOR | ✅ | ✅ | ✅ | ❌ | ✅ |
| SUPPORT | ✅ | ✅ | ✅ | ❌ | ❌ |
| ANALYST | ✅ | ❌ | ❌ | ❌ | ❌ |
| CONTENT_MANAGER | ✅ | ❌ | ❌ | ❌ | ❌ |

`ROLE_ALLOWED_STATUS_ACTIONS` 未动；PATCH 未绕过任何 gating。

---

## 15. Audit 结果

- PATCH 成功写入 `actorType = USER`、`adminId = 当前管理员 UUID`
- 与 POST 同一 `recordAudit()` 调用
- `before/after` 结构一致
- SYSTEM actor 未动

---

## 16–18. 测试数量

| 层 | B2 基线 | B3 后 | 结果 |
|---|---|---|---|
| API Jest | 16 suites / 218 | **17 suites / 267**（+49） | 全通过 |
| Admin smoke | 4 | **5**（+1） | 全通过 |
| Playwright | 50 | **57**（+7） | 全通过 |
| Real E2E | 149 | **156**（+7） | 全通过 |

旧测试**零删除、零削弱**。

---

## 19–24. 验证门槛

| 门槛 | 结果 |
|---|---|
| typecheck | **exit 0**（6 workspace） |
| lint | **exit 0 / 0 warning** |
| build | **exit 0**（`/users/[id]` 3.07 kB / 112 kB） |
| prisma validate | **valid** |
| migrate status | **16, up to date** |
| migrate diff | **No difference detected.** |

---

## 25. 数据库验证

- `schema.prisma` mtime：**15:15:30**（未改）
- migrations：**16** 目录
- 零 schema 改动、零 migration、无 drift

---

## 26. 未解决问题

1. **PATCH 默认返回 200（NestJS `@Patch` 默认），POST 默认返回 201（`@Post` 默认）。** 这是 NestJS 的标准行为，不是 bug。E2E 已按实际状态码断言（PATCH 200、POST 201）。如需统一，可加 `@HttpCode(201)` 到 PATCH，但 B3 未实施。
2. **`SafetyService.recordAutoFlag()` 的注释与实现矛盾**（非 Admin 模块，B3 未触碰，见审计报告 §12-G）。
3. **B4 Reports Detail / B5 Moderation** 待后续 brief。

---

**B3 完成。停止。未进入 B4。**
