# ADMIN PHASE C4 — Blocks Final Result

Status: **COMPLETE / STOPPED**

阶段范围：只读的「屏蔽关系管理」。不修改 schema、不新增 migration、不修改
`SafetyService`、不启用 `blocks:write`、不新增任何写接口。

---

## 1. Schema

### 实际 `Block` schema（`prisma/schema.prisma` 第 549 行，逐字读取）

```prisma
model Block {
  blockerId String   @db.Uuid
  blocker   User     @relation("BlocksMade", fields: [blockerId], references: [id], onDelete: Cascade)
  blockedId String   @db.Uuid
  blocked   User     @relation("BlocksReceived", fields: [blockedId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([blockerId, blockedId])
}
```

### 与 brief 历史基线的比对

| brief 的历史假设 | 真实 schema | 结论 |
|---|---|---|
| 没有 `id` | `@@id([blockerId, blockedId])`，无单列主键 | ✅ 一致 |
| 没有 `status` | 无该列 | ✅ 一致 |
| 没有 `updatedAt` | 无该列 | ✅ 一致 |
| 没有 `reason` | 无该列 | ✅ 一致 |
| 没有 `owner` | 无该列 | ✅ 一致 |
| 详情路由应为 `/blocks/:blockerId/:blockedId` | 复合主键，Prisma 生成键名 `blockerId_blockedId` | ✅ 一致，按此实现 |

**没有任何一处与真实 schema 冲突，因此不触发 §二十八 的停止条件。**

方向语义已从写路径确认（`apps/api/src/social/social-safety.controller.ts`）：
`blockerId = user.id`（发起屏蔽者），`blockedId = dto.userId`（被屏蔽者）。

- 是否修改 `schema.prisma`：**NO**（mtime 仍为 `2026-09-17 15:15`，大小仍为 22472 字节）
- 是否新增 migration：**NO**（`prisma/migrations` 仍为 16 个目录）
- 是否新增表 / 列 / 枚举成员 / 索引：**NO**

---

## 2. API

新增两条路由，均只读：

```
GET /api/v1/admin/blocks
GET /api/v1/admin/blocks/:blockerId/:blockedId
```

- 权限：两条均为 `blocks:read`
- 详情路由是**复合键**，不是 `/:id`（`Block` 没有可作为键的单值）
- 不存在 `POST` / `PATCH` / `PUT` / `DELETE` 的任何屏蔽路由（实测均 404）

### query

| 参数 | 语义 |
|---|---|
| `page` | 1–1000，越界夹取 |
| `pageSize` | 1–100，越界夹取 |
| `user` | **任一侧**：UUID 精确匹配 `blockerId OR blockedId`；文本对**双方** nickname 做大小写不敏感 `contains`。**不搜索 email** |
| `blocker` | 单侧精确：`blockerId`（UUID）或 `blocker.nickname`（文本） |
| `blocked` | 单侧精确：`blockedId`（UUID）或 `blocked.nickname`（文本） |
| `createdFrom` | `createdAt >=`（含） |
| `createdTo` | `createdAt <=`（含）。字面比较，前端补 `T23:59:59.999Z` |
| `sort` | 白名单键，未知值 400 |

`blocker` / `blocked` 是 brief §六 允许的增补项。加它们的理由是**方向本身就是本阶段的语义**：
`Connection` 的 `userAId` 是 UUID 排序的产物，所以 C2 只暴露一个 `user` 是正确的；
而 `Block` 的两侧是真实且有方向的，只提供 `user` 就无法回答「Alice 屏蔽了谁」与「谁屏蔽了 Alice」
这两个不同的问题。它们同时让 §十三 的要求可以被外部证伪——任何把这对 id 归一化
（排序、`min`/`max`、`Set` 去重）的实现，会让这两个参数返回同一个集合。

### sort

```
createdAt_desc              （默认）
createdAt_asc
blocker_nickname_asc / _desc
blocked_nickname_asc / _desc
```

四个 nickname 键均带 `nulls: "last"`（PostgreSQL 的 `ORDER BY … DESC` 默认 NULLS FIRST）。
客户端字符串**从不**直接进入 Prisma `orderBy`：白名单是预构建对象的映射表。
未知 sort → `400 VALIDATION_ERROR`，**不静默回退**。

### pagination

`totalPages = ceil(total / pageSize)`；`total = 0` → `totalPages = 0`；
越界页 → `200` 且 `items = []`，**不自动移页、不改 total**。

### 响应

List：`{ items, total, page, pageSize, totalPages }`，
每项 `{ blockerId, blockedId, createdAt, blocker{id,nickname}, blocked{id,nickname} }`。
**没有 `id`**——不伪造数据库中不存在的标识。

Detail：`{ block{blockerId, blockedId, createdAt}, blocker, blocked, history }`。

不存在的一对 → `404 BLOCK_NOT_FOUND`（沿用既有 `*_NOT_FOUND` 命名规范；
项目此前没有该错误码，本阶段按同一规范新增）。**绝不 `200 { data: null }`**。

---

## 3. RBAC

从**真实** `apps/api/src/admin/permissions.ts` 读取（该文件本阶段未修改，mtime 仍为 `2026-09-17 12:13`）：

| 角色 | `blocks:read` |
|---|---|
| SUPER_ADMIN | ✅（拥有全部权限） |
| ANALYST | ✅ |
| MODERATOR | ❌ |
| SUPPORT | ❌ |
| CONTENT_MANAGER | ❌ |

即 `blocks:read` = SUPER_ADMIN + ANALYST，与 `connections:read`、`exchanges:read` 同一持有集合，
比 `risk:read`（多一个 MODERATOR）严格更窄。

实测（真实 HTTP）：
- SUPER_ADMIN / ANALYST → `200`
- MODERATOR / SUPPORT / CONTENT_MANAGER → `403 PERMISSION_DENIED`
- 匿名 → `401 UNAUTHORIZED`
- disabled 管理员 → `401 USER_DISABLED`

`blocks:write` 在矩阵中存在但**未启用**，控制器上没有任何 `@RequirePermission("blocks:write")`。

---

## 4. Privacy

| 字段 | 是否返回 |
|---|---|
| `handle` | **否** |
| `email` | **否** |
| `passwordHash` | **否** |
| `token`（`tokenHash`/`refreshToken`/`accessToken`） | **否** |
| OAuth（`oauth`/`clientSecret`） | **否** |
| IP | **否** |
| User-Agent | **否** |

三层独立保证：

1. **服务层根本不查 `SocialAccount`。** 最强的形式：Jest 的 Prisma 替身里**没有**
   `socialAccount` 委托，任何读取都会抛异常；并显式断言 `prisma.socialAccount === undefined`。
   `Block` 与 `SocialAccount` 在 schema 上也没有任何关系，本就不存在合法路径。
2. **响应全文扫描字面量。** 夹具在真实 `SocialAccount` 上写了
   `PW_BLOCK_SECRET_HANDLE_*`，并断言该字面量在 list / detail 响应中都不存在——
   即使有人重命名字段，内容扫描仍会抓住泄漏。
3. **浏览器侧双重扫描。** Playwright 拦截**原始 API 响应体**并对 JSON 做递归键名扫描，
   同时扫描渲染后的 `main` 文本与页面 HTML。

另有一条反向断言确认扫描不是空转：夹具的 handle **确实存在**于数据库中。

---

## 5. UI

新增两个页面：

- `/blocks` — 列表。列为 **屏蔽方 / 方向 / 被屏蔽方 / 创建时间 / 操作**。
  筛选：用户、创建时间（起/止）、排序。默认 `pageSize = 20`（沿用既有 Admin 页面）。
  每行唯一的操作是「查看」，链接到 `/blocks/{blockerId}/{blockedId}`。
- `/blocks/[blockerId]/[blockedId]` — 详情。分区：屏蔽关系信息 / 方向 / 屏蔽方 / 被屏蔽方 / 处理历史。

**方向是显式渲染的**：列表用独立的「屏蔽 →」标记列，详情用垂直链条
「屏蔽方 Alice ↓ 屏蔽 ↓ 被屏蔽方 Bob」，两侧角色都有标签。
不存在任何把双方渲染成无序「关联用户」对的形式。

**没有任何写控件**：无解封、无编辑、无删除、无恢复、无批量操作。

导航：新增「屏蔽」项，位于 **连接 → 交换 → 屏蔽 → 审计日志**，按 `blocks:read` 门禁。

空态：无筛选时「暂无屏蔽记录」，有筛选无结果时「没有符合当前筛选条件的屏蔽记录」；
详情历史为空时「暂无处理记录」。

错误映射：403 →「无权限访问」，404 →「屏蔽记录不存在」，其他 →「加载失败，请稍后重试」；
并有一层 denylist 正则确保 Prisma / stack / SQL / 连接串不会透出。

---

## 6. Tests

| 套件 | C4 新增 | 全量结果 | 上一阶段基线 |
|---|---|---|---|
| API Jest | `admin-blocks.spec.ts` **65 例** | **22 suites / 561 tests 全过** | 21 / 496 |
| Playwright | `admin-blocks.spec.ts` **33 例** | **223 passed / 0 failed / 0 flaky** | 190 |
| Real E2E | §10g **60 项** | **424 项 / 422 过** | 364 |
| Smoke | **3 例** | **17 / 17** | 14 |

三个数字都是精确增量：Jest +1 suite / +65、Playwright +33、Real E2E +60、smoke +3。

### Jest（65 例）覆盖

RBAC 全五角色 + 匿名 + disabled；list 的分页包络、count/findMany 同一 `where` 与同一事务、
`blocker`/`blocked` 单侧过滤、`user` 双侧过滤（UUID 与文本）、`user` 不搜 email、
空关键词不加过滤、三个关键词 AND 组合、日期上下界、`2026-02-30` 与 `2026-13-01` 被拒、
默认排序、`createdAt_asc`、四个 nickname 键的 `nulls:last`、未知 sort 400、
page/pageSize 夹取、空结果 0 页、越界页、响应无 `id`、select 无 `include`、不触碰相邻域；
方向（`Alice→Bob` 与 `Bob→Alice` 都是独立行、绝不互换、复合键顺序正确）；
详情（成功、404 精确形状、无块的真实用户对也是 404）；隐私（递归键名扫描、email、
`passwordHash`、token、handle 字面量、服务层不读 `SocialAccount`）；审计（GET 不写）；
schema 契约（无单列 id 假设、无 migration、控制器恰好两条 GET 路由）。

### Playwright（33 例）覆盖

导航可见性与严格等值顺序、三个被拒角色看不到入口、ANALYST 可读；
页面标题与列头（含「不存在屏蔽 ID 列」）、行数与 PostgreSQL 独立计数一致；
`Alice→Bob` / `Bob→Alice` / `Carol→Alice` 三行、方向未被归一化（反向对的第一个单元格必须是不同的人）；
`user=Alice` 返回 3 条、`user=Bob` 2 条、`user=Carol` 1 条；UUID 精确匹配且部分 id 不降级为子串；
日期上下界含末日；排序切换；非法 sort 被 API 拒绝；
空态；清除筛选；分页（临时补 20 条填充数据，`try/finally` 清理）；查看跳转；
详情方向正确（正反两对都验）；详情显示双方 id 与时间；
历史诚实为空；未知对显示「屏蔽记录不存在」且不泄漏内部错误；
被拒角色直接被 API 拒绝（不只是隐藏导航）；读操作不写审计；
只读（无任何写控件，每行只有一个「查看」链接）；
隐私（API 响应体 + 渲染文本 + HTML 三重扫描）；响应体递归键名扫描且无合成 `id`；
加载态、失败重试、重试不整页刷新。

### Real E2E（§10g，60 项）覆盖

真实 HTTP + 真实 PostgreSQL。所有计数都通过**独立的 SQL 查询路径**
（`SELECT COUNT(*) FROM "Block" WHERE …`）得到，不用被测端点自证。

- RBAC 全五角色 + 匿名 + disabled
- 总数与 SQL 一致（= 3）；每行携带复合键且无合成 `id`
- `user` 双侧：`Alice` → API 3 = SQL 3；并独立算出
  「Alice 作为 blocker = 1」「作为 blocked = 2」，`1 + 2 = 3`——
  只查一侧的实现会返回 1，必然失败
- `blocker` 与 `blocked` 对同一人返回**不同**集合
- 日期上下界、闭区间、非法日期、`2026-02-30`
- 默认排序与 SQL 排序一致；`createdAt_asc` 与 SQL 最旧行一致；未知 sort 400
- 分页：两页不重不漏、合计等于 SQL 行数、越界页空且不改 total
- **方向**：SQL 确认两个方向各一行；API 正向报 `Alice` 为 blocker，反向报 `Bob` 为 blocker；
  两条绝不互相归一化；正向过滤只返回正向行（不存在倒置伪行）
- 未知对 404 `BLOCK_NOT_FOUND`，且响应体无 `data` 包络
- GET-only：`POST`/`PATCH`/`PUT`/`DELETE` 全部 404
- 隐私：list 与 detail 两个载荷各扫 handle 字面量、email、7 个敏感字段名；
  并反向确认夹具 handle 真实存在于库中
- 读操作不写审计；BLOCK 审计行确实为 0，历史诚实为空
- 清理：Block 表回到 0 行

---

## 7. Validation

| 项 | 结果 |
|---|---|
| `typecheck` | **exit 0**（六个 workspace 全部通过） |
| `lint` | **exit 0**（api `eslint "src/**/*.ts"` 无输出；两个 Next 应用 `✔ No ESLint warnings or errors`） |
| `build` | **exit 0**。`○ /blocks 4.7 kB / 111 kB`，`ƒ /blocks/[blockerId]/[blockedId] 3.92 kB / 110 kB` |
| `prisma validate` | **valid** 🚀 |
| `prisma migrate diff`（datamodel → DB） | `-- This is an empty migration.` = **零漂移** |
| `prisma migrate diff`（DB → datamodel） | `-- This is an empty migration.` = **零漂移** |
| `prisma migrate status` | 16 个迁移；`:5433` 缺 `_prisma_migrations` 的既有状态未变 |

---

## 8. Database

| 表 | C4 起始基线 | C4 结束 | 说明 |
|---|---|---|---|
| `Block` | **0** | **0** | 夹具自建自清 |
| `User` | 10 | 10 | |
| `Connection` | 0 | 0 | |
| `ExchangeRequest` | 0 | 0 | |
| `SharedSocialAccount` | 0 | 0 | |
| `SocialAccount` | 0 | 0 | |
| `Conversation` | 28 | 28 | 见 §9 |
| `Message` | 0 | 0 | |
| `AdminAuditLog` | 2 | 2 | C4 全程未新增一行 |
| `AdminUser` | 6 | 6 | |
| `AdminNote` | 0 | 0 | |
| `Report` | 1 | 1 | |

端口 4000 / 3001 均已释放；本次会话的临时脚本与日志已删除。

---

## 9. Known issues

### C4 introduced

**无。** C4 没有引入任何未解决的缺陷。

两处**由本阶段修掉的自身问题**（已修复，记录以备追溯）：

1. Playwright 用例 5 用 `getByRole("columnheader", { name: "屏蔽方" })`——
   Playwright 的 `name` 默认是**子串**匹配，因此它同时命中了「被屏蔽方」，
   触发 strict mode violation。改为 `{ exact: true }`。这不是产品缺陷，
   而是断言写法本身不够精确；修正后 33/33 通过。
2. Real E2E 的 C4 清理顺序：C4 会创建一个 `SocialAccount`（隐私夹具），
   而 C3 的零行断言要求 social-account 表归零。因此 C4 的清理被放在
   **C3 零行断言之前**，与 C3 当初撞上 C2 连接断言是同一类顺序陷阱。
   断言本身未被修改或弱化。

### pre-existing

1. **`pageSize is clamped to 100 rather than honoured verbatim`（B2 用户列表段，失败）**
   该断言要求 `items.length === 100`，即数据库里至少要有 100 个用户。
   本机数据库在脚本运行时只有 16 个用户，所以它在**任何**运行中都必然失败。
   它断言的是「一整页」而不是「pageSize 被夹取到 100」——与它自己的名字不符，
   是脚本断言写法问题，与 C4 无关。此条在上一阶段报告中已被记录为已知缺陷。

2. **`page 1 and page 2 return full, disjoint pages`（B2 用户列表段，失败）**
   同一类问题：它要求 `pageSize=10` 的两页都是**满页**，即至少 20 个用户；
   运行时只有 16 个，第二页 6 条。它的名字说的是「不重叠」，断言却额外要求「满」。
   同为数据量假设，与 C4 无关。

   这两条都位于 B2 段、都随数据库用户数变化而翻转，C4 不新增任何永久用户行。

3. **既有浏览器会话泄漏（未修）**：`admin-moderation.spec.ts` 与
   `admin-report-detail.spec.ts` 各创建一个 `Conversation` 却从不删除，
   每次全量 Playwright 泄漏 2 条孤儿会话。本次会话共跑了 3 次全量/准全量，
   泄漏 6 条，已按创建时间精确识别并删除，`Conversation` 回到 28。
   **未修改这两个 spec**——修复它们超出 C4 范围。

4. **`globalTeardown` 行为不稳定（未修）**：Windows worker 强制终止时它不运行，
   夹具残留；而它运行时又会删除它自己在 `globalSetup` 里播种的 7 个管理员角色账号
   （连带 6 条 `AdminUser` 与 1 条 OPEN `Report`）。本次它**运行了**，
   因此会话结束后 `User` 一度降到 3、`AdminUser` 为 0、`Report` 为 0。
   已通过重新执行同一份 `seed()` 恢复，数据库最终与 C4 起始基线逐行一致。
   这是既有夹具设计问题，不在 C4 范围内修复。

5. **`dashboard.todayNewUsers`**：上一阶段记录的另一条历史脚本问题。本次运行中
   它**通过**，未出现在失败列表里。

### environment-only

1. **Windows Playwright worker 退出缺陷**：完整套件结束后出现
   `worker-0 process did not exit within 300000ms after stop, force-killed it`。
   按项目既定判据（看 `passed` / `failedTests`，不看退出码）判定为环境产物；
   实测 `223 passed / 0 failed`。

2. **后台任务包装器偶发不返回**：本会话中若干次后台命令的进程已结束（端口释放、
   无残留进程）但包装器不返回。改用前台执行 + 日志落盘后恢复正常，
   与产品代码无关。

3. **并发运行造成的假失败**：中途一次运行出现
   `Transaction already closed … The timeout for this transaction was 5000 ms`，
   原因是同时有多个被中断的 Playwright 进程争用数据库与 API。
   干净重跑后该错误不再出现（223/223 通过）。

---

## 10. Stop

**C4 COMPLETE.**
**STOP.**
**Do not enter C5.**

未实现且**刻意未实现**的部分（属报告结论，不是待办）：
`blocks:write`、解封、创建/修改屏蔽、批量操作、风险评分、moderation workflow、
`SafetyService` 改造、用户端 Block API 改造、独立的 `BlockAuditRecord`。
