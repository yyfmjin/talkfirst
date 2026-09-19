# Admin Phase B2 — Users Management 实施记录

> 落地日期：2026-09-17 · 依据：`docs/ADMIN-PHASE-B-READINESS-AUDIT.md` 与 B1 已验证基线
>
> 范围严格限定在 B2 Users。**没有进入 B3/B4/B5**，没有修改 Prisma schema，没有生成 migration，
> 没有动 `UserStatusScheduler` / `SafetyService` / RBAC matrix / `AdminGuard` / `PermissionGuard` /
> SYSTEM Actor，没有把 `POST /admin/users/:id/status` 改成 `PATCH`。

---

## 1. 修改文件清单

| 文件 | 改动 |
| --- | --- |
| `apps/api/src/admin/admin.service.ts` | `AdminListQuery` 扩到 8 个参数；新增 `USER_SORT_ORDERS` 白名单、`USER_LIST_SELECT` 允许列表、`DEFAULT_USER_SORT`、`invalidQuery`、`resolveUserSort`、`daysInMonth`；重写 `searchUsers()`，新增 `buildUserWhere` / `parseDateBoundary` / `clampPage` / `clampPageSize` |
| `apps/api/src/admin/admin.controller.ts` | `GET /admin/users` 接收新参数并原样转发（默认值/校验/白名单全部留在 service） |
| `apps/api/src/admin/admin-users.spec.ts` | **新增**，51 个用例 |
| `apps/admin/src/app/users/page.tsx` | 在现有页面增强：统一搜索、状态/国家/日期筛选、排序、分页、空/加载/错误三态、请求序号防覆盖、状态徽章、创建时间与最近活跃 |
| `apps/admin/test/e2e/admin-users.spec.ts` | **新增**，20 个浏览器用例（含 25 个隔离夹具用户） |
| `apps/admin/test/smoke.test.mjs` | **新增**一条断言；**未删除任何旧断言** |
| `scripts/phaseA-rbac-verify.mjs` | 新增 2d 节（53 条真实 HTTP + 真实 SQL 校验）；`call()` 增加 429 退避重试 |

**未修改**：`prisma/schema.prisma`（mtime 仍是 15:15:30）、`prisma/migrations/*`（仍是 16 个）、
`permissions.ts`、`admin.guard.ts`、`permission.guard.ts`、`user-status.scheduler.ts`、
`safety.service.ts`、`apps/admin/test/fixtures/*`。

---

## 2. API query parameters

`GET /api/v1/admin/users` · 权限 `users:read` · 守卫链不变。

| 参数 | 取值 | 行为 |
| --- | --- | --- |
| `search` | 任意字符串（截断到 64） | 首选关键词：email / nickname 模糊（大小写不敏感）+ 完整 UUID 精确匹配 id |
| `q` | 同上 | **B2 之前的旧参数，保留可用**；`search` 存在时以 `search` 为准 |
| `status` | `ACTIVE` / `DISABLED` / `SUSPENDED` / `BANNED` / `ALL` | 等值过滤；**非法值忽略并视为 ALL（沿用既有兼容行为）** |
| `country` | 两位国家代码 | `User.countryCode` 等值匹配；自动大写；**非两位字母的值忽略** |
| `createdFrom` | ISO 8601 日期或日期时间 | `createdAt >= createdFrom` |
| `createdTo` | ISO 8601 日期或日期时间 | `createdAt <= createdTo`（**字面 lte，不做隐式补全天**） |
| `sort` | 8 个白名单键之一 | 见 §6；**非法值 400，绝不静默回退** |
| `page` | 1–1000 | 越界截断（0 / 非数字 → 1） |
| `pageSize` | 1–100 | 越界截断（0 / 非数字 → 20，沿用既有行为） |

非法日期与非法 sort 的响应沿用项目既有参数错误信封（与 `common/validation.pipe.ts` 同构）：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "details": { "createdFrom": ["createdFrom must be an ISO 8601 date or date-time"] }
  }
}
```

**没有引入新的错误码体系**，客户端仍只需一个「你的输入有问题」分支。

---

## 3. API response schema

```jsonc
{
  "success": true,
  "data": {
    "items": [{
      "id": "…", "email": "…", "nickname": "…|null",
      "countryCode": "US|null", "status": "ACTIVE",
      "isAdmin": false,
      "bannedAt": "…|null", "banReason": "…|null", "suspendedUntil": "…|null",
      "createdAt": "…", "lastActiveAt": "…|null"
    }],
    "total": 168,
    "page": 1,
    "pageSize": 20,
    "totalPages": 9
  }
}
```

**纯加法**：`items` / `total` / `page` / `pageSize` 全部保留原名原义，只新增 `totalPages`。

---

## 4. search 实现

```ts
const keyword = (query.search ?? query.q ?? "").trim().slice(0, 64);
OR: [
  { email:    { contains: keyword, mode: "insensitive" } },
  { nickname: { contains: keyword, mode: "insensitive" } },
  ...(UUID_RE.test(keyword) ? [{ id: keyword }] : []),   // 精确，不模糊
]
```

- 关键词为空 → **完全不生成 `OR`**（不是生成一个恒真条件）。
- `id` 子句只在关键词**本身是一个合法 UUID** 时才出现。`id` 是 uuid 列，`contains` 在 Prisma 层就无法表达，
  而前缀匹配会悄悄返回无关行；所以只做精确匹配。
- 真实 E2E 同时验证了「完整 UUID → 恰好 1 行」与「UUID 前缀 → 退化为文本搜索且与 SQL 一致」。

---

## 5. filter 实现

`buildUserWhere()` 是唯一的 where 构造点，`count` 与 `findMany` **共用同一个对象**（有专门断言），
因此 `total` 与当前页永远描述同一集合：

- `status`：`USER_STATUSES.includes(status)` 才加入 `where.status`，否则不加（= ALL）。
- `country`：`/^[A-Z]{2}$/` 通过才加入 `where.countryCode`，先 trim + 大写。
- 日期：`createdFrom` → `gte`，`createdTo` → `lte`，两者可单独或同时存在；都不传则**不生成 `createdAt` 子句**（全部时间）。

**没有任何 JS 侧过滤**：不存在「先取一页再筛掉几行」的写法，`count` 与 `findMany` 都走数据库。

---

## 6. sort whitelist

```ts
export const USER_SORT_ORDERS = {
  createdAt_desc:    { createdAt: "desc" },
  createdAt_asc:     { createdAt: "asc" },
  lastActiveAt_desc: { lastActiveAt: { sort: "desc", nulls: "last" } },
  lastActiveAt_asc:  { lastActiveAt: { sort: "asc",  nulls: "last" } },
  nickname_asc:      { nickname: "asc" },
  nickname_desc:     { nickname: "desc" },
  status_asc:        { status: "asc" },
  status_desc:       { status: "desc" },
} as const satisfies Record<string, Prisma.UserOrderByWithRelationInput>;
```

客户端字符串 → 白名单键 → Prisma `orderBy`，**字符串永不直传**。未知键 → 400。

### 为什么 `lastActiveAt` 需要 `nulls: "last"`

这是 B2 过程中真实发现并修掉的问题：PostgreSQL 对 `ORDER BY … DESC` 的默认是 **NULLS FIRST**，
所以朴素的 `{ lastActiveAt: "desc" }` 会让「最近活跃 倒序」把**从未活跃过**的账号排在最前面 ——
与标签承诺的正好相反。可空列按「最近」排序，只有把空值放到另一端才有意义。
两个方向都加了 `nulls: "last"`，浏览器测试与真实 E2E 各自独立验证。

---

## 7. pagination 与 §8 totalPages

- `skip = (page - 1) * pageSize`、`take = pageSize`，边界 1–1000 / 1–100 与 B2 之前完全一致。
- `totalPages = Math.ceil(total / pageSize)` —— **`total = 0` 时是 `0`，不是 `1`**。
  前端把 `0` 当作「没有页」：不渲染分页条、不渲染「第 X / Y 页」、只显示空状态。
  这样 API 与 UI 对同一件事只有一个说法，不会出现「第 1 / 0 页」。
- 分页条在 `total > 0` 时**始终渲染**，靠按钮自身的 `disabled` 表达首/末页，
  这样「只有一页」和「翻页坏了」看起来不一样。

---

## 9. 敏感字段保护

- `USER_LIST_SELECT` 是具名常量，11 个字段逐一列出；**没有 `include`**，所以任何 relation 都不可能顺带返回。
- Jest 的 mock 会**按 service 实际传入的 `select` 投影**夹具行（夹具本身带 `passwordHash` / `refreshToken`），
  所以一旦有人把 `passwordHash: true` 加进 select，值就会出现在响应里并让深度扫描失败 ——
  而不是因为夹具里本来就没有而「碰巧通过」。
- 三层验证：Jest 深度 key 扫描 + bcrypt/JWT 形状正则；浏览器测试对 `main` 文本与真实 HTTP 响应各扫一遍；
  真实 E2E 再对真实响应扫一遍 `passwordHash/tokenHash/refreshToken/accessToken/ip/userAgent/oauth/secret`。

---

## 10. RBAC

| 角色 | `users:read` | `users:write` | 状态操作能力 |
| --- | --- | --- | --- |
| SUPER_ADMIN | ✓ | ✓ | 全部 5 个动作 |
| MODERATOR | ✓ | ✓ | activate / disable / suspend / unban（**不能永久封禁**） |
| SUPPORT | ✓ | ✓ | activate / disable |
| ANALYST | ✓ | ✗ | 无 |
| CONTENT_MANAGER | ✓ | ✗ | 无 |

`permissions.ts` 与 `ROLE_ALLOWED_STATUS_ACTIONS` **一行未改**。列表增强没有给
ANALYST / CONTENT_MANAGER 增加任何写能力 —— 既有测试与新增测试都钉住了这一点。

---

## 11–13. 测试数量与结果

| 层 | B1 基线 | 现在 | 结果 |
| --- | --- | --- | --- |
| API Jest | 15 suites / 167 | **16 suites / 218**（+51） | 全通过 |
| Admin smoke (`node:test`) | 3 | **4**（+1） | 全通过 |
| Admin Playwright | 29 | **50**（+21） | 全通过 |
| Web (`node:test`) | 5 | 5 | 全通过 |
| Real E2E (`phaseA-rbac-verify.mjs`) | 96 | **149**（+53） | 全通过 |

**没有任何旧测试减少或被删除。** `admin-rbac.spec.ts` / `admin-user-detail.spec.ts` /
现有 status E2E / 现有 Audit E2E 全部原样通过，未做任何同步修改。

### Jest（51 项）覆盖

5 角色读取 + 控制器元数据 + PermissionGuard 放行 + 无身份拒绝 + **升级列表不得扩大写权限**；
分页 skip/take 与回显、`count` 与 `findMany` 使用同一 where、`totalPages` 边界（20/20→1、21/20→2、0→0）；
search 三种（email / nickname / 完整 UUID）+ 前缀不是 id 检索 + `q` 兼容 + `search` 优先 + 空关键词不加 OR + 超长截断；
四种 status + DISABLED 仍是一等状态 + 非法 status 忽略 + 大小写不敏感；
country 等值 + 小写归一 + 非法忽略；`createdFrom`/`createdTo` 各自与组合 + 无日期不加子句 +
**非法日期 400 且带字段名** + **`2026-02-30` 这类不存在的日期必须被拒（JS 会静默滚到 3 月）** + 闰日放行 + 校验发生在开事务之前；
8 个 sort 逐一映射 + 省略 sort 保持旧默认 + **`nulls: "last"`** + 非法 sort 400 + 白名单是通往 orderBy 的唯一路径；
page/pageSize 边界；空结果是 `[]` 与 0 而不是 null；响应保留全部旧字段；
select 是显式允许列表且无 include、字段集合精确相等、深度扫描无密钥、无 relation；
原有 `POST …/status` 动作集与审计不变、角色矩阵不变、读列表不写审计、一次事务两条查询零写入。

### Playwright（20 项）覆盖

页面打开并显示真实总数（渲染行数 ≤ 20）；搜索 email / nickname / 完整 id；UUID 前缀不当作 id；
状态筛选逐一对齐数据库且**每行徽章与筛选一致**；国家等值匹配；创建时间区间**两端闭区间**
（`createdTo` 当天必须被包含，这是「前端补全到当日末尾」的关键验证）；排序四字段两方向 + 选项数量固定；
分页 `第 1 / 2 页` → `第 2 / 2 页` 且首末页按钮 disabled；空结果显示「暂无用户」且**绝不出现「第 1 / 0 页」**；
真·空库与筛选空是两种文案；重新筛选时页面结构不塌陷；**慢的旧响应不能覆盖新响应**；
失败显示安全文案（不含 Prisma 堆栈）且重试可恢复；
5 个角色各自的控制可见性（SUPER_ADMIN / MODERATOR / SUPPORT 写，ANALYST / CONTENT_MANAGER 只读）；
每行有状态徽章与两个时间戳、空值显示 `-` 而不是 null；列表与真实 HTTP 响应都不含密钥；
内部备注仍可写并真的落库。

### Real E2E（53 项）覆盖

5 角色 200；search 与 SQL 同谓词同结果、完整 UUID 恰 1 行、前缀退化为文本搜索；
`q` 兼容、`search` 优先；四种 status 逐一对独立 SQL 计数、非法 status 回退 ALL；
country 等值 / 小写归一 / 非法忽略，三者都对齐 SQL；日期下界、上界、闭区间、反向区间、无时间界，全部对齐 SQL；
非法日期与非存在日期均 400 且**不泄漏驱动错误或堆栈**；
5 种 sort 的**整页有序性**（不是只看首元素）+ `lastActiveAt` 两方向的空值位置 + 两个方向与 SQL 两端一致 + 非法 sort 400 + 省略 sort 保持旧默认；
page 1 / page 2 满页且不相交、`total` 跨页稳定、`totalPages` 是 `total/pageSize` 的上取整、
**超大 page 返回空列表而非报错或重复**、未过滤 total/totalPages 对齐 SQL、pageSize 被截断到 100；
深度扫描 8 个禁止字段、无 relation、无 bcrypt/JWT 形状值、读列表不写审计行。

---

## 14–19. 验证门槛

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | **exit 0**（6 个 workspace，含 admin） |
| `npm run lint` | **exit 0**，0 error 0 warning |
| `npm run build` | **exit 0**；`/users` 4.03 kB / 113 kB，`/users/[id]` 2.38 kB / 112 kB |
| `prisma generate` | **exit 0** |
| `prisma validate` | **valid** |
| `prisma migrate status` | **16 migrations, up to date** |
| `prisma migrate diff` | **`-- This is an empty migration.`** |
| `npm run test`（全仓） | **exit 0 / 171s（冷启动）** 与 **exit 0 / 162s（复用已起服务）**；admin smoke 4/4 → Playwright **50 passed** → API Jest **16 suites / 218** → web 5/5 |

全仓 `npm run test` 共跑通两次**前台**运行，两次都带 `[e2e] removed 6 admin role fixture user(s)`
（即 `globalTeardown` 与 webServer 收尾都执行了）。另有一次**后台**运行的偶发不退出，未复现，
见 §21 第 8 条（非 B2 引入）。

---

## 20. 数据库验证结果

| 项 | 值 |
| --- | --- |
| `User` | **168**（与 B1 基线一致，夹具全部回收） |
| `AdminUser` | **9**（Playwright 自建的 CONTENT_MANAGER 夹具已删除） |
| `prisma/schema.prisma` mtime | **15:15:30**（早于 B2 开始） |
| migrations | **16 个目录**，无新增 |
| schema drift | **无** |

---

## 21. 未解决问题

1. **`country` 非法值的策略是「忽略」，与 `status` 一致。** `country=USA` 不会返回空列表，而是不加国家过滤。
   理由：项目既有的 query 参数策略就是「不认识的值忽略」，且一个永远匹配不到任何行的代码返回空列表
   更容易被误读成「这个国家没有用户」。已在 Jest 与真实 E2E 中各钉一条断言。若后续要求严格，
   改成 400 只需在 `buildUserWhere` 里换一个分支。
2. **`createdTo` 是字面的 `lte`，不做隐式补全天。** 前端 `<input type="date">` 只给出 `YYYY-MM-DD`，
   所以控制台显式发送 `T23:59:59.999Z`。这是有意为之：API 保持字面语义、行为可在 SQL 层验证，
   补全逻辑留在唯一知道「用户选的是一个日期而不是一个时刻」的地方。代价是时区按 UTC 处理，
   若将来要求按管理员本地时区补全，需要在前端改成带偏移量的时间串。
3. **`lastActiveAt` 的排序语义是 B2 新引入的**（B2 之前列表只有 `createdAt desc`），
   因此 `nulls: "last"` 不是对既有行为的改变，而是对这个新排序的定义。已同时用浏览器与真实 E2E 验证。
4. **`search` 与 `q` 同时存在时 `q` 被忽略。** 这是需求指定的优先级；`q` 单独使用时仍然有效，
   真实 E2E 对两种情况都有断言。
5. **真实 E2E 脚本现在会在遇到 429 时退避重试（最多 4 次 × 15s）。** 该脚本本身是一次约 85 次请求的
   突发，而 API 的限流是 120 次/分钟/IP；不重试的话，一分钟内连跑两次会得到一屏假失败。
   限流本身是产品行为，未做任何修改。被限流的请求从未进入 handler，重试不会重复写入。
6. **B3 仍待决定的事项**（`docs/ADMIN-PHASE-B-READINESS-AUDIT.md` §12-A / §12-B）：
   `POST` 是否新增 `PATCH` 别名、状态词表是否统一。B2 **没有**把 `POST` 改成 `PATCH`。
7. **`SafetyService.recordAutoFlag()` 的注释与实现矛盾**（非 Admin 模块，B2 未触碰，见审计报告 §12-G）。
8. **全仓 `npm run test` 偶发在「全部通过」之后不退出（观察 1 次，未复现；非 B2 引入）。**
   现象（唯一一次）：**后台启动**的冷启动全仓 `npm run test`，Playwright 50 条全部 `ok` 之后打印两次
   `Error: worker-0 process did not exit within 300000ms after stop, force-killed it`，父进程到 23 分钟
   仍未返回，最后手动 `taskkill /PID <根 PID> /T /F` 收场；进程树里 Playwright CLI 仍活着，并仍挂着
   它自己拉起的 `node dist/main.js`（:4000）与 `next start --port 3001`。
   **日志证明的因果顺序与直觉相反**：该次日志有 `[e2e] seeded 6 admin role fixture(s)`，但**没有**
   `[e2e] removed 6 admin role fixture user(s)` —— 即 `globalTeardown` 与 webServer 收尾**根本没有执行**。
   所以是 **worker 先不退出 → CLI 卡住 → 两个服务作为后果被遗留**，而不是「服务没被杀干净导致 CLI 卡住」。
   **未能复现**：随后两次**前台**全仓运行都干净退出，且都带 `removed 6 admin role fixture user(s)` ——
   `exit 0 / 171s`（冷启动，Playwright 自建两个服务）与 `exit 0 / 162s`（复用已起服务），
   两次均为 Playwright 50 passed、API Jest 16 suites / 218 passed、web 5/5、端口释放。
   另外单独跑 1 条用例的冷启动完整走了 `Terminating the WebServer` → `Terminated the WebServer`，
   端口释放 —— 说明 Playwright 的 webServer 收尾本身是好的。
   **结论**：偶发的 worker 退出问题，与 B2 的 spec 无关（`admin-users.spec.ts` 的 `afterAll` 与既有
   `admin-dashboard.spec.ts` 一样调用 `prisma.$disconnect()`；且复用模式下**同一批 50 条 spec** 干净退出）。
   未证实的机制不做断言。若再次遇到：`taskkill /PID <npm 根 PID> /T /F`。
   注：`webServer.gracefulShutdown` **在 Windows 上被忽略**（Playwright 类型注释原文：
   "Windows doesn't support SIGTERM and SIGINT signals, so this option is ignored on Windows"），
   因此它不是一个可用的修法。
