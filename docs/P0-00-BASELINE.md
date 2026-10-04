# P0-00 — 生产环境与代码基线检查（只读）

> 任务编号：P0-00
> 执行日期：2026-10-04
> 执行方式：**只读检查**。未修改业务代码、未删除文件、未重构、未创建迁移、未改数据库结构、未 commit。
> 所有结论均标注证据来源；无法验证的一律写 `NOT VERIFIED`，不写推测当结论。
>
> ⚠️ **后续状态：本报告发现的工程缺陷（§E.1 / §E.2 / §E.4 / §G8 / §G13）已在 2026-10-04 修复并验证，
> 见 `docs/P0-00-FIXES.md`。** 下面保留的是**修复前**的基线快照，作为历史记录不再更新。

本轮**新增文件仅此一个**（检查报告本身）。构建过程重新生成了 `apps/api/dist`、`apps/web/.next`、`apps/admin/.next`，但它们都在 `.gitignore` 中，检查结束时 `git status` 为空。

---

## A. 当前项目结构

### A.1 仓库形态

| 项 | 值 |
|---|---|
| 类型 | npm workspaces monorepo（非 pnpm / 非 turborepo） |
| `apps/` | `api`、`web`、`admin`、`mobile` |
| `packages/` | `types`、`config`、`validation`（**三个包在 apps 下均为 0 处引用**） |
| 规模 | API 源码 233 个 `.ts`；web 38 个 `page.tsx`；admin 23 个 `page.tsx`；提交 31 个 |
| 根脚本 | `typecheck` / `lint` / `test` / `test:static` / `test:e2e` / `build`，均 `--workspaces --if-present` |

### A.2 技术栈（实测版本）

| 层 | 技术 |
|---|---|
| 运行时 | Node v22.14.0 / npm 10.9.2 |
| API | NestJS 12 + Prisma 6 + PostgreSQL 16 + Socket.IO 4 + `@nestjs/throttler` |
| Web | Next.js 15 App Router + React 19 + Tailwind 3 |
| Admin | Next.js 15 App Router（独立视觉体系，不共用 member 端 token） |
| Mobile | Expo（`apps/mobile`） |
| 数据库 | PostgreSQL 16（Docker），宿主机端口 **5433**；Redis 7（6379） |

### A.3 API 模块清单（`apps/api/src/`）

`admin` `auth` `chat` `common` `connections` `discover` `exchange` `feedback` `health` `mail` `meta` `moments` `notifications` `prisma` `safety` `security` `social` `social-sync` `translate` `uploads` `users`

`AppModule` 实际导入的功能模块（`apps/api/src/app.module.ts:28` 起）：Prisma、Security、Auth、Users、Meta、Discover、Connections、Social、Chat、Exchange、Safety、Translate、Admin、Uploads、Moments、Feedback、SocialSync、Notifications。

### A.4 启动方式

| 目标 | 命令 | 端口 |
|---|---|---|
| API（开发） | `npm run dev:api` → `nest start --watch` | `API_PORT`，默认 **4000** |
| API（生产） | `node dist/main.js`（`start:prod`） | 同上 |
| Web | `npm run dev -w @talkfirst/web` → `next dev --port 3000` | **3000** |
| Admin | `npm run dev -w @talkfirst/admin` → `next dev --port 3001` | **3001** |
| DB / Redis | `npm run db:up` → `docker compose up -d postgres redis` | 5433 / 6379 |
| 本地一键 | `start-local-dev.bat`（**先构建 API 再启动三个服务**，构建失败即退出） | — |
| 本地一键（旧） | `start-local.bat`（直接 `node apps/api/dist/main.js`，**不构建**） | — |

API 启动链（`apps/api/src/main.ts`）：
1. `loadEnvironment()`（`main.ts:48`）用 dotenv 读取 `<repo>/.env`；dotenv 不覆盖已存在的环境变量，所以 Docker/systemd 注入的真实环境优先。
2. 每次启动都执行断言（不依赖 `NODE_ENV`）：`assertSecretConfigured(["JWT_SECRET","JWT_REFRESH_SECRET"])`（:84）、`assertThrottleMultiplierSafe()`（:85）、`assertDeviceSaltConfigured()`（:90）、`assertTokenEncryptionKeyConfigured()`（:98）、`assertTrustProxyConfigured()`、`assertOAuthConfiguration()`（:112）；生产部署再追加 `assertMailConfigurationForProduction()`（:119）。
3. `app.setGlobalPrefix("api/v1")`（:123）；`app.set("trust proxy", trustProxySetting())`（:130）；`json/urlencoded` 上限 8MB（:155-156）；`enableCors`（:167）；监听 `API_PORT ?? 4000`（:172）。

### A.5 全局 API 前缀与健康检查

- 所有路由前缀：`/api/v1`
- 健康检查：`GET /api/v1/health` → `{ success: true, data: { status: "ok", service: "talkfirst-api", timestamp } }`
- **注意**：这是纯 liveness，不检查数据库/Redis（readiness 缺失，见 G10）。

---

## B. 已完成模块（对照开发计划的 11 个域）

| 域 | 后端 | 前端入口 | 状态 |
|---|---|---|---|
| **Auth** | `auth/`（含 `oauth/`、密码重置、邮箱验证码、会话服务） | `/login` `/register` `/verify` `/reset` `/register/success` | ✅ 完成（含 Google 快捷登录、忘记密码、首设密码） |
| **Users / Profile** | `users/`、`meta/`（语言/国家/兴趣字典）、自定义属性（`UserAttribute` / `AttributeDefinition`） | `/me`、`/me/edit`、`/me/password`、`/me/visibility`、`/me/interests`、`/me/attributes`、`/me/social`、`/profile/[id]` | ✅ 完成（含逐字段可见范围） |
| **Discover** | `discover/`（推荐 + 每日额度 `DiscoverView` + 类别 `DiscoverCategory`） | `/discover` | ✅ 完成 |
| **Chat** | `chat/`（Socket.IO + REST 兜底）、`translate/` | `/messages`、`/messages/[id]` | ✅ 完成（含跨语言翻译） |
| **Connections** | `connections/`（状态机 + 事务内条件认领） | `/connections` | ✅ 完成 |
| **Exchanges** | `exchange/`（请求/接受/拒绝/取消 + 联系方式交换） | `/messages/[id]` 内的交换面板 | ✅ 完成 |
| **Moments** | `moments/`、`uploads/`（图片 + 视频转码） | `/moments`、`/moments/[id]`、`/moments/compose`、`/moments/settings`、`/moments/user/[id]` | ✅ 完成（含视频上传转码、评论/回复、编辑/删除、审核状态） |
| **Reports** | `safety/`（举报 + 归属校验） | 动态与聊天的举报弹窗 | ✅ 完成 |
| **Blocks** | `safety/` | `/me/safety` | ✅ 完成 |
| **Admin** | `admin/`（权限矩阵 22 项权限、fail-closed 守卫、22 个域） | `apps/admin` 23 个页面 | ✅ 完成 |
| **AuditLog** | `AdminAuditLog`、`SecurityEvent`、`AccessLog` | `/audit`、`/risk`、`/ops/access-logs`、`/ops/access-logs/[id]` | ✅ 完成 |

**额外的已实现能力**（超出计划清单）：意见反馈（`feedback/` + `/feedback`）、IP 封禁（两级 + 中间件 + `/ops/ip-bans`）、发现页类别管理（`/discover-categories`）、外部社交账号动态同步（`social-sync/`，5 个 adapter）、内容审核队列（`/moderation-moments`）。

---

## C. 未完成模块（每条都有代码/数据证据）

| # | 未完成项 | 证据 | 阻塞类型 |
|---|---|---|---|
| C1 | 搜索页 / 话题页 | API 层不存在对应接口（`docs/FUNCTIONAL-TEST-UI-UX.md` §2.22 已核对） | 需产品先定数据契约 |
| C2 | admin 评论审核视图 | `Report` 无 `commentId` 列；动态审核已做，评论未做 | 需迁移 + 权限设计 |
| C3 | 已读回执 / 会话未读数 /「未读 ≤5」 | 需 `ConversationMember.lastReadAt` | 需迁移 |
| C4 | 收藏（Bookmark） | 需新建 `MomentBookmark` | 需迁移 |
| C5 | 通知去重 | 需 `Notification(userId,type,targetId,window)` 唯一索引 | 需迁移 |
| C6 | **《用户协议》《隐私政策》《社区规则》正文** | `/legal` 页面自述缺失；`/register` 已写「注册即表示同意社区规则」但无正文 | 需法务/产品提供文本（**合规风险最高**） |
| C7 | admin 逐页视觉迁移 | 只做了 token 收敛（63 → 10 处 hex），有意未逐页改 | 有意保留 |
| C8 | `packages/{types,config,validation}` | 三个包在 `apps/` 下引用数均为 **0**（实测） | 死代码，需决定删除或启用 |
| C9 | **CI** | 仓库无任何 CI 配置 | 缺失（是后续开发的安全网） |
| C10 | mobile 可验证性 | `apps/mobile` 无行为测试（脚本自述「no automated behavioural tests exist yet」）；缺图标/启动图资源 | 需真机/模拟器 |
| C11 | Phase G 剩余 / 搜索 | 同 C1 | — |
| C12 | 状态转换矩阵 / 日期时区 | `docs/REPAIR-2026-10.md` §4.1、§4.2 | 行为变更，需产品确认 |
| C13 | 文档漂移 | `docs/AI_CONTEXT.md` 仍有 `DOC_DRIFT` | 待校准 |

---

## D. 当前 Git 状态

| 项 | 值 |
|---|---|
| 分支 | `master` |
| HEAD | `b033c10 docs(handover): 标注本次修复的提交号 c618e6d` |
| 与远端 | `HEAD == origin/master`（本地与远端完全同步） |
| 工作区 | **干净**（无未暂存、无未跟踪） |
| 提交总数 | 31 |
| 远端 | `https://github.com/yyfmjin/talkfirst.git` |

**最近 8 条提交**

```
b033c10  10-04  docs(handover): 标注本次修复的提交号 c618e6d
c618e6d  10-04  test(static): 修复 51c2cbb 遗留的静态测试基线回归
51c2cbb  10-03  feat: 运维/管理端四项能力 + 外部社交账号动态同步
145b7bb  10-03  feat(uploads): 视频上传与转码 + 修复 6 个使其无法工作的缺陷
55488b6  10-03  fix(web): 动态列表的删除按钮按真实归属显示，不再只在「我的」标签页
0a64afd  10-03  merge: 整合远端 Gmail 验证码分支，保留本地安全加固
ebe1e31  10-03  chore(sync): 全量同步已积累的工作 + Google 快捷登录 + 密钥入库阻断
60fc041  10-03  feat(oauth): 上线预检脚本，把 P6 联调变成一条命令
```

**未提交的本地修改**：无。

> **P0-00 本轮未 commit 任何内容。** 本报告文件 `docs/P0-00-BASELINE.md` 处于未跟踪状态，等待你确认。

---

## E. 测试状态（全部为本轮实测）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查（7 workspace） | `npm run typecheck` | ✅ 0 错误 |
| API 全量单测 | `cd apps/api && npx jest --runInBand` | ✅ **86 suites / 1602 tests 全通过**（57s） |
| web 静态测试 | `npm run test:static`（web） | ✅ 16/16 |
| admin 静态测试 | `npm run test:static`（admin） | ✅ 28/28 |
| lint（api / web / admin） | `npm run lint` | ✅ 0 error / 0 warning |
| API 构建 | `npm run build -w @talkfirst/api` | ✅ 通过 |
| web 构建 | `npm run build -w @talkfirst/web` | ✅ 通过（38 个路由全部产出） |
| admin 构建 | `npm run build -w @talkfirst/admin` | ✅ 通过 |
| 静态契约（testids/主题/导入） | `node scripts/static-contract-check.mjs`（**须在仓库根运行**） | ✅ 79 源文件 / 93 主题色 / 102 E2E testids 全部满足 |

### E.1 ⚠️ 两个静态检查器当前不可信（本轮新发现）

| 检查器 | 表现 | 判定 |
|---|---|---|
| `scripts/jsx-balance-check.mjs` | 报 **220 条 finding（69 个文件）**，例如 `visibility-select.tsx:70 closing </button> does not match <div> opened at line 49` | **误报**。已逐行核对：`</button>` 闭合的是 `VISIBILITY_TIERS.map()` 回调 `return (` 内的 `<button>`；且 `apps/web` 的 `next build` **通过**，JSX 语法必然合法。该检查器不处理 `{}` 表达式内的嵌套 JSX |
| `scripts/tf-prop-check.mjs` | 报 **254 条 finding**，且 `--self-test` 输出 `THE CHECKER IS WRONG, not your code. Fix scripts/tf-prop-check.mjs before trusting its output.` | **自身自检失败**，在被修好前其输出不能作为门禁依据 |

两个脚本 `exit code` 都是 `0`，所以它们**不会让 `npm run test:static` 变红**——也就是说当前"静态契约"这道门实际上只有 `static-contract-check.mjs` 一处在真正生效。

### E.2 ⚠️ 从 workspace 内调用契约检查必然误报

`apps/web/package.json` 的脚本是 `node ../../scripts/static-contract-check.mjs`，而该脚本用 `const ROOT = process.cwd()`（`static-contract-check.mjs:40`）当仓库根。经 `npm run test:contracts -w @talkfirst/web` 调用时 cwd 是 `apps/web`，于是必然报：

```
### barrel (1)
  apps/web/src/components/tf/index.ts
      tf/index.ts is missing
```

而该文件**实际存在**（2880 字节）。从仓库根运行则完全通过。**规范用法：在仓库根直接 `node scripts/*.mjs`**；`scripts/verify.bat` 正是这样做的。

### E.3 Playwright（本轮未重跑）

本轮**没有重跑** Playwright（`NOT VERIFIED in this pass`）。已记录的既有失败：

- web：`chat-socket` 1 条、`moment-compose` 2 条、`profile` 1 条；desktop 与 phone 两个 project **完全一致**，单独运行也失败，均在未改动文件中。基线为各 project **152 passed / 4 failed**。
- admin：10 条失败，原因是选择器歧义（如 `getByRole('heading', {name:'屏蔽关系'})` 同时匹配 `<h1>` 与 `<h2>`）。
- 全量连跑两个 project 会撞 `globalTimeout: 20 * 60_000`（表现为 23 条 "did not run"），**分 project 跑即可**。
- `apps/admin` 的 `npm test` 会**连带执行 Playwright**（`test` = 静态测试 && `playwright test`），且 Playwright 的 `webServer` 需要已构建的 API（`node dist/main.js`）与 3000 端口。

### E.4 API 测试必须串行

`npx jest` 默认并行时，需要真实数据库的 `oauth-flow-http.spec.ts` 会与其它 worker 争用而偶发失败；`--runInBand` 串行后 1602 条全绿。**CI 必须串行或隔离该套件。**

---

## F. Prisma / 数据库状态

| 项 | 值 |
|---|---|
| schema 位置 | `prisma/schema.prisma`（datasource `db`，PostgreSQL） |
| 迁移数量 | **29** |
| `prisma migrate status` | ✅ `Database schema is up to date!` |
| **漂移检测** | ✅ `prisma migrate diff --from-schema-datasource --to-schema-datamodel` = **No difference detected** |
| 本地库 | `localhost:5433` / db=`talkfirst` / user=`talkfirst`（密码已隐去，48 字符） |
| seed | `prisma/seed.ts`（17KB，`npx tsx prisma/seed.ts`） |

### F.1 本地库数据量（实测）

| 表 | 行数 | 含义 |
|---|---|---|
| `User` | 13 | 有测试用户 |
| `Moment` | 4 | 有测试动态 |
| `AdminUser` | **0** | 无角色行 → 走 `isAdmin` 兼容回退 |
| `AccessLog` | **0** | 访问日志为空 |
| `IpBan` | 0 | — |
| `Feedback` | 0 | — |
| `DiscoverCategory` | 0 | → 发现页类别走内置回落 |
| `SocialSyncAccount` | 0 | — |

**管理员可用性**：`User.isAdmin = true` 共 1 个（`admin@talkfirst.dev`，状态 `ACTIVE`）。`AdminUser` 表 0 行，但 `admin.guard.ts:93` 明确保留兼容回退——「`isAdmin` 为真但没有 `AdminUser` 行」仍可进入，角色视作 `SUPER_ADMIN`。**结论：管理端本地可登录，不是阻塞项。**

### F.2 敏感字段（设计层面的现状）

- `User.passwordHash` 可空（OAuth-only 账号无伪造凭据）。
- `OAuthIdentity`：`(provider, providerUserId)` 唯一键，邮箱仅作快照。
- `SocialSyncAccount` 的第三方 token：**AES-256-GCM**，密钥为 `TOKEN_ENCRYPTION_KEY`（`scryptSync` 派生，`token-crypto.service.ts`）。
- `AccessLog` 含原始客户端 IP 与 User-Agent，由独立权限 `ops:read` 保护。

### F.3 生产库待应用的迁移

生产库需要应用 **6 个**新迁移（均为 10-03 那批，全部是追加式）：

```
20261003094404_social_sync_accounts
20261003100633_ip_ban_and_app_setting
20261003101958_feedback
20261003102800_moment_review_status
20261003104212_discover_categories
20261003174412_social_sync_synclimit_check
```

> 上述是"本地有、生产尚无"的推断依据：`docs/HANDOVER-2026-10-04-dsh-takeover.md` 记录了最后一批提交是在 10-03 18:00 后推送、且服务器尚未拉取。**生产库的实际迁移状态本机无法查询 —— `NOT VERIFIED`。**

---

## G. 生产环境问题（按严重度）

| # | 级别 | 问题 | 证据 | 建议 |
|---|---|---|---|---|
| **G1** | 🔴 | **生产未部署**：远端已到 `b033c10`，服务器没有拉取；6 个迁移未应用 | `docs/HANDOVER-…` §4.A1 | `scripts/deploy-pull.sh`（含前置校验 + `--ff-only`） |
| **G2** | 🔴 | **`NEXT_PUBLIC_API_BASE_URL` 未配置**。它是**构建期**注入：`apps/web/Dockerfile:3` 与 `apps/admin/Dockerfile:3` 的 ARG 默认值是 `http://localhost:4000/api/v1`。本轮本机构建产物里烘焙进去的正是 `localhost:4000`（24 处）。**整个源码树里 `3.141.192.106` 出现 0 次**（含所有产物）→ 线上那个 `http://3.141.192.106:4000` **只能来自服务器构建时的环境变量** | 实测 grep + Dockerfile | 服务器 `.env` 设 `NEXT_PUBLIC_API_BASE_URL=https://api.talkfirst.ccwu.cc/api/v1` 与 `NEXT_PUBLIC_SOCKET_BASE_URL=https://api.talkfirst.ccwu.cc`，然后**重新构建 web 与 admin**（改完不重建无效） |
| **G3** | 🔴 | **`TOKEN_ENCRYPTION_KEY` 未配置**：`main.ts:98` 启动断言，生产缺失**直接拒绝启动**（无安全默认值——否则会用仓库里可读的密钥加密真实用户 token）。`.env.example` 里该键是**注释行**，容易漏 | `main.ts:98`、`.env.example:56` | 生产设 32+ 随机字符（`openssl rand -base64 48`）。**警告：轮换它会让已存 token 全部失效** |
| **G4** | 🔴 | **`API_PUBLIC_URL` 本机 = `http://localhost:4000`**：生产沿用会在 `assertOAuthConfiguration()` 处因 loopback + 生产部署**拒绝启动**（fail-closed，行为正确） | `oauth-config.ts:161-184`、本机 `.env` | 生产设 `API_PUBLIC_URL=https://api.talkfirst.ccwu.cc`（Google 回调地址由它派生，两者不能漂移） |
| **G5** | 🟠 | **`TRUST_PROXY` 需按真实拓扑确认真实值**（本机 `0`）。生产是 Nginx + Cloudflare，值不对会导致：访客 IP 可被 `X-Forwarded-For` 伪造，或封禁中间件封到代理 IP（等于全站拒绝） | `main.ts` `assertTrustProxyConfigured`、`security/client-ip.ts` | 按跳数设置（Cloudflare → Nginx → API 通常为 **2**），**需在服务器实测确认** |
| **G6** | 🟠 | **本机 `.env` 里 `OAUTH_DEV_PROVIDER=true`**（本地假 OIDC provider）。生产必须为 false/未设，否则同样拒绝启动 | `oauth-config.ts:111`、本机 `.env` | 服务器 `.env` 确保未开启 |
| **G7** | 🟠 | `SECURITY_DEVICE_SALT` 生产必填（本机已设 64 字符）；缺失会让 `deviceHash` 全为 NULL | `main.ts:90` | 服务器补上 |
| **G8** | 🟠 | **`.env.docker.example` 缺 16 个新变量**：`API_PUBLIC_URL`、`OAUTH_PROVIDERS`、`OAUTH_DEV_PROVIDER`、`GOOGLE_CLIENT_ID/SECRET`、`DATABASE_URL`、`DIRECT_URL`、`PUBLIC_UPLOAD_BASE_URL`、`SOCIAL_SYNC_ENABLED`、`SOCIAL_SYNC_INTERVAL_MINUTES`、6 个 `VIDEO_*` | 实测 `comm` 对比 | 用 Docker 方式部署会缺键；补模板 |
| **G9** | 🟠 | **Nginx `client_max_body_size` 需为 100m**（视频上传），该配置不在本仓库 | 视频功能设计 | 服务器侧同步改 |
| **G10** | 🟡 | `/api/v1/health` 只是固定返回 `ok`，**不检查 DB/Redis** → 容器编排会把"DB 挂了但进程活着"判为健康 | `health.controller.ts:5` | 增加 readiness（带 DB ping） |
| **G11** | 🟡 | 本机 `.env` 是「生产风格混用」：`NODE_ENV=development` 但含真实 Gmail 应用密码与 Google 凭据 | 实测（值未读取/未记录） | 生产与本地环境文件分离 |
| **G12** | 🟡 | 本机 `AccessLog` 为 **0 行**：说明最近没有真实请求流经该库，**访问日志写入链路在当前数据上未被验证** | 实测 count | 部署后用真实请求确认写入 |
| **G13** | 🟡 | `apps/api/dist` 曾经入库、现已从版本控制移除；`start-local.bat` 仍直接跑 `dist/main.js` → 全新克隆后该脚本会失败 | `git ls-files apps/api/dist` = 0 | 本地一律用 `start-local-dev.bat` |

---

## H. 推荐的下一步

### H.1 顺序（这一步很重要）

**P0-01（修复生产 API HTTPS）之前，必须先补 G3 / G5 / G7 / G4 四个环境变量**。否则 P0-01 把代码部署上去后，API 会因为 `TOKEN_ENCRYPTION_KEY`、`API_PUBLIC_URL`（loopback）、`TRUST_PROXY`（未声明）而**拒绝启动** —— 修完"前端连不上"会立刻变成"后端起不来"。

推荐执行顺序：

1. **服务器 `.env` 补键**（不提交、不回传）：
   `API_PUBLIC_URL=https://api.talkfirst.ccwu.cc`
   `NEXT_PUBLIC_API_BASE_URL=https://api.talkfirst.ccwu.cc/api/v1`
   `NEXT_PUBLIC_SOCKET_BASE_URL=https://api.talkfirst.ccwu.cc`
   `TOKEN_ENCRYPTION_KEY=<openssl rand -base64 48>`
   `SECURITY_DEVICE_SALT=<已有的不变>`
   `TRUST_PROXY=<按实测拓扑>`
   `OAUTH_DEV_PROVIDER` 不设/为 false
2. **P0-01**：全仓库定位 API base URL 来源 → 确认结论（源码树无硬编码 IP，问题在构建期 env）→ 修复配置 → **重新构建 web/admin** → 验证产物中不再出现旧地址、出现新地址。
3. **部署**：`scripts/deploy-pull.sh`（拉取 → 校验 → `npm ci` → `prisma generate` → 构建 → `prisma migrate deploy` → 重启 pm2/systemd）。
4. **Nginx** 同步 `client_max_body_size 100m`。
5. **部署后验收**（见 H.2）。

### H.2 部署后的手工验收步骤（给 P0-01 用）

1. `curl -s https://api.talkfirst.ccwu.cc/api/v1/health` → 期望 `{"success":true,...}`。
2. 浏览器打开 `https://talkfirst.ccwu.cc/login`，DevTools → Network，再点注册；**断言**：所有 `/api/v1/*` 请求的 host 都是 `api.talkfirst.ccwu.cc`，**不出现** `3.141.192.106:4000`，Console **无 Mixed Content 报错**。
3. 管理端 `https://admin…/login` 登录成功后打开任一页面，确认请求同样走 https。
4. Chat 页发一条消息，确认 Socket.IO 连的是 `wss://api.talkfirst.ccwu.cc`（不是 `ws://` 或 IP）。
5. 上传一张头像 + 一条带视频的动态，确认 100m 体量限制已生效（G9）。
6. 查生产库 `AccessLog` 是否有新行（G12）、`_prisma_migrations` 是否为 29 条。

### H.3 建议在 P0-01 之后、进入 P0-02 之前处理（不阻塞 P0-01）

1. **CI（C9）** —— 当前是代码级安全网缺失。注意：API 测试必须串行；两个不可信检查器（E.1）要么修好、要么从门禁里移除；`apps/admin` 的 `npm test` 应把 Playwright 与静态测试分开。
2. **修正 workspace 内的契约脚本调用方式（E.2）** —— 目前 `npm run test:contracts -w @talkfirst/web` 必然误报，会误导后来者。
3. **法律文件正文（C6）** —— 合规风险最高，需要你或法务提供文本。
4. **`packages/*` 死代码（C8）** —— 三个包 0 引用，删除或启用都应在 CI 就位后做。

---

## 本轮执行的检查动作与未做的事

**做了**：git 状态与提交历史；monorepo 结构、模块清单、启动方式、配置加载链与启动断言；三个 workspace 的构建与全量测试；静态契约与两个附加检查器；Prisma 迁移状态与 schema↔库漂移检测；本地库关键表计数与管理员可用性；前端 API 基址解析与构建产物取证；部署配置（compose / Dockerfile / deploy 脚本）与环境变量模板对比。

**明确没做**：

- 未修改任何业务代码、未删除文件、未重构。
- 未创建迁移、未修改数据库结构（只做了只读查询与 `migrate diff`）。
- 未 commit、未 push。
- **未连接生产服务器**，生产库的迁移状态、服务器 `.env` 的真实内容、Nginx 配置均为 `NOT VERIFIED`。
- 未重跑 Playwright（§E.3）。
- 未执行 P0-01 及之后任何任务。
