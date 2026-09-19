# Admin Phase B1 — Dashboard 实施记录

> 落地日期：2026-09-17 · 依据：`docs/ADMIN-PHASE-B-READINESS-AUDIT.md` 中确认的决策
>
> 范围严格限定在 B1 Dashboard。**没有进入 B2/B3/B4/B5**，没有修改 Prisma schema，
> 没有生成 migration，没有动 `UserStatusScheduler` / `SafetyService` / RBAC matrix /
> `AdminGuard` / `PermissionGuard` / SYSTEM actor。

---

## 1. 修改文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/admin/admin.service.ts` | 重写 `dashboard()`：新增 7 个字段与 3 个 recent 列表；`admins` 语义改为 `AdminUser.isActive`；新增 `SEVEN_DAYS_MS` / `RECENT_LIMIT` 常量 |
| `apps/api/src/admin/admin-dashboard.spec.ts` | **新增**，22 个用例 |
| `apps/admin/src/app/dashboard/page.tsx` | **新增**，Dashboard 页面 |
| `apps/admin/src/app/page.tsx` | 由 Dashboard 页面改为 `redirect("/dashboard")` |
| `apps/admin/src/components/shell.tsx` | 导航 `仪表盘` 的 href 由 `/` 改为 `/dashboard` |
| `apps/admin/test/e2e/admin-dashboard.spec.ts` | **新增**，15 个浏览器用例 |
| `apps/admin/test/e2e/admin-rbac.spec.ts` | KPI 标签断言同步为真实新标签（`总用户`→`用户总数`、`待审举报`→`待处理举报`），并补一条 `在线管理员` |
| `apps/admin/test/smoke.test.mjs` | **新增**一条断言（dashboard 调真实 API、`/` 是 redirect）；**未删除任何旧断言** |
| `scripts/phaseA-rbac-verify.mjs` | 新增 2c 节，24 条真实 HTTP + 真实 SQL 校验 |

**未修改**：`prisma/schema.prisma`（mtime 仍是 15:15:30，早于本阶段）、
`prisma/migrations/*`（仍是 16 个）、`permissions.ts`、`admin.guard.ts`、
`permission.guard.ts`、`user-status.scheduler.ts`、`safety.service.ts`。

---

## 2. Dashboard API 最终响应结构

`GET /api/v1/admin/dashboard` · 权限 `dashboard:read` · 守卫链不变
（`JwtAuthGuard` → `AdminGuard` → `PermissionGuard` → `AdminService`）

```jsonc
{
  "success": true,
  "data": {
    // ── 既有字段，名称与语义保持不变 ──
    "users": 168,
    "activeToday": 0,
    "messagesToday": 0,
    "connections": 44,
    "reportsOpen": 0,
    "admins": 9,          // ← 语义变更：AdminUser.isActive=true 的行数
    "banned": 2,

    // ── Phase B1 新增 ──
    "active": 166,
    "suspended": 0,
    "todayNewUsers": 0,
    "newUsers7d": 0,

    "recentAudit": [{
      "id": "…", "action": "ADMIN_USER_BAN",
      "targetType": "USER", "targetId": "…",
      "actorType": "USER", "adminId": "…",     // SYSTEM 行为 null
      "detail": "…", "createdAt": "2026-09-17T…"
    }],

    "recentResolvedReports": [{
      "id": "…", "reason": "HARASSMENT", "status": "RESOLVED",
      "messageId": null, "createdAt": "2026-09-17T…",
      "reporter":     { "id": "…", "nickname": "…", "email": "…" },
      "reportedUser": { "id": "…", "nickname": null, "email": "…" }
    }],

    "recentSystemEvents": [{
      "id": "…", "action": "SYSTEM_USER_SUSPENSION_EXPIRED",
      "targetType": "USER", "targetId": null,
      "detail": "Auto-released 1 expired suspension(s)", "createdAt": "…"
    }]
  }
}
```

三个列表各取最近 10 条（`RECENT_LIMIT`）。`recentSystemEvents` **不返回 `adminId`** ——
这个列表按定义全是 SYSTEM 行，没有执行者 id 可渲染。

---

## 3. 每个 KPI 字段的真实来源

| 字段 | Prisma 查询 | 对应 SQL |
| --- | --- | --- |
| `users` | `user.count()` | `count(*) FROM "User"` |
| `active` | `user.count({ status: "ACTIVE" })` | `… WHERE status='ACTIVE'` |
| `suspended` | `user.count({ status: "SUSPENDED" })` | `… WHERE status='SUSPENDED'` |
| `banned` | `user.count({ status: "BANNED" })` | `… WHERE status='BANNED'` |
| `activeToday` | `user.count({ lastActiveAt: { gte: today } })` | `… WHERE "lastActiveAt" >= 当日 00:00` |
| `todayNewUsers` | `user.count({ createdAt: { gte: today } })` | `… WHERE "createdAt" >= 当日 00:00` |
| `newUsers7d` | `user.count({ createdAt: { gte: now - 7*24h } })` | `… WHERE "createdAt" >= now-7d` |
| `messagesToday` | `message.count({ createdAt: { gte: today }, deletedAt: null })` | `… WHERE "createdAt" >= 当日 00:00 AND "deletedAt" IS NULL` |
| `connections` | `connection.count({ status: "ACTIVE" })` | `… WHERE status='ACTIVE'` |
| `reportsOpen` | `report.count({ status: "OPEN" })` | `… WHERE status='OPEN'` |
| `admins` | **`adminUser.count({ isActive: true })`** | `SELECT count(*) FROM "AdminUser" WHERE "isActive" = true` |
| `recentAudit` | `adminAuditLog.findMany({ orderBy: createdAt desc, take: 10 })` | — |
| `recentResolvedReports` | `report.findMany({ status: { in: [RESOLVED, REJECTED] }, … take: 10 })` | — |
| `recentSystemEvents` | `adminAuditLog.findMany({ actorType: "SYSTEM", … take: 10 })` | — |

### 时间边界（统一定义，无新语义）

- `today` = **本地时区**当日 00:00 → 当前时间（`dayStart()`，与 Phase A 既有实现一致）
- `last 7d` = 当前时间往前 `7 * 24h`
- 一次请求只取一个 `now`，被所有查询共用，所以两个窗口不会因为并行查询而互相漂移。

### `admins` 的语义变更（已确认）

由 `User.isAdmin`（遗留兼容标志）改为 `AdminUser.isActive = true`。
理由是 `AdminUser.role` 才是授权实际读取的东西 —— 用遗留标志会把一个**已被撤销权限的管理员**
报成仍然在线。

真实 E2E 里用夹具把两者刻意做成不同值（一个只有 `isAdmin` 的遗留账号 + 一个
`isAdmin=true` 但 `isActive=false` 的软禁用管理员），所以
`dashboard.admins === count(AdminUser WHERE isActive) && !== count(User.isAdmin)`
是一条**真断言**，不是恒真式。

---

## 4. 前端路由变化

| 之前 | 现在 |
| --- | --- |
| `/` 渲染 Dashboard | `/` → `redirect("/dashboard")` |
| 导航 `仪表盘` → `/` | 导航 `仪表盘` → `/dashboard` |

`/` **保留为永久 redirect** 而不是删除：登录页仍然 `router.replace("/")`，
共享测试 helper `loginAndLand()` 也依赖它 —— 两者都断言登录后出现「仪表盘」标题。
删掉这个路由会把它们一起弄坏。

导航新增 `/moderation` 项**故意未加**：页面要到 B5 才存在，指向 404 的导航项比没有更糟。

---

## 5. 权限验证结果

5 个现有角色**全部 200**（矩阵未改）：

| 角色 | `/admin/dashboard` |
| --- | --- |
| SUPER_ADMIN | 200 |
| MODERATOR | 200 |
| SUPPORT | 200 |
| ANALYST | 200 |
| CONTENT_MANAGER | 200 |

未登录 → 302 到 `/login`（Playwright `Test 13b`）。
`AdminController.prototype.dashboard` 的 `@RequirePermission("dashboard:read")` 元数据有断言钉住，
所以"矩阵允许"和"路由真的声明了权限"是两件事分别验证的。

---

## 6-8. 测试数量与结果

| 层 | 之前 | 现在 | 结果 |
| --- | --- | --- | --- |
| API Jest | 14 suites / 145 | **15 suites / 167**（+22） | 全通过 |
| Admin smoke (`node:test`) | 2 | **3**（+1） | 全通过 |
| Admin Playwright | 14 | **29**（+15） | 全通过 |
| Web (`node:test`) | 5 | 5 | 全通过 |
| Real E2E (`phaseA-rbac-verify.mjs`) | 72 | **96**（+24） | 全通过 |

**没有任何旧测试减少或被删除。**

### API Jest（`admin-dashboard.spec.ts`，22 项）覆盖

5 角色 × `dashboard:read`、控制器元数据、PermissionGuard 放行、无身份仍被拒；
11 个计数字段逐一对号（含"零值必须返回"）；
`admins` 必须走 `adminUser.count({isActive:true})` 且**从未**用 `isAdmin`；
今日/7 日两个窗口边界（本地 00:00 与 ~168h）各自验证；`reportsOpen` 只算 OPEN；
审计列表的 8 个字段**精确相等**（多一个就失败）；SYSTEM 行 `actorType=SYSTEM` + `adminId=null`；
SYSTEM 事件查询不含 `adminId`；举报列表只取 `id/nickname/email`；
空库返回 0 与空数组而不是 null；**全响应深度扫描无 `ip`/`userAgent`/`passwordHash`/`tokenHash`**，
且序列化后不含 bcrypt / JWT / user-agent 形状的值。

### Playwright（15 项）覆盖

登录后落在 `/dashboard`、`/` 自动跳转、侧栏 Dashboard 链接、
8 张 KPI 卡片各恰好一张且可见、**每个 KPI 与数据库逐一比对**、
零值卡片仍渲染并显示 `0`、状态分桶之和等于总数、
最近审计区域存在、SYSTEM 行显示 `系统 · 自动` 且**不含 `admin `/`null`/`undefined`**、
人工行仍显示 `admin xxxxxxxx`、系统自动事件区渲染、三个区域空态显示「暂无数据」、
刷新按钮原地重新请求（断言 `/admin/dashboard` 请求数 +1 且 `/admin/me` 为 0 —— 证明没有整页刷新）、
请求中按钮禁用、失败显示 error + 重试恢复、未登录跳登录页。

### Real E2E（24 项）覆盖

5 角色 200；8 个字段**逐一对独立 SQL 聚合**（边界值在 JS 里算好后作为参数传入，
不用 `date_trunc`，避免 DB 会话时区与 Node 本地时区不一致导致的假失败）；
既有 3 个字段语义不变；`admins` 等于 AdminUser 计数且**不等于** `isAdmin` 计数；
状态分桶求和等于总数；三个列表是数组；`recentAudit` 每行的 actorType/adminId 配对合法；
`recentSystemEvents` 行内不含 `adminId`；响应无 `ip`/`userAgent`/`passwordHash`/`tokenHash`；
**读取 dashboard 不产生任何审计行**。

---

## 9-14. 验证门槛

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0**（5 个 workspace） |
| `npm run lint` | **exit 0**，0 error 0 warning |
| `npm run build` | **exit 0**，三产物齐全；`/dashboard` 路由已生成（3.67 kB / 110 kB） |
| `prisma validate` | **valid** |
| `prisma migrate status` | **16 migrations, up to date** |
| `prisma migrate diff` | **`-- This is an empty migration.`** |

---

## 15-16. 数据库统计值与漂移

| 项 | 值 |
| --- | --- |
| `User` | **168** |
| `User` ACTIVE / BANNED | **166 / 2**（SUSPENDED、DISABLED 均为 0） |
| `AdminUser`（全部 active） | **9** |
| `User.isAdmin = true` | **9** |
| `AdminAuditLog` | **17**（SYSTEM 行 0） |
| `Report` OPEN / REVIEWING / RESOLVED | **0 / 6 / 4** |
| `Connection` / `SocialAccount` / `Block` / `AdminNote` | **44 / 28 / 3 / 16** |

**schema drift：无。** `prisma/schema.prisma` 的 mtime 仍是 15:15:30（早于本阶段开始），
migrations 目录仍是 16 个，`migrate diff` 为空。数据库统计值与审计基线逐项一致。

---

## 17. 未解决问题

1. **`/moderation` 导航项未加**。页面属 B5；加一个指向 404 的链接不算"导航正常"。
2. **`recentResolvedReports` 的 `email`**。为了让 `nickname ?? email` 这个控制台通用的显示
   回退可用而保留。当前 `Report` 表里没有未设昵称的真实用户，所以这条路径实际很少触发 ——
   如果后续要求最小化暴露，可以改为只返回 `nickname` 并在前端显示占位。
3. **`activeToday` / `messagesToday` / `newUsers7d` 当前都是 0**。不是 bug：
   `lastActiveAt` 与消息时间戳都早于当日 00:00，也没有当日新增用户。页面按需求照常显示 0。
4. **既有 17 条审计行的 action 是小写点号**（`user.ban` 等），当前代码写大写。
   这些是历史行，按 §三.4 不重写，Dashboard 的最近审计会显示混合命名。
5. **`SafetyService.recordAutoFlag()` 的注释与实现矛盾**（非 HIGH 级别会把机器信号写成
   `reporterId = reportedUserId` 的自举报）。属非 Admin 模块，B1 未触碰，见审计报告 §12-G。

---

## 18. 一处测试同步（说明，不是删除断言）

`admin-rbac.spec.ts` 原先断言 Dashboard 上出现「总用户」「待审举报」。
Phase B1 按需求把 KPI 标签定为「用户总数」「待处理举报」，所以这条断言**同步改成了真实的新标签**，
并额外补了一条「在线管理员」。断言数量没有减少，覆盖没有变弱 ——
它仍然在验证"Dashboard 真的加载了数据而不是报错"。
