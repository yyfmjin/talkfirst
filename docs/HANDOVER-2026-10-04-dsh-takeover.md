# TalkFirst — DSH 开发进度接管交接文档

> 日期：2026-10-04
> 来源：`dsh`（DeepSeek Harness 桌面版）在 `D:\文件\网站\TalkFirst` 工作区的全部会话记录
> 目的：把 dsh 里关于 TalkFirst 的开发进度、结论、未验证项和遗留待办**完整迁移到仓库内**，作为后续开发（无论用哪个 AI 或哪个环境）的唯一交接基线。

---

## 0. 数据来源与可复查性

| 项 | 内容 |
|---|---|
| 原始会话目录 | `C:\Users\17366\.dsh\sessions\--D-~6587~4EF6-~7F51~7AD9-TalkFirst--\` |
| 工作区注册表 | `C:\Users\17366\.dsh\storages\workspace.json` → workspace `21c3dba3-…`，path = `D:\文件\网站\TalkFirst` |
| 会话数量 | **17 个**：3 个主会话 + 14 个子代理（审查角色）会话 |
| 时间跨度 | 2026-10-02 14:33 → 2026-10-04 00:58（GMT+8） |
| 存储格式 | `session.v4.jsonl.zstd`（zstd 压缩的 JSONL，逐事件追加） |

**3 个主会话**

| 会话 | 标题 | 轮次 | 时间 |
|---|---|---|---|
| `session-149f4cfa-…` | 项目全面审查、问题发现、修复与回归验证总指令 | 79 turns | 10-02 14:33 → 10-04 00:58 |
| `session-f44e5748-…` | 启动项目 | 15 turns | 10-02 17:37 → 10-03 14:59 |
| `session-a1f413fe-…` | 动态删除与评论管理功能 | 22 turns | 10-02 21:52 → 10-03 17:38 |

**14 个子代理会话** 是 10-02 的三批只读审查（14:43–14:48 / 17:08–17:14 / 19:51–19:56）：前端、后端、移动端、QA、安全、API 契约、状态机、设计系统、访问日志采集等角色。它们产出了最初那份 66 项问题清单（P0×4 / P1×11 / P2×31 / P3×20），已落进 `docs/REPAIR-2026-10.md`。

**复查方式**（如需回溯原始对话）：

```bash
pip install zstandard
python -c "
import zstandard,glob,os
for p in glob.glob(r'C:\Users\17366\.dsh\sessions\*TalkFirst*\*\*.zstd'):
    open(os.path.basename(p)[:-5],'wb').write(zstandard.ZstdDecompressor().stream_reader(open(p,'rb')).read())
"
```

已解压的副本与摘要（本次接管生成，非仓库内容）位于 `D:\tmp\dsh-talkfirst\`，其中 `extract/` 下有 `users.md`（全部用户指令）、`turns.md`（逐轮结论）、`summaries.md`（上下文压缩摘要）、`todos-goals.md`（任务与目标状态历史）、`subagents.md`（14 份审查报告）。

---

## 1. 接管时的仓库事实（本次实测，非引用 dsh 叙述）

| 项 | 值 |
|---|---|
| 远端 | `origin` = `https://github.com/yyfmjin/talkfirst.git` |
| 分支 / HEAD | `master` @ `51c2cbb` |
| 与远端关系 | `HEAD == origin/master`，ahead 0 / behind 0 |
| 工作区 | 干净（无未暂存、无未跟踪） |
| 提交总数 | 31 |
| 迁移总数 | 29，`prisma migrate status` → **Database schema is up to date** |
| 数据库 | PostgreSQL @ `localhost:5433` 可连接（本次实测端口开放、迁移已应用） |
| workspace | api / web / admin / mobile + packages/{types,config,validation} 共 7 个 typecheck 目标 |

**dsh 时代（10-02 起）产生的提交**

| commit | 时间 | 内容 |
|---|---|---|
| `51c2cbb` | 10-03 19:48 | 运维/管理端四项能力 + 外部社交账号动态同步（66 files，+11865/−149） |
| `145b7bb` | 10-03 17:13 | 视频上传与转码 + 修复 6 个使其无法工作的缺陷 |
| `55488b6` | 10-03 16:52 | 动态列表删除按钮按真实归属显示 |
| `0a64afd` | 10-03 10:19 | merge：整合远端 Gmail 验证码分支，保留本地 8 项安全加固 |
| `ebe1e31` | 10-03 09:52 | 全量同步（187 files，+31300/−9353）+ Google 快捷登录 + 密钥入库阻断 |
| `60fc041` / `3e5167b` / `9ef0d0c` | 10-03 08:5x | Google 快捷登录三件套（预检脚本 / E2E 跳过 / 主实现） |
| `9b055dc` | 10-02 14:06 | redesign moment composer UI（被定为全站设计基准 PC-3.6） |

---

## 2. 本次接管的验证结果（重跑 dsh 的最终声明）

dsh 在 10-02 的大部分时间里 **shell 完全不可用**（每次 `pwsh` 都以 `3221225794` = `0xC0000142 STATUS_DLL_INIT_FAILED` 退出，导致 build/typecheck/lint/test/git/docker 一次都跑不了），直到 10-03 17:11 才修好。因此它早期产出的多数改动**只有静态复核、没有编译与测试证据**。

本次接管在同一批产物上重跑：

| 检查 | 命令 | 结果 |
|---|---|---|
| typecheck（7 workspace） | `npm run typecheck` | ✅ 全部通过 |
| API 全量测试 | `cd apps/api && npx jest --runInBand` | ✅ **86 suites / 1602 tests 全部通过**（56s） |
| lint | `npm run lint` | ✅ API eslint 无输出、web `No ESLint warnings or errors`、admin 通过 |
| 静态契约 / 静态测试 | `npm run test:static` | ✅ **web 16/16、admin 28/28**（接管时不合格，已修复，见 §2.1） |
| UI-copy 扫描器（CLI） | `node scripts/ui-copy-scan.mjs apps/admin/src` | ✅ 0 findings |
| 迁移状态 | `npx prisma migrate status` | ✅ 29 migrations，schema up to date |

**结论：dsh 最终报告的验证数字（86 套件 / 1602 用例）在接管环境中可复现，且工作树与远端完全一致。** 当时仓库处于干净、可复现的状态点，但**并非“测试全绿”**——两个 workspace 的静态测试已红（见 §2.1）。

### 2.1 本次接管修复：静态测试基线回归（dsh 未发现）

dsh 在 10-03 18:00 之后的两笔提交（内容审核/反馈/IP 封禁/发现页类别/社交同步，`51c2cbb`）**再也没有跑过 `apps/web` 与 `apps/admin` 的静态测试**——最后一份报告只声明了 typecheck / build / lint 与 API 测试，而这两个 workspace 的静态测试**当时就已经是红的**，并且一直红着推上了远端。

本次接管实测失败明细与修复：

| workspace | 失败 | 性质 | 处理 |
|---|---|---|---|
| `apps/web` | 1/16：`smoke.test.mjs` 的 composer 断言 | 正则 `/apiFetch\("\/moments"/` 不允许类型实参；C 阶段给该调用加了 `apiFetch<{ reviewStatus?: string }>` 以便提示作者“待审”而非跳到空信息流 | 正则改为 `apiFetch(?:<[^>]*>)?\("\/moments"`，**语义未放宽**（仍要求经共享客户端发到 `/moments`，禁止裸 `fetch`） |
| `apps/admin` | 4/28：变更检测型允许清单未同步 | 侧边栏域列表（9→14）、权限词表（21→22）、写路由集合（4→12）、UUID 参数计数（11→16）、迁移允许清单（少 6 条）、schema model/enum 清单（少 6 model / 6 enum） | 按实际契约逐条补齐并注明理由（新增的 `ops:write` 是**独立权限**：ANALYST 持 `ops:read` 且只读，一个权限无法既放行读日志又放行封禁） |
| `apps/admin` | 1/28：`ui-copy` 扫描 6 条英文命中 | 全部是**值而非文案**：访问日志详情里的 HTTP 请求头名（`Content-Type` / `Referer` / `Origin` / `Accept-Language`）、发现页类别 `slug` 与示例值（`minecraft` / `steam` / `language-exchange`）、表单示例关键词 `travel, backpacking` | 并入既有豁免机制（沿用 `isAdmin` / `HTTP` / `ops:read` 的先例），两处清单（测试与 CLI）同步扩写并写明「必须逐字展示，翻译反而错」 |

修复后：`apps/web` 16/16、`apps/admin` 28/28、CLI 扫描 0 findings。**没有任何检查被降低标准换绿**：放宽的唯一一条正则仍然钉住原来的契约，其余全部是把「人必须确认过的变更」写进允许清单。

### 2.2 已知的、非本次引入的问题

- **`npx jest` 默认并行时存在争用**：需要真实数据库的 `oauth-flow-http.spec.ts` 会与其它 worker 冲突导致偶发失败。用 `--runInBand` 串行后全绿。**建议 CI 使用串行**，或将该套件单独隔离。
- **Playwright 既有失败**：`chat-socket` 1 条、`moment-compose` 2 条、`profile` 1 条，desktop 与 phone 两个 project 完全一致，**单独运行也失败**，均位于 dsh 未改动的文件中。`apps/admin` 另有 10 条 Playwright 失败，原因是选择器歧义（如 `getByRole('heading', {name:'屏蔽关系'})` 同时匹配 `<h1>` 与 `<h2>`）。
- **全量两个 project 连跑会撞 `globalTimeout: 20 * 60_000`**，表现为 23 条 “did not run”。**分 project 跑即可**（各 152 passed / 4 failed）。

---

## 3. dsh 已完成的工作

### 3.1 全量审查与修复（会话一，10-02）
- 15 角色审查 → 66 项问题（P0×4 / P1×11 / P2×31 / P3×20），全部落进 `docs/REPAIR-2026-10.md`。
- P0 全部修复：`replace*` 数据丢失（事务化）、消息路径账号/连接状态校验、uploads 卷持久化、连接双接受竞态。
- P1 全部修复：admin 测试门禁、`PermissionGuard` 改为 fail-closed、生产 fail-closed（`ALLOW_INSECURE_DEFAULTS` 单一判定入口）、登出/注销、401 集中处理、peerId、审核权限矩阵、mobile 基址配置化。
- P2 部分修复：keyset 游标 `(createdAt,id)`、`UuidParamPipe` 挂到 24 个 `@Param`、`POST /blocks` 与举报归属校验、动态 DTO 接 ValidationPipe、DEMO 伪造计数修正。
- 功能补全：忘记密码/重置（含账号枚举防护、重置后撤销全部 refresh token）、Discover 每日额度真正生效、加载更早的聊天记录。

### 3.2 设计系统 + 全站 UI/UX 重构（Phase A–I）
文档：`docs/DESIGN-SYSTEM.md`（规范与计划）、`docs/FUNCTIONAL-TEST-UI-UX.md`（逐页验收与人工测试清单）。

| Phase | 范围 | 状态 |
|---|---|---|
| A | Design System（`design/tokens.ts` + 22 个 `tf/*` 原语 + 全局基线） | ✅ |
| B | 启动页 + PhoneShell + Bottom Nav + ScreenHeader + `/me` 入口分层 + 品牌紫→蓝 | ✅ |
| C | Auth + Onboarding（登录/注册/验证/重置/legal/onboarding 8 步） | ✅ |
| D | Discover + Feed + 动态详情 + 某人动态 | ✅ |
| E | Messages + Chat + Connections + Exchange + 聊天安全菜单 | ✅ |
| F | Profile + `/me/*` 子页 + `moments/settings` | ✅ |
| G | 通知中心 | ✅ |
| G | 搜索页 / 话题页 | ⛔ **确认无法实现**：API 层不存在对应接口（见 `docs/FUNCTIONAL-TEST-UI-UX.md` §2.22），需产品决策 |
| H | 安全中心 `/me/safety` + 举报/拉黑 | ✅ |
| I | Admin token 收敛（63 → 10 处 hex） | 🔶 逐页视觉迁移**刻意未做**（理由见 §2.23） |

### 3.3 运维能力（Phase O0–O2）
文档：`docs/OPS-PHASE-O-PLAN.md`（561 行，含 16 项差距、4 项关键决策、每阶段实测证据）。
- O0：修复 admin 静态测试基线（26/28 → 28/28）；**额外发现并修复 9 个 spec 共用的 `reflectorReturning` 桩件缺陷**（该缺陷曾让 `PERMISSION_UNDECLARED` 这条 fail-closed 路径从未被覆盖）。
- O1：守卫拒绝入日志（拦截器下沉为中间件）、设备识别落库、日志保留策略、IP 归一化（`::1` → `127.0.0.1`）；**发现真实安全缺陷**：无代理拓扑下 `TRUST_PROXY` 默认 `1` 允许 `X-Forwarded-For` 伪造访客 IP。
- O2：`ops:read` 权限 + 3 个读取 API + 索引迁移 + `/ops/access-logs` 管理页。

### 3.4 内容管理（会话三）
- 动态与评论的**修改 / 删除**（`MomentEditDialog` 重写、详情页菜单、二次确认、中文错误映射、API 单测、E2E 用例）。
- 修复：动态列表删除按钮只在「我的」标签页渲染（归属是数据行属性，不是筛选条件属性）；错误过滤器在拒绝路径上的 `ERR_HTTP_HEADERS_SENT`。

### 3.5 视频上传与转码（`145b7bb`）
- 动态视频从 base64 JSON（受 8MB body 上限约束，实际约 5MB）改为 **multipart 流式上传 + 磁盘临时文件 + ffmpeg 转码**。
- 新增 `POST /uploads/moment-video`；自研流式 multipart 解析器（multer 的 diskStorage 在应用侧不可解析）；`VideoCompressionService`（ffprobe 探测 + H.264/AAC/MP4 + `+faststart`）；竖/横屏分别取缩放盒保持比例；目标 15MB、最多 3 轮重压；超时与并发限制；`finally` 清理临时文件。
- 未改动 Prisma schema、图片上传、聊天上传、鉴权。

### 3.6 Google 快捷登录（`9ef0d0c` / `3e5167b` / `60fc041` / `0a64afd`）
- 授权码 + PKCE(S256) + 服务端回调；`state`/`nonce`/`code_verifier` 存签名 HttpOnly Cookie 且单次使用；自实现 JWKS 缓存（**未新增运行时依赖**）；钉死 RS256、校验 `iss`/`aud`/`exp`/`nonce`/`email_verified === true`。
- `OAuthIdentity` 模型（`(provider, providerUserId)` 唯一键）、`User.passwordHash` 可空、`SessionService` 作为唯一会话签发出口。
- 前端登录/注册入口、隐私政策页、首设密码；本地假 OIDC provider 让无凭据也能端到端；`docs/OAUTH-SETUP.md` + `scripts/oauth-preflight.mjs`。
- 范围决定：**仅 Google、面向海外**，手机号注册登录暂缓，Apple 放弃。

### 3.7 运维/管理端四项 + 外部社交同步（`51c2cbb`）
1. **访问日志详情页** `/ops/access-logs/[id]`（修 404；可从日志跳该用户 / 该 IP 的记录）。
2. **IP 封禁**：两级（二级只保留登录/注册/验证/找回/登出/`auth/me`；一级全拒，管理端例外）、复用同一 `client-ip.ts` 解析实现、封禁与解封写 `AdminAuditLog`、被拒请求仍写 `AccessLog`（`errorCode=IP_BANNED`）、防自锁三闸（拒回环/内网/CGNAT、拒 admin 日志出现过的地址、无 `AdminUser` 时拒绝执行）。查库失败时**fail-open**（有意取舍）。
3. **意见反馈**：`/me/feedback` 提交与历史 + 管理端 `/feedback` 队列与回复 + `AppSetting` 存可改反馈邮箱（读失败回落默认值）。
4. **内容审核**：`Moment.reviewStatus` + 分级队列（`scanText.blocked` 拒绝；HIGH 或 MEDIUM 且非可信账号 → `PENDING`；可信账号豁免以免队列被淹没）。顺带修掉一处漏洞：详情接口原本未检查可见性，知道 ID 即可看到待审内容。
5. **发现页类别管理**：类别从代码常量改为 `DiscoverCategory` 表 + CRUD + `/discover-categories` 页；库中无数据时回落内置两组（不需播种）；slug 不可改。
6. **外部社交账号动态同步**：Adapter 架构 + 5 个 adapter（YouTube 真实可用；X / TikTok / Instagram / 抖音为 `REQUIRES_APPROVAL`）+ 统一 `ExternalPost` + 去重 upsert（`(socialAccountId, provider, externalPostId)`，更新时**绝不触碰 `hidden` / `importedMomentId`**）+ 手动/定时同步（`@Cron` 每 30 分钟，每 tick 最多 10 个账号、最旧优先）+ AES-256-GCM token 加密 + 进程内并发锁（非 Redis）。
   - 模型命名：因既有 `SocialAccount`（好友互看 handle）占用，实际落地为 **`SocialSyncAccount` / `SocialSyncPost` / `SocialSyncStatus`**（用户已确认接受）。

---

## 4. 遗留待办

### A. 必须由账号持有人完成（AI 无法代办）

| # | 事项 | 为什么必须你做 | 状态 |
|---|---|---|---|
| A1 | **生产部署未执行** | dsh 只做了 `git push`，**服务器没有拉取**。生产需：`git pull` → `npm ci` → 构建 → `prisma migrate deploy`（6 个新迁移）→ 重启 PM2。仓库内有 `scripts/deploy-pull.sh` 可一键完成（含环境变量校验与 `--ff-only` 快进） | ❌ 未做 |
| A2 | **`TOKEN_ENCRYPTION_KEY` 未配置** | `.env.example` 有该键，但**本机 `.env` 里缺失**。生产缺失时 `main.ts` 的启动断言会**拒绝启动**（无安全默认值，否则会用源码里的公开密钥加密真实 token） | ❌ 未配置 |
| A3 | **`TRUST_PROXY` 需按真实拓扑确认真实值** | 当前按「仓库内唯一编排文件 `docker-compose.yml` 直接暴露 API 端口、不含代理」推断为 `0`。**生产是 Nginx + Cloudflare，必须改成对应跳数**，否则封禁中间件可能封到代理 IP（等于全站拒绝） | ⚠️ 待确认 |
| A4 | **`NEXT_PUBLIC_API_BASE_URL` 未配置** | 它是**构建期**注入前端产物的；指向 localhost 的产物部署后整个后台打不开。`deploy-pull.sh` 会校验 | ❌ 未配置 |
| A5 | **YouTube 同步需在 Google Cloud Console 操作** | ① 启用 `YouTube Data API v3`（未启用时读取 403，代码会映射为 `SOCIAL_PERMISSION_DENIED`）；② 登记**同步**回调，与登录回调是两个不同地址：`https://api.talkfirst.ccwu.cc/api/v1/social-sync/youtube/callback` 与本地 `http://localhost:4000/api/v1/social-sync/youtube/callback` | ❌ 未做 |
| A6 | **法律文件正文缺失（合规风险最高）** | `/legal` 目前诚实地说明了这点，但《用户协议》《隐私政策》《社区规则》**正文在代码库中不存在**。一个收集语言、国籍、性别、生日、位置与私人聊天记录的产品没有隐私政策，在欧盟/英国/加州是实质合规风险。拿到正文后可做成 `/terms`、`/privacy` 并接上 `/legal` 勾选项 | ❌ 缺失 |
| A7 | **Google `GOCSPX-` 密钥曾在对话中明文出现** | dsh 已建议轮换；该值未入库（`.env` 从未被 git 跟踪） | ⚠️ 建议轮换 |

### B. 代码层可继续做（无需外部依赖）

| # | 事项 | 出处 | 备注 |
|---|---|---|---|
| B1 | **CI**：typecheck + lint + jest（串行）+ Playwright | `REPAIR-2026-10.md` §4.10 | 是后续所有改动的安全网，建议优先级最高 |
| B2 | `reviewReport` 状态转换矩阵 + `UserStatus` 转换校验（拒绝 `ACTIVE→ACTIVE`、`BANNED→DISABLED`，停止覆盖 `banReason`） | 同上 §4.1 | |
| B3 | admin 日期筛选时区（5 个页面 + `buildDateRange`），并修 `connections` 页漏掉的 `T23:59:59.999` | 同上 §4.2 | 需改半开区间或传浏览器偏移 |
| B4 | **已读回执三件套**（需迁移）：`ConversationMember.lastReadAt` → 会话未读数、消息已读、聊天「未读数 ≤5」 | 同上 §4.3 | schema 变更 |
| B5 | **收藏**（需迁移）：`MomentBookmark` + 列表页 + `/me` 入口 | 同上 §4.4 | schema 变更 |
| B6 | **通知去重**（需迁移）：`Notification(userId,type,targetId,window)` 唯一索引 | 同上 §4.5 | schema 变更 |
| B7 | admin 评论审核视图（需迁移 + 权限） | 同上 §4.6 | 动态审核已在 C 阶段完成，评论未做 |
| B8 | 响应式：`fixed inset-0` 浮层改 shell 内 `absolute`；补 320/414/768/1024 视口用例 | 同上 §4.8 | |
| B9 | SEO：路由级 `metadata`/`generateMetadata` + `sitemap.ts`/`robots.ts` + 品牌化 404 | 同上 §4.9 | |
| B10 | `packages/*` 收敛：三个包 0 引用；`NOTIFICATION_TYPES` 已三处重复且开始漂移 | 同上 §4.11 | |
| B11 | 文档校准：`docs/AI_CONTEXT.md` 仍有大量 `DOC_DRIFT`（schema 行数、已实现功能、测试规模、引用了不存在的「Production Readiness 审计」文件） | 同上 §4.12 | |
| B12 | Phase I 收尾：`app/moments/compose/page.tsx` 的 1 个 `GradientButton` + `components/ui.tsx` 整体删除（`Field`/`SmallButton`/`OutlineButton` 已零调用点） | `FUNCTIONAL-TEST-UI-UX.md` §9 | 需先决定是否改动「设计基准页」 |
| B13 | 已知有意保留的旧实现：Feed 删除动态仍用 `window.confirm`；评论区 3 处手写 `rounded-full` 输入框；`/me/edit` 与 `/me/password` 的 `Field` 无程序化标签 | 同上 §9.2 | |
| B14 | 前端仍保留的浅紫（`#6572D8` 等约 60 处，浅紫底 + 紫字）——**计划内待迁移，不是 bug**。判断标准：同屏出现饱和旧紫与品牌蓝并排才是 bug | 同上 §8 | |
| B15 | `apps/admin` 10 条 Playwright 选择器歧义 | `a1f413fe` 会话 | |

### C. dsh 已确认无法实现（需要产品决策）

| # | 事项 | 结论 |
|---|---|---|
| C1 | 搜索页 / 话题页 | API 层不存在对应接口，动手前核对后放弃 |
| C2 | 4 个社交平台 adapter（X / TikTok / Instagram / 抖音）的真实调用 | 平台准入问题：X 免费层无读取权限（Basic $200/月）、TikTok 需应用审核、Instagram 需 Business/Creator + Facebook 应用审核、抖音需开放平台审核。每个文件头部都标了 `NOT VERIFIED against a live API`；前端文案为「该平台需要开发者审批，目前无法读取动态」 |
| C3 | YouTube adapter 真实调用 | 代码完成，但**从未执行过真实 API 调用**（受 A5 阻塞） |

### D. 明确的验证缺口（必须如实标注）

- **无管理员账号可用**（当时 `AdminUser` 与 `AccessLog` 表均为 0 行），因此 **IP 封禁中间件、内容审核队列、意见反馈、社交同步的「装配后行为」未经真实 HTTP 动态验证** —— 单元测试覆盖了决策逻辑，但没有端到端装配验证。
- 视频转码的 ffmpeg 路径**已在真实数据库/真实进程下测过部分环节**，但生产 Nginx 需同步把 `client_max_body_size` 改为 `100m`（不在本仓库内）。
- 早期（10-02）大量改动是「静态复核」产物，其中**未经编译验证的部分**已由本次接管的 typecheck + jest 全量通过覆盖。

---

## 5. 环境事实与已踩过的坑（避免重复踩）

| 坑 | 事实 |
|---|---|
| dsh shell 不可用 | 每次 `pwsh` 退出码 `3221225794`（`0xC0000142 STATUS_DLL_INIT_FAILED`）。**根因**：`dsh-pwsh-local` 执行器按「显式 pwshPath → 常见位置 → PATH → Windows PowerShell 5.1」查找，本机没有 PowerShell 7，PATH 里解析到一个坏的 `pwsh`（Store reparse point），在 DLL 初始化阶段就死掉，5.1 回退永远走不到。**修复**：在 `C:\Users\17366\.dsh\profiles\desktop\cordis.patch.yml` 里为 `dsh-pwsh-local` 显式声明 `pwshPath: 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'`。配置懒解析，**立即生效、无需重启** |
| 邮件配置曾长期失效 | 代码**从不读** `EMAIL_*`（`.env.example` 明确标注 DEPRECATED）。生效的是 `MAIL_PROVIDER` + `SMTP_*`。`SMTP_FROM` **必须整体加引号**，否则 `docker compose` 解析 `.env` 直接崩 |
| `dist/` 是提交进仓库的构建产物且会过期 | `start-local.bat` 跑的是 `node apps/api/dist/main.js`。**修好的 bug 可能因为 dist 过期而复现**。用 `start-local-dev.bat`（启动前先构建，失败即退出） |
| 配置校验的执行顺序 | `main.ts` 的 `loadEnvironment()` 在任何校验之前用 dotenv 显式加载 `<repo>/.env`（不覆盖已存在的环境变量，所以 Docker/systemd 环境优先） |
| 本地 `.env` 是「生产风格」配置 | 曾导致本地 API 拒绝启动（缺 `SECURITY_DEVICE_SALT`、`TRUST_PROXY`）。现已改为 `NODE_ENV=development` 并补上这两个键 |
| `.env.docker.local` 曾含真实密钥且被暂存 | `JWT_SECRET` / `JWT_REFRESH_SECRET` / `POSTGRES_PASSWORD`。`.gitignore` 曾漏掉它，已补规则并 `git rm --cached`（文件保留在磁盘）。**建议评估是否轮换这三个值** |
| 迁移一旦应用就不能改 | dsh 曾改动已应用的迁移文件导致校验和不匹配，需按 SHA-256 重算恢复 |
| 本地管理员账号 | `173669647@qq.com` / `thanks315`（dsh 在本地库创建的测试管理员） |
| 本地启动 | `start-local-dev.bat`（API :4000 / Web :3000 / Admin :3001）。Playwright 的 `webServer` 会自行拉起 3000 与 4000，与手动启动的服务互相打架；`globalTimeout` 为 20 分钟 |
| 仓库内的验证脚本 | `scripts/verify.bat`（检查器自测 → 静态契约 → typecheck → lint → test:static → build×3）、`scripts/deploy-pull.sh`（服务器端一键部署） |

---

## 6. 建议的下一步顺序

1. **A2 + A3 + A4 + A1**：补 `TOKEN_ENCRYPTION_KEY`、确认 `TRUST_PROXY` 真实值、配 `NEXT_PUBLIC_API_BASE_URL`，然后执行生产部署（6 个迁移 + PM2 重启）。顺序很重要：**先补环境变量再部署**，否则 API 会拒绝启动。
2. **A6 法律文件**：合规风险最高，需要你或法务提供正文。
3. **B1 CI**：在继续任何功能开发之前建立安全网（注意 jest 必须串行）。
4. **A5**：Google Cloud Console 启用 YouTube Data API v3 + 登记同步回调，把 C3 从「未验证」变成「已验证」。
5. **B2–B4**：状态转换矩阵、时区、已读回执（后者是聊天体验的明显缺口）。
6. 其余 B 项按价值排序；C1（搜索/话题）需要产品先给数据契约。

---

## 7. 交接诚实性声明

- 本文档中的**仓库事实与验证数字来自本次接管的实际命令输出**（`git`、`npm run typecheck`、`npx jest --runInBand`、`npm run lint`、`npm run test:static`、`node scripts/ui-copy-scan.mjs`、`npx prisma migrate status`）。
- **dsh 已完成工作**一节的来源是 dsh 会话记录（用户指令、逐轮结论、任务清单、上下文压缩摘要、14 份子代理审查报告），属于**对 dsh 自述的整理**；其中可复核的部分（提交内容、文档、代码是否存在）已在本次接管中抽查确认。
- **§2.1 的 5 条静态测试失败是本次接管实测发现并修复的**，dsh 从未报告过它们。修改共涉及 4 个文件：`apps/admin/test/smoke.test.mjs`、`apps/admin/test/ui-copy.test.mjs`、`apps/web/test/smoke.test.mjs`、`scripts/ui-copy-scan.mjs`；**均未降低任何检查的标准**。这些修改在本文档写作时**尚未提交**（工作树为 modified，未 push）。
- **§4.D 的验证缺口是 dsh 自己标注的**，本文档原样保留，未做美化。
- 本次接管**未执行**生产部署、未改动任何业务代码、未跑 Playwright（现有失败与本次改动无关）、未跑三个 `build`。
- 本文档**只写事实，不写计划性承诺**；§6 是建议顺序而非承诺。
