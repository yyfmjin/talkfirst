# P0-03 — 交友属性：现状盘点（2026-10-05）

> 任务编号：P0-03
> 结论：**能力与内容都在位**，前端、服务端、治理、测试四层都能找到落点。
> 本文是**盘点**，不是设计：只记录代码与数据里**实际存在**的东西，以及一处确实缺的通路。

**前置说明（重要）**：P0-03 的原始需求文本**不在仓库里**，我也没有它。
所以本文**不做「规格 vs 实现」的逐条对照**（`P0-04` / `P0-06` 那种做法在这里做不到），
只盘点现状并标出证据。要逐条对账，需要把那份文案补进来。

---

## 1. 数据模型（两行表，职责分开）

`prisma/schema.prisma`：

| 模型 | 作用 | 关键点 |
|---|---|---|
| `AttributeDefinition` | 出厂标签目录（可选项） | `key` 唯一 · `kind` · `category VarChar(32)` · `label`/`labelZh` · `valueType` · `sort` · `isActive` · `isSearchable` |
| `UserAttribute` | 一位用户选中的一个标签 | `kind` · `definitionId?`（`SetNull`）· `label` · `labelKey`（归一化副本）· `value?` · `visibility` · `sortOrder` · `reviewStatus` |

两条约束是设计意图，不是巧合：

- `@@unique([userId, definitionId])` — 同一个出厂标签不能选两次；
- `@@unique([userId, kind, labelKey])` — 同一个词在**同一栏**里不能重复。唯一性建在
  归一化后的 `labelKey` 上，而不是显示用的 `label`，所以「Game 」「game」「ｇａｍｅ」
  是同一个词（Q12）。
- `definitionId` 是 `SetNull` 而不是级联删除：删掉一个定义，用户的这一行**降级成自定义标签**，
  而不是把用户数据一起删掉。

---

## 2. 服务端接口

`apps/api/src/users/users.controller.ts:53-99`：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/users/me/attributes` | 返回 `{ aboutMe, lookingFor }` 两组 |
| `POST` | `/users/me/attributes` | 选一个 **SYSTEM 标签**（`definitionId`）或建一个 **CUSTOM 标签**（`label`） |
| `PATCH` | `/users/me/attributes/:id` | 改 `label` / `value` / `visibility` / `sortOrder` |
| `DELETE` | `/users/me/attributes/:id` | 删自己的行 |
| `GET` / `PUT` | `/users/me/field-visibility` | 逐字段可见性（P0-04 的落点） |

目录（可选出厂标签）由另一个模块给出：`GET /meta/attributes?kind=`（`apps/api/src/meta/meta.controller.ts:41`）。
前端就是同时取这两个（`apps/web/src/app/me/attributes/page.tsx:71-72`）。

### 规则（`apps/api/src/users/profile-attributes.service.ts`）

| 规则 | 值 / 行为 | 位置 |
|---|---|---|
| 每栏上限 | `ATTRIBUTE_MAX_PER_KIND = 10` | `:51` · 计数在 `:179` |
| 标签名长度 | `32` 个字符（按码点算，不是字节） | `:53` |
| 补充说明长度 | `80` | `:55` |
| 排序值上限 | `1000` | `:57` |
| SYSTEM / CUSTOM 互斥 | 同时给 `definitionId` 和 `label` 直接报错 | 不变量在服务端强制 |
| 已下线的标签 | `isActive:false` 的定义**不允许新选**，已选中的行保留 | Q10，`:144` 之后 |
| kind 必须匹配 | 选的定义属于另一栏 → 拒绝 | |
| 安全检查 | `label` 与 `value` **都**过安全扫描；HIGH/blocked 在**写入前**拒绝 | |
| 服务端自算字段 | `labelKey`、`reviewStatus` 由服务端推导，客户端传了也无效 | `:201`（写入 `APPROVED`） |

`PATCH` 不能改 `kind`、不能改 `definitionId`，也**不能给出厂标签改名** —— 那是目录的事。

---

## 3. 可见性（两层，不是一层）

1. **行级**：每个 `UserAttribute` 自带 `visibility`（`PUBLIC` / `CONNECTIONS` / `PRIVATE`，默认 `PUBLIC`），
   判定走全仓库唯一的那一处 `canViewField`（`apps/api/src/users/profile-visibility.constants.ts:83`）。
2. **审核态**：非本人**只看得到 `APPROVED` 的行**（`apps/api/src/users/profile-attributes.view.ts:138`），
   本人看得到自己全部的行（含 PENDING/REJECTED）。

`users.service.ts:232` 是公开投影的入口：`filterAttributesForViewer(...)` 之后再分组。

---

## 4. 出厂内容（seed）

`prisma/seed.ts:87-136` 的 `ATTRIBUTE_DEFINITIONS`，实测 **36 条**：

| kind | 分布 | 小计 |
|---|---|---|
| `ABOUT_ME` | Hobby 11 · Personality 8 · Communication 6 · Lifestyle 2 · Music 1 | **28** |
| `LOOKING_FOR` | Social 4 · Culture 2 · Gaming 1 · Travel 1 | **8** |

`prisma/seed.ts:112-120` 记着 **2026-10-04 的补齐**：上一版每个板块只有 1 条，
性格与交流方式实际上**不可用**（能力早就在，缺的只是可选内容）。同一处还写死了两条判断，
免得后来者当成遗漏：「慢热」只留在性格一个归属；英文 label 直说意思，不做逐字对译。

---

## 5. 前端

- **选择器**：`apps/web/src/app/me/attributes/page.tsx`。上限/长度常量在 `:24-29` **显式标注**
  「Mirrors `profile-attributes.service.ts`」，即前端做的是**提前拦**，服务端仍是权威。
  计数显示 `{n} / 10`（`:322`），自定义标签与出厂标签在同一个列表里共存（`:342` 标「自定义」）。
- **分栏**：`apps/web/src/lib/attribute-sections.ts` 把数据库的 `category` 折叠成**用户想得出来的栏目**：
  `Personality → 我的性格`，`Hobby / Music / Lifestyle / Culture / Gaming / Travel → 我的兴趣`，
  `Communication → 交流方式`；顺序按 `SECTION_ORDER`。
  `LOOKING_FOR`（8 条）不走这个映射 —— 它就是卡片上的「我想认识」那一组。
  映射表覆盖不到的 `category` **保留原名当标题**，不会被悄悄丢掉。
- **展示**：只有一套卡片（P0-05 的硬要求），属性在 `apps/web/src/components/profile-preview-card.tsx:165-176`，
  两组各最多 6 个。

---

## 6. 测试

`apps/api/src/users/profile-attributes.spec.ts` 分六个 `describe`，共 **36** 条（`npx jest` 实测：36 passed）：

| 组 | 覆盖 |
|---|---|
| `attribute label normalization` | 空白折叠 / NFKC / 大小写折叠 / 空标签 = 无标签 |
| `create` | 归属取自 JWT · 每栏上限 · 只数本栏 · 重复标签的稳定冲突 · P2002 竞态映射 · enum 外 kind · SYSTEM/CUSTOM 互斥 · 未知或已下线的定义 · kind 不匹配 |
| `create (system tags + safety)` | 出厂标签形状 · 按 `definitionId` 去重 · HIGH / blocked 在写入前拒绝 · `value` 也扫 · 伪造 `labelKey`/`reviewStatus` 无效 |
| `update` | 非 UUID 不打库 · 改不了别人的行 · 改可见性与排序 · 出厂标签不能改名 · 改名后重算 `labelKey` 并拒冲突 · 空 payload · 改名也要扫 |
| `remove` | 只能删自己的 · 畸形 id 不打库 |
| `field visibility` | 默认档位物化 · 未知 fieldKey 不建垃圾行 |

公开投影那一侧由 `users-public-profile.spec.ts` 与 `discover-privacy.spec.ts` 覆盖（P0-04）。

---

## 7. 盘点发现：`reviewStatus` 是「能力在位、通路缺失」

这是本次盘点唯一打算点名的一处，**记录，不改**。

- `UserAttribute.reviewStatus` 存在，默认 `APPROVED`，有 `@@index([reviewStatus])`，
  并且**在公开投影里是生效的**：非 `APPROVED` 的行对别人不可见（`profile-attributes.view.ts:138`）。
- 但是：**全仓库没有任何生产代码把它写成非 `APPROVED`**。
  写入路径只有一处（`profile-attributes.service.ts:201`，硬写 `APPROVED`）；
  不合规的标签是**写入前直接拒绝**，不是「先收下、置为待审」。
  唯一写过 `HIDDEN` 的地方是测试里**故意伪造**的入参（`profile-attributes.spec.ts:340`，断言它被忽略）。
- 管理端**没有**交友属性这一块：`apps/admin/src` 里 `attribute` 零命中；
  admin 侧代码里唯一提到 `AttributeDefinition` 的是一句注释（讲 DiscoverCategory 的删除语义），不是审核入口。

**这意味着什么**：机制是**安全的默认**（万一有行被置成非 `APPROVED`，它对别人不可见，不会泄露），
但没有「怎么变成待审」和「谁来审」这两步。所以现在它是一条**休眠通路**，
不是一条可用的审核流程。

**为什么不顺手补**：补它就要决定三件事 —— 什么情况置 PENDING（安全扫描命中哪一档）、
管理端放在哪个菜单、被驳回后当事人看到什么提示。这三件都是产品决定，
不该由一个盘点任务替产品做。**列在这里等指令。**

---

## 8. 本轮做了什么验证

- 读代码与数据取证，没有改动任何**产品**代码。
- 统计来自 `prisma/seed.ts` 的**实测**（按行解析 `ATTRIBUTE_DEFINITIONS`），不是目测。
- 与本文同时跑过的门禁：`apps/api` 的 `tsc --noEmit`、`eslint`、全量 `jest`
  —— **88 套件 / 1651 用例全绿**（含本轮新补的两条与一条 P0-04 用例，见下）。
- 顺手补掉的两处测试债（与 P0-03 无关，但同属这轮）：
  1. `P0-06`：`discover-privacy.spec.ts` 补「被拒绝的候选确实被排除（两个方向）」与
     「资料完整者多得 5 分且只有它拿到这条理由」。
  2. `P0-04`：`users-public-profile.spec.ts` 补「本人能读到自己的 PRIVATE 字段」——
     同一行 fixture 两个视角，闭合了 P0-04 矩阵里唯一缺的那格。

## 9. 没做的事（明确）

- **没有**逐条对照 P0-03 原始规格（文本不在仓库，见开头说明）。
- **没有**动 `reviewStatus` 的通路（第 7 节的三个产品决定）。
- **没有**做页面级/截图验收：Playwright 的既知失败按 `docs/KNOWN-E2E-ISSUES.md` 的决定**继续保留**，
  不在本轮修（用户 2026-10-04 的明确指令）。
- **没有**核对生产库里出厂标签是否已按最新 seed 落库（需要连生产库；本地库是另一套数据）。
