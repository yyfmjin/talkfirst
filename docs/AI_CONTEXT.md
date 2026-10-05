# TalkFirst — AI 上下文（AI_CONTEXT.md）

> 本文件是给「接手这个项目的 AI / 开发者」看的**单一事实来源**。
> 目标：让新的会话在 **5 分钟内**搞清楚这是什么项目、代码在哪、
> 怎么跑起来、哪些约定不能破坏、当前做到哪一步。
>
> 最后更新：2026-09-19（PC-1.4 完成）
> 维护规则：**只写当前代码真实存在的东西**。文档与代码冲突时，以代码为准，
> 并在这里标注 `DOC_DRIFT`。

---

## 1. 这是什么项目

**TalkFirst**（口号：Talk First. Connect Later.）是一个**语言交换 / 跨文化社交**应用。

核心产品循环：

```
注册 → 引导(Onboarding) → Discover 发现 → 查看资料 → Say Hello
     → 建立连接(Connection) → 聊天(Chat) → 交换联系方式(Exchange)
```

内容循环：

```
发动态(Post) → 详情 → 评论 → 回复 → 通知 → 审核
```

产品定位关键词：语言交换、文化交流、交友需求（Looking For）、
交友属性（自定义标签）、隐私分级可见。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 12 + Fastify 无，用 Express 平台；Prisma 6；PostgreSQL |
| 实时 | Socket.IO（`apps/api/src/chat`） |
| 前端(用户端) | Next.js 15 App Router + React 19 + TailwindCSS 3 |
| 前端(管理端) | Next.js 15 App Router（`apps/admin`，端口 3001） |
| 测试 | Jest（API 单测）+ Playwright（Admin E2E，PC-1.4 起 Web 也接入） |
| 语言 | TypeScript（strict 风格，禁 `any`） |
| 运行 | Node >= 20；npm workspaces（monorepo） |

---

## 3. 目录结构

```
TalkFirst/
├─ apps/
│  ├─ api/          NestJS 后端
│  │  └─ src/
│  │     ├─ auth/        注册/登录/刷新/验证码/密码
│  │     ├─ users/       用户资料 + PC-1.3 属性 API  ← Profile 相关都在这里
│  │     ├─ discover/    Discover 推荐/筛选
│  │     ├─ moments/     动态 + 点赞 + 评论
│  │     ├─ chat/        会话/消息/WebSocket 网关
│  │     ├─ connections/ 连接请求/好友关系
│  │     ├─ exchange/    联系方式交换请求
│  │     ├─ social/      社交账号绑定（SocialAccount / SharedSocialAccount）
│  │     ├─ safety/      举报/拉黑/关键词扫描（SafetyService）
│  │     ├─ meta/        字典数据（语言/兴趣/目的/国家/系统属性定义）
│  │     ├─ admin/       管理端 API（用户/举报/审核/审计）
│  │     ├─ uploads/     头像上传
│  │     ├─ translate/   消息翻译
│  │     └─ common/      守卫/过滤器/拦截器/错误码
│  ├─ web/          用户端 Next.js
│  │  ├─ src/app/        路由（App Router）
│  │  ├─ src/components/ 共享组件（含 ProfilePreviewCard）
│  │  ├─ src/lib/        API 客户端 / 类型契约 / session
│  │  └─ test/           smoke + PC-1.4 Playwright（e2e/、fixtures/）
│  └─ admin/        管理端 Next.js
├─ packages/
│  ├─ config/       共享配置
│  ├─ types/        共享类型
│  └─ validation/   共享校验
├─ prisma/
│  ├─ schema.prisma 单一 schema（1455 行，2026-10-05 实测；随迁移增长，引用前请现测）
│  ├─ migrations/   正式 migration 历史
│  └─ seed.ts       本地种子数据
├─ scripts/         运维/冒烟脚本（db-check、phaseN-smoke 等）
├─ docs/            文档
│  ├─ architecture/ 各阶段设计与最终报告
│  ├─ audit/        审计报告
│  └─ AI_CONTEXT.md ← 本文件
├─ .local-data/     本地临时数据（PG 数据目录、日志、一次性脚本）—— 非产品代码
├─ docker-compose.yml
└─ start-local.bat  Windows 一键启动
```

---

## 4. 本地运行

### 4.1 端口约定

| 服务 | 端口 |
|---|---|
| API | **4000**（`API_PORT`，前缀 `api/v1`） |
| Web（用户端） | **3000** |
| Admin（管理端） | **3001** |
| PostgreSQL（项目本地） | **5433** |
| PostgreSQL（Docker Compose） | **5432** |
| Redis | 6379 |

### 4.2 一键启动（Windows 当前开发机）

```bat
start-local.bat
```

它依次启动：项目本地 PostgreSQL(5433) → `prisma migrate deploy` + seed
→ API(`apps/api/dist/main.js`) → Web(`next start`)。

健康检查：

```bash
curl http://localhost:4000/api/v1/health
curl -o NUL -w "%{http_code}" http://localhost:3000/
node scripts/db-check.cjs
```

### 4.3 Docker

```bash
docker compose up -d --build
docker compose logs -f api web
```

### 4.4 关键环境变量（`.env` 位于仓库根）

```
API_PORT=4000
DATABASE_URL=postgresql://talkfirst:talkfirst@localhost:5433/talkfirst?schema=public
DIRECT_URL=（同上）
JWT_SECRET / JWT_REFRESH_SECRET
THROTTLE_MULTIPLIER=100   # 本地跑 Playwright 必须，见下
```

**限流陷阱**：`POST /auth/login` 在 `auth.controller.ts` 里硬编码 50/分钟。
浏览器测试套件一轮要登录 ~74 次，**只调 `THROTTLE_LIMIT` 无效**；
必须靠 `THROTTLE_MULTIPLIER`（`HttpThrottlerGuard` 会把所有限流按倍数放大）。
本地保留 `THROTTLE_MULTIPLIER=100`。

---

## 5. 数据库

### 5.1 规模

- `prisma/schema.prisma`：**1455 行**（2026-10-05 实测）
- **47 个 model**，**25 个 enum**（2026-10-05 实测；本行曾写 36 / 18，属 `DOC_DRIFT`）
- 迁移历史共 **30** 个（`prisma/migrations/`，含 P0-02 的 username 迁移）
- 单一 schema 文件，所有 app 共用

### 5.2 核心模型分组

| 分组 | Model |
|---|---|
| 用户 | `User`、`AdminUser`、`VerificationCode`、`RefreshToken` |
| 字典 | `Interest`/`UserInterest`、`Purpose`/`UserPurpose`、`Language`/`UserLanguage`、`Country`/`UserPreferredCountry` |
| 社交账号 | `SocialAccount`、`SharedSocialAccount`、`MomentPlatformBinding` |
| 内容 | `Moment`、`MomentLike`、`MomentComment`、`MomentSetting` |
| 关系 | `ConnectionRequest`、`Connection`、`Block` |
| 聊天 | `Conversation`、`ConversationMember`、`Message`、`MessageTranslation` |
| 安全/管理 | `Report`、`AdminNote`、`AdminAuditLog`、`Notification` |
| 联系方式交换 | `ExchangeRequest` |
| **PC-1.2 新增** | `AttributeDefinition`、`UserAttribute`、`ProfileFieldVisibility` |
| 视图辅助 | `SchemaMeta`、`DiscoverView` |

### 5.3 PC-1.2 新增：交友属性模型（重点）

这是最近一次 schema 变更（migration `20260919050334_profile_attributes`）。

**新增 3 张表：**

- `AttributeDefinition` — **系统标签目录**（平台维护）
  - `key` 唯一；`scope` = SYSTEM/CUSTOM；`kind` = ABOUT_ME/LOOKING_FOR
  - `category`、`label`（英文）、`labelZh`（中文）、`valueType`、`sort`
  - `isActive`（可停用但**不删除**，见 Q10）、`isSearchable`

- `UserAttribute` — **用户选择的一行**（系统标签选择 & 自定义标签共用）
  - `kind`：ABOUT_ME 或 LOOKING_FOR（**两个概念不合并**）
  - `definitionId`：系统标签选择时非空；纯自定义时为 `NULL`
  - `label` / `labelKey`：自定义标签用；`labelKey` 是归一化后的唯一键
  - `value`：可选补充值；`visibility`、`sortOrder`、`reviewStatus`
  - 唯一约束：`(userId, definitionId)` 与 `(userId, kind, labelKey)`

- `ProfileFieldVisibility` — **逐字段可见性**
  - 主键 `(userId, fieldKey)`；**没有行 = 用默认值 PUBLIC**（懒加载，不回填）

**新增 5 个 enum：**

| Enum | 值 |
|---|---|
| `AttributeKind` | `ABOUT_ME`、`LOOKING_FOR` |
| `AttributeSource` | `SYSTEM`、`CUSTOM` |
| `AttributeValueType` | `BOOLEAN`、`TEXT`、`SINGLE_SELECT`、`MULTI_SELECT` |
| `Visibility` | `PUBLIC`、`CONNECTIONS`、`PRIVATE` |
| `ReviewStatus` | `PENDING`、`APPROVED`、`REJECTED`、`HIDDEN` |

**`User` 表只加了一列**：`region String? @db.VarChar(80)`（可空、无默认值、无索引）。

### 5.4 数据完整性语义（必须遵守）

- **SYSTEM vs CUSTOM 不变量**（schema 无 CHECK，靠 service 层保证）：
  - SYSTEM → `definitionId != null`
  - CUSTOM → `definitionId == null` 且 `label != null` 且 `labelKey != null`
- `labelKey` **只能由服务端生成**：Unicode NFKC → trim → 合并空白 → casefold。
  客户端永远不准提交 `labelKey`。
- `definitionId` 删除策略是 **SetNull**：删掉定义不会毁掉用户数据，
  只会把那一行「降级」成自定义样式。
- `UserAttribute.userId` / `ProfileFieldVisibility.userId`：**Cascade**。

### 5.5 迁移纪律

- 正式 migration 在 `prisma/migrations/`，**不允许手工改历史 migration**。
- 本地库若无 `_prisma_migrations`，用 `prisma migrate resolve --applied <name>`
  做基线，**禁止**手写 tracking 表、禁止 `db push`、禁止 `migrate reset`。
- **生产数据库状态 = UNKNOWN**。所有验证结论仅对 `localhost:5433/talkfirst` 成立。

---

## 6. API 约定

### 6.1 基本规则

- 全局前缀 `api/v1`，默认端口 4000。
- 鉴权：`JwtAuthGuard`（Bearer access token）。
- **`userId` 永远取自 JWT subject**。禁止从 body / query 接收 `userId` / `ownerId`
  ——这是本项目防 IDOR 的硬规则。
- 响应：成功 `{ success: true, data: ... }`；失败 `{ success: false, error: { code, message } }`。
- 异常统一由 `apps/api/src/common/api-exception.filter.ts` 兜底：
  - 非 `HttpException` → 500 `INTERNAL_ERROR`，**message 固定为 `Something went wrong`**
    （绝不外泄 stack / SQL / Prisma 信息）。
  - 401 一律归一成 `UNAUTHORIZED` 码。

### 6.2 错误码

全项目现有 **70 个** `error.code`。**契约是 `code`，不是 message**。

常用：

| code | 含义 |
|---|---|
| `VALIDATION_ERROR` | 入参不合法（400） |
| `UNAUTHORIZED` | 未登录/凭证失效（401） |
| `INVALID_CREDENTIALS` | 账号或密码错误 |
| `PERMISSION_DENIED` / `ADMIN_REQUIRED` | 权限不足（403） |
| `BLOCKED` | 存在拉黑关系，拒绝访问（403） |
| `USER_NOT_FOUND` | 用户不存在/不可见（404） |
| `MESSAGE_BLOCKED` | 内容被安全扫描拦截（403） |
| `ATTRIBUTE_EXISTS` | 属性重复（409） |
| `ATTRIBUTE_NOT_FOUND` | 属性不存在（404） |
| `USER_DISABLED` / `USER_SUSPENDED` / `USER_BANNED` | 账号状态受限 |
| `PASSWORD_MISMATCH` / `PASSWORD_UNCHANGED` | 密码修改相关 |

**新增错误码要克制**：优先复用现有 code，不要为小场景新造顶层码。

### 6.3 PC-1.3 交付的 Profile 属性 API（PC-1.4 前端已全部对接）

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/v1/users/me/attributes` | 读自己的属性（按 kind 分组） |
| POST | `/api/v1/users/me/attributes` | 新增（系统标签 or 自定义） |
| PATCH | `/api/v1/users/me/attributes/:id` | 改 value / visibility / sortOrder /（自定义的）label |
| DELETE | `/api/v1/users/me/attributes/:id` | 删自己的 |
| GET | `/api/v1/users/me/profile-field-visibility` | 读逐字段可见性 |
| PUT | `/api/v1/users/me/profile-field-visibility` | 写逐字段可见性 |
| GET | `/api/v1/meta/attributes` | 系统标签目录（只返回 `isActive=true`，共 **20 条**，支持 `?kind=`） |

其它相关既有接口（PC-1.4 已增强，非新增）：

| Method | Path | 约束 |
|---|---|---|
| PATCH | `/users/me` | nickname 2–24；region ≤80；city ≤80；bio ≤500 |
| PUT | `/users/me/avatar` | 上传头像（`INVALID_IMAGE` / `IMAGE_TOO_LARGE`） |
| PUT | `/users/me/languages` | 1–8 项 |
| PUT | `/users/me/interests` | **至少 3，最多 20** |
| PUT | `/users/me/purposes` | 1–7 |
| PUT | `/users/me/preferred-countries` | ≤10 |
| GET | `/users/:id` | 公开资料（受可见性 + 拉黑规则约束） |

**数量上限（属性）**：`ABOUT_ME` ≤ 10，`LOOKING_FOR` ≤ 10，
由 **service 层**校验（不依赖数据库约束）。

---

## 7. 可见性 / 隐私语义（最容易搞错的地方）

### 7.1 统一决策点

`apps/api/src/users/profile-visibility.constants.ts` 是**唯一**的可见性判断入口。

- `PROFILE_VISIBILITY_FIELD_WHITELIST`：**13 个**可被逐字段可见性控制的字段
  `nickname`、`avatarUrl`、`birthDate`、`countryCode`、`city`、`region`、
  `gender`、`bio`、`languages`、`interests`、`purposes`、`preferredCountries`、`attributes`
- `canViewField(visibility, { isSelf, isConnected })`：只回答「层级」问题。
- 前端镜像定义在 `apps/web/src/lib/profile.ts`（`PROFILE_VISIBILITY_FIELDS`），
  **两边必须保持一致**。

### 7.2 规则优先级

```
拉黑(Block)  >  PRIVATE  >  CONNECTIONS  >  PUBLIC
```

- **Block 覆盖一切，包括 PUBLIC**。调用方必须**先**跑 block 检查，
  再问 `canViewField`。存在拉黑 → 403 `BLOCKED`。
- 目标用户非 `ACTIVE` 状态 → 404 `USER_NOT_FOUND`。
- `SELF` → 全可见。
- `CONNECTIONS` → 仅 **ACTIVE Connection** 可见。
- `PRIVATE` → 仅本人。
- 属性行 `reviewStatus != APPROVED` → 只有作者本人可见。

### 7.3 「无行 = PUBLIC」的懒加载模型

- `ProfileFieldVisibility` 里**没有行**，等价于 `PUBLIC`。
- **不要**给存量用户批量插入 13 行默认记录。
- 用户把某字段设成 `PUBLIC` 时，后端会**删除**那一行（回到默认）。

### 7.4 三类可见性互相独立（绝不能混用）

| 机制 | 管什么 |
|---|---|
| `ProfileFieldVisibility` | **只**管 profile 字段 |
| `UserAttribute.visibility` | 单个属性标签的层级 |
| `SharedSocialAccount` | **只**管社交账号 handle 的按对方授权 |
| `MomentSetting.visibleTo` | **只**管动态可见范围 |

**资料可见性 ≠ 社交账号可见性。** 社交 handle 永远只由 `SharedSocialAccount` 决定，
不得被 profile 可见性开关影响，反之亦然。

### 7.5 绝不外泄的字段

任何公开响应（公开资料 / 资料卡 / 属性接口）中**永远不得出现**：

```
email  passwordHash  tokenHash  refreshToken  accessToken
oauth / clientSecret  social handle  isAdmin  status  ip  userAgent
```

前端 `ProfilePreviewCard` 也**永不显示**：`email`、`password`、`token`、
`OAuth`、社交 handle，以及内部字段 `reviewStatus`、`definitionId`、`source`。

### 7.6 两种「隐藏」的响应形状

- **标量**：隐藏时返回 `null`（不区分「未设置」与「不可见」）。
- **数组**：隐藏时返回 `[]`。

→ 前端必须**整行不渲染**，而不是显示「暂无」。否则会泄露「该用户设过这个字段」。

### 7.7 Discover 隐私（已闭环）

`DiscoverService` 最初直接查 `User` 表、不读 `ProfileFieldVisibility`，
所以「设为 PRIVATE 的字段」仍会出现在推荐卡片上。**该缺口已修复**：

- 候选人查询已 `include` `fieldVisibilities`，投影前统一走
  `resolveFieldVisibilityMap()` + `canViewField()`——与 `GET /users/:id`
  是同一套规则，没有第二份实现。
- 派生字段同样受限：`age` 跟随 `birthDate`，`countryName`/`countryFlag`
  跟随 `countryCode`；由隐藏字段推导出的 `matchReasons` 会被丢弃
  （否则「共同兴趣：摄影」会绕过 PRIVATE）。打分与排序算法未改动。
- `matchScore` 仍由原始数据算出（排名不变），但 **Discover 卡片本来就不含**
  `city` / `region` / `gender` / `attributes` / `preferredCountries`。
- Self 与 ACTIVE Connection 在推荐流里**结构性不存在**（候选查询已排除），
  所以 CONNECTION 层级只能用 `/profile/[id]` 验证；Discover 只需正确区分
  PUBLIC 与「隐藏」。

证据：`apps/api/src/discover/discover-privacy.spec.ts`；
`.local-data/pc14/verify.cjs` 的 Discover 步骤（真实 HTTP + PG）；
`apps/web/test/e2e/discover-privacy.spec.ts`（真实浏览器）。

---

## 8. 当前开发进度

> 判定口径：**只有源码存在 ≠ 完成**。下表区分「已实现」与「已验证」。

| 阶段 | 内容 | 状态 | 依据 |
|---|---|---|---|
| Phase 1/2 | 基础设施 + 认证 | ✅ 完成 | 注册/登录/刷新/登出/验证码/JWT 守卫/限流均存在并有单测 |
| Onboarding | 引导流程 | ✅ 完成 | `apps/web/src/app/onboarding/*`，真实写库 |
| Discover | 发现 + Say Hello | ✅ 完成 | `discover` 模块 + `connections` 模块，有 spec；隐私投影已闭环（见 7.7） |
| Chat | 会话/消息/WebSocket | ✅ 完成 | REST + `chat.gateway.ts`，Socket.IO |
| Exchange | 联系方式交换 | ✅ 完成 | `exchange` 模块，有 `exchange-privacy.spec.ts` |
| Moments | 动态/点赞/评论 | ✅ 完成 | feed/like/comment + **详情页**（`@Get(":id")` + `/moments/[id]`）· 回复（`parentId`）· 本人删除评论（PC-2.4）· 编辑/删除动态 · 举报 · 审核状态。**仍缺**：评论分页与评论举报（见 C2） |
| Admin A / A+ | 管理端骨架 + RBAC | ✅ 完成 | JwtAuthGuard → AdminGuard → PermissionGuard + 审计日志 |
| Admin B1–B5 | 仪表盘/用户/用户详情/举报 | ✅ 完成 | 有对应页面 + API + Playwright |
| Admin C1–C5 | 连接/交换/拉黑/集成 | ✅ 完成 | 同上 |
| Production P0 | HTTPS/Nginx/备份 | ⚠️ 未闭环 | 服务器侧未动（生产状态仍 = UNKNOWN）。**仓库侧能做的已做**：`deploy-pull.sh` 的启动关键校验、构建期基址守卫、G10 就绪探针 —— 见 `docs/P0-00-FIXES.md`（FIX-5/7/8）与 `docs/P0-00-BASELINE.md` §G |
| PC-1.1 | 属性 schema 设计 | ✅ 完成 | `docs/architecture/PROFILE-ATTRIBUTE-SCHEMA-DESIGN.md` |
| PC-1.2 | 属性 schema 迁移 | ✅ 完成 | migration `20260919050334_profile_attributes`，本地库已应用并双向 diff 为空 |
| PC-1.3 | 属性 API | ✅ 完成 | `apps/api/src/users/profile-attributes.*`，有 spec + 418 行真实 HTTP 验证脚本全 PASS |
| PC-1.4 | 属性/资料 UI | ✅ 完成 | Playwright **54/54**（desktop+phone）、真实 HTTP+PG **13/13**、Jest **683/683**、typecheck/lint/build 全通过；报告见 `docs/architecture/PC-1.4-PROFILE-UI-FINAL-RESULT.md` |

### 8.1 已知产品缺口（来自 `docs/audit/`）

> **2026-10-05 校准**：本节原来挂着多条「缺失」，而其中好几条在代码里**已经实现**。
> 按本文开头的规则（「文档说 MISSING 但代码已有 → 标 `DOC_DRIFT`，以代码为准」），
> 这里直接按代码实况重写，并在每条后面给出证据；仍未闭环的集中列在后面。
> 待办编号沿用 `docs/P0-00-BASELINE.md` §C（C1…C13）。

**已闭环（曾经记为缺口）**

1. ~~帖子详情页 / `GET /moments/:id` 不存在~~ → **已实现**：`moments.controller.ts` 的 `@Get(":id")`（`:417`）+ `apps/web/src/app/moments/[id]`。
2. 评论：**回复**（`parentId`，PC-2.3.2）与**本人删除**（PC-2.4，`moments.controller.ts` 的注释写明了「更具体的路由要声明在 `@Delete(":id")` 之前」）**已实现**；评论分页与举报仍缺（→ C2）。
3. ~~内容举报缺失（`Report` 只支持 user + 可选 message）~~ → **部分闭环**：`Report` 已有 `momentId` 与 `messageId` 两列，动态/聊天举报可用；**评论举报**仍缺（`Report` 没有 `commentId` → C2）。
4. ~~通知闭环不完整（无独立页、多事件不发通知）~~ → **部分闭环**：`/notifications` 页 + `notifications` 模块（10 种类型、游标分页、全部已读）已在；**13 处**生产者在发通知（admin ×2、chat、connections ×2、exchange ×2、moments ×3、social-safety ×2、user-status）。**仍缺**：实时推送（`chat.gateway.ts` 里没有任何通知类 socket 事件）。
5. ~~邮箱验证未强制 + `Math.random` 生成验证码 + 无 SMTP~~ → **已实现**：`ENFORCE_EMAIL_VERIFICATION` 策略（`auth/email-verification.policy.ts`）· 验证码走 `common/crypto.ts` 的 CSPRNG（生产代码里已无 `Math.random`，残留只在演示种子注释里）· `apps/api/src/mail/` 有真实 `smtp-mail.provider.ts`（另配 console / fake 两个 provider）。
8. ~~未实现「修改密码 / 忘记密码」找回流程~~ → **已实现**：`/me/password` + 忘记密码/重置（P0-00 §B 的 Auth 行）。
10. ~~Admin 无内容/评论管理能力~~ → **已闭环**：动态审核队列与举报复核已在；**评论**举报从 2026-10-05（C2）起也通了 —— 举报目标、审核侧标签/筛选/详情面板都已接（FIX-12）。
11. ~~收藏（Bookmark）缺失~~ → **已实现**（2026-10-05，C4）：新建 `MomentBookmark` + `GET /moments/bookmarks`、`POST/DELETE /moments/:id/bookmark`，`/moments` 多了「收藏」标签，卡片与详情页各多一个收藏按钮。详见 `docs/P0-00-FIXES.md` FIX-10。
12. ~~会话未读数~~ → **已实现**（2026-10-05，C3）：`ConversationMember.lastReadAt` + `POST /conversations/:id/read`。旧 `unreadCount` 是 `take: 5` 的副产品（从没打开过的会话最多显示 5，读完也不会归零），现在是真值；发送响应里那个名不符实的 `peerUnread`（算的是未读**通知**、零消费方）已删。**仍未做**：送达回执（「已发送/已送达」需要对方在线状态与投递记录，是另一个特性，不只是未读数）。详见 FIX-11。
13. ~~评论分页 / 评论举报~~ → **已实现**（2026-10-05，C2）：评论分页 PC-2.4 就有；本轮补的是**举报** —— `Report.commentId` + `POST /reports` 的第三个目标、审核侧的 `COMMENT` 标签/筛选/详情面板，以及用户端「别人的评论 → 举报」入口。详见 FIX-12。

**仍未闭环**

- 送达回执（C3 的另一半：「已送达」需要对方的在线/投递记录，与本次的未读数不是同一件事）
- 浏览器端 E2E 的既知失败（见 `docs/KNOWN-E2E-ISSUES.md`；按决定保留，不作为门禁）
- ~~通知去重（C5）~~ → **已核实：无需机制**。口径由用户 2026-10-05 定为「**每次点赞都提醒**」，按 `(收件人, 类型, 目标)` 去重会把两个不同人的点赞合成一条，与它直接冲突；而 13 个生产者可分两类、都不产生重复投递（事件型以**新建行**为触发；状态型用**自消耗谓词 + 条件认领**）。结论与理由见 `docs/P0-00-FIXES.md` FIX-9，契约测试在 `apps/api/src/moments/moments-like-notifications.spec.ts`
- 通知实时推送（无 socket 事件）
- ~~话题页~~ → **已实现**（2026-10-05，C1 的一半）：`GET /moments/feed?topic=` + `GET /moments/topics`，动态页多了话题筛选 chip。详见 `docs/P0-00-FIXES.md` FIX-12
- 成员搜索（C1 的另一半，2026-10-05 ✓ 已拆出；**待产品决定**：搜谁？按昵称/语言/兴趣？是否配额？）
- 法律文件正文（C6，需法务/产品文本）
- 移动端可验证性（C10，需真机/模拟器）
- 会话状态转换矩阵 / 日期时区（C12，需产品确认）
- 第 6 条（社交平台同步的演示内容）**本次未复核**，保持原结论

**P2**：计数漂移、SSO 占位、`login`/`refresh` 对 DISABLED/SUSPENDED 门禁不一致、
翻译降级为 `local-demo`、WS 单机内存态、Admin audit 页缺 loading/empty、
`Report.messageId` / `ExchangeRequest.connectionId` 无外键。

**P3**：UI 文案/组件一致性（toast vs inline vs `window.confirm`）、
无障碍（ESC/点击外部关闭/焦点陷阱）、移动端视觉回归基线。

### 8.2 产品已声明「缺失」的部分（不要以为有）

- 广告 / 推广 / 运营位 / Banner / Popup / 公告 / Feature Flags：**完全不存在**（连 schema 都没有）。
- Google / Apple SSO：前端只是「即将上线」占位。
- S3 / SMTP / Redis：**未接入**（上传走本地文件系统；`STORAGE_*` 未配置返回 `STORAGE_NOT_CONFIGURED`）。

---

## 9. 硬约束（改代码前必读）

以下规则在本项目反复被强调，**违反会造成返工**：

1. **不要重写已有的 Profile / Auth / Discover 逻辑**。先读
   `apps/api/src/users/*`、`apps/api/src/auth/*`、`apps/web/src/app/me/*`，
   找出现有实现，再做**增量**修改。
2. **不要随意改 `prisma/schema.prisma`**（当前 **771 行**）。
   需要 schema 变更时：先出设计文档 → 等批准 → 再动 schema → 再 migration。
3. **不要在没有明确授权时跑 migration**：
   禁止 `prisma migrate dev` / `migrate deploy` / `db push` / `migrate reset`。
4. **不要改 `apps/api/src/safety/safety.service.ts`**。
   自定义属性文案写入前要调 `scanText()`，命中 HIGH / blocked 直接拒绝，
   但**不要修改 SafetyService 本身**。
5. **`userId` 只能来自 JWT**，绝不允许客户端提交。
6. **资料可见性 ≠ 社交账号可见性**。不要动 `SharedSocialAccount` 授权模型，
   不要动 `MomentSetting.visibleTo`。
7. **公开响应绝不外泄** `email` / `passwordHash` / token / OAuth / social handle。
8. **不要用 `any` / `as unknown as` / 为过 TS 而强转**。
   API 返回与前端类型不一致时，**改真实契约**，不要强转。
9. **不要删除或弱化现有测试**。
10. **不要宣称验证了生产**。生产数据库状态 = **UNKNOWN**。
11. **发现缺口先报告**（`API_GAP` / `SCHEMA_CHANGE_REQUIRED`），
    不要顺手自己加 endpoint 或 migration。
12. **不要顺手升级依赖、不要顺手做 P1/P2、不要顺手重构**。范围外的事先问。

---

## 10. 验证方式与可信度

### 10.1 证据等级（高 → 低）

1. 真实运行结果（真实 HTTP + 真实 PostgreSQL + 真实浏览器 E2E）
2. 当前源码
3. 当前 `schema.prisma`
4. 当前测试
5. 当前 docs
6. 历史审计报告 / Final Result

**规则**：文档说 COMPLETE 但代码没有 → 标 `DOC_DRIFT`，以代码为准。
文档说 MISSING 但代码已有 → 同样标 `DOC_DRIFT`。

### 10.2 本项目验证的现状

| 层 | 现状 |
|---|---|
| API 单测 | **23 个 spec**（auth guard、exception filter、block guard、discover filter、exchange privacy、moments access、safety autoflag、users avatar、属性 spec 等） |
| Admin E2E | **13 个 Playwright spec** + smoke |
| Web E2E | PC-1.4 起已有 `apps/web/test/e2e/profile.spec.ts`（27 场景 × desktop/phone = **54 passed**，真实浏览器 + 真实 API + 真实 PostgreSQL）；其余页面仍只有 `test/smoke.test.mjs` |
| 真实 HTTP + PG | PC-1.3 做过（`.local-data/pc13/verify.cjs`，14 步全 PASS） |

**注意**：「有 Jest」≠「这个功能已验证」。单测多用 mock，
真正跑通 HTTP + PostgreSQL 的功能是少数。

### 10.3 常用命令

```bash
npm run typecheck           # 全仓
npm run lint
npm run build
npm run test                # 各 workspace 测试（Jest 全量约 86s）
```

单包：

```bash
npm run build -w @talkfirst/api
npm run typecheck -w @talkfirst/web
npm run lint -w @talkfirst/web
npx jest --config apps/api/jest.config.js <pattern>
```

### 10.4 本地环境坑

- **PostgreSQL 默认是停的**。项目本地实例在 `.local-data/pgdata`，端口 5433。
  启动封装脚本：`.local-data/pc12/withpg.sh <payload.sh>`
  （起 PG → 跑 payload → `pg_ctl -m fast stop`）。
  终端结束会杀进程组，所以必须**一条命令内**完成「起 PG → 干活 → 停 PG」。
- 用 **`node dist/main.js`**，不要用 `npm run dev`（watcher 不可靠）；先 build。
- EOL 混杂：`apps/web/src/app/moments/page.tsx` 是 **CRLF**，多数文件是 LF。
  用脚本改文件时要注意。
- `apps/web/src/app/profile/[id]/` 这种带方括号的路径，写 shell 时**要加单引号**。
- 生产构建前确保 `THROTTLE_MULTIPLIER=100`，否则浏览器测试会被 429 卡住。
- 偶发 `get_proc_lock` / `proc_subproc` 噪声可忽略（除非 exit code ≠ 0）。

---

## 11. 下一步建议

按优先级：

1. ~~收口 PC-1.4~~ ✅ 已完成（见第 8 节）。
2. ~~闭环 Discover 隐私缺口~~ ✅ 已完成（见 7.7）。
3. **P1 产品缺口**：帖子详情 → 评论回复/分页/删除/举报 → 内容举报 → 通知闭环。
4. **社交平台**：把 MOCK 的 `seedDemoMoments` 替换为真实能力（或明确降级为「演示」）。
5. **生产就绪**：HTTPS / 反代 / 备份 / SMTP / Redis 仍是未闭环项。

---

## 12. 文档地图

| 文件 | 作用 |
|---|---|
| `docs/AI_CONTEXT.md` | ← 本文件，AI 接手入口 |
| `docs/local-start.md` | 本地启动 |
| `docs/DOCKER-DEPLOY.md` | Docker 部署 |
| `docs/admin-console.md` | 管理端说明 |
| `docs/audit/PRODUCT-COMPLETENESS-AUDIT.md` | 产品完整度审计（权威缺口清单） |
| `docs/audit/FEATURE_INVENTORY.md` | 逐功能矩阵 |
| `docs/audit/TEST_COVERAGE_GAPS.md` | 测试缺口 |
| `docs/architecture/PROFILE-ATTRIBUTE-SCHEMA-DESIGN.md` | PC-1.1 属性 schema 设计 |
| `docs/architecture/PC-1.2-MIGRATION-PREFLIGHT.md` | PC-1.2 迁移预检 |
| `docs/architecture/PC-1.2-MIGRATION-FINAL-RESULT.md` | PC-1.2 迁移结果 |
| `docs/architecture/PC-1.3-PROFILE-ATTRIBUTE-API-FINAL-RESULT.md` | PC-1.3 API 结果 |
| `docs/architecture/PC-1.4-PROFILE-UI-FINAL-RESULT.md` | PC-1.4 资料 UI 结果（含测试证据） |

---

**维护提醒**：任何阶段完成后，回来更新第 8 节的进度表和本节的文档地图。
