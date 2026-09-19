# TALKFIRST ADMIN SYSTEM AUDIT

> Phase A — Admin System Architecture Audit
> 日期：2026-09-17
> 范围：只读审计。**未修改任何代码、schema，未执行 migration。**
> 所有结论均来自实际读取代码与数据库，未根据文件名猜测。无法验证处标注 `UNVERIFIED`。

---

## 1. 当前后台架构

三个独立应用，通过 HTTP 通信，**没有共享运行时**：

| 应用 | 技术栈 | 端口 | 说明 |
|---|---|---|---|
| `apps/web` | Next.js 15 / React 19 / Tailwind | 3000 | 用户端 |
| `apps/admin` | Next.js 15 / React 19 / Tailwind 3 | 3001 | 管理后台（独立应用，非 web 的子路由） |
| `apps/api` | NestJS 12 / Prisma 6 / PostgreSQL 18 | 4000 | 唯一后端，全局前缀 `api/v1` |

关键点：

- `apps/admin` 是**完全独立的 Next.js 应用**，不是 `apps/web` 里的 `/admin` 路由。物理隔离良好。
- Admin API 与用户 API 在**同一进程、同一 Nest 应用**里，靠 `@Controller("admin")` 前缀区分，而非独立服务。
- 认证共用一套 JWT cookie（`tf_access` / `tf_refresh`），**没有独立的管理员会话体系**。
- `apps/admin/src/lib/api.ts` 使用 `credentials: "include"`，即后台完全依赖主站的 HttpOnly cookie。

**Admin 路由隔离情况（实际读取）：**

```
apps/api/src/admin/            ← 唯一的 admin controller
  admin.controller.ts          @Controller("admin") + @UseGuards(AuthGuard("jwt"), AdminGuard)
  admin.guard.ts
  admin.module.ts
  admin.service.ts
```

全仓 grep `@Controller("admin")` 只有 1 处命中，**没有散落在其他模块的 admin 端点**。这一点是好的。

### ⚠️ 存在**第二套** Admin 前端（重要发现）

`docs/admin-console.md` 声称旧的手机端 `/admin` "仅做快捷跳转，不再新增功能"。

**实际情况与该文档不符。** 实测 `apps/web/src/app/admin/page.tsx` 是一个 **648 行、功能完整的管理后台**，位于**用户端应用（3000 端口）内**，调用同一套 `/admin/*` 端点：

```
apps/web/src/app/admin/page.tsx        648 行 ← 完整后台 UI
apps/web/src/components/admin-entry.tsx 17 行 ← 仅 isAdmin 才显示的入口
```

它实际调用（实测）：

```ts
apiFetch("/admin/dashboard")                                  // 仪表盘
apiFetch(`/admin/users?q=&status=&page=&pageSize=`)           // 用户列表
apiFetch(`/admin/users/${userId}`)                            // 用户详情
apiFetch(`/admin/users/${userId}/status`, { method: "POST" })  // 封禁
apiFetch(`/admin/users/${userId}/notes`,  { method: "POST" })  // 备注
apiFetch(`/admin/reports?status=&page=&pageSize=`)            // 举报
apiFetch(`/admin/reports/${reportId}/review`, { method: "POST" }) // 审核
apiFetch(`/admin/audit?page=&pageSize=`)                      // 审计
```

即 `apps/admin` 与 `apps/web/src/app/admin` 是**两套并行的后台 UI，覆盖同一批端点**。

影响：

- **RBAC 必须同时改造两处**，否则漏改一处就会保留越权入口
- 后台 UI 暴露在**面向普通用户的公开应用源**（3000）上，攻击面扩大；同源意味着用户端任何 XSS 都更容易触达管理功能
- 648 行重复代码，双份维护成本
- 文档与实现不一致，会误导后续开发

**处置建议（Phase A 一并决定）：** 二选一 —— (a) 把 `apps/web/src/app/admin/page.tsx` 缩减为真正的跳转/提示页（与文档一致）；或 (b) 删除该路由与 `admin-entry.tsx`。**不建议保留双份实现。** 注意 API 侧仍受 `AdminGuard` 保护，因此这不是一个直接的越权漏洞，而是**架构与可维护性风险**。

---

## 2. 当前已经完成的 Admin 功能

**后端（9 个端点，全部实测存在于 `admin.controller.ts`）：**

| 方法 | 路径 | 功能 | 节流 |
|---|---|---|---|
| GET | `/admin/dashboard` | 7 项聚合指标 | 全局 120/min |
| GET | `/admin/me` | 当前管理员信息 | 全局 |
| GET | `/admin/users` | 用户搜索 + 分页（q / status / page / pageSize） | 全局 |
| GET | `/admin/users/:id` | 用户详情（含近 10 条举报、20 条备注） | 全局 |
| POST | `/admin/users/:id/status` | ban / unban / disable / activate | 60/min |
| POST | `/admin/users/:id/notes` | 写内部备注 | 全局 |
| GET | `/admin/reports` | 举报列表 + 分页 + 状态筛选 | 全局 |
| POST | `/admin/reports/:id/review` | reviewing / resolved / rejected | 全局 |
| GET | `/admin/audit` | 审计日志 + 分页 | 全局 |

**前端（4 个页面）：**

- `/login` — 邮箱密码登录，登录后调 `/admin/me` 校验 `isAdmin`，非管理员自动登出
- `/` — Dashboard，7 个数字卡片
- `/users` — 用户列表（搜索 email/nickname、状态筛选、分页、封禁/停用/解封、写备注）
- `/users/[id]` — 用户详情（基本信息 + 被举报列表 + 内部备注）
- `/reports` — 举报列表 + 受理/处理/驳回
- `/audit` — 审计日志列表

**已具备的良好基础：**

- Admin 与用户 API 物理分离（独立 controller + 独立前端应用）
- `AdminGuard` 存在且挂在 controller 级别，覆盖所有 admin 端点
- 封禁/解封/举报审核/写备注**已经写 AuditLog**
- 用户列表与举报列表**已经分页**（未一次性拉全表）
- Dashboard 使用数据库聚合（`count()`），不是把全量用户拉到前端再算
- `ValidationPipe` 对 admin DTO 生效，DTO 使用 `@IsIn` 白名单枚举
- 用户资料更新 `updateProfile` 使用**显式字段白名单**，未 spread DTO（见 §6 第 12 条）

---

## 3. 当前缺失功能

按目标清单逐项对照，**全部缺失**：

| 模块 | 状态 | 说明 |
|---|---|---|
| Dashboard 完整指标 | 🔴 部分 | 只有 7 个数字，缺 New Users Today/7d、DAU/WAU/MAU、Say Hello、Conversations、Exchanges、Blocks、Suspended |
| Dashboard 趋势图 | ❌ 缺失 | 无 trends 端点 |
| Dashboard 时间筛选 | ❌ 缺失 | 无 Today/7d/30d/Custom |
| 用户管理筛选/排序 | 🔴 部分 | 只有 q + status；缺 country、createdAt、lastActiveAt、VERIFIED/UNVERIFIED、5 种排序 |
| 用户列表字段 | 🔴 部分 | 缺 Avatar、Age、Languages、Reports 计数、Connections 计数 |
| 用户详情完整画像 | 🔴 部分 | 缺 profile（languages/interests/purposes）、社交账号、Exchange 历史、Connections、行为统计、风险信息、历史操作记录 |
| 临时封禁 / 永久封禁区分 | ❌ 缺失 | 只有单一 `BANNED`，无到期时间 |
| Logout All Sessions | ❌ 缺失 | 无此端点 |
| 举报类型枚举 | ❌ 缺失 | `Report.reason` 是自由文本 VarChar(64)，非 12 值枚举 |
| 举报优先级 / 指派 | ❌ 缺失 | 无 priority、无 assignedModerator |
| 举报上下文查看 | ❌ 缺失 | 无相关消息/Moment/Block/Connection/Exchange 关联视图 |
| 内容审核模块 | ❌ 缺失 | 无 `/admin/moderation` |
| Risk Center | ❌ 缺失 | 无 `/admin/risk` |
| Connections 管理 | ❌ 缺失 | 无 `/admin/connections` |
| Contact Exchange 管理 | ❌ 缺失 | 无 `/admin/exchanges`（**这是 Phase 2 刚建立的授权模型，后台完全看不到**） |
| Block 管理 | ❌ 缺失 | 无 `/admin/blocks` |
| Audit Log 筛选 | ❌ 缺失 | 只有分页，无时间/admin/action/target 筛选 |
| Audit Log 导出 | ❌ 缺失 | 无导出 |
| Admin RBAC | ❌ 缺失 | 只有 `isAdmin` 布尔 |
| 管理员管理 | ❌ 缺失 | 无 `/admin/admins`，无法在后台增删改管理员 |
| System Settings | ❌ 缺失 | 无 `SystemSetting` 模型，配置散落各处 |
| Announcements | ❌ 缺失 | 无模型、无端点、无页面 |
| Admin E2E | ❌ 缺失 | 无 Playwright，无 `apps/admin/e2e` |

---

## 4. 当前 Admin API

**命名风格（实际观察，后续必须沿用）：**

- 全局前缀 `api/v1`，controller 前缀 `admin`
- 全部返回 `{ success: true, data: ... }` 或 `{ success: false, error: { code, message } }`
- 分页返回 `{ items, total, page, pageSize }`
- 列表查询参数用 `q` / `status` / `page` / `pageSize`
- 动作类用 `POST` + `{ action: "..." }` 单一 DTO 枚举分发（`/status`、`/review`），**而非** REST 风格的多个动词端点

**与目标清单的冲突（重要）：**

目标清单建议 `POST /admin/reports/:id/resolve`、`/dismiss`、`/assign` 分开。但现有实现是 `POST /admin/reports/:id/review` + `action` 枚举。

**建议：保留 `/review` 并扩展，不要新增重复端点。** 这与"不要为了机械匹配清单而创建重复 endpoint"的要求一致。缺失的是 `assign` 与 `reason`，应以新增字段/子资源方式补齐，而非另起一套。

**权限现状：** 9 个端点**全部只校验 `isAdmin`**，没有任何一个做角色或范围检查。任何 `isAdmin=true` 的用户可以调用全部 9 个端点。

---

## 5. 当前 AdminGuard

`apps/api/src/admin/admin.guard.ts`（全文 29 行）：

```ts
async canActivate(context: ExecutionContext) {
  const request = context.switchToHttp().getRequest<{ user?: { id: string } }>();
  const userId = request.user?.id;
  if (!userId) throw new ForbiddenException({ ... code: "ADMIN_REQUIRED" });
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, status: true },
  });
  if (!user?.isAdmin || user.status !== "ACTIVE") {
    throw new ForbiddenException({ ... code: "ADMIN_REQUIRED" });
  }
  return true;
}
```

**评价：**

- ✅ 逻辑正确：`isAdmin` 且 `status === "ACTIVE"`
- ✅ 挂在 controller 级别，不会漏掉某个端点
- ✅ 认证先于授权（`AuthGuard("jwt")` 在前，未认证返回 401；非管理员返回 403）
- ❌ **无角色概念**，无法表达"MODERATOR 不能改系统设置"
- ❌ **无资源范围检查**，无法表达"SUPPORT 不能永久封禁"
- ❌ **每个请求一次 DB 查询**，无缓存（性能问题，非安全问题）
- ⚠️ 只检查 `isAdmin`，**不检查目标**：管理员可以封禁另一个管理员，也可以封禁自己
- ⚠️ 未区分 `DISABLED` 与 `BANNED` 的语义差异（两者都被拒，行为正确但信息丢失）

---

## 6. 当前权限问题

按严重度排序。**均已通过读取实际代码确认。**

### P0 — 阻断性问题

**1. 完全没有 RBAC，9 个管理员权限完全相同**
`User.isAdmin` 是布尔值。实测数据库中 **9 个用户 `isAdmin=true`**（共 168 用户）。这 9 人全部拥有：封禁任意用户、审核任意举报、读取全部审计日志、写备注。目标要求的 5 个角色**一个都不存在**。

**2. 管理员可以封禁其他管理员，也可以封禁自己**
`setStatus()` 只按 `userId` 更新，**没有任何目标校验**：

```ts
await this.prisma.user.update({
  where: { id: userId },
  data: { status: "BANNED", bannedAt: new Date(), banReason: ... },
});
```

后果：任一被攻陷的管理员账号可一次性封禁其余 8 个管理员（含 SUPER_ADMIN），造成后台整体失守。这是**最严重的权限提升/横向攻击面**。

**3. `reason` 是可选的**
`UserStatusDto.reason` 标注 `@IsOptional()`。目标明确要求"所有修改操作需要 reason"。实测后果：不填原因也能封禁，且此时审计日志 `detail` 为 `null`，事后无法追溯原因。

### P1 — 高危

**4. 审计日志字段严重不足**
`AdminAuditLog` 实际字段：

```prisma
model AdminAuditLog {
  id        String   @id @default(uuid()) @db.Uuid
  adminId   String   @db.Uuid      // ← 无外键关系
  action    String   @db.VarChar(64)
  targetId  String?  @db.Uuid      // ← 强类型 UUID
  detail    String?  @db.VarChar(2000)
  createdAt DateTime @default(now())
}
```

缺失：`ip`、`userAgent`、`before`、`after`、`targetType`、结构化 `reason`。
且 `targetId` 是 `@db.Uuid`，**无法记录非 UUID 目标**（例如 `settings.discover_daily_limit` 这类 key）。

**5. `AdminAuditLog.adminId` 与 `AdminNote.adminId` 都没有外键**
schema 中两者均无 `@relation`。后果：管理员账号被删除后，其审计记录成为**悬空孤儿行**，`adminId` 指向不存在的用户，审计链条断裂。这属于审计可篡改性（audit tampering）问题。

**6. `reviewReport` 的审计记录语义错误**
```ts
await this.audit(adminId, `report.${action}`, reportId, updated.reportedUserId);
```
把**被举报人的 UUID 塞进了 `detail` 字段**（detail 本应是可读原因）。同时举报审核**完全没有采集 reason**——目标要求"处理时必须填写 reason"。

**7. 审计日志对所有管理员完全开放**
`GET /admin/audit` 仅受 `isAdmin` 保护。目标要求：普通管理员不可删除、只有 SUPER_ADMIN 可导出。现状是 9 个管理员**全部可以读取全部审计日志**，且无导出/只读区分。

### P2 — 中危

**8. 用户列表暴露 email（PII）**
`searchUsers` 的 `select` 含 `email: true`，列表页直接展示。目标要求列表/普通详情不暴露敏感信息；email 应视为受限字段。

**9. 前端破坏性操作无二次确认**
`apps/admin/src/app/users/page.tsx` 的"封禁/停用/解封"按钮**点击即执行**，无 `confirm`，无 reason 弹窗。reason 是一个与列表并列的共享输入框，与具体操作无绑定，容易误操作。

**10. 无 CSRF token**
管理员会话完全依赖 cookie（`credentials: "include"`），所有敏感操作是 cookie 认证的 POST。`main.ts` 中未见 CSRF 保护，依赖 SameSite=Lax 缓解。属于纵深防御缺失。

**11. `GET /admin/users/:id` 对不存在的 ID 返回 200 + `data: null`**
`userDetail` 用 `findUnique`，找不到时返回 `null`，controller 仍包成 `{ success: true, data: null }`。语义应为 404。

**12. `ValidationPipe` 未开启 `whitelist` / `forbidNonWhitelisted`**

```ts
const object = plainToInstance(metadata.metatype, value);
```

未传 `excludeExtraneousValues`，因此**客户端多传的字段会保留在 DTO 实例上**。

**但实测当前不可利用**：`updateProfile` 使用显式字段白名单构造 `data`：

```ts
data: {
  nickname: dto.nickname,
  birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
  ...
}
```

并未 spread DTO。因此**未发现实际 mass assignment 漏洞**。但这是一个**潜伏风险**：任何未来使用 `{ ...dto }` 的端点都会立即变成权限提升漏洞。建议在 Phase A 一并加固。

**13. Admin 前端不按角色隐藏任何内容**
`components/shell.tsx` 的 NAV 是 4 项硬编码常量，所有管理员看到完全相同。当前因无角色而不构成漏洞，但**必须与 RBAC 同步建设**，否则会退化成"仅前端隐藏按钮"的反模式。

**14. 管理员账号只能通过 seed / 直接改库创建**
`prisma/seed.ts` 依赖 `ADMIN_BOOTSTRAP_EMAIL` 环境变量。`.env` 中**未设置该变量**。后台无 `/admin/admins` 端点，无法自助管理管理员。

**15. 存在两套并行 Admin UI，且文档描述不实**
`apps/web/src/app/admin/page.tsx`（648 行，用户端 3000 端口内）与 `apps/admin` 功能重叠、调用同一批端点。`docs/admin-console.md` 却称其"仅做快捷跳转"。详见 §1。后果：RBAC 改造需覆盖两处，漏改即留越权入口；后台 UI 暴露在公开应用源上。

---

## 7. RBAC 设计

### 设计原则

1. **不推翻 `isAdmin`**，先保证兼容：`isAdmin` 保留，新增 `AdminUser` 作为角色载体。
2. **Phase A 只做「角色」不做「细粒度权限表」**。5 个角色是静态的，权限矩阵固定，引入 `AdminPermission` + `AdminRolePermission` 会多出 3 张表却无当前收益。权限矩阵以 TypeScript 常量作为单一事实来源（single source of truth），后端强制校验。
3. 当出现"某个人需要临时多一项权限"的真实需求时，再升级为 DB 驱动的权限表。**升级路径保留**。

### 角色定义（与目标一致）

| 角色 | 定位 |
|---|---|
| `SUPER_ADMIN` | 全部权限；管理管理员；改系统配置；封禁/解禁；举报处理；内容审核；审计日志 |
| `MODERATOR` | 举报审核、内容审核、用户风险信息、**临时**封禁、删除违规内容 |
| `SUPPORT` | 用户查看、基础账户问题处理、看必要信息；不可改风控规则、不可管管理员 |
| `ANALYST` | 只读统计；不可改用户、不可审核、不可封禁 |
| `CONTENT_MANAGER` | Moments/评论内容审核与管理；不可管管理员 |

### 权限矩阵

`R` = 只读，`W` = 可写，`W*` = 受限写（见脚注），`–` = 无权限

| Role | Dashboard | Users | Reports | Moderation | Risk | Connections | Exchanges | Blocks | Audit | Settings | Admin 管理 | Announcements |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SUPER_ADMIN | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R + 导出 | R/W | R/W | R/W |
| MODERATOR | R | R | R/W | R/W | R | R | R | R | R（仅自己） | – | – | – |
| SUPPORT | R | R | R | – | R | R | R | – | – | – | – | – |
| ANALYST | R | – | – | – | R | – | – | – | – | – | – | – |
| CONTENT_MANAGER | R | – | R | R/W | – | – | – | – | – | – | – | R/W |

**脚注：**
- `W*` Users 写权限的细分（必须由后端按角色强制）：
  - `SUPER_ADMIN`：ban / unban / disable / activate，含永久封禁
  - `MODERATOR`：仅临时封禁（需带到期时间），不可永久封禁、不可操作其他管理员
  - `SUPPORT`：仅 disable / activate，**不可永久封禁**
  - `ANALYST` / `CONTENT_MANAGER`：无任何写权限
- Exchanges `W` = 撤销授权（revoke）。仅 `SUPER_ADMIN`。撤销必须 confirm + reason + AuditLog。
- Blocks `W` = 解除 Block。仅 `SUPER_ADMIN`（普通管理员不可随意删 Block，符合目标要求）。

**该矩阵可满足目标 §24 的全部 10 项关键测试：**

| # | 测试 | 期望 | 本矩阵依据 |
|---|---|---|---|
| 1 | normal user → admin endpoint | 403 | 无 `AdminUser` 记录 |
| 2 | moderator → report resolve | 成功 | Reports = R/W |
| 3 | moderator → system setting | 403 | Settings = – |
| 4 | analyst → dashboard | 成功 | Dashboard = R |
| 5 | analyst → ban user | 403 | Users = – |
| 6 | support → user view | 成功 | Users = R |
| 7 | support → permanent ban | 403 | Users 写 = 仅 disable/activate |
| 8 | exchange revoke → AuditLog | 创建 | Exchanges W 强制写审计 |
| 9 | user ban → AuditLog | 创建 | Users W 强制写审计 |
| 10 | settings change → AuditLog | 创建 | Settings W 强制写审计 |

### 强制校验位置（必须在后端，四层）

```
1. AuthGuard("jwt")          → 认证：是谁
2. AdminGuard                → 是否管理员（AdminUser 存在且 isActive）
3. @RequirePermission(...)   → 角色是否有该资源该动作的权限
4. Service 层 Scope Check    → 目标是否在允许范围内（如不可操作管理员、不可自封）
```

第 4 层是当前**完全缺失**、且最容易造成越权的一层，必须与 RBAC 同期建设。

---

## 8. Prisma 当前结构

### 已存在且可复用（**不要重建**）

| 模型 | 用途 | 复用评价 |
|---|---|---|
| `User` | 含 `isAdmin`、`bannedAt`、`banReason`、`status` | ✅ 保留 `isAdmin` |
| `Report` | `reporterId` / `reportedUserId` / `messageId` / `reason` / `status` | ✅ 复用，需扩展 |
| `Block` | `blockerId` / `blockedId` / `createdAt` | ✅ 复用（无 reason 字段） |
| `Connection` | `userAId` / `userBId` / `conversationId` / `status` | ✅ 复用 |
| `ConnectionRequest` | Say Hello 请求 | ✅ 复用 |
| `Conversation` / `ConversationMember` / `Message` | 会话与消息 | ✅ 复用 |
| `SocialAccount` | 用户社交账号（`visibility` 已于本日下线） | ✅ 复用 |
| `SharedSocialAccount` | **逐对授权**（Phase 2 新建） | ✅ **Exchange 后台页必须读这张表** |
| `ExchangeRequest` | 交换请求 | ✅ 复用 |
| `Moment` / `MomentComment` / `MomentLike` | 内容 | ✅ 复用（`source` 字段已区分 DEMO/USER） |
| `Notification` | 通知 | ✅ 复用 |
| `AdminNote` | 管理员备注 | ✅ 复用，建议加外键 |
| `AdminAuditLog` | 审计日志 | ✅ 复用，需扩展字段 |
| `UserStatus` enum | `ACTIVE` / `DISABLED` / `BANNED` | ⚠️ 需加 `SUSPENDED` |
| `ReportStatus` enum | `OPEN` / `REVIEWING` / `RESOLVED` / `REJECTED` | ⚠️ 无 `DISMISSED`（代码用 REJECTED 表达"驳回"） |

### **关键发现：不存在 `AdminUser` 模型**

全 schema 中**没有任何 `AdminUser` / `AdminRole` / `AdminPermission` 模型**。管理员身份**唯一**由 `User.isAdmin Boolean @default(false)` 表达。

因此目标中"如果当前 schema 已经有 AdminUser：优先在现有结构上扩展"的前提**不成立**——需要新建，但**必须与 `User` 一对一挂接**，而不是另起一套互不相干的管理员表。

### 不存在、需新建的模型

`AdminUser`、`SystemSetting`、`Announcement`、`ModerationCase`、`UserRiskSummary`、`AdminRole`(enum)、`AdminPermission`、`AdminRolePermission`

### 当前数据规模（实测）

```
admins 9 / users 168
reports 10 (REVIEWING 6, RESOLVED 4, OPEN 0)
adminAuditLog 17 / adminNote 16
blocks 3 / connections 44 / exchangeRequest 6 / SharedSocialAccount 24 / moments 23
migrations 13 已全部应用，schema 与 DB 无漂移
```

---

## 9. Prisma 是否需要修改

**需要。** 但**不是全部现在做**。

| 模型 | 是否新增 | 所属 Phase | 理由 |
|---|---|---|---|
| `AdminRole` enum | ✅ 现在 | **Phase A** | RBAC 前提 |
| `AdminUser` | ✅ 现在 | **Phase A** | RBAC 前提，与 `User` 一对一 |
| `AdminAuditLog` 扩展字段 | ✅ 现在 | **Phase A** | 审计是安全基线，且早建早收集数据 |
| `UserStatus.SUSPENDED` | ✅ 现在 | **Phase A** | 临时封禁需要独立状态，否则永久/临时无法区分 |
| `Report` 扩展（type/priority/assignee/decision） | ✅ 现在 | **Phase D** | 举报模块前提；可合并进 Phase A 迁移以省一次迁移 |
| `SystemSetting` | ✅ 后续 | **Phase G** | 配置管理前提 |
| `Announcement` | ✅ 后续 | **Phase G** | 公告前提 |
| `ModerationCase` | ❌ **暂不建** | 延后 | 先复用 `Report`；只有当审核对象超出"举报"范围（主动巡检发现的内容）时才需要独立工单表。**现在建会与 Report 职责重叠。** |
| `UserRiskSummary` | ❌ **暂不建** | 延后 | 风险指标全部可由现有表聚合得出（report/block/message 计数）。物化会增加数据陈旧风险。**先用聚合查询，出现性能瓶颈再物化。** |
| `AdminPermission` / `AdminRolePermission` | ❌ **暂不建** | 延后 | 角色静态、矩阵固定，TS 常量足够。升级路径保留。 |

**结论：Phase A 只动 4 处，且合并为 1 个 migration。**

---

## 10. Prisma Diff

**需要 schema change。** 以下为 **proposed diff，尚未执行**。

### Migration M1 — Phase A（RBAC + 审计基线）

```prisma
// ── 新增枚举 ────────────────────────────────────────────────
enum AdminRole {
  SUPER_ADMIN
  MODERATOR
  SUPPORT
  ANALYST
  CONTENT_MANAGER
}

// ── 扩展既有枚举 ────────────────────────────────────────────
enum UserStatus {
  ACTIVE
  DISABLED
  BANNED
  SUSPENDED      // 新增：临时封禁（带到期时间），与永久 BANNED 区分
}

// ── 新增模型：管理员身份与角色 ──────────────────────────────
model AdminUser {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @unique @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      AdminRole @default(MODERATOR)
  isActive  Boolean   @default(true)
  createdBy String?   @db.Uuid          // 谁授予的（审计链）
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([role])
  @@index([isActive])
}

// ── User 反向关系 ───────────────────────────────────────────
model User {
  // ... 现有字段保持不变，isAdmin 保留（兼容期）
  adminProfile AdminUser?
}

// ── 扩展 AdminAuditLog（补齐审计必需字段）──────────────────
model AdminAuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  adminId    String   @db.Uuid
  admin      User     @relation("AuditByAdmin", fields: [adminId], references: [id], onDelete: Restrict)
  action     String   @db.VarChar(64)
  targetType String?  @db.VarChar(32)   // 新增：user / report / exchange / setting / ...
  targetId   String?                    // 改：去掉 @db.Uuid，兼容非 UUID 目标（如 settings key）
  reason     String?  @db.VarChar(500)  // 新增：结构化原因（不再是自由文本 detail）
  before     Json?                      // 新增：变更前快照
  after      Json?                      // 新增：变更后快照
  ip         String?  @db.VarChar(45)   // 新增：IPv4/IPv6
  userAgent  String?  @db.VarChar(512)  // 新增
  detail     String?  @db.VarChar(2000) // 保留：向后兼容既有 17 条记录
  createdAt  DateTime @default(now())

  @@index([adminId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}

// ── AdminNote 加外键（消除孤儿行）──────────────────────────
model AdminNote {
  // ... 现有字段
  admin User @relation("NotesByAdmin", fields: [adminId], references: [id], onDelete: Restrict)
}
```

### 字段解释

| 字段 | 作用 | 为什么需要 |
|---|---|---|
| `AdminUser.role` | 角色 | RBAC 核心；替代"人人都是超管" |
| `AdminUser.isActive` | 软停用管理员 | 移除管理员时不删审计链（配合 `onDelete: Restrict`） |
| `AdminUser.userId @unique` | 一对一挂 `User` | **不重建平行用户体系**，复用现有认证 |
| `AdminUser.createdBy` | 谁授予的权限 | 防止"凭空出现管理员"，权限授予本身可审计 |
| `AdminAuditLog.targetType` | 目标类型 | 区分 user/report/setting，否则 targetId 无法解读 |
| `AdminAuditLog.targetId` 去 UUID | 兼容任意目标 | 现为 `@db.Uuid`，**无法存 settings key** |
| `AdminAuditLog.reason` | 结构化原因 | 目标强制要求；现在塞在自由文本 `detail` 里 |
| `AdminAuditLog.before/after` | 变更快照 | 目标要求"结果：before / after" |
| `AdminAuditLog.ip/userAgent` | 环境 | 目标要求 |
| `UserStatus.SUSPENDED` | 临时封禁 | 目标区分临时/永久封禁；单一 `BANNED` 无法表达 |
| `AdminNote.admin` 外键 | 引用完整性 | 现在无外键 → 管理员删除后备注悬空 |

### 迁移风险评估

| 风险 | 等级 | 说明与处置 |
|---|---|---|
| 新增枚举值 `SUSPENDED` | 🟢 低 | `ALTER TYPE ADD VALUE` 是增量操作，不动存量数据。**注意：PostgreSQL 中该语句不能在事务内与其他 DDL 混用**，需单独一条 migration 或放在最前 |
| `AdminAuditLog.targetId` 由 `@db.Uuid` 改为 `text` | 🟡 中 | 类型放宽（UUID → text）是**兼容**的，现有 17 行 UUID 值可无损转换。**但必须确认没有索引依赖旧类型**（当前无 targetId 索引，安全） |
| 新增 `AdminUser` 表 + 回填 9 个 `isAdmin=true` | 🟡 中 | **回填策略必须明确**：建议全部回填为 `SUPER_ADMIN`（不降低现有能力，避免运维中断），随后由人工下调。⚠️ **若直接回填为 MODERATOR，9 个现有管理员会立刻失去权限** |
| `AdminAuditLog.adminId` 加外键 `onDelete: Restrict` | 🟡 中 | 加外键前必须确认 17 行 `adminId` 全部指向存在的用户，**否则 migration 失败**。需先跑孤儿检查 |
| `AdminNote.adminId` 加外键 | 🟡 中 | 同上，16 行需先校验 |
| `before/after` 新增 `Json?` | 🟢 低 | 可空，存量行保持 NULL |
| 新增列全部可空或带默认值 | 🟢 低 | 无 NOT NULL 无默认值的加列，不会锁表重写 |

**执行前置检查（Phase A 落地时必须先跑）：**

```sql
-- 1. 审计日志孤儿检查
SELECT COUNT(*) FROM "AdminAuditLog" a
LEFT JOIN "User" u ON u.id = a."adminId" WHERE u.id IS NULL;
-- 2. 备注孤儿检查
SELECT COUNT(*) FROM "AdminNote" n
LEFT JOIN "User" u ON u.id = n."adminId" WHERE u.id IS NULL;
-- 3. targetId 非 UUID 检查（改类型前）
SELECT COUNT(*) FROM "AdminAuditLog"
WHERE "targetId" IS NOT NULL
  AND "targetId" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

**必须：先 `pg_dump` 备份；使用 `migrate deploy` 而非 `migrate dev`；绝不 reset。**

---

## 11. Admin API 新架构

### 命名约定（沿用现有）

- 全部 `api/v1/admin/*`
- 返回体 `{ success, data }` / `{ success, error: { code, message } }`
- 分页 `{ items, total, page, pageSize }`
- 动作类端点用 `POST` + `action` 枚举，**不拆成多个动词端点**

### 端点规划（✅=已存在需扩展，🆕=新增）

```
── Dashboard ──────────────────────────────────────────────
✅ GET    /admin/dashboard                    （保留，扩展指标）
🆕 GET    /admin/dashboard/overview?range=    （新：带时间范围的完整指标）
🆕 GET    /admin/dashboard/trends?range=&metric=  （新：趋势序列）
🆕 GET    /admin/dashboard/moderation         （新：审核侧指标）

── Admin 自身 ─────────────────────────────────────────────
✅ GET    /admin/me                           （扩展：返回 role + permissions）
🆕 GET    /admin/admins                       （列表，仅 SUPER_ADMIN）
🆕 POST   /admin/admins                       （授予管理员，仅 SUPER_ADMIN）
🆕 PATCH  /admin/admins/:id/role              （改角色，仅 SUPER_ADMIN）
🆕 DELETE /admin/admins/:id                   （移除，仅 SUPER_ADMIN，不可自删）

── Users ──────────────────────────────────────────────────
✅ GET    /admin/users                        （扩展：更多筛选 + 排序 + 计数）
✅ GET    /admin/users/:id                    （扩展：完整画像；不存在时改 404）
✅ POST   /admin/users/:id/status             （扩展：加 SUSPENDED + 强制 reason + 角色校验）
🆕 POST   /admin/users/:id/sessions/revoke    （Logout All Sessions）
🆕 GET    /admin/users/:id/actions            （历史管理操作）

── Reports ────────────────────────────────────────────────
✅ GET    /admin/reports                      （扩展：type/priority/assignee 筛选）
🆕 GET    /admin/reports/:id                  （详情 + 上下文：消息/Moment/Block/Connection/Exchange）
✅ POST   /admin/reports/:id/review           （保留，强制 reason；不新增 resolve/dismiss 重复端点）
🆕 POST   /admin/reports/:id/assign           （指派，现有缺失）

── Moderation ─────────────────────────────────────────────
🆕 GET    /admin/moderation                   （统一审核队列）
🆕 GET    /admin/moderation/:id
🆕 POST   /admin/moderation/:id/action        （approve/remove/warn/restrict/ban，强制 reason）

── Risk / Connections / Exchanges / Blocks ────────────────
🆕 GET    /admin/risk                         （按风险等级筛选，聚合计算不物化）
🆕 GET    /admin/connections
🆕 POST   /admin/connections/:id/remove       （强制 confirm + reason）
🆕 GET    /admin/exchanges                    （读 SharedSocialAccount，展示 owner→viewer→platform）
🆕 POST   /admin/exchanges/:id/revoke         （撤销授权，强制 confirm + reason）
🆕 GET    /admin/blocks
🆕 POST   /admin/blocks/:id/remove            （仅 SUPER_ADMIN）

── Audit ──────────────────────────────────────────────────
✅ GET    /admin/audit                        （扩展：时间/admin/action/target 筛选）
🆕 GET    /admin/audit/export                 （仅 SUPER_ADMIN）

── Settings / Announcements ───────────────────────────────
🆕 GET    /admin/settings
🆕 PATCH  /admin/settings/:key                （仅 SUPER_ADMIN，强制 confirm + reason）
🆕 GET    /admin/announcements
🆕 POST   /admin/announcements
🆕 PATCH  /admin/announcements/:id
🆕 DELETE /admin/announcements/:id
```

**Exchanges 页面的关键要求（承接 Phase 2）：**
必须展示 `SharedSocialAccount` 的**三元组** `ownerId → viewerId → platform`，而不是 `userId → platform`。
绝不能把 `A → Instagram` 渲染成对所有人的授权——那正是 Phase 2 修复的越权根因。

---

## 12. Admin 前端目录

```
apps/admin/src/
├── app/
│   ├── layout.tsx                     ✅ 现有
│   ├── globals.css                    ✅ 现有
│   ├── login/page.tsx                 ✅ 现有（扩展：记住 role）
│   ├── (console)/                     🆕 路由组，统一挂 Shell + 权限守卫
│   │   ├── layout.tsx                 🆕 侧边栏 + 顶栏 + 权限上下文
│   │   ├── page.tsx                   ✅ 现 / → Dashboard（扩展趋势图 + 时间筛选）
│   │   ├── users/
│   │   │   ├── page.tsx               ✅ 现有（扩展筛选/排序/计数列）
│   │   │   └── [id]/page.tsx          ✅ 现有（扩展完整画像）
│   │   ├── reports/
│   │   │   ├── page.tsx               ✅ 现有（扩展类型/优先级/指派）
│   │   │   └── [id]/page.tsx          🆕 举报详情 + 上下文
│   │   ├── moderation/page.tsx        🆕
│   │   ├── risk/page.tsx              🆕
│   │   ├── connections/page.tsx       🆕
│   │   ├── exchanges/page.tsx         🆕
│   │   ├── blocks/page.tsx            🆕
│   │   ├── audit/page.tsx             ✅ 现有（扩展筛选 + 导出）
│   │   ├── admins/page.tsx            🆕 仅 SUPER_ADMIN
│   │   ├── settings/page.tsx          🆕 仅 SUPER_ADMIN
│   │   └── announcements/page.tsx     🆕
├── components/
│   ├── shell.tsx                      ✅ 现有（改：NAV 按角色过滤 + 顶栏 role/avatar）
│   ├── data-table.tsx                 🆕 分页/排序/筛选统一表格
│   ├── drawer.tsx                     🆕 详情抽屉
│   ├── confirm-dialog.tsx             🆕 强制 reason 的二次确认（安全要求）
│   ├── empty-state.tsx                🆕
│   └── role-gate.tsx                  🆕 前端按角色隐藏（**仅 UX，不是安全边界**）
├── lib/
│   ├── api.ts                         ✅ 现有
│   ├── permissions.ts                 🆕 与后端矩阵镜像的角色→权限映射
│   └── format.ts                      🆕
└── e2e/                               🆕 Phase H
```

**注意：** `role-gate.tsx` 只负责 UX。所有权限判断**必须在后端完成**（目标 §三.8/§三.9）。

---

## 13. Phase A 文件修改计划

Phase A 交付 **RBAC 基础架构**，不含任何业务页面。

### 后端

| 文件 | 动作 | 内容 |
|---|---|---|
| `prisma/schema.prisma` | 改 | 新增 `AdminRole` enum、`AdminUser`、`UserStatus.SUSPENDED`、扩展 `AdminAuditLog`、`AdminNote` 外键 |
| `prisma/migrations/<ts>_phase17_admin_rbac/migration.sql` | 新增 | 上述 DDL + 9 个 `isAdmin` 回填为 `SUPER_ADMIN` |
| `apps/api/src/admin/permissions.ts` | **新增** | 角色→权限矩阵常量（单一事实来源） |
| `apps/api/src/admin/admin.guard.ts` | 改 | 从 `isAdmin` 布尔升级为读 `AdminUser`；保留 `isAdmin` 兜底（兼容期） |
| `apps/api/src/admin/require-permission.decorator.ts` | **新增** | `@RequirePermission("users:write")` 元数据装饰器 |
| `apps/api/src/admin/permission.guard.ts` | **新增** | 读取元数据 + 校验角色矩阵 |
| `apps/api/src/admin/admin.service.ts` | 改 | 新增 `recordAudit()` 统一审计入口（含 ip/ua/before/after/reason）；`setStatus` 加目标保护（不可操作管理员、不可自封）+ 强制 reason |
| `apps/api/src/admin/admin.controller.ts` | 改 | 挂 `@RequirePermission`；`/admin/me` 返回 role + permissions |
| `apps/api/src/admin/admin.module.ts` | 改 | 注册新 provider |
| `apps/api/src/common/validation.pipe.ts` | 改 | 开启 `whitelist: true` + `forbidNonWhitelisted: true`（消除 mass assignment 潜伏风险） |

### 前端

| 文件 | 动作 | 内容 |
|---|---|---|
| `apps/admin/src/lib/permissions.ts` | 新增 | 镜像后端矩阵 |
| `apps/admin/src/components/shell.tsx` | 改 | NAV 按角色过滤；顶栏显示 role |
| `apps/admin/src/app/login/page.tsx` | 改 | 登录后取 role，非管理员拒绝 |
| `apps/admin/src/components/confirm-dialog.tsx` | 新增 | 强制 reason 的确认组件 |
| `apps/web/src/app/admin/page.tsx` | **改/删** | 处置第二套并行后台 UI（缩减为跳转页或删除），并同步修正 `docs/admin-console.md` |

### 测试

| 文件 | 动作 |
|---|---|
| `apps/api/src/admin/admin-rbac.spec.ts` | 新增：§24 的 10 项关键测试 |
| `apps/api/src/admin/admin-audit.spec.ts` | 新增：审计写入与不可篡改 |

### 明确不在 Phase A 范围

❌ Dashboard 趋势、用户列表 UI 扩展、举报详情、Moderation、Risk、Connections、Exchanges、Blocks、Settings、Announcements、E2E

---

## 14. Phase B-G 开发路线

| Phase | 内容 | 依赖 | 交付判据 |
|---|---|---|---|
| **A** | RBAC + Admin 基础架构 + 审计基线 | — | 10 项 RBAC 测试全过；审计含 ip/before/after/reason |
| **B** | Dashboard：完整指标 + 趋势 + 时间筛选 | A（需 role） | 聚合 API 不拉全表；4 个时间范围可用 |
| **C** | User Management：筛选/排序/计数列 + 详情完整画像 + 临时封禁 + Logout All | A, B | 列表分页不超 100/页；临时封禁可到期自动解除 |
| **D** | Reports + Moderation：类型枚举、优先级、指派、上下文、统一审核队列 | A, C | 处理强制 reason；可查看相关消息/Moment |
| **E** | Risk + Connections + Exchanges + Blocks | A, C, D | Exchanges 正确展示 `owner→viewer→platform` 三元组；revoke 有审计 |
| **F** | Audit Log：全维度筛选 + 只读约束 + SUPER_ADMIN 导出 | A | 非超管无法导出；记录不可删改 |
| **G** | Settings + Announcements | A, F | 配置入 `SystemSetting` 不硬编码；仅超管可改 |
| **H** | Admin E2E + Security Audit | B–G | Playwright 覆盖 login→dashboard→users→user detail→report→moderation→audit；独立 test DB |

**每个 Phase 完成必须运行：`typecheck` / `lint` / `test` / `build`，发现错误先修再进下一 Phase。**

---

## 15. Security Risks

### 已确认存在

| # | 风险 | 等级 | 依据 |
|---|---|---|---|
| 1 | 无 RBAC，9 个管理员权限等同 | 🔴 P0 | 仅 `isAdmin` 布尔 |
| 2 | 管理员可封禁其他管理员 / 自己 → 后台整体失守 | 🔴 P0 | `setStatus` 无目标校验 |
| 3 | `reason` 可选，无原因即可封禁 | 🔴 P0 | `@IsOptional()` |
| 4 | 审计日志缺 ip/ua/before/after/targetType/reason | 🟠 P1 | schema 实测 |
| 5 | 审计/备注 `adminId` 无外键 → 孤儿行，审计链断裂 | 🟠 P1 | schema 实测 |
| 6 | 举报审核审计语义错误 + 无 reason | 🟠 P1 | `admin.service.ts:161` |
| 7 | 审计日志对所有管理员开放，无只读/导出约束 | 🟠 P1 | `GET /admin/audit` |
| 8 | 用户列表暴露 email | 🟡 P2 | `searchUsers` select |
| 9 | 前端破坏性操作无二次确认、无 reason 绑定 | 🟡 P2 | `users/page.tsx` |
| 10 | 无 CSRF token，仅 SameSite=Lax | 🟡 P2 | `main.ts` |
| 11 | `GET /admin/users/:id` 不存在时返回 200 + null | 🟡 P2 | `userDetail` |
| 12 | `ValidationPipe` 无 whitelist（当前不可利用，潜伏） | 🟡 P2 | 已确认 `updateProfile` 用白名单 |
| 13 | Admin 前端不按角色隐藏 | 🟡 P2 | NAV 硬编码 |
| 14 | 无法在后台管理管理员，仅靠 seed | 🟡 P2 | 无 `/admin/admins`；`.env` 无 `ADMIN_BOOTSTRAP_EMAIL` |
| 15 | 两套并行 Admin UI（含用户端 3000 端口内一套），文档不实 | 🟡 P2 | `apps/web/src/app/admin/page.tsx` 648 行 |

### 已验证为**安全**（避免过度恐慌）

| 检查项 | 结论 | 依据 |
|---|---|---|
| 普通用户访问 `/admin/*` | ✅ 403 | `AdminGuard` 抛 `ADMIN_REQUIRED` |
| 未认证访问 `/admin/*` | ✅ 401 | `AuthGuard("jwt")` 先执行 |
| 非管理员能否从 `/admin/me` 绕过 | ✅ 不能 | 同样受 `AdminGuard` 保护 |
| 通过 `PATCH /users/me` 自提权为管理员（mass assignment） | ✅ 不能 | `updateProfile` 用显式字段白名单，DTO 无 `isAdmin` |
| Admin 端点是否散落在其他模块 | ✅ 没有 | 全仓仅 1 个 `@Controller("admin")` |
| 用户 API 是否被当作 Admin API 复用 | ✅ 没有 | 独立 controller |
| 管理员密码/Token 是否泄露 | ✅ 未泄露 | `admin.service.ts` 的 select 均不含 `passwordHash` / token |

### `UNVERIFIED`（本次未验证）

- **Admin 端点的实机 HTTP 行为**：本次为纯代码审计，未启动 API 做 401/403 实机探测。上表中"已验证为安全"的结论**基于代码路径分析**，非运行时证据。建议在 Phase A 落地时用自签 JWT 补一次实机矩阵测试（普通用户 / 5 种角色 × 全部端点）。
- **CSRF 是否可实际利用**：仅确认无 CSRF token；未构造跨站 PoC。
- **Admin 前端渲染是否正常**：未运行 `apps/admin` 构建或浏览器验证。
- **`AdminAuditLog` / `AdminNote` 孤儿行实际数量**：未执行 §10 的孤儿检查 SQL。

---

## 16. Test Plan

### 单元 / 集成（`apps/api/src/admin/*.spec.ts`）

**RBAC 矩阵测试（目标 §24 的 10 项，必须全过）**

| # | 场景 | 期望 |
|---|---|---|
| 1 | 普通用户 → `GET /admin/users` | 403 |
| 2 | MODERATOR → `POST /admin/reports/:id/review` | 200 |
| 3 | MODERATOR → `PATCH /admin/settings/:key` | 403 |
| 4 | ANALYST → `GET /admin/dashboard` | 200 |
| 5 | ANALYST → `POST /admin/users/:id/status` (ban) | 403 |
| 6 | SUPPORT → `GET /admin/users/:id` | 200 |
| 7 | SUPPORT → 永久封禁 | 403 |
| 8 | SUPER_ADMIN → `POST /admin/exchanges/:id/revoke` | 200 + 审计创建 |
| 9 | SUPER_ADMIN → `POST /admin/users/:id/status` (ban) | 200 + 审计创建 |
| 10 | SUPER_ADMIN → `PATCH /admin/settings/:key` | 200 + 审计创建 |

**补充安全测试（本次审计新发现，必须覆盖）**

| # | 场景 | 期望 |
|---|---|---|
| 11 | MODERATOR → 封禁另一个管理员 | 403（目标保护） |
| 12 | SUPER_ADMIN → 封禁自己 | 403（自封保护） |
| 13 | 封禁时 `reason` 缺失 | 400（强制 reason） |
| 14 | 举报处理时 `reason` 缺失 | 400 |
| 15 | MODERATOR → `GET /admin/audit/export` | 403 |
| 16 | 停用管理员（`isActive=false`）→ 任意 admin 端点 | 403 |
| 17 | `PATCH /users/me` 携带 `isAdmin: true` | 200 但 `isAdmin` 不变（防 mass assignment 回归） |
| 18 | 审计日志写入失败时业务操作是否回滚 | 需明确事务边界并断言 |

### 迁移测试

- 回填后 `AdminUser` 行数 === `isAdmin=true` 行数（9）
- 加外键前孤儿检查为 0
- `prisma migrate diff` = No difference detected
- 存量 `AdminAuditLog` 17 行、`AdminNote` 16 行无丢失

### E2E（Phase H）

`apps/admin/e2e`，使用**独立 test database**，禁止指向生产/开发库。
链路：admin login → dashboard → users → user detail → report → moderation action → audit log。
技术选型：Playwright（当前项目**完全没有** E2E 框架，需从零建立）。

---

## 17. 下一步

**只给出 Phase A 落地最应该执行的 5 个任务（按顺序）：**

1. **建立 RBAC 数据模型并安全回填**
   新增 `AdminRole` enum + `AdminUser`，把现有 9 个 `isAdmin=true` 用户回填为 `SUPER_ADMIN`（不降权，避免运维中断），`User.isAdmin` 保留作为兼容兜底。
   *前置：先跑孤儿检查 SQL + `pg_dump` 备份；用 `migrate deploy`。*

2. **实现权限矩阵与三层后端强制校验**
   新建 `permissions.ts`（矩阵单一事实来源）+ `@RequirePermission` 装饰器 + `PermissionGuard`；改造 `AdminGuard` 读 `AdminUser`。
   *这是把"人人超管"变成真 RBAC 的核心一步。*

3. **补上资源级 Scope Check（当前最危险的缺口）**
   在 `setStatus` 中禁止操作其他管理员、禁止自封，并按角色限制封禁类型（SUPPORT 仅 disable/activate，MODERATOR 仅临时封禁）。
   *不做这步，RBAC 只解决了"能不能进这个端点"，没解决"能对谁做什么"。*

4. **重建审计基线：强制 reason + 完整审计字段**
   `reason` 由可选改为必填；新增 `recordAudit()` 统一入口，写入 `targetType/targetId/reason/before/after/ip/userAgent`；修正 `reviewReport` 的 detail 误用；给 `AdminAuditLog.adminId` 与 `AdminNote.adminId` 加外键。

5. **补齐 RBAC 测试套件（18 项）+ 加固 `ValidationPipe` + 消除第二套后台 UI**
   实现 §16 的 18 项测试；同时开启 `whitelist: true` + `forbidNonWhitelisted: true` 消除 mass assignment 潜伏风险；并处置 `apps/web/src/app/admin/page.tsx` 这第二套后台 UI（缩减或删除），确保 RBAC 不存在漏改入口。最后跑通 `typecheck` / `lint` / `test` / `build`。

**完成后暂停，等待指令再进入 Phase B。**
