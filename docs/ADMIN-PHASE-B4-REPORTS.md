# Admin Phase B4 — Reports Queue & Report Detail

> 状态：**已完成**。零 schema 改动、零 migration。
> 前置：B1 Dashboard / B2 Users / B3 User Detail 均已完成且未回退。

---

## 1. 本阶段做了什么

B4 有两个目标，且第二个是**本轮才暴露出来的真实缺口**：

| # | 目标 | 结论 |
|---|---|---|
| B4.1–B4.2 | Reports 列表接口支持按原因 / 对象类型 / 举报人 / 被举报人 / 时间筛选 | 服务端完成 |
| B4.3 | 举报队列列表页增强（筛选栏、两种空状态、分页） | 前端完成 |
| B4.4 | **`/reports/[id]` 举报详情页** | **原本不存在，本轮新建** |

### 1.1 为什么详情页是缺口而不是"新增功能"

`reports/page.tsx` 在 B4 之前就已经把每一行的**举报人名**和「查看详情」按钮链到 `/reports/<id>`：

```tsx
<Link href={`/reports/${item.reporter.nickname ?? item.reporter.email}`} ...>
```

但 `apps/admin/src/app/` 下**只有 `reports/page.tsx`，没有 `reports/[id]/`**。
也就是说队列里每一条举报的链接都是 **404**。一个只能看列表、点进去必 404 的审核界面，
等于没有审核能力 —— 所以这不是"锦上添花的新页面"，是把断掉的链路接上。

---

## 2. 服务端（先做，因为前端要按它的形状写）

### 2.1 三个具名 select 常量

沿用 B2 确立的规则：**列表路径禁止 `include`**。`Report` 只有两个关系且都是 `User`，
一个裸 `include` 会把 `passwordHash` 带回每一个报告行。

```ts
REPORT_LIST_SELECT    // 队列行：reporter 无 status，reportedUser 带 status
REPORT_DETAIL_SELECT  // 详情：双方都带 status
REPORT_HISTORY_SELECT // 审核历史：刻意不含 ip / userAgent
```

`REPORT_HISTORY_SELECT` 不含 `ip`/`userAgent` 是**有意的**：这两个字段在专门的审计屏上是
合理的，但一条举报的审核历史关心的是"做了什么决定"，不是操作员当时坐在哪里。

### 2.2 `targetType` 是派生的，不是列

**`Report` 没有 `targetType` 列。** 有 `messageId` 就是消息举报，没有就是用户举报：

```ts
function deriveTargetType(messageId: string | null): "USER" | "MESSAGE" {
  return messageId ? "MESSAGE" : "USER";
}
```

前端 `targetTypeOf()` 镜像同一条规则，**单一来源**，所以徽章和筛选器不可能互相矛盾。

### 2.3 消息摘要是一个判别联合，不是 `null`

`Report.messageId` 是**裸 UUID、无外键**，所以一条举报可以比它指向的消息活得更久。
`messageSummary()` 因此返回：

```ts
| { available: true; id; content; type; createdAt; sender }
| { available: false; reason: "NO_MESSAGE" | "DELETED" }
```

三个状态在 UI 上读起来必须不同：正常显示内容 / 「该消息已被删除」/「这条举报没有关联消息」。
把它们都压成 `null` 会让"证据已不可得"和"渲染坏了"看起来一样。

### 2.4 未知 id → 404 `REPORT_NOT_FOUND`

不返回 `200 + { success: true, data: null }`。这与 B3 修 `userDetail` 时是同一条原则：
**不存在的资源是 404，不是成功的空值。**

---

## 3. 前端

### 3.1 列表页：默认状态从 `OPEN` 改成「全部」

B4 之前的默认是 `status=OPEN`。在真实数据集里每条举报都已被处理过，
所以**打开这个页面看到的第一个画面是一个空列表** —— 与"系统里根本没有举报"完全无法区分。

现在 `ALL` 是**纯 UI 概念，永不发给 API**：省略 `status` 参数就是"全部"。
发送 `status=ALL` 会被 API 400，因为 `ALL` 不是 `ReportStatus` 的成员。
（`smoke.test.mjs` 里有一条断言专门锁住这个 `filters.status !== "ALL"` 守卫。）

### 3.2 两种空状态必须不同

| 状态 | 文案 | 出路 |
|---|---|---|
| 筛选无结果 | 没有符合当前筛选条件的举报 | 给出「清空筛选」按钮 |
| 队列真的为空 | 系统中还没有任何举报 | 不提供按钮（没有可放宽的东西） |

用同一份文案会告诉操作员"你的筛选太窄"，而他其实根本没筛。

### 3.3 详情页 `/reports/[id]`

渲染六块：状态 / 对象类型徽章、举报人与被举报人（链到用户详情）、描述、
被举报消息、被举报人现状、审核历史、审核操作按钮。

两个必须分开的处理：

- **描述为空**是正常状态（举报人选择不展开说明）。显式写「举报人没有填写补充说明」，
  而不是留一个空档让人以为是渲染失败。
- **审核历史为空**同样显式说明。注意：`Report` **没有** `reviewedAt`/`reviewedBy`/resolution
  任何字段，**唯一的处理记录来源是 `AdminAuditLog`**（`targetType='REPORT' AND targetId=:id`）。
  渲染成"从未审核"在一条早于审计日志就存在的举报上会是错的。

### 3.4 状态处理与 B3 保持一致

| 情况 | 处理 |
|---|---|
| `UNAUTHORIZED` / `ADMIN_REQUIRED` / `ADMIN_INACTIVE` | `router.replace("/login")` |
| `REPORT_NOT_FOUND` | 独立的「举报不存在」屏（不是「加载中…」，也不是可重试错误） |
| 其它错误 | 显示错误 + 保留页面结构 |

`REPORT_NOT_FOUND` 走独立屏而不是可重试错误，是因为重试一个不存在的 id 永远不会成功，
把它做成"再试一次"会诱导操作员反复点一个不可能work的按钮。

---

## 4. 验证结果（全部真实执行）

| 门槛 | 结果 |
|---|---|
| API Jest | **18 suites / 335 tests 全过** |
| Admin 浏览器测试（reports 队列） | **8/8**（Test 20–27） |
| Admin 浏览器测试（report 详情页） | **9/9**（Test 30–38） |
| Admin 浏览器测试（reports 队列 + 详情页合并跑） | **17/17**，夹具 0 残留 |
| Admin 浏览器测试（users） | 21/21 |
| Admin 浏览器测试（user-detail） | 12/12 |
| Admin 浏览器测试（audit + dashboard + rbac） | 24/24（3 + 16 + 5） |
| **`npm run test -w apps/admin` 全量门槛** | **`status: "passed"` / 74 passed / 0 failed / `EXIT=0`（2.5m）** — 限流真因 + Test 20 竞态均修复后 |
| Admin smoke（静态契约） | **6/6** |
| 全仓 typecheck | exit 0（6 workspace） |
| 全仓 lint | exit 0 / 0 warning |
| API build | exit 0 |
| Admin build | exit 0，`/reports` 3.67 kB / 113 kB，**新增 `/reports/[id]` 2.68 kB / 112 kB（ƒ Dynamic）** |
| Web build | exit 0 |
| `prisma/schema.prisma` | **未改动** |
| migration 数 | **未变**（B4 零 schema 改动） |
| 数据库 | 夹具 0 残留 |

新增浏览器用例（`apps/admin/test/e2e/admin-reports-ui.spec.ts`）：

| # | 断言 |
|---|---|
| 20 | 队列落地在「全部状态」，不是一个空的 OPEN-only 视图 |
| 21 | 夹具行走完渲染（对象类型徽章 / 状态徽章 / 原因 / 描述） |
| 22 | 原因筛选缩到匹配行；且验证**大小写不敏感**（选 `Spam` 命中存 `SPAM` 的行） |
| 23 | 状态筛选是**服务端**执行的（每张可见徽章都等于筛选值） |
| 24 | 排除夹具的日期窗口 → 出现**可恢复**的空状态 + 「清空筛选」 |
| 25 | 「清空筛选」恢复未筛选列表 |
| 26 | 筛不到与系统为空**读起来不同** |
| 27 | 只读角色（ANALYST）看得到队列、看不到任何审核按钮，且有解释横幅 |

新增浏览器用例（`apps/admin/test/e2e/admin-report-detail.spec.ts`）：

| # | 断言 |
|---|---|
| 30 | 用户举报**不渲染消息块**（不是渲染一个空的证据区），徽章为「用户举报」 |
| 31 | 消息举报渲染消息正文 + 发送者昵称 |
| 32 | 软删除的消息读作「该消息已被删除」，**不与「没有关联消息」混同** |
| 33 | `messageId` 悬空（无 FK）时走删除分支：不是 500、不是空白、无未捕获异常 |
| 34 | 从未被审核的举报显式写「还没有审核记录」，不是空白区看起来像坏了 |
| 35 | 真实审核动作：状态徽章转 `REVIEWING`、历史出现、**审计行是真的人类行**（`actorType=USER` 且 `adminId` 等于执行者） |
| 36 | 未知 id → 独立「举报不存在」屏；不留「加载中…」，也不做成可重试错误；给返回入口 |
| 37 | 只读角色（ANALYST）能读完内容，但看不到任何审核按钮 |
| 38 | **队列里每行的详情链接真的能打开详情页**（这正是不建这个页面时的回归） |

> Test 38 是这一组里最重要的：队列的每一行都链到 `/reports/<id>`，
> 在整个 B4 的大部分时间里那个路由**不存在**。一个只有动作会 404 的队列不是审核工具。
> Test 33 次之：`Report.messageId` 没有外键，所以"举报比它指向的消息活得久"是**可达状态**而非数据损坏。

---

## 5. 本阶段踩到的坑（复用价值高）

### 5.1 `getByLabel` 的子串陷阱

筛选项 `举报人筛选` 是 `被举报人筛选` 的**子串**，所以
`getByLabel("举报人筛选")` **同时命中两个 input**，Playwright strict mode 报
`resolved to 2 elements`。必须 `{ exact: true }`。

> 注意与 B2 的区别：B2 里 `getByPlaceholder("搜索 email / nickname")` 的**子串匹配是被故意利用的**
> （新占位符向后追加就能兼容旧 helper）。这里是**必须避免**的。同一机制，两种用法。

### 5.2 下拉选项的 `value` 未必是数据库里的字面值

UI 的 reason 选项 value 是 `Spam`，夹具行里存的是 `SPAM`。
`selectOption("SPAM")` **匹配不到任何 option**，且**静默失败**（下拉保持原值）。
因为 API 的 reason 过滤是 `equals + mode: "insensitive"`，选 `Spam` 才能命中 `SPAM` 行。

### 5.3 静态 smoke 断言会随重写失效

`smoke.test.mjs` 原来有一条 `/\/admin\/reports\?status=/`，断言源码**总是**带 `status=`。
B4 故意改成"全部时省略"之后这条正则不再匹配。

**这不代表代码坏了，而是断言在描述旧行为** —— 已改写为 B4 的真实契约（7 个参数都有
`params.set`、`filters.status !== "ALL"` 守卫、`totalPages`、`T23:59:59.999Z` 补全、
两种空状态文案、`report-target-badge`）。

**教训**：改列表页的查询构造方式时，先 grep `test/smoke.test.mjs` 有没有相关正则。

### 5.4 全量 Playwright 会撞 API 限流

整套约 74 次登录（每次 = 2 个 API 调用）+ 每页多次抓取，**全部来自同一个 IP**。

**真正卡住的是 `POST /auth/login` 自己的 per-route 限额 50 次/分钟**，
不是全局的 120 —— 全局值在这里无关紧要。详见 §5.7（那里有隔离复现与正确修法）。

现象：某个用例的 `loginAndLand()` 失败，而**单独跑该 spec 时全过**。

**所以全量红 ≠ 代码回归。** 排查方法：把失败的 spec 单独跑一遍，过了就是限流/时序。
**但别就此收工** —— 本轮我就是用这条规则把真缺陷当成噪音，
绕了四次才找到 §5.7 的根因。规则只用于**分诊**，不用于结案。

> 修好之后不需要再靠这条规则了：`THROTTLE_MULTIPLIER` 已经让全量套件不再撞限流。
> 若它再次变红，**先当真实回归看待**。

### 5.5 Windows 上 worker 不退出会吞掉报告

**结论：这是 Playwright 1.63 + Node 22 在 Windows 上的既有缺陷，与本项目代码无关。**
（我一度把 §5.8 的竞态误判成它的成因，见下 —— 那个修正本身也是错的，已回退。）

**现象**：worker 跑完全部用例后不退出，CLI 永久挂住，`globalTeardown` **不执行**
（所以 `[e2e] removed ...` 那行不会打印），直到超时被强杀。报告里会出现：

```
Error: worker-0 process did not exit within 300000ms after stop, force-killed it
Error: worker-0 process did not exit within 300000ms after stop, force-killed it
Timed out waiting 600s for the test suite to run
  74 passed (10.0m)
  4 errors were not a part of any test, see above for details
```

**是间歇性的，而且和内容无关 —— 这是最关键的证据**：

| 跑的东西 | 有 Prisma？ | 结果 |
|---|---|---|
| 全量 74 条 | 是 | HUNG ×5、clean ×1 |
| `admin-rbac.spec.ts`（5 条） | **否** | **HUNG** |
| `admin-reports-ui.spec.ts`（8 条） | 是 | **HUNG** |
| `admin-users.spec.ts`（21 条） | 是 | HUNG |
| `admin-dashboard.spec.ts`（15 条） | 是 | clean |

**连一个完全没有 Prisma 的 spec 单独跑也会挂** → 排除 Prisma 泄漏、排除某个 spec 的代码、
排除我对 `admin-users.spec.ts` 的改动。**这是环境问题。**

**超时从哪来**（`node_modules/playwright/lib/runner/index.js`）：

```js
const timeout = +(process.env.PWTEST_CHILD_PROCESS_TIMEOUT || 5 * 60 * 1e3);
```

它按 **heartbeat** 判定：worker 还在发心跳就继续等，心跳停了满一个 timeout 才强杀。
所以 worker 不是死锁，而是**活着但不再推进**。

**可调**：`PWTEST_CHILD_PROCESS_TIMEOUT=15000` 能把等待从 300 秒压到 15 秒，
排查时非常好用（本节的对照组就是靠它跑出来的）。

**应对方式（不要试图修它）**：

- **看 `passed` 与 `failedTests`，不要看进程退出码。**
  `worker-0 process did not exit ... force-killed it` 与
  `N errors were not a part of any test` **都不是失败**，全部是关停产物。
- **跑测试一律重定向到文件**（见下），否则强杀会把输出一起带走。
- `globalTimeout` 设 **10 分钟**只是安全网；跑到上限说明该查，但**这个挂起本身就是已知的**，
  不必因为 `timedout` 就怀疑代码。

> **⚠️ 我在本轮的两个错误结论，都记在这里以免重犯**：
> ① 先把成因归给 `globalTimeout` 太小 —— 错，调大只是挪墙；
> ② 之后又归给 §5.8 的 Test 20 竞态 —— **也错**。当时看到一次 `passed (2.5m)` 就下了结论，
> 但那是间歇性的另一次投币结果。**对照组（无 Prisma 的 spec 同样挂）才是证据。**
> 教训：**"修了一个东西之后它好了一次"远不足以证明因果**，尤其在现象本身是间歇的时候。


### 5.6 写夹具前先读 schema —— 两个当场被 `tsc` 拦下的假设

详情页的夹具要造一条真实消息，写的时候凭印象用了两个**不存在的字段**：

| 写了 | 实际 | 正确写法 |
|---|---|---|
| `conversation.participants` | 关联叫 `members`，连接表是 `ConversationMember`（复合主键 `conversationId+userId`） | `members: { some: { userId } }` |
| 以为要传 `receiverId` | `Message` **只有** `senderId`（会话承载接收方） | 只传 `senderId` |

好消息是 `tsc --noEmit` **当场报错**（`'participants' does not exist in type 'ConversationWhereInput'`），
没有变成运行期才炸的静默问题。**教训**：夹具直接写 Prisma 时，先
`awk '/^model X /,/^}/' prisma/schema.prisma` 看一眼真实形状，
本仓库的数据模型有好几处和"听起来应该长这样"不同（另见 §3.3 的 `Report` 无 `reviewedAt`）。

另一个**不是**错误只是容易误判的点：夹具账号的 `nickname` 是 `PW superadmin` / `PW support`
（`seed()` 写的是 `` `PW ${key}` ``），而页面渲染的是 `nickname ?? email`。
所以断言发送者时应该找 **`PW support`**，不是 email —— 写 email 会失败，
而且看起来像是"页面没渲染出人"。这反而是个有用的断言：它同时证明了
**昵称优先于 email** 这条渲染规则。

### 5.7 `npm run test` 因 API 限流假红 —— 真因是 per-route `@Throttle`，不是全局 limit

**这是本轮最有价值的发现，而且它连续骗了我四次。**

#### 症状

`npm run test -w apps/admin` 反复红，失败都在 `loginAndLand()` 等不到 `仪表盘` 标题，
现场证据（`error-context.md`）明确指向限流：

```
- paragraph: "HTTP_ERROR：ThrottlerException: Too Many Requests"
```

凭据是对的、表单没错，报的就是限流。三条独立证据印证它不是回归：

1. 失败的是**登录落地**这一步，不是权限断言；
2. 同一 spec 的**下一条**（同样要登录）**立刻通过** —— 真回归不会隔一条就好；
3. 单独跑该 spec → **12/12 全过，每条约 1 秒，零 flaky**。

#### 四个被推翻的错误诊断（记录下来，避免重走）

| # | 当时的判断 | 为什么是错的 |
|---|---|---|
| 1 | 限流是暂态的，重试就好 | 桶是**持续**被打的，重试落在同一个窗口里照样 429 |
| 2 | 加 `retries: 1` 就能吸收 | 重试只是重跑测试，请求照发，窗口没变 |
| 3 | `globalTimeout` 太小 | 与限流无关；它只影响截断，不影响 429 |
| 4 | `ConfigModule` 加载 `.env` 太晚，`throttleLimit()` 读到默认值 | 实测 `THROTTLE_LIMIT` 在 `dotenv` 之后确实可见，环境变量没问题 |

**更糟的是我在 helper 里造过一个假阳性**：`dashboard.or(page.getByText(/Too Many Requests/))`
的竞速分支会在**仪表盘只是还没渲染出来**时误触发，凭空伪造出一条 429 错误信息。
用一个临时探针 spec 抓真实流量才看清 —— `/auth/login` 实际返回的是
**`200 {"success":true,...}`**，根本没有 429。删掉那个分支后，
`admin-user-detail.spec.ts` 单跑立刻 **12/12 全过，含此前必挂的 Test 11**。

#### 真正的原因

`apps/api/src/auth/auth.controller.ts` 里，`POST /auth/login` 有**自己的**限流：

```ts
@Throttle({ default: { limit: 50, ttl: 60000 } })   // 50 次/分钟/IP
```

全仓共 **17 处**这样的 per-route 覆盖。而 `app.module.ts` 里的
`THROTTLE_LIMIT`（默认 120）**只改全局默认值，永远碰不到这些覆盖**。
整套约 74 条用例条条要登录，跨过 50/min 就吃真 429 —— 所以调大
`THROTTLE_LIMIT` 那次改动**在原理上就不可能有用**，这也解释了为什么实测毫无变化。

**隔离复现**（`POST /auth/login` 连打 160 次，同一分钟内）：

| 模式 | 结果 |
|---|---|
| 只设 `THROTTLE_LIMIT=1000`（旧做法） | 第 51 次起 429 |
| **不设** `THROTTLE_MULTIPLIER`（=1） | **50 × 401 → 110 × 429** ← 就是这个 bug |
| **`THROTTLE_MULTIPLIER=100`** | **160 × 401，0 × 429** |

50 这个数字精确对上 login 的 `limit: 50`，是该原因的直接指纹。

#### 修法

**不逐个改 17 个装饰器，也不动生产限流**，而是在守卫里统一放大：

| 文件 | 改动 | 理由 |
|---|---|---|
| `apps/api/src/common/http-throttler.guard.ts` | 重写 `handleRequest(requestProps: ThrottlerRequest)`，把已解析的 limit 乘 `THROTTLE_MULTIPLIER()` | `ThrottlerGuard.canActivate` 解析完 per-route limit 后**只**通过这个钩子下传，因此一处覆盖全部 17 个覆盖点 |
| `.env` | 加 `THROTTLE_MULTIPLIER=100` | 只影响本机测试；**默认 1 = 行为完全不变**，可安全上线 |
| `apps/api/src/app.module.ts` | 修正过时注释 | 原文把 `THROTTLE_LIMIT` 说成能解决浏览器套件，是错的 |

实现要点：

- **只乘 limit，不乘 ttl**。同时放大窗口的话有效速率不变，等于没改。
- `Math.max(1, Math.floor(limit * multiplier))` —— 保证倍率小于 1 时也不会把
  limit 压到 0 从而彻底锁死路由。
- 倍率**未设置或非法时返回 1**，与改动前逐字节等价。

#### 上一轮的记录是错的

本节此前写「修法是 `retries: 1` + `loginAndLand` 竞速判 429」——**两者都已回滚**，
且上面已说明它们为什么无效甚至有害。`retries` 现为 **`0`**，
`loginAndLand` 回到"提交登录 → 等仪表盘标题"的直白写法。
当时观察到的 `73 passed / 1 flaky / EXIT=0` 是**撞运气**：那一轮的登录恰好没跨过 50。
**不要**把一个侥幸通过的退出码当成问题的解决。

#### 为安全而上锁：Docker 拿不到这个开关

`docker-compose.yml` 的 `api` 服务用的是**显式白名单** `environment:`，里面**没有**
`THROTTLE_MULTIPLIER`（也没有 `THROTTLE_LIMIT`）。所以生产容器**不可能**被这个开关放宽 ——
这正是想要的结果。实测无该变量时：

| 输入 | `throttleMultiplier()` | 全局 limit |
|---|---|---|
| 未设置 / `""` / `"abc"` / `"0"` / `"-5"` | **1** | **120** |
| `"100"` | 100 | 120 |

即：**非法值一律回落到 1**，拼错不可能意外关掉限流；只有本机 `.env` 显式设为 100 才放宽。

#### 顺带暴露的第二件事

`reuseExistingServer: true` 时 Playwright 用 health 端点判存活，而**限流期间 health 也返回
429**（非 200）→ Playwright 判定服务没起，于是自己再起一个 → `EADDRINUSE :::4000`。
**跑测试前手起的 API 记得关掉**，别和 webServer 抢 4000。

### 5.8 Test 20 的夹具竞态 —— 只在全量跑才输的那个

限流修好后，全量跑在第 74 条（`admin-users.spec.ts` Test 20：内部备注输入框）挂了一次。
**先排除自己的改动**：单跑该 spec → **21/21 全过**，Test 20 只用 **1.0s**。
再直接查库：`body = "phase B2 browser note"` 的备注数是 **0** —— 备注**根本没写进去**，
不是写错了行。**这个"查真实副作用"的步骤是关键，它把问题从"断言写错了"改判成"动作没发生"。**

**真因**：备注输入框的值存在一个**按行 id 索引的 state map** 里
（`apps/admin/src/app/users/page.tsx`，`note[item.id]`）。而 Test 20 用的是**裸
`applyFilters(page)`** —— 它点「搜索」后**不等待响应**就返回。于是测试在筛选后的行还没渲染
时就往输入框打字，字符落进**上一行**的 state 槽位；新行渲染出来时输入框是空的，
点「备注」什么也没提交。

全量跑时前 73 条把服务拖慢，这个竞态才输掉；单跑永远赢 —— **所以必须按机制修，不能靠重跑。**

**修法**（用的是文件里**本来就有的** helper）：

```ts
await applyFiltersAndWait(page, "search=pw.users.09");   // 等那条带筛选条件的响应
const targetRow = userRows(page).first();
await expect(targetRow).toContainText(`${PREFIX}09@example.test`);  // 限定到目标行
await targetRow.getByPlaceholder("写一条内部备注…").fill("phase B2 browser note");
await targetRow.getByRole("button", { name: "备注", exact: true }).click();
```

同时把 `target!.id` 换成显式抛错的空值检查。

**修复后**：Test 20 在全量跑里只用 **1.1–1.2s**（此前是 15.1s 超时）—— 竞态确实消除了。

> **不要把 §5.5 的 worker 挂起归因到这个竞态。** 我当时那样写过，**是错的**：
> 修掉竞态后确实见过一次 `status: "passed"` 的干净跑（`74 passed (2.5m)`），
> 但后续重跑又是 `timedout`，而**一个完全没有 Prisma、我从未改过的 spec 单独跑同样会挂**。
> 那一次干净跑是间歇性的投币结果，不是因果。详见 §5.5 的对照组。

**同类风险排查**：全文件 21 处 `applyFilters`，但**只有 Test 20 会往输入框打字**；
其余各条都只是断言 DOM，Playwright 的自动等待能兜住。所以不需要全量改写。

**教训**：
- **「单跑全过」不是「没问题」的证据**，只说明竞态没被触发 —— 这一点仍然成立，
  而且它就是定位这个 bug 的入口。
- **「改完就好了」也不是因果证据**，尤其当现象本身是**间歇性**的时候。
  要证明因果，得有一个**对照组**（这里是无 Prisma 的 spec 也照样挂）。


---

## 6. 未做 / 需显式批准的事项

> **修正（本轮）**：本节原先写的「`apps/admin` 的浏览器测试尚未纳入 `npm run test` 的硬门槛」
> **是错的**。`apps/admin/package.json` 的 test 脚本一直是
> `node --test ./test/smoke.test.mjs && playwright test` —— **Playwright 早就在门槛里**，
> 而且是 `&&` 串联，失败会真的 fail。之前的记录写错了，已删除。
> 真正的问题不是"没接进去"，而是**接进去了却不可靠地变红**（见下）。

1. **`npm run test`（admin）此前会因 API 限流偶发假红** —— 本轮已修。
   真因是 `login` 的 **per-route `@Throttle({ limit: 50 })`**，不是全局 120；
   用 `THROTTLE_MULTIPLIER`（默认 1 = 不变）统一放大。全量实测 **74 passed / 0 failed**。
   详见 §5.7。
2. **`moderation:read` / `moderation:write` 权限依然零路由使用**（B5 范畴）。
3. 仍未做：CSRF token、列表 email 脱敏、`/admin/admins`。

> 曾经列在这里的「举报详情页没有 Playwright 用例」**已关闭**：
> `apps/admin/test/e2e/admin-report-detail.spec.ts`（Test 30–38，9/9 通过）。
