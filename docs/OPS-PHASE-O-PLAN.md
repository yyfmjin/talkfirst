# OPS-PHASE-O-PLAN — 网站运维与安全防护设计文档

> 状态：**O0 ✅　O1 ✅（含 O1-5）　O2 ✅ —— 本阶段目标全部完成；O3–O5 为后续规划**
> 最后更新：2026-10-02
> 前置阅读：`docs/AI_CONTEXT.md`、`docs/admin-console.md`
> 维护规则：本文档描述**当前代码真实存在的东西**。与代码冲突时以代码为准。

---

## 1. 背景与目标

需求方提出：后台管理需要网站运维功能——网站访问日志（访问 IP、访问时间、访问设备等详细
的用户与非用户访问信息），以及更多安全防护功能。

本阶段（Phase O）的目标不是从零造一个日志系统，而是**把已经存在但只写不读的审计数据接出来
可用**，并补齐采集侧的真实缺口。

核心结论：**数据面已经建完，控制面完全是空的。**

- `AccessLog` / `SecurityEvent` 两张表随迁移 `20261001085200_security_audit_center_p1` 上线；
- 每个请求都写入 `AccessLog`（全局拦截器），每个认证事件都写入 `SecurityEvent`；
- 索引正是运维台会用到的那几个；
- 但**零端点、零权限、零界面**可达：全仓库 `prisma.accessLog` 只出现在一处 `.create()`。

---

## 2. 现状盘点（已完成的能力）

### 2.1 数据模型

`AccessLog` — `prisma/schema.prisma:855-889`

| 字段 | 类型 | 可空 |
|---|---|---|
| `id` | uuid PK | 否 |
| `requestId` | VarChar(64) | 否 |
| `method` | VarChar(8) | 否 |
| `path` | VarChar(256) | 否 |
| `queryDigest` | VarChar(512) | **是** |
| `statusCode` | Int | 否 |
| `durationMs` | Int | 否 |
| `userId` | uuid | **是** |
| `authenticated` | Boolean | 否 |
| `isAdmin` | Boolean | 否 |
| `ip` | VarChar(45) | **是** |
| `deviceHash` | VarChar(64) | **是** |
| `userAgent` | VarChar(512) | **是** |
| `referer` / `origin` / `acceptLanguage` / `contentType` | VarChar | **是** |
| `errorCode` | VarChar(48) | **是** |
| `riskLevel` | VarChar(8) | 否 |
| `createdAt` | DateTime | 否 |

索引：`createdAt`、`[ip,createdAt]`、`[userId,createdAt]`、`[path,createdAt]`、`[statusCode,createdAt]`。
约束：**仅 `id` 主键**——无 unique、**无外键**、无 CHECK。
`AccessLog.userId` **没有 FK 也没有 Prisma relation**，因此 `include: { user: true }` 不可用，
必须手工 join。这是有意的：审计行不应因用户删除而消失。

`SecurityEvent` — `schema.prisma:805-849`。含 `type`/`source`/`riskLevel`/`riskScore`/`factors`(Json)/
`userId`/`ip`/`deviceHash`/`userAgent`/`method`/`path`/`statusCode`/`requestId`/`success`/`detail`(Json)/
`handledAt`/`handledBy`/`createdAt`。`userId` 是 `onDelete: SetNull`（审计历史必须存活）。
**`handledAt`/`handledBy` 字段存在但从未被任何代码写入。**

`DeviceIdentity` (`:892-901`) 与 `DeviceUser` (`:905-914`)：**死表**——全仓库除 schema 与
migration 外零引用，既不写也不读。

### 2.2 写入路径

`apps/api/src/security/`：

- `access-log.interceptor.ts` — 全局注册（`security.module.ts:20` 的 `APP_INTERCEPTOR`，
  `@Global()` 模块）。成功走 `tap`，失败走 `catchError` 后重新抛出。
- `access-log.service.ts:43-72` — 故障隔离：`write()` 从不抛错，审计失败不影响业务响应。
- `request-id.middleware.ts` + `request-context.ts` — 用 `AsyncLocalStorage` 传递请求元数据。
- `client-ip.ts:43` — **只读 `req.ip`**，从不直接读 `X-Forwarded-For`/`X-Real-IP`（防伪造）。
  `trustProxySetting()`：`TRUST_PROXY` 未设时生产为 `1`，开发为 `false`。
- `common/redact.ts:142` — `summarizeQuery()` **只保留 12 个白名单 key**
  （page/pageSize/limit/cursor/type/status/sort/order/direction/kind/scope/role），
  其余全部丢弃。**注意：`queryDigest` 是明文摘要，不是哈希。**
- `device-hash.ts:41-50` — `SECURITY_DEVICE_SALT` 缺失时返回 `undefined` 并只警告一次，
  **绝不**用硬编码常量兜底（否则会产生看似合法、实则可猜的稳定哈希）。
- `security.constants.ts:110-113` — `accessRiskLevel()`：**只有 `429 → MEDIUM`，其余全 `LOW`**。

### 2.3 已有的安全防护（Phase O 不需重做）

| 防护 | 位置 | 关键参数 |
|---|---|---|
| IP 维度限流 | `common/http-throttler.guard.ts`、`app.module.ts:33-34` | 60 次/分/IP（`THROTTLE_MULTIPLIER` 可倍增） |
| 账户维度防爆破 | `auth/login-attempt.service.ts` | 管理员 3 次 / 普通 5 次；30s 起指数退避，上限 15 分钟；窗口 15 分钟 |
| 会话 | `auth/auth.service.ts` | JWT + HttpOnly Cookie；Refresh 轮换 + 重放检测 |
| 密码 | — | bcrypt cost 12 + DUMMY_HASH 等时比较防枚举 |
| 输入校验 | `common/validation.pipe.ts` | 白名单，未知字段被剥离 |
| HTTP 头 | `main.ts`（helmet） | 另有 `scripts/next-security-headers.mjs` |
| 审计脱敏 | `common/redact.ts` | 敏感 key 直接替换 + 深度/长度上限 |
| 权限 | `admin/permissions.ts` | 五角色 / 20 权限；`PermissionGuard` **fail-closed** |
| 账户状态机 | `users/user-status.scheduler.ts:77` | 每分钟释放到期的暂停 |

---

## 3. 差距清单

| # | 缺口 | 证据 | 严重度 |
|---|---|---|---|
| 1 | **后台静态测试已失败 2/22** | 实测 `node --test ./test/smoke.test.mjs` → pass 20 / fail 2 | 🔴 阻塞 |
| 2 | **守卫拒绝的请求不留日志** | `JwtAuthGuard` 是控制器级守卫（`users.controller.ts:40`），守卫早于拦截器 | 🔴 |
| 3 | **无读取 API** | 全仓库 `accessLog` 仅 `.create()`（`access-log.service.ts:45`） | 🔴 |
| 4 | **无后台页面** | 17 个页面中无；`admin.service.ts` 只查 `adminAuditLog` | 🔴 |
| 5 | **设备识别从未启用** | salt 未设 → `deviceHash` 恒 NULL；`DeviceIdentity`/`DeviceUser` 实测 **0 行** | 🔴 |
| 6 | **无保留策略** | 全项目仅 1 个 cron（暂停到期）；两张日志表无限增长 | 🔴 |
| 7 | **无 UA 解析** | 无依赖 import，无 browser/OS/deviceType 字段 | 🟠 |
| 8 | **风险等级形同虚设** | 仅 429→MEDIUM | 🟠 |
| 9 | **`SecurityEvent` 无界面** | 已写 6 类真实事件，界面看不到 | 🟠 |
| 10 | **404 / 静态资源不记录** | 无 catch-all；`/uploads/*` 在路由前挂载 | 🟠 |
| 11 | 缺索引 | `requestId`（与 SecurityEvent 唯一关联键）、`deviceHash`、`riskLevel`、`isAdmin`、`authenticated` | 🟠 |
| 12 | 限流状态在内存 | 多副本/重启即失效；Redis 未接 | 🟠 |
| 13 | 无验证码/人机校验 | — | 🟡 |
| 14 | 无告警 | — | 🟡 |
| 15 | 无匿名访客身份 | 无 visitId/sessionId，无法区分同一 IP 的不同访客 | 🟡 |
| 16 | `permission.guard.ts:27` 引用不存在的文件 | `admin-route-audit.ts` 全仓库不存在（启动期断言从未实现） | 🟡 |

### 3.1 缺口 #2 的实测证据

```
基线：AccessLog 总行数 446
未认证请求 GET /api/v1/users/me     → HTTP 401（守卫拒绝）
请求不存在的路径                     → HTTP 404
最近 5 分钟统计：仅 19 条 200，0 条 401/404
```

**含义**：攻击者扫描 `/api/v1/admin/*` 被 403 拒绝时，系统内查不到任何痕迹——而这正是安全
审计最需要的数据。命中 handler 才产生的 401 会记录，被守卫拦下的不会。

### 3.2 缺口 #5 / #6 的实测证据

```
DeviceIdentity  0 行
DeviceUser      0 行
AdminAuditLog   0 行（尚无管理员执行过写操作）
```

---

## 4. 关键决策

### 决策 1：新增独立权限 `ops:read`，仅 SUPER_ADMIN + ANALYST

**理由**：访问日志含**原始 IP 与原始 User-Agent**。若直接复用 `audit:read`，等于把原始 IP 开放给
全部 5 个角色（含客服与内容管理员），隐私面过大。

现有先例是三个关系域（`connections:read`/`exchanges:read`/`blocks:read`）的持有集合：
**SUPER_ADMIN + ANALYST**。运维面是同类隐私敏感表面，沿用该集合。

**影响**：权限词表从 20 → 21，`smoke.test.mjs:856` 硬断言为 20，**必须同步更新**。
另需同步 `apps/admin/src/lib/permissions.ts` 的前端镜像（含 `ALL` 与 `ROLE_PERMISSIONS`）。

### 决策 2：UA 采用「读取时解析」，不新增列

原始 UA 已完整保留（512 字符对真实 UA 足够）；`ua-parser-js@1.0.41` 已作为 `fbjs` 的传递依赖
存在于 `node_modules`。因此**无需迁移、无需回填历史数据**即可给出浏览器/OS/设备类型。

写时持久化（新增列）留待确有性能需要时再做。

### 决策 3：`TRUST_PROXY` 需先确认真实拓扑再定值

`client-ip.ts:9-11` 的注释说明部署是 **Cloudflare + 反向代理 = 2 跳**，但生产默认值为 `1`。
若 nginx 使用 `$proxy_add_x_forwarded_for`，`trust proxy: 1` 会解析出 **Cloudflare 边缘 IP 而非
访客 IP**——即「访问 IP」这一项在生产环境会是错的。

仓库内**无 nginx 配置可查证**，故此项标记为「待确认」，不凭猜测改值。

### 决策 4：不做自动封禁

`readme:9763` 明确「不要让用户感觉被监控」；现有风控刻意只统计事实、不做判断
（`admin.service.ts:1392-1397` 记录了 Phase C 规范禁止引入风险模型）。
Phase O4 保持一致：**只输出信号，人工决策**。

---

## 5. 分阶段实施计划

### Phase O0 — 修复测试基线 ✅ 已完成

**为什么必须最先做**：`package.json` 的 `test` 脚本先跑三个静态 `.mjs` 再跑 `playwright test`。
静态测试一失败，**整个 e2e 套件无法通过 `npm test` 触达**——后续所有页面都没有测试落地处。
这是 `REPAIR-2026-10` P005(t) 已经修过一次的同一失效模式。

| 任务 | 位置 | 结果 |
|---|---|---|
| O0-1 | `smoke.test.mjs:168-183` | ✅ 原断言查重构前的内联三元式；改为断言经由共享 helper `deriveReportTargetType` 派生，并**新增**「禁止本地重新实现该规则」的反向断言，同时覆盖原来缺失的 MOMENT 分类 |
| O0-2 | `smoke.test.mjs:1010-1145` | ✅ 见下 |

**O0-2 实现要点**：没有把 `16` 简单改成 `21`。原写法用「迁移总数」当「C5 未加迁移」的代理指标，
任何合法 schema 演进都会误报。现改为：

- `C5_BASELINE`（16 项）与迁移列表前缀逐项比对——保护「历史迁移不可被改写」；
- `POST_C5_MIGRATIONS`（5 项）显式列出 C5 之后新增的迁移——**新增迁移必须经人工确认并编辑此清单**，
  把「钉住计数器」换成「钉住编辑动作」；
- 保留原有 `无 c5/integration 命名` 断言；
- 模型清单 33→40（补 `AccessLog`/`SecurityEvent`/`DeviceIdentity`/`DeviceUser`/
  `AttributeDefinition`/`UserAttribute`/`ProfileFieldVisibility`），
  枚举清单 13→18（补 `AttributeKind`/`AttributeSource`/`AttributeValueType`/`ReviewStatus`/`Visibility`）。

**验收结果**：`npm run test:static` → **28/28 通过**（修改前 26/28）。

### O0 的额外发现：`test-reflector` 桩件缺陷（已修）

O0 期间定位到一个**系统性测试缺陷**，影响 9 个 spec：

```
修复前，8 个 spec 各自重复定义：
  function reflectorReturning(permission) {
    return { getAllAndOverride: jest.fn(() => permission) } as unknown as Reflector;
  }
```

该桩件对**每一次** `getAllAndOverride` 调用都返回 `permission`。但
`PermissionGuard.canActivate` 会问**两个不同的问题**：

1. `ADMIN_PUBLIC_METADATA_KEY` —— 「这条路由是否显式公开？」
2. `PERMISSION_METADATA_KEY` —— 「它声明了什么权限？」

于是桩件对第 1 问也答 `"blocks:read"`，`isPublic` 为真，守卫在
`if (isPublic) return true` 处直接返回，**根本没走到权限判定**。后果：

- 「非读者被拒绝」的断言在一个**完全正常**的守卫上失败（12 个套件、22 个测试）；
- `PERMISSION_UNDECLARED` 这条 fail-closed 路径**从未被任何测试覆盖**——桩件让它不可达；
- `admin-rbac.spec.ts` 用例 9 断言「未声明权限 → 通过」，即 **audit P006 之前的旧行为**，
  与守卫现文档（`permission.guard.ts:18-29` "Fail-closed (FIX, audit P006)"）直接矛盾。
  它此前一直是**空过**的：对修复前与修复后的守卫都成立。

修复：新增共享桩件 `apps/api/src/admin/test-reflector.ts`，**只**对
`PERMISSION_METADATA_KEY` 返回权限；8 个 spec 删除各自的重复副本并改为导入。
用例 9 重写为断言 `403 PERMISSION_UNDECLARED`，使该 fail-closed 路径首次真正被测试。

**这是纯测试修复，未改动任何生产代码**：守卫本身正确且 fail-closed。

### 当前测试基线（如实记录）

| 套件 | 结果 |
|---|---|
| `apps/admin` 静态测试 | **28/28 通过** ✅ |
| `apps/api` | 1190 通过 / **5 失败**（3 个套件） |

那 5 个失败**不是 Phase O 引入的**，也**不是生产缺陷**，而是**未完成重构遗留的过期测试夹具**：
`connections.service.ts` / `moments.service.ts` / `verification.service.ts`
带着**未提交**改动，而 `connections-notification.spec.ts`、`moments-detail.spec.ts`
**与提交版本一致、从未同步更新**。

具体：

- `connections-notification.spec.ts` → `tx.connectionRequest.updateMany is not a function`
  （生产代码新增「CAS 认领」模式，spec 的 `tx` mock 未加该方法）
- `moments-detail.spec.ts` → `likeCount` 期望 7、实际 0（投影改为派生，spec 仍按旧桩件断言）
- `verification-lifecycle.spec.ts` → 冷却限流未触发

（原第 4 个套件 `auth-password-reset.spec.ts` 已在本阶段修复，见下文 O1 附带修复。）

属**既有技术债**，建议单独一个修复阶段处理，**不阻塞 Phase O**：Phase O 只需
`test:static` 全绿 + 新增测试通过即可验证。

### Phase O1 — 补齐采集缺口（🔴 P0，进行中）

| 任务 | 方案 | 状态 |
|---|---|---|
| O1-2a 设备盐 | 生成 32 字节随机盐写入 `.env`；`.env.example`/`.env.docker.example` 补占位与说明 | ✅ 已完成 |
| O1-2b 生产守卫 | 新增 `assertDeviceSaltConfigured()`（`common/security-config.ts`），与 `assertThrottleMultiplierSafe` **同一模式**：生产缺失即**拒绝启动**，把「静默降级」变成「启动失败并说明原因」 | ✅ 已完成 |
| O1-2c 落库路径 | **新建 `DeviceIdentity`/`DeviceUser` 写入路径**：新增 `security/device-identity.service.ts`。`DeviceIdentity`（首见/末见 upsert + 有界**哈希** UA 列表）对**每个已认证请求**记录（`access-log.interceptor`）；`DeviceUser.loginCount` **只在登录成功时递增**（`auth.service.recordDeviceLogin`，唯一传 `bumpLoginCount: true` 的调用点） | ✅ 已完成并实测 |
| O1-1 守卫拒绝入日志 | **已完成**：访问日志从 `APP_INTERCEPTOR` 下沉为 Express 中间件（`security/access-log.middleware.ts`）。拦截器运行在**守卫之后**，所以守卫拒绝与未匹配 404 永远不可见；中间件 + `res.on("finish")` 是**唯一**能观测全部响应的机制。真实错误码由 `ApiExceptionFilter` 回显到内部响应头（发送前删除，客户端不可见），中间件读取后写入 `errorCode`。拦截器已删除，此中间件成为**唯一写入者**（无重复行） | ✅ 已完成并实测 |
| O1-3 保留策略 | 新增 `security/audit-retention.service.ts`：`@Cron(EVERY_DAY_AT_3AM)`，**分批**清理（先查 id 再按 id 删除，因为 Prisma `deleteMany` 无 `take`，这是唯一能界定语句大小的方式）。访问日志默认 **30 天**、安全事件默认 **180 天**（后者是事件证据，必须活得更久）；两者均可配，且 **`0` = 永久保留而非「删光」**；非法值回退默认值而非 0；`MAX_BATCHES` 上限防止单次 sweep 无界运行；重叠 tick 跳过 | ✅ 已完成 + 7 项测试 |
| O1-4 IP 归一化 | `normalizeIp()` 把**精确的** `::1`（及 `0:0:0:0:0:0:0:1`）折到 `127.0.0.1`，并补上带方括号的 IPv6 主机/端口（`[::1]:1234`）。实测 `AccessLog.ip` 存的是 `::1`，导致同一本地客户端被记成两个键，按 IP 归组时漏行。用锚定匹配，`2001:db8::1` 不受影响 | ✅ 已完成 + 3 项测试 |
| O1-5 `TRUST_PROXY` | **已完成**（并发现真实安全缺陷）。仓库内**唯一的配置文件就是 `docker-compose.yml`**，它直接发布 API 端口（`4000:4000`）且**不定义任何代理服务**（无 nginx / traefik / caddy）——全仓库只有这一个 yml，已穷尽搜索。因此本仓库的正确值是 **`0`**，而代码的生产默认值是 `1`。已加入 `assertTrustProxyConfigured()`：生产未显式设置则**拒绝启动**（与 JWT 密钥、设备盐同一 fail-closed 模式） | ✅ 已完成并实测 |

**为什么 O1-2b 值得单独做**：设备识别此前是**双重静默失效**——既无 salt，
也**根本没有落库代码**（`DeviceIdentity`/`DeviceUser` 全仓库零引用）。只配 salt 不会让表长出数据。

#### O1-2c 实测证据（Node 进程 + 真实 PostgreSQL）

2 次登录 + 3 次已认证的普通请求之后：

```
DeviceIdentity  2 行   （此前 0 行，且 deviceHash 恒为 NULL）
DeviceUser      2 行

  hash 24b748fb…  userId 638a009d…  loginCount = 2   ← 两次登录
  hash b9fbb8f6…  userId 638a009d…  loginCount = 0   ← 三次普通请求
```

第二行 `loginCount = 0` 正是设计意图的证据：**普通流量不会抬高「登录次数」**。
若把拦截器也传 `bumpLoginCount: true`，这一行会是 3，指标就失去了意义。

### O1 附带修复：密码重置的 P2025 缺口（真实缺陷）

`auth-password-reset.spec.ts` 有一个用例「验码通过但账号**随后**消失 → 不抛 P2025/500」，
它此前**一直失败**，且原因不是夹具写错，而是 `AuthService.resetPassword` 确实没有处理
`user.update` 抛出的 Prisma `P2025`（记录不存在）。

场景：`findUnique` 之后、`update` 之前账号被删除。后果有两层：

1. 用户收到**不透明的 500**，而不是可理解的 `CODE_INVALID`；
2. 更严重的是**响应出现差异**——该端点对「验证码无效」答 `CODE_INVALID`，对「账号刚好消失」答 500，
   于是这个**未认证**端点变成了账号存在性的旁路信号，与该文件开头声明的
   「No account-existence oracle」契约直接冲突。

已修：`update` 外包一层 `catch`，识别 `code === "P2025"`（结构化判断，不依赖生成的
`PrismaClientKnownRequestError` 类）后改抛同一个 `BadRequestException(CODE_INVALID)`。
用例的夹具也一并修正为**在写操作上注入 P2025**（原写法让 `findUnique` 返回 null，
走的是 `!user` 这条**另一条**分支，因此并未钉住真正的问题）。

**影响**：`apps/api` 失败套件 **4 → 3**，通过测试 **1179 → 1190**。

### O1-1 实测证据（真实 API + 真实 PostgreSQL）

重启后发 5 个**此前完全不留痕**的请求（未认证访问受保护接口、未匹配路由、坏 token）：

```
before:  total 614,  401 行 15,  404 行 0
after:   total 624,  401 行 19,  404 行 1     ← 恰好 +10 = 探针数，无重复行

GET /api/v1/users/me                   401  UNAUTHORIZED  isAdmin=f
GET /api/v1/moments/feed               401  UNAUTHORIZED  isAdmin=f
GET /api/v1/admin/users                401  UNAUTHORIZED  isAdmin=t   ← 攻击者扫描
GET /api/v1/admin/dashboard            401  UNAUTHORIZED  isAdmin=t   ← 攻击者扫描
GET /api/v1/definitely-not-a-route-zzz 404  HTTP_ERROR    isAdmin=f   ← 首次有 404
```

`authenticated=f` 对全部探针成立——守卫拒绝时 Passport 从未填充 `request.user`，
所以这些行被正确地记为**匿名**。**+10 = 探针数**同时证明没有重复写入
（这正是把拦截器整体删除、中间件成为唯一写入者的目的）。

### O1 附带修复 2：`isAdminPath` 前缀混淆

迁移到中间件时发现 `isAdminPath()` 用裸 `startsWith`，于是
`/api/v1/administrators` 会被当成 admin 路由，在审计里被错误标记为 `isAdmin=true`。
已改为要求前缀后跟 `/` 或整串相等，并加测试覆盖。

### O1-5 实测证据：这是一个**真实安全缺陷**，不只是配置问题

原先我把这一项记为「阻塞于拓扑确认」。重新调查后**推翻了该判断**——拓扑可以从仓库自身确定，
而且结论揭示了一个可被利用的缺陷。

**第一步：确认本仓库的真实拓扑。** 穷尽搜索所有 `*.conf` / `*.yml` / `*.yaml` /
`nginx*` / `Caddyfile` / `traefik*`（排除 `node_modules`、`.next`、`dist`），
结果只有 `docker-compose.yml` 一个文件，且它：
- 直接发布 API 端口（`ports: - "${API_PORT:-4000}:4000"`）；
- **不定义任何代理服务**。

即：**本仓库的拓扑是「无代理」**，`trust proxy` 应为 `0`。
`client-ip.ts` 注释里描述的「Cloudflare + 反向代理」是一种**尚未存在**的部署设想，
却被当成了默认值。

**第二步：验证后果**（真实 Express，非推理）：

```
app.set("trust proxy", false) -> req.ip = 127.0.0.1   （忽略 XFF）
app.set("trust proxy", 1)     -> req.ip = 1.2.3.4     （信任 XFF）← 生产默认值
app.set("trust proxy", 0)     -> req.ip = 127.0.0.1   （忽略 XFF）
```

**在无代理拓扑下，生产默认值允许任意调用者用一个请求头伪造自己的 IP。**
而 `AccessLog.ip` 正是整个运维台赖以工作的字段（IP 归组、一设备多账号调查、滥用取证）——
它会变成**攻击者可自行撰写**的值。审计轨迹会看起来完好无损，实则毫无价值。

**第三步：修复并端到端验证。**
- 新增 `assertTrustProxyConfigured()`：生产未显式设置则拒绝启动，错误信息说明后果与可选取值；
- 编译产物实测：`REFUSED: InsecureConfigurationError`；
  `TRUST_PROXY=0` → allowed；development → allowed（不强制）；
- `docker-compose.yml` 显式加 `TRUST_PROXY: ${TRUST_PROXY:-0}`；
- `.env` / `.env.example` / `.env.docker.example` 三处补齐
  （`.env.docker.example` 原先这两个变量**都缺**，而它 `NODE_ENV=production`——加守卫后会直接启动失败，因此必须补）。

**运行中的 API 端到端验证**：发送带 `X-Forwarded-For: 203.0.113.99` 的请求后查库：

```
path=/api/v1/users/me  401  ip=127.0.0.1  UNAUTHORIZED
forged_rows_present = 0     ← 伪造地址从未进入数据库
```

> 这一项从「等待用户提供信息」变成「已完成」，靠的是把问题**查到底**而不是停在假设上。
> 教训：当一个配置项「没有明确答案」时，先穷尽仓库内的证据，再判断是否真的缺信息。

### Phase O1 验收
- ✅ `DeviceIdentity` 行数 > 0（实测 2 行，`deviceHash` 有值）
- ✅ `loginCount` 语义正确（登录计数、流量不计）
- ✅ 保留策略：`0`/非法值/分批/截止时间均有测试（7 项）+ 真实数据库验证
- ✅ `::1` 归一化 + 括号 IPv6（3 项测试）
- ✅ **未认证请求受保护接口后 `AccessLog` 出现对应 401/403 行**（实测 +10 行，404 首次落库）
- ✅ **`TRUST_PROXY` 已定值并加生产守卫**（实测伪造 XFF 无法进入日志）
- ✅ 11 项新增守卫测试（`security-config.spec.ts`）

### 当前测试计数（Phase O2 结束时）

| 套件 | 结果 |
|---|---|
| `apps/admin` 静态 | **28/28 通过** ✅ |
| `apps/admin` build | 成功（`/ops/access-logs` 已生成）✅ |
| `apps/api` | **1218 通过 / 5 失败**（3 个套件，均为既有夹具债） |
| `apps/api` typecheck | 通过 ✅ |
| `apps/admin` typecheck | 通过 ✅ |

Phase O1 + O2 期间 `apps/api` 通过数 **1179 → 1218**，失败套件 **4 → 3**（未新增失败）。
新增 `access-log.middleware.spec.ts`（替代原 `access-log.interceptor.spec.ts`），
其中**新增**了「守卫拒绝仍被记录」与「未匹配 404 仍被记录」两个用例——
这两个场景在旧结构下**无法表达**，正是迁移的原因。

### Phase O2 — 访问日志读取 API + 后台页面（🔴 P0，核心交付）

**后端 ✅ 已完成并实测**

- ✅ 迁移 `20261002140000_ops_access_log_indexes`：补 **5 个索引**（`requestId`、
  `deviceHash+createdAt`、`riskLevel+createdAt`、`isAdmin+createdAt`、`authenticated+createdAt`）。
  `requestId` 是 `AccessLog` 与 `SecurityEvent` 的**唯一**关联键却无索引；
  `deviceHash` 在 `SecurityEvent` 上有索引、在这里没有。用
  `prisma migrate diff --from-migrations --to-schema-datamodel` 验证为
  **"No difference detected"**，即手写 SQL 与 schema 完全一致。
- ✅ 权限：新增 **`ops:read`**（仅 SUPER_ADMIN + ANALYST），后端与前端镜像同步。
  前端权限词表被测试钉死「恰好等于后端」，`ops:read` 两侧都已加入。
- ✅ 权限解析实测：SUPER_ADMIN → 200；普通用户 → **403**；匿名 → **401**。
- ✅ `GET /admin/access-logs`：过滤 `ip`/`userId`/`path`/`statusCode`/`riskLevel`/
  `authenticated`/`isAdmin`/`createdFrom`/`createdTo` + 分页。**过滤全部在数据库执行**。
  实测：`statusCode=401` → 19（与直接查库一致）、`isAdmin=true` → 26、
  `path=admin` → 29、`ip=127.0.0.1` → 81、未来日期 → **0**。
- ✅ `GET /admin/access-logs/stats`：实测 `total=674`、`distinctIpCount=2`，
  且 `byStatus` 各项之和 = 674（口径自洽）。
- ✅ `GET /admin/access-logs/:id`：未知 id → 404 `ACCESS_LOG_NOT_FOUND`。
- ✅ 14 项单测（`admin-access-logs.spec.ts`）：过滤翻译、非法日期不放宽、
  分页夹紧、显式 select 无 include、**单次查询解析整页账号**、
  账号已删除 → `null` 而非崩溃、统计与列表共用同一 `where`。

两个实现要点：

1. **路由顺序**：`access-logs/stats` 必须声明在 `access-logs/:id` **之前**，
   否则 Nest 会把 `stats` 当成 `:id` 捕获。
2. **手工 join**：`AccessLog.userId` 无 FK、无 Prisma relation（审计行必须在账号
   删除后存活），所以账号用**每页一次**查询合并，而不是每行一次；查询不到的 id
   就是诚实的 `null`，UI 需占位而非 `userId.slice()`。

**前端 ✅ 已完成并实测**

- ✅ 新页面 `apps/admin/src/app/ops/access-logs/page.tsx`（表格范式，只读）。
- ✅ `shell.tsx` 新增导航分组「网站运维」+ 对应 `NAV_ICONS` 图标。
- ✅ 浏览器实测（Playwright + Chromium，真实登录）：
  ```
  NAV_HAS_OPS_GROUP true          HEADING_VISIBLE true
  NAV_HAS_ACCESS_LOG true         TABLE_ROWS 20
  LANDED_URL /ops/access-logs     TOTAL 726
  TOTAL_AFTER_401_FILTER 20       FIRST_ROW_HAS_401 true
  PAGE_ERRORS []
  ```
- ✅ 截图确认：侧边栏出现「网站运维 → 访问日志」；表格含时间/IP/账号/请求/状态/耗时/设备/操作；
  会话中可见 `admin` 标记出现在 `/api/v1/admin/access-logs`、`/api/v1/admin/dashboard`
  这些**O1-1 之前根本不存在的行**上，即本次修复在真实数据中的直接证据。
- ✅ 三种状态带 `data-testid`；空态区分「无记录」与「筛选无结果」。

**同步更新的测试钉子**（这些断言是**有意**钉死的，不更新就会失败）：

| 位置 | 改动 |
|---|---|
| `smoke.test.mjs` 权限词表 | 20 → **21**，并加 `ops:read` 存在性断言 |
| `smoke.test.mjs` ANALYST 期望集 | 加 `ops:read` |
| `smoke.test.mjs` 导航顺序 | 加 `{ /ops/access-logs, 访问日志, ops:read }` |
| `smoke.test.mjs` 域→路由表 | 登记 ops 域 |
| `smoke.test.mjs` post-C5 迁移允许清单 | 加 `20261002140000_ops_access_log_indexes` |
| `smoke.test.mjs` 只读域循环 | 加 `access-logs`（审计记录不可编辑） |
| `smoke.test.mjs` UUID 参数计数 | 10 → **11** |
| `admin-shell-ui.spec.ts` | `SECTIONS` 加「网站运维」；`FULL_NAV` 加「访问日志」；三个角色用例的 `absent` 加「访问日志」 |
| `admin-integration.spec.ts` | `ROUTE_TABLE` 加 3 条 `ops:read` 路由 |
| `ui-copy.test.mjs` + `ui-copy-scan.mjs` | `ADMIN_ALLOWED` 加 `HTTP`、`ops:read` |

> 一次教训记录：我最初把 `admin`、`/admin`、`/users`、`IP` 加进 **`BASE_ALLOWED`**，
> 这会让 `admin@example.com` 不再被识别为邮箱（`admin` 被当白名单剥掉 → `@example.com`
> 的 `example` 成了残留），**反而制造了漏检**。已回退，只保留**范围最小**的
> admin 专属豁免，并把原因写进注释。

**验收**：`npm run test:static` → **28/28 通过**；`@talkfirst/admin` build 成功（`/ops/access-logs` 已生成）。



- 新建 `app/ops/access-logs/page.tsx`：
  - `"use client"` + `export default` 包 `<Shell><XScreen /></Shell>`（**强制**：`AdminSessionProvider`
    在 `Shell` 内；具名导出会让 `next build` 失败而 `tsc` 通过）
  - draft/applied 拆分 + 模块级纯函数 `buildQuery(filters, page)`
  - `++ticket.current` 防竞态（列表页必备）
  - `totalPages` 由 API 给，前端**不重算**；`0` 视为「无页」
  - `createdTo` 补 `T23:59:59.999Z`（裸日期是午夜，操作者意图是整天）
  - `ALL` 是 UI 专用值，**永不**发给 API
  - 三种状态带 `data-testid="access-logs-loading|empty|error"`
  - 过滤器**全部后端执行**，绝不「取一页再前端隐藏」
- `shell.tsx`：新增 `NAV_GROUPS` 组「网站运维」+ **对应 `NAV_ICONS` 图标**
  （缺 key 会静默复用仪表盘图标，不报错）

**验收**：可按 IP/状态码/时间筛选；分页正确；`ops:read` 持有者可读、
其余角色 403；Playwright e2e 覆盖。

### Phase O3 — 安全事件中心（🟠 P1）

- `GET /admin/security-events`（过滤 `type`/`riskLevel`/`success`/时间）
- `POST /admin/security-events/:id/handle` — 启用**已存在但从未写入**的 `handledAt`/`handledBy`
- 前端用**卡片/feed 范式**（事件含变长 JSON，不适合表格），复用 `risk/page.tsx` 的 Section/Row
- 高亮 `BRUTE_FORCE_DETECTED`(HIGH)、`TOKEN_REFRESH_FAILED`
- **注意** `SecurityEvent.userId` 是 `SetNull` → 可为空，UI 需占位

**验收**：可标记已处理并留痕；`handledBy` 正确写入当前管理员 ID。

### Phase O4 — 主动防护增强（🟠 P1）

- 设备关联页「一设备多账号」（聚合 `DeviceUser`），用于识别养号
- IP 异常信号：同 IP 高频 4xx/429、同 IP 多账号登录 → **输出信号，不自动封禁**（决策 4）
- `accessRiskLevel()` 升级：综合状态码 + 路径 + 频率；`riskScore`/`factors` 字段已存在
- 限流迁 Redis：`ThrottlerModule` 换 Redis storage；`LoginAttemptService` 改持久化
  （`login-attempt.service.ts:15` 已预留说明）

### Phase O5 — 运维化（🟡 P2）

- 访问日志/审计导出 CSV（`audit:export` 权限已预留但未接线）
- 告警：阈值触发 + 通知渠道（nodemailer 基建已有）
- 访问趋势可视化
- 管理员二次验证 / IP 白名单（`settings:*`、`admins:*` 权限已预留未接线）
- 补 `permission.guard.ts:27` 引用的启动期路由断言（`admin-route-audit.ts` 实现或删除该注释）

---

## 6. 测试影响（新增导航项时会连带失败的位置）

这些断言是**有意钉死**的，改动时必须同 commit 更新：

| 位置 | 内容 | 失败方式 |
|---|---|---|
| `smoke.test.mjs:814-825` | 导航 9 项顺序 + 每项权限 | `deepEqual` |
| `smoke.test.mjs:856` | 权限词表**恰好 20 个** | 加 `ops:read` 即失败 |
| `smoke.test.mjs:759-775` | 域 → 路由对照表 | 新域需登记 |
| `admin-shell-ui.spec.ts:18` | `SECTIONS` 四个分区 | `toEqual` |
| `admin-shell-ui.spec.ts:20-30` | `FULL_NAV` 九项 | `toEqual` |
| `admin-shell-ui.spec.ts:117-136` | 三个角色的完整可见项列表 | `toEqual` |

新增页面还需（依据现有惯例）：
1. `test/e2e/admin-<domain>.spec.ts`，导入 `loginAndLand` / `openNav`
2. `smoke.test.mjs` 中钉住：调用的端点、每个 query 参数、两条空状态文案、`totalPages`、
   「单一 default export + 内层 Screen 包 `<Shell>`」形状
3. 无任何 admin 端点能创建 `AccessLog`，需要数据的 spec 必须用 Prisma 直插并带清理前缀
   （参照 `test/fixtures/admin-roles.ts:85-132` 的 `seedAuditRows`/`cleanupAuditRows`）

---

## 7. 明确不做的事

- **不改** `AccessLog` / `SecurityEvent` 的既有字段语义（只增索引）
- **不删**历史数据（保留策略只清超期）
- **不引入**自动封禁或自动降权
- **不把** `queryDigest` 当作哈希描述——它是明文白名单摘要
- **不为**运维页新增 Prisma `relation`（`AccessLog.userId` 保持无 FK，手工 join）

---

## 8. 参考

- 迁移：`prisma/migrations/20261001085200_security_audit_center_p1`
- 脱敏：`apps/api/src/common/redact.ts`
- 客户端 IP：`apps/api/src/security/client-ip.ts`
- 设备标识：`apps/api/src/security/device-hash.ts`
- 权限矩阵：`apps/api/src/admin/permissions.ts`
- 后台约定：`apps/admin/src/components/shell.tsx`、`apps/admin/src/lib/api.ts`
- 既有一致性问题记录：`docs/REPAIR-2026-10.md`
