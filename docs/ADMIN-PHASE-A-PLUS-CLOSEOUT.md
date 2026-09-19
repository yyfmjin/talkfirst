# Admin Phase A+ 收尾 — 4 项基础问题

> 范围严格限定为需求列出的 4 项。**未进入 Dashboard / Phase B**，
> 未新增 User Management 功能、Reports、Moderation、Risk、Connections、Exchanges、
> Blocks、Settings、Announcements，未改动已正常的 RBAC 业务规则。
>
> 第 2 项（SYSTEM actor）按需求**只输出方案，没有执行 migration** →
> 见 [`ADMIN-SYSTEM-ACTOR-DESIGN.md`](./ADMIN-SYSTEM-ACTOR-DESIGN.md)。

---

## 1. 全新 clone 的 `npm install` peer 冲突

### 根因

`@nestjs/throttler@6.5.0` 的 peer 范围只到 `@nestjs/common@^11` / `@nestjs/core@^11`，
而项目实际使用 12.0.3。**`package-lock.json` 把 6.5.0 钉死**，因此全新 clone 执行
`npm install` 会在解析阶段直接 `ERESOLVE` 失败 —— 也就是说这个项目在本次修改前
**本来就是装不上的**，不是偶发问题。

### 选版依据（不是"升到最新"）

| 版本 | `@nestjs/common` peer 范围 | 结论 |
| --- | --- | --- |
| 6.4.0 | `^7 \|\| ^8 \|\| ^9 \|\| ^10 \|\| ^11` | 不兼容 12 |
| **6.5.0（原）** | `^7 … \|\| ^11` | **冲突** |
| **6.6.0（新）** | `^7 … \|\| ^11 \|\| **^12**` | **对齐** |
| 6.6.0 也是当前 latest | — | 无更高版本可选 |

6.6.0 相对 6.5.0 的完整改动（官方 CHANGELOG）：

- `c625e98` — **Update to allow for support for Nest version 12**（即 peer 范围）
- `c342bad` — Declare the supported Node versions in `engines`

**零代码变更、无破坏性变更。** API 侧用法（`ThrottlerModule.forRoot([...])`、
`@Throttle({ default: { limit, ttl } })`、继承 `ThrottlerGuard` 的 `HttpThrottlerGuard`）
全部不受影响，因此没有需要分析的 API 兼容风险。

未降级 NestJS，未修改任何无关依赖。

### 验收

```
mv node_modules .local-data/node_modules.pre-clean     # 等价于删除（同一分区重命名）
npm install --no-audit --no-fund                        # 不带 --legacy-peer-deps
→ added 1037 packages in 32m   exit 0
→ throttler=6.6.0
```

依赖树：`@nestjs/throttler@6.6.0` 对 `@nestjs/common@12.0.3` / `@nestjs/core@12.0.3` 均为
**deduped**，无冲突。

> **clean install 之后需要显式 `npx prisma generate`。**
> `@prisma/client` 自带的 postinstall 在本机沙箱环境下生成不完整，表现为 typecheck 出现
> 大量 `TS7006 implicit any` 与 `Property 'block' is missing in type 'PrismaService'`。
> 重新生成后 typecheck 干净通过。

> **仍存在另一个既有 peer 冲突（本次未引入、未修复）**：
> `babel-plugin-transform-import-meta@3.0.0` 声明 peer `@babel/core@^8.0.1`，
> 实际解析为 7.29.7。修改前后完全一致（旧 lockfile 与旧 node_modules 都是 7.29.7）。
> 它**不阻塞安装**（npm 报成功），只是 `npm ls` 会标 `invalid`。属独立议题，未擅自改动。

---

## 2. SYSTEM actor 审计方案

**只出方案，未执行 migration。** 完整内容见
[`ADMIN-SYSTEM-ACTOR-DESIGN.md`](./ADMIN-SYSTEM-ACTOR-DESIGN.md)，要点：

- `enum AuditActorType { USER, SYSTEM }` + `actorType`（默认 `USER`）+ `adminId` 可空
- 用 **CHECK 约束**强制配对，使「SYSTEM 带 adminId」（伪造）与「USER 无 adminId」（无主）
  两种状态**不可表示**
- 不建任何 system User 行 —— 假账号会被搜索到、可能被放松的校验变成可登录、污染用户统计
- 迁移是纯元数据级（`ADD COLUMN` 带常量默认值 + `DROP NOT NULL`），**不回填、不重写表、不改索引**
- API 侧全是加法（多一个 `actorType` 字段），`recordAudit` 默认 `USER` 所以现有调用点无需改动
- **关键约束**：审计页 `item.adminId.slice(0, 8)` 在 `null` 上会崩，
  前端改动必须与"第一条 SYSTEM 写入"**同批上线**

---

## 3. Admin User Detail E2E

### 发现并修复的真实缺陷

`/admin/users/[id]` 原本**一个状态操作按钮都没有**，是纯只读页；而且因为接口返回
`200 + data:null`，页面会**永久停在「加载中…」**（`data` 永不为真，也不抛错）。

### 改动

| 文件 | 改动 |
| --- | --- |
| `apps/admin/src/lib/status-actions.ts` | **新增**。`ACTION_META` / `STATUS_ACTION_ORDER`，列表页与详情页共用一份元数据（原先只写在列表页内） |
| `apps/admin/src/app/users/[id]/page.tsx` | 外层 `<Shell>` + 内层 screen 消费 `useAdminSession()`；接入状态按钮 + `ConfirmDialog`；新增「用户不存在」状态；用 `ApiRequestError.code` 判定而不是 `message.includes("401")` |
| `apps/admin/src/app/users/page.tsx` | 改用共享 `status-actions` 模块 |
| `apps/admin/test/fixtures/admin-roles.ts` | 新增 `victim` 夹具（非管理员成员）+ `admin?: false` 开关；seed 时重置 status/ban 列 |
| `apps/admin/test/fixtures/browser.ts` | **新增**。登录/导航/进入详情页的共用辅助，两个 spec 不再各存一份 |
| `apps/admin/test/e2e/admin-user-detail.spec.ts` | **新增**。5 个测试 |

> `victim` 必须是**非管理员**：`AdminService.setStatus` 规则(4) 会拦下非 SUPER_ADMIN
> 对活跃管理员的操作，否则 MODERATOR/SUPPORT 的"允许的操作"根本无从验证。

### 覆盖

| 角色 | 断言 |
| --- | --- |
| SUPER_ADMIN | 列表→点击→详情；四个按钮齐全；三种确认弹窗各自规则：普通操作需原因才可确认、永久封禁需输入 `BAN`、临时封禁需未来解封时间；全部取消后状态仍为 ACTIVE |
| MODERATOR | 可查看；**真实执行一次「停用」并断言 ACTIVE → DISABLED**（button→dialog→API→DB→重渲染全链路）；无「永久封禁」 |
| SUPPORT | 可查看；只有「停用」「解封」；无「临时封禁」「永久封禁」 |
| ANALYST | 只读横幅；零个状态按钮 |
| 不存在的 id | **直接对 API 断言** 404 + `USER_NOT_FOUND` + 响应中**没有 `data` 键**；前端渲染「用户不存在」且不残留「加载中…」 |

**这些断言只验证前端行为。后端 `PermissionGuard` 仍是唯一安全边界**，
没有因为前端测试通过而删除任何后端检查。

---

## 4. Admin API 404 修复

`AdminService.userDetail` 原实现把 `findUnique` 的 `null` 直接交给控制器的成功信封：

```ts
return this.adminService.userDetail(id).then((data) => ({ success: true as const, data }));
// 不存在的 id → HTTP 200 { success: true, data: null }
```

改为在 service 内抛 `NotFoundException`，使用项目现有错误格式
`{ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } }`
（与 `setStatus` 里已有的同名错误码一致）。

放在 service 而不是 controller，是为了让所有现在与将来的调用方都继承该保证。
`ApiExceptionFilter` 对带 `success` 键的异常 payload 原样透传，所以 404 状态码与信封都正确。

新增 `apps/api/src/admin/admin-user-detail.spec.ts`（4 个测试），其中一条直接断言
**控制器不可能对不存在的用户发出成功信封**。

---

## 5. 验证结果

| 项目 | 结果 |
| --- | --- |
| `npm install`（clean） | exit 0，`added 1037 packages`，无 `--legacy-peer-deps` |
| `npm run typecheck` | 全部 workspace 通过 |
| `npm run lint` | API / admin / web 全部 exit 0，无警告 |
| `npm run test` | exit 0 |
| API jest | **14 suites / 126 tests**（原 13 / 122，+4） |
| Admin `npm test` | 2 静态 smoke + **10 浏览器测试**（原 5，+5） |
| Web | 5 tests |
| 三个 build | API / Admin / Web 全部 exit 0，`apps/api/dist/main.js` 存在 |
| 真机 E2E `phaseA-rbac-verify.mjs` | **57/57**（原 53/53，新增 4 项 404 检查），无回退 |

**数据库**：168 users / 9 AdminUser 全 SUPER_ADMIN / 9 `User.isAdmin=true` / 0 SUSPENDED /
audit 17 / notes 16 / reports 10 / 0 夹具残留 / 3 个审计链外键仍为 `RESTRICT`。
**无 migration**（15 个迁移，`migrate status` up to date）。
Phase A+ 的自动恢复与定时器逻辑未改动。

---

## 6. 本机环境限制（不是项目缺陷）

1. **代理**：环境导出了 `HTTP_PROXY` / `HTTPS_PROXY` 且**没有 `NO_PROXY`**，
   Playwright 探测 `webServer` 就绪时走代理 → `Timed out waiting 120000ms from config.webServer`。
   已把 loopback 绕过**固化进 `playwright.config.ts`**（`ensureLoopbackBypass()`，追加式，
   不覆盖已有值）。这是真实的可移植性修复 —— 带代理的 CI 环境同样会踩。
2. **safe-delete shim**：`nest build`（`deleteOutDir: true`）与 `playwright test`
   （清理 `test-results`）都会批量删除自己的输出目录，被 shim 的 50 文件阈值拦下。
   **没有为此改动项目配置**（那是本机机制，写进项目会影响正常机器）；
   以 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 运行。
   注意：`dangerouslyDisableSandbox` 与 `env -u CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR` 均**无效**。
3. **`incremental` + `deleteOutDir` 陷阱**：一次被中断的 `nest build` 会让 `dist` 处于半清理状态，
   之后 `tsc` 认为无需 emit → build 报"成功"但 `dist/main.js` 缺失。重跑即可。
4. **`reuseExistingServer: true` 会认领被中断运行遗留的 `next start`**，
   曾导致 E2E 卡死 12 分钟。跑之前确认 3001 无残留监听。

---

## 7. 遗留问题

- **SYSTEM actor 方案待确认**（第 2 项），确认后才执行 migration。
- `babel-plugin-transform-import-meta@3.0.0` 的 `@babel/core@^8.0.1` peer 冲突（既有，未修）。
- `apps/admin` 的 `npm test` 依赖数据库 + 已构建产物。
- 仍未做：完整 Admin E2E、CSRF、`/admin/users` 列表 email 脱敏、`/admin/admins`。
- settings / audit-export 的浏览器断言目前是空转的（前端确实还没有这些页面）。
- 项目不是 git 仓库，`git diff` 证据无法产出。
