# P0-04 — 隐私设置：现状核对（2026-10-04）

> 任务：Profile Privacy —— 至少支持 avatar / age / city / language / interests / personality /
> friendship needs / custom tags 的可见性切换，状态为 PUBLIC / CONNECTIONS_ONLY / PRIVATE，且
> **服务端**必须过滤，不能只靠前端隐藏。
>
> **结论：已实现，本轮不需要改代码。** 下面是逐条核对，以及唯一一处我建议补的测试。

---

## 1. P0-04 的七条要求 → 代码与测试

| # | 要求 | 实现 | 证据 |
|---|---|---|---|
| 1 | 默认采用安全合理的隐私策略 | 缺 `ProfileFieldVisibility` 行 = `DEFAULT_FIELD_VISIBILITY = PUBLIC`；而**账号身份字段永久不可切换**（`email` / `passwordHash` / `emailVerified` / `isAdmin` / `status` / `banReason` / `id` / 审计与关系字段） | `profile-visibility.constants.ts:40`、`:59-72`；白名单注释里写明"永久不可切换"的理由 |
| 2 | Profile API 必须在**服务端**过滤 | `UsersService.getPublicProfile` 逐个字段过 `canViewField`：`age` 挂在 `birthDate` 的可见性上、`city`、`gender` 各自由自己决定；属性走 `filterAttributesForViewer` | `users.service.ts:182-198`、`:232` |
| 3 | 不能只依赖前端隐藏 | 同上；前端 `/me/visibility` 只是写配置，读路径一律服务端决定 | `users-public-profile.spec.ts`（4 例：净化输出、拉黑、非 ACTIVE、本人） |
| 4 | Discover API 不能泄露 private 字段 | Discover **复用同一个判定点**，不是第二套实现 | `discover.service.ts:351-352`；`discover-privacy.spec.ts` 7 例 |
| 5 | Chat 中查看资料不能绕过 | 聊天里点开的是同一个统一资料卡，读的是同一个 `GET /users/:id` | 无独立读路径可绕过 |
| 6 | Moments 点头像不能绕过 | 同上 | E2E `profile.spec.ts:418`「动态作者头像：打开统一的资料卡」 |
| 7 | Admin 是否可见遵守现有权限 | Admin 走自己的 `AdminService` 读路径 + 权限矩阵（22 项权限），与会员侧可见性正交 | `admin/permissions.ts`、`permission.guard.ts`（fail-closed） |

**命名差异**：P0-04 写 `CONNECTIONS_ONLY`，仓库里叫 `CONNECTIONS`。语义相同，不需要改。

## 2. 已有的测试（P0-04 要求的那四种视角）

| 视角 | 覆盖 | 位置 |
|---|---|---|
| owner 看到完整资料 | ✅ | E2E `profile.spec.ts:534`「本人能看到全部字段，包括 PRIVATE」· API `users-public-profile.spec.ts`（§3，2026-10-05 补） |
| stranger 只看到 public | ✅ | API `discover-privacy.spec.ts:129/223`（逐字段）· E2E `:518` |
| connection 看到 connections-only | ✅ | API `discover-privacy.spec.ts:156` · E2E `:518` |
| private 永远不能被普通用户读取 | ✅ | API `discover-privacy.spec.ts:129` · E2E `:534` |

另外两条容易被忽略但已经在测的：

- **Block 优先于所有可见性层级**：被拉黑的人即使进入候选集也完全不投影（`discover-privacy.spec.ts:189`），
  `users.service.ts:182` 的注释把这条顺序写明了。
- **不泄露"为什么被隐藏"**：`languages` 为 PRIVATE 时既返回空数组、也**不给出「语言互补」这条匹配理由**
  （`discover-privacy.spec.ts:261`）。理由本身就是一种泄露 —— 这条是被想到并测过的。

## 3. 唯一建议补的一处（2026-10-05 已补）

P0-04 的测试矩阵里，**owner 这一条原本只有 E2E 覆盖，没有 API 级断言**：
`users-public-profile.spec.ts` 的自视用例断言的是"本人能看到自己的资料，**无视状态**"，
而不是"本人能看到自己的 **PRIVATE** 字段"。

**已按原方案补上**：`users-public-profile.spec.ts` 新增一条用例，同一个 fixture 造出
`bio` / `languages` 两条 `visibility: PRIVATE` 行，**同一行数据读两次** —— 本人读到，
已连接但不是本人的 stranger 读不到（`bio: null`、`languages: []`）。同一行、两个视角，
所以能造成差异的只可能是 `canViewField` 的视角判定；顺带钉住 PRIVATE 不等于 CONNECTIONS。
矩阵四格现均已有 API 级断言。

（当时没做是成心的：用户 2026-10-04「别在一个问题上耗太久」，先记下来，等手上这件事收尾再补。）

## 4. 有意保留的设计（不是缺陷）

- **默认 PUBLIC**：这是一个语言交换/认识新朋友的产品，可被发现是它的功能本身；真正需要保护的
  是账号身份字段，那些**不可切换**且不进公开投影。所以"默认公开"在这里是安全且合理的，
  不是偷懒。
- **每个自定义标签各自有可见性**（比 P0-04 要求的"custom tags visibility"更细一层）：
  `UserAttribute.visibility` 是逐行的，因此个人可以向不同的人展示不同的标签。
