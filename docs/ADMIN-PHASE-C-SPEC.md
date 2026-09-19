# Admin Phase C — Specification (archived)

> Recovered verbatim from the session record and archived here as the governing
> document for Phase C. Do not edit; treat as read-only source of truth.

---

# TALKFIRST — ADMIN PHASE C
# Risk / Connections / Contact Exchange / Blocks
# 前置：B1 ✅ / B2 ✅ / B3 ✅ / B4 ✅ / B5 ✅
# 本阶段：Admin Phase C
# 禁止进入 Production Readiness / Activity / OAuth / Subscription

==================================================
一、Phase C 总目标
==================================================

建立四个 Admin 管理中心：

C1 Risk Center
C2 Connections Management
C3 Contact Exchange Management
C4 Block Management
C5 Admin Phase C Integration

当前项目已经存在部分：

- SafetyService
- Connection
- ContactExchange
- SharedSocialAccount
- Block
- AdminAuditLog
- RBAC permissions

原则：

优先建立在真实现有模型之上。

不要因为 Admin 需要页面，
就新建平行业务模型。

==================================================
二、开始前必须执行完整 Readiness Audit
==================================================

先不要写代码。

检查：

prisma/schema.prisma

apps/api/src/admin/*
apps/api/src/safety/*
apps/api/src/connections/*
apps/api/src/*
apps/admin/src/app/*
apps/admin/src/components/shell.tsx
apps/admin/src/lib/permissions.ts
scripts/phaseA-rbac-verify.mjs

重点确认：

Risk：
SafetyService 实际功能

Connections：
Connection schema + service

Exchange：
ContactExchange
SharedSocialAccount
SocialAccount

Blocks：
Block

==================================================
三、Readiness Audit 输出
==================================================

必须输出：

A. Risk 当前能力
B. Connection 当前能力
C. Contact Exchange 当前能力
D. Block 当前能力
E. 每个模型真实 relation
F. 当前 API
G. 当前前端页面
H. 当前 RBAC
I. 可以直接复用的方法
J. 需要新增的方法
K. 是否需要 migration
L. 数据量
M. 数据一致性问题
N. 隐私风险
O. 测试缺口

不得假设不存在的 service 或 model。

==================================================
四、Phase C 通用规则
==================================================

1. 所有查询必须真实 PostgreSQL。
2. 禁止 mock。
3. 禁止 random。
4. 禁止前端全表过滤。
5. 所有列表分页。
6. 所有查询 explicit select。
7. 管理后台不能泄漏密码、token、OAuth credential。
8. 审计字段 ip/userAgent 默认不下发。
9. 权限必须后端控制。
10. 前端隐藏按钮不能代替权限。
11. 删除/修改必须经过明确授权。
12. 不改变普通用户端既有业务语义。
13. 不删除历史数据。
14. 不修改 SYSTEM Actor。
15. 不修改 UserStatusScheduler。
16. 不修改 SafetyService 现有行为，除非当前 Risk 模块确认必须修改并单独审批。
17. 默认优先只读。
18. 需要 mutation 时必须验证现有 permission 是否支持。

==================================================
五、Phase C RBAC 基线
==================================================

不要修改：

apps/api/src/admin/permissions.ts

当前已知：

risk:read
connections:read
exchanges:read
blocks:read

具体角色必须以当前代码真实 matrix 为准。

例如当前审计中：

risk:read：
SUPER_ADMIN
MODERATOR
ANALYST

connections:read：
SUPER_ADMIN
ANALYST

exchanges:read：
SUPER_ADMIN
ANALYST

blocks:read：
SUPER_ADMIN
ANALYST

必须重新读取实际代码确认。

禁止自行给：

SUPPORT
MODERATOR
CONTENT_MANAGER

增加权限。

如果确实需要 write permission：

停止并报告。

==================================================
六、C1 Risk Center
==================================================

目标：

将 SafetyService 目前产生的风险信号，
形成 Admin 可读的 Risk Center。

注意：

SafetyService 当前不是 Moderation Action Service。

不要把：

scanText()
trustedAccount()
sayHelloLimit()
extractLinks()
recordAutoFlag()

改造成第二套审核系统。

==================================================
七、C1 Risk Data Source
==================================================

先确认：

SafetyService 是否有持久化 risk data。

如果已经有：

使用真实数据。

如果没有持久化 Risk 模型：

不要直接新增 RiskRecord。

第一版可以基于已有：

Report
AdminAuditLog
用户状态
Safety 相关已有记录

提供可用的 Risk Overview。

如果实现某项功能必须新增 Risk schema：

立即停止并报告。

==================================================
八、C1 Risk API
==================================================

建议：

GET /api/v1/admin/risk

权限：

risk:read

支持：

page
pageSize
riskLevel
user
createdFrom
createdTo

但是：

只有当前真实数据支持的筛选才能实现。

不要发明不存在的 riskLevel enum。

==================================================
九、Risk Overview
==================================================

页面目标：

管理员看到：

高风险用户/事件
近期风险信号
风险来源
相关举报
当前用户状态

所有数据必须来自现有真实表。

不要重新存一份数据。

==================================================
十、特别注意 recordAutoFlag
==================================================

Readiness Audit 已知：

SafetyService.recordAutoFlag()

存在一个历史问题：

注释说：

machine signals must not be written into Report

但非 HIGH 级别实际可能创建：

reporterId = reportedUserId

形成自举报。

本阶段：

不要默默修。

如果 Risk Center 发现这个问题必须处理：

停止并记录为独立 Safety Phase。

==================================================
十一、C1 Risk UI
==================================================

新增：

apps/admin/src/app/risk/page.tsx

包含：

Risk Overview

- 风险概览
- 风险事件
- 关联用户
- 关联举报
- 用户当前状态

如果当前真实数据不足：

正确显示：

暂无数据

禁止 mock。

==================================================
十二、C2 Connections Management
==================================================

基于：

Connection

不要新增：

AdminConnectionRecord

==================================================
十三、C2 Connections API
==================================================

新增：

GET /api/v1/admin/connections

权限：

connections:read

支持：

page
pageSize
status
user
createdFrom
createdTo

如果 schema 已有：

Connection.status

则使用真实 enum。

==================================================
十四、Connections 列表
==================================================

显示：

Connection ID
User A
User B
Status
CreatedAt
相关更新时间（只有 schema 真有才显示）

User A / B：

只显示：

id
nickname

必要时：

email

如果产品不需要 email：

不返回。

==================================================
十五、Connection Detail
==================================================

新增：

GET /api/v1/admin/connections/:id

只读。

显示：

双方用户
status
createdAt
updatedAt（若存在）
相关 audit

不要修改用户端 Connection 行为。

==================================================
十六、Connections 隐私
==================================================

禁止显示：

passwordHash
token
refreshToken
OAuth credential
私密 SocialAccount 信息

连接本身不等于：

Contact Exchange

不要把双方已交换的社交账号直接塞入 Connection 页面。

==================================================
十七、C3 Contact Exchange
==================================================

基于：

ContactExchange
SharedSocialAccount
SocialAccount

尤其注意之前 Security Phase 2 已经引入：

SharedSocialAccount

它承担的是：

owner
viewer
platform
socialAccount
exchange

的 pair-scoped visibility。

Admin C 不得退回旧的：

SocialAccount.visibility

全局模型。

==================================================
十八、Exchange API
==================================================

新增：

GET /api/v1/admin/exchanges

权限：

exchanges:read

支持：

page
pageSize
platform
user
createdFrom
createdTo

只有 schema 真有对应字段才能实现。

==================================================
十九、Exchange List
==================================================

列表至少：

exchangeId
initiator
receiver
status
createdAt

双方：

id
nickname

平台：

Instagram
Telegram
WhatsApp
WeChat
Discord
X
TikTok
等

但必须以实际 SocialAccount.platform enum 为准。

不要假设不存在的平台。

==================================================
二十、Exchange Detail
==================================================

新增：

GET /api/v1/admin/exchanges/:id

显示：

exchange
双方用户
平台
共享关系
创建时间
相关 audit

非常重要：

Admin 看到 Contact Exchange 元数据
≠
Admin 自动获得双方私密社交账号明文。

遵循现有 privacy/security 模型。

==================================================
二十一、SharedSocialAccount
==================================================

明确检查：

ownerId
viewerId
platform
socialAccountId
exchangeId

任何 Admin 查询必须说明：

为什么管理员有权看到这个字段。

如果不是管理功能必要字段：

不要返回。

==================================================
二十二、C4 Block Management
==================================================

基于：

Block

不要新增 BlockRecord。

==================================================
二十三、Block API
==================================================

新增：

GET /api/v1/admin/blocks

权限：

blocks:read

支持：

page
pageSize
blocker
blocked
createdFrom
createdTo

真实字段以 schema 为准。

==================================================
二十四、Block List
==================================================

显示：

Block ID
Blocker
Blocked User
CreatedAt

用户：

id
nickname

必要时：

email

不要显示：

私密聊天内容
social account
token

==================================================
二十五、Block Detail
==================================================

新增：

GET /api/v1/admin/blocks/:id

只读。

显示：

blocker
blocked
createdAt

如果存在相关 audit：

显示 audit summary。

==================================================
二十六、Block Management 的边界
==================================================

第一版：

只读。

不要直接新增：

DELETE /admin/blocks/:id

不要允许管理员随意解除用户 Block。

因为当前 permission matrix 只有：

blocks:read

没有：

blocks:write

如果未来需要管理员解除：

单独设计 blocks:write。

现在不要自己加。

==================================================
二十七、四个列表的通用 API 规范
==================================================

统一：

{
  items,
  total,
  page,
  pageSize,
  totalPages
}

必须分页。

不能：

findMany 全部
再 JS slice。

==================================================
二十八、查询安全
==================================================

所有筛选：

page
pageSize
status
platform
user
dates

全部经过：

validation
+
explicit Prisma where

禁止：

字符串直传 orderBy
字符串直传 SQL

==================================================
二十九、排序
==================================================

每个模块如需要排序：

必须白名单。

如果需求没有明确多字段排序：

默认 createdAt DESC 即可。

不要为了“统一”增加十几个排序字段。

==================================================
三十、前端导航
==================================================

Phase C 完成后：

Dashboard
Users
Reports
Moderation
Risk
Connections
Exchanges
Blocks
Audit

只添加真正已经实现的页面。

不要先加 404 链接。

==================================================
三十一、Risk UI
==================================================

/risk

==================================================
三十二、Connections UI
==================================================

/connections

列表
筛选
分页
详情

==================================================
三十三、Exchange UI
==================================================

/exchanges

列表
筛选
分页
详情

==================================================
三十四、Blocks UI
==================================================

/blocks

列表
筛选
分页
详情

==================================================
三十五、通用前端能力
==================================================

每个页面必须具备：

loading
empty
error
retry
pagination

不要复制大量代码。

只抽取真正稳定的 Admin UI primitive。

==================================================
三十六、敏感数据
==================================================

任何 Phase C API：

禁止：

passwordHash
tokenHash
refreshToken
accessToken
oauth
secret

默认不返回：

ip
userAgent

SocialAccount：

尤其检查：

access token
refresh token
provider credential

绝对不得返回给 Admin 前端。

==================================================
三十七、Audit
==================================================

Phase C 第一版主要是 read-only。

所以：

普通列表查询不写 Audit。

进入页面不写 Audit。

GET 不写 Audit。

如果未来增加 mutation：

必须走：

recordAudit()

actorType=USER
adminId=current admin

禁止 SYSTEM。

==================================================
三十八、C1 API Jest
==================================================

新增：

admin-risk.spec.ts

覆盖：

- permission
- pagination
- empty
- real data
- filter
- sensitive data
- no audit on GET

如果 Risk 数据源没有对应能力：

不要创建 mock 来通过测试。

==================================================
三十九、C2 API Jest
==================================================

新增：

admin-connections.spec.ts

覆盖：

- roles
- pagination
- status
- user filter
- dates
- detail
- 404
- sensitive fields
- no audit on GET

==================================================
四十、C3 API Jest
==================================================

新增：

admin-exchanges.spec.ts

覆盖：

- permission
- pagination
- platform
- user
- date
- detail
- SharedSocialAccount correctness
- no OAuth credential leakage

==================================================
四十一、C4 API Jest
==================================================

新增：

admin-blocks.spec.ts

覆盖：

- permission
- pagination
- blocker
- blocked
- dates
- detail
- 404
- sensitive fields
- read-only

==================================================
四十二、Real E2E
==================================================

扩展：

scripts/phaseA-rbac-verify.mjs

四个模块必须使用：

真实 HTTP
+
真实 PostgreSQL

每个列表：

API total
=
独立 SQL count

每个 filter：

API result
=
独立 SQL 查询结果

每个 detail：

真实 DB row
=
API response

==================================================
四十三、RBAC Real E2E
==================================================

每个 permission：

至少验证：

有权限角色 → 200

无权限角色 → 403

不能只验证前端隐藏。

==================================================
四十四、Playwright
==================================================

新增：

admin-risk.spec.ts
admin-connections.spec.ts
admin-exchanges.spec.ts
admin-blocks.spec.ts

每个页面至少验证：

1. navigation
2. title
3. real rows
4. filters
5. pagination
6. empty
7. loading
8. error
9. retry
10. detail
11. 404
12. role visibility

==================================================
四十五、数据隐私 E2E
==================================================

针对：

Exchange / SocialAccount

必须做递归 JSON key scan。

禁止：

passwordHash
tokenHash
refreshToken
accessToken
clientSecret
oauthToken
oauthSecret
secret

并检查常见 JWT / OAuth token 形状。

==================================================
四十六、C5 Admin Integration
==================================================

当：

Risk
Connections
Exchanges
Blocks

全部完成之后：

统一检查：

1. shell navigation
2. permission-driven navigation
3. page loading
4. API base URL
5. error handling
6. pagination component
7. empty component
8. detail back navigation
9. sensitive field policy
10. Audit policy

==================================================
四十七、Dashboard 联动
==================================================

不要随便扩大 Dashboard。

只有当 Phase C 实际产生稳定统计，
才考虑 Dashboard 增加：

risk events
connections
exchanges
blocks

否则不要修改已经通过验收的 Dashboard。

==================================================
四十八、User Detail 联动
==================================================

B3 已经有：

connectionCount
blocksMadeCount
blocksReceivedCount
socialAccountCount

Phase C 完成后：

不要重新实现这些 count。

如果发现定义需要变化：

先记录为兼容性问题。

不要悄悄改 B3 语义。

==================================================
四十九、Audit 页面联动
==================================================

Phase C 默认 GET-only：

不写 Audit。

未来 mutation 才进入 Audit。

保持：

SYSTEM
USER

actor 规则。

==================================================
五十、数据库原则
==================================================

默认：

零 migration。

禁止：

prisma migrate reset
db push

禁止新增：

AdminRiskRecord
AdminConnectionRecord
AdminExchangeRecord
AdminBlockRecord

除非 Readiness Audit 明确证明：

真实业务功能无法利用已有模型实现。

==================================================
五十一、停止条件
==================================================

立即停止并报告：

- 当前模型无法支持目标
- 必须新建平行模型
- 必须 migration
- 必须修改 UserStatusScheduler
- 必须修改 SYSTEM Actor
- 必须修改 Core User schema
- 必须修改 Connection 业务语义
- 必须修改 ContactExchange 业务语义
- 必须修改 Block 业务语义
- 必须修改 RBAC matrix
- 必须修改 SafetyService

特别：

Risk 如果必须修改 SafetyService 才能正常工作：

停止。

单独建立 Safety Phase。

==================================================
五十二、执行顺序
==================================================

严格：

C1 Risk Readiness Audit
↓
C1 Risk
↓
API tests
↓
Playwright
↓
Real E2E
↓
C2 Connections
↓
API tests
↓
Playwright
↓
Real E2E
↓
C3 Contact Exchange
↓
API tests
↓
Playwright
↓
Real E2E
↓
C4 Blocks
↓
API tests
↓
Playwright
↓
Real E2E
↓
C5 Integration
↓
完整回归

不要四个模块一起开发。

==================================================
五十三、完整回归
==================================================

必须：

npm run typecheck
npm run lint
npm run test
npm run build

Playwright 全套：

PASS

Real E2E：

PASS

Prisma：

validate
migrate status
migrate diff

要求：

0 drift

==================================================
五十四、最终测试不变量
==================================================

任何 Phase C GET：

不得写 Audit。

任何 Admin 页面：

不得读取不存在的字段。

任何 API：

不得泄漏 secret。

任何无权限角色：

不得因为前端导航隐藏而绕过后端。

任何 Social Account：

不得泄漏 OAuth credential。

任何 mutation：

如果未来存在，必须：

USER actor
+
adminId
+
recordAudit()

==================================================
五十五、最终报告
==================================================

分别输出：

C1 Risk：

- API
- 数据来源
- RBAC
- 测试
- 未解决问题

C2 Connections：

- API
- 数据来源
- RBAC
- 测试
- 未解决问题

C3 Exchanges：

- API
- 数据来源
- SharedSocialAccount 使用方式
- privacy
- RBAC
- 测试
- 未解决问题

C4 Blocks：

- API
- 数据来源
- RBAC
- 测试
- 未解决问题

C5：

- Navigation
- integration
- regression

最后输出：

- API Jest 总数
- Playwright 总数
- Real E2E 总数
- typecheck
- lint
- build
- prisma validate
- migrate status
- migrate diff
- schema drift
- 数据库数据量
- 所有未解决问题

最后：

**停止。**

不要进入 Production Readiness。</long_text_quote>，先做 @long-text:"# TALKFIRS..." <long_text_quote># TALKFIRST — ADMIN PHASE B5
# Moderation Management
# 前置：B1 Dashboard ✅ / B2 Users ✅ / B3 User Detail ✅ / B4 Reports ✅
# 本阶段目标：完成 Admin 核心 Moderation 工作台
# 严格禁止进入 Admin Phase C

==================================================
一、当前项目状态
==================================================

已经完成：

- Admin SYSTEM Actor
- B1 Dashboard
- B2 Users
- B3 User Detail + Status API
- B4 Reports

开始本阶段前，必须读取 B4 最终实施报告，
并记录真实验证基线。

不要假设测试数量。

必须读取并记录：

- API Jest
- Admin Playwright
- Real E2E
- typecheck
- lint
- build
- prisma validate
- migrate status
- migrate diff

要求：

后续测试数量只能增加，不能减少。

==================================================
二、本阶段唯一目标
==================================================

实现：

Admin Moderation 工作台。

核心原则：

Moderation 不创建新的平行数据模型。

当前代码库没有：

- ModerationRecord
- MessageModeration

不要补造这两个模型。

当前 Moderation 采用：

Report
+
AdminAuditLog
+
现有 UserStatus
+
现有 AdminService.setStatus()
+
现有 AdminService.reviewReport()

形成管理工作台。

==================================================
三、禁止范围
==================================================

本阶段禁止进入：

- Risk Center
- Connections Management
- Contact Exchange Management
- Block Management
- Settings
- Announcements
- OAuth
- Activity
- Redis
- Subscription
- Boost
- Payment
- SafetyService 重构
- UserStatusScheduler 修改

禁止新增：

ModerationRecord
MessageModeration

除非发现当前 schema 完全无法实现本阶段目标。

一旦必须新增 schema：

立即停止并报告，不得自行 migration。

==================================================
四、先执行 B5 Readiness Audit
==================================================

不要立即写代码。

先检查：

apps/api/src/admin/admin.service.ts
apps/api/src/admin/admin.controller.ts
apps/api/src/admin/*.spec.ts

apps/admin/src/app/reports/page.tsx
apps/admin/src/app/reports/[id]/page.tsx
apps/admin/src/app/users/[id]/page.tsx
apps/admin/src/components/shell.tsx

prisma/schema.prisma

以及：

Report
Message
User
AdminAuditLog
Block
UserStatus

确认 B4 实际实现：

- Report queue
- Report detail
- Review
- Audit history
- Message unavailable handling
- status/action
- RBAC

==================================================
五、Readiness Audit 输出
==================================================

输出：

1. Report 当前状态机
2. 当前 Reports API
3. 当前 Report Detail API
4. 当前 Review API
5. 当前 User status API
6. 当前 AdminAuditLog 结构
7. 当前 RBAC
8. 当前 Block relation
9. 当前 Message relation
10. 当前 Moderation 页面是否已经存在
11. 可直接复用的方法
12. 需要新增的方法
13. 是否需要 Prisma migration
14. 测试缺口

完成 Readiness Audit 后，
如果无需 schema 改动，直接从 B5.1 开始。

==================================================
六、B5 的核心概念
==================================================

Moderation 页面不是重新存一份 moderation 数据。

它是一个：

Moderation Workbench

数据来源：

Report
+
Reported User
+
Reporter
+
Message
+
AdminAuditLog
+
User status

管理员从一个工作台完成：

查看举报
↓
查看目标
↓
查看内容
↓
查看历史
↓
采取处理措施

==================================================
七、B5.1 Moderation Queue API
==================================================

新增：

GET /api/v1/admin/moderation

权限：

moderation:read

不要创建第二套 Report 查询器。

优先复用：

listReports()

或抽取真正通用的 query builder。

Queue 支持：

page
pageSize
status
reason
targetType
reporter
reportedUser
createdFrom
createdTo

如果 Reports API 已经具备这些能力：

Moderation API 不要重复实现过滤逻辑。

==================================================
八、Moderation Queue 的业务意义
==================================================

Moderation queue 默认关注：

OPEN
REVIEWING

已处理：

RESOLVED
REJECTED

如果 B4 已经定义合理默认策略：

保持一致。

不要产生：

Reports 页面一套状态逻辑
Moderation 页面另一套状态逻辑

==================================================
九、Moderation Queue Response
==================================================

至少：

{
  items,
  total,
  page,
  pageSize,
  totalPages
}

item 必须明确 select。

建议包含：

reportId
reason
status
targetType
messageId
reporter
reportedUser
createdAt

不要把整个 Report 对象透传。

==================================================
十、B5.2 Moderation Detail
==================================================

新增：

GET /api/v1/admin/moderation/:reportId

权限：

moderation:read

但是：

不要复制 B4 Report Detail。

应该：

复用 reportDetail()

在其基础上组合：

report
target
message
users
auditHistory
availableActions

==================================================
十一、Moderation Detail Response
==================================================

必须清晰表达：

report：

id
reason
description
status
createdAt

reporter：

id
nickname
email
status

reportedUser：

id
nickname
email
status

target：

USER / MESSAGE

message：

available
content
createdAt
sender

如果消息不存在：

available=false

禁止 500。

==================================================
十二、Admin Audit History
==================================================

Moderation Detail 必须显示：

review history
status changes
related moderation actions

唯一真相：

AdminAuditLog

条件：

targetType=REPORT
targetId=report.id

按：

createdAt DESC

SYSTEM：

系统 · 自动

USER：

admin xxxxxxxx

不得读取：

adminId.slice()

而不检查 actorType。

==================================================
十三、B5.3 Available Actions
==================================================

根据当前 Report status + 用户 status，
计算：

availableActions

可能包括：

review
resolve
reject
suspend
ban

具体动作必须根据现有 RBAC + 状态机计算。

不要把按钮显示出来之后
再让后端随便决定。

前后端两层都必须验证。

==================================================
十四、review
==================================================

已有：

POST /api/v1/admin/reports/:id/review

继续使用。

动作：

reviewing
resolved
rejected

不要重新创建：

POST /admin/moderation/:id/resolve

之类重复 API。

如果为了 Moderation UI 必须提供语义包装，
包装内部必须调用 reviewReport()。

==================================================
十五、suspend
==================================================

使用现有：

setStatus()

action：

suspend

必须复用：

- reason required
- expiresAt required
- expiresAt future
- self protection
- admin protection
- role action gating
- audit

Moderation 不得绕过 Users Status Service。

==================================================
十六、ban
==================================================

同样使用：

setStatus()

action：

ban

仅允许当前已有角色：

SUPER_ADMIN

不要给 MODERATOR 增加 ban 权限。

不要修改：

ROLE_ALLOWED_STATUS_ACTIONS

==================================================
十七、Moderation Action API
==================================================

如果当前产品架构允许，
可以提供统一：

POST /api/v1/admin/moderation/:reportId/action

Body：

{
  action,
  reason,
  expiresAt
}

允许：

reviewing
resolved
rejected
suspend
ban

但这个统一入口：

必须仅作为 orchestrator。

绝不能复制：

reviewReport()
setStatus()

如果统一 endpoint 会导致重复审计或改变已有 API 行为，
则不要创建。

优先使用：

已有 review API
+
已有 status API

==================================================
十八、Audit 规则
==================================================

每个成功人工动作：

actorType=USER
adminId=current admin

必须产生恰好一条对应 AuditLog。

review:

targetType=REPORT

suspend/ban：

targetType=USER

before / after 必须准确。

失败：

400
403
404

不得产生 AuditLog。

==================================================
十九、权限
==================================================

继续使用：

moderation:read
moderation:write

当前 matrix 已存在：

SUPER_ADMIN
MODERATOR
CONTENT_MANAGER

拥有 moderation 权限。

不要修改 permissions.ts。

对于：

SUPPORT
ANALYST

不允许：

moderation:write

后端必须真实 403。

==================================================
二十、CONTENT_MANAGER
==================================================

Readiness Audit 已确认：

CONTENT_MANAGER 当前拥有：

moderation:read
moderation:write

因此 B5 上线后：

CONTENT_MANAGER 会获得 Moderation 能力。

不要擅自删除。

同时测试明确钉住。

==================================================
二十一、前端 Moderation 页面
==================================================

新增：

apps/admin/src/app/moderation/page.tsx

页面：

Moderation

导航：

Dashboard
Users
Reports
Moderation
Audit

这一次可以加入：

/moderation

因为页面真正存在。

==================================================
二十二、Moderation 页面布局
==================================================

建议：

顶部：

Moderation

筛选：

状态
举报原因
Target Type
Reporter
Reported User
日期

主体：

Moderation Queue

每行：

举报理由
举报目标
举报用户
报告时间
状态
操作

操作：

查看

进入：

/moderation/:id

==================================================
二十三、Moderation Detail UI
==================================================

页面：

/moderation/[id]

结构：

举报信息
↓
举报人
↓
被举报用户
↓
目标
↓
消息内容
↓
当前状态
↓
历史操作
↓
可执行动作

危险动作：

suspend
ban

必须二次确认。

==================================================
二十四、审查动作
==================================================

reviewing：

受理

resolved：

处理

rejected：

驳回

reason：

必填

前端不要只检查 UI。

API 必须再次检查。

==================================================
二十五、Status Action
==================================================

suspend：

必须弹出：

reason
expiresAt

ban：

必须：

reason

不要让 Moderation 快捷操作绕过 Users 页面已有验证。

==================================================
二十六、Message 展示
==================================================

如果：

messageId != null

显示：

MESSAGE

并加载消息。

如果消息已删除：

内容已删除或不可用

如果：

messageId == null

显示：

USER

不要假设所有举报都有消息。

==================================================
二十七、Sensitive Data
==================================================

Moderation API 不得返回：

passwordHash
tokenHash
refreshToken
accessToken
oauth
secret

Audit：

不得返回：

ip
userAgent

Message：

只返回当前产品必要内容。

==================================================
二十八、B5 API Jest
==================================================

新增：

admin-moderation.spec.ts

至少覆盖：

1. 5 roles read
2. moderation:read
3. moderation:write
4. queue pagination
5. queue filter
6. totalPages
7. USER target
8. MESSAGE target
9. detail 200
10. detail 404
11. message available
12. message unavailable
13. audit history
14. SYSTEM audit
15. USER audit
16. review
17. resolve
18. reject
19. suspend
20. ban
21. missing reason
22. missing expiresAt
23. expired expiresAt
24. permission denied
25. failed action no audit
26. success action exactly one audit
27. before/after
28. sensitive fields
29. duplicate audit prevention

==================================================
二十九、与已有 API 复用测试
==================================================

必须证明：

Moderation resolve
→ reviewReport()

Moderation reject
→ reviewReport()

Moderation suspend
→ setStatus()

Moderation ban
→ setStatus()

禁止复制业务实现。

==================================================
三十、Real E2E
==================================================

扩展：

scripts/phaseA-rbac-verify.mjs

真实 HTTP + PostgreSQL。

测试：

SUPER_ADMIN
MODERATOR
CONTENT_MANAGER

可以读取 Moderation。

SUPPORT / ANALYST：

根据实际 permission matrix
确认是否：

403

写权限：

只有已有角色可以执行。

==================================================
三十一、Real E2E Audit
==================================================

执行成功：

review
resolve
reject
suspend
ban

逐项查询：

AdminAuditLog

验证：

actorType
adminId
targetType
targetId
before
after

并确认：

失败请求不产生行。

==================================================
三十二、Playwright
==================================================

新增：

apps/admin/test/e2e/admin-moderation.spec.ts

至少：

1. nav
2. queue
3. filter
4. empty
5. loading
6. error
7. retry
8. detail
9. USER target
10. MESSAGE target
11. unavailable message
12. audit
13. SYSTEM actor
14. USER actor
15. reviewing
16. resolved
17. rejected
18. suspend confirmation
19. ban confirmation
20. reason validation
21. role controls
22. read-only roles
23. sensitive UI
24. back navigation

==================================================
三十三、Smoke
==================================================

更新：

apps/admin/test/smoke.test.mjs

增加：

/moderation
相关页面结构断言。

禁止删除旧断言。

==================================================
三十四、数据库
==================================================

原则：

不改 schema。

不 migration。

不新增：

ModerationRecord
MessageModeration

不新增：

Report.targetType

不补：

Report.messageId FK

==================================================
三十五、旧测试
==================================================

所有现有测试必须继续通过。

尤其：

B1 Dashboard
B2 Users
B3 User Detail
B4 Reports
SYSTEM Actor

禁止删除测试。

==================================================
三十六、最终完整验证
==================================================

必须：

npm run typecheck
npm run lint
npm run test
npm run build

Admin：

Playwright

API：

Jest

Real：

phaseA-rbac-verify.mjs

Prisma：

validate
migrate status
migrate diff

要求：

0 errors
0 failures
0 drift

==================================================
三十七、停止条件
==================================================

立即停止：

- 必须新建 ModerationRecord
- 必须新建 MessageModeration
- 必须新增 Report.targetType
- 必须补 messageId FK
- 必须修改 UserStatusScheduler
- 必须修改 SafetyService
- 必须修改 RBAC matrix
- 必须改变 SYSTEM Actor
- 必须改变 review 状态机
- 必须删除旧 Reports API
- 必须改变 setStatus 语义

发现上述情况，只报告。

==================================================
三十八、最终报告
==================================================

输出：

1. readiness audit
2. 修改文件
3. Moderation API
4. queue response
5. detail response
6. action routing
7. reviewReport/setStatus 复用情况
8. RBAC
9. Audit
10. message unavailable 处理
11. sensitive-field protection
12. Jest
13. Playwright
14. Real E2E
15. typecheck
16. lint
17. build
18. prisma validate
19. migrate status
20. migrate diff
21. DB verification
22. unresolved issues

完成后：

**停止。**

不要进入 Admin Phase C。</long_text_quote></user_query>
