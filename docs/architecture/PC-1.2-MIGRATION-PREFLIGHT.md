# PC-1.2 MIGRATION PRE-FLIGHT REVIEW

Status: **REVIEW COMPLETE — NO MIGRATION EXECUTED**

本文件是 PC-1.2 Profile Attribute Schema 的**迁移前评审记录**。
它是只读评审的产物，不是迁移，也不是迁移批准。

本阶段**未执行**：

- `prisma migrate dev`
- `prisma migrate deploy`
- `prisma db push`
- 任何 `CREATE` / `ALTER` / `DROP` 语句（无论通过 Prisma 还是 psql）

本阶段**未修改**：

- `prisma/schema.prisma`（PC-1.2 Phase A 已完成，本次只读取）
- 任何业务代码（`apps/api` / `apps/web` / `apps/admin` / `packages/*`）
- `SafetyService`
- 任何既有测试

---

## 0. 评审证据范围

| 项 | 值 |
| --- | --- |
| Reviewed artifact | `prisma/schema.prisma` — 771 行，36 models，18 enums |
| Reviewed plan | `docs/architecture/PC-1.2-MIGRATION-PLAN.sql` — 131 行，21 条语句 |
| Plan generator | `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` |
| Diff 比对对象 | **仅** `localhost:5433` 的本地数据库 |
| Migration 目录 | `prisma/migrations` 仍为 16 个 migration（+ `migration_lock.toml`），未新增 |
| 代码引用 | `grep` 全仓 `apps/` `packages/`：新模型**零引用**（PC-1.2 Phase A 只改 schema） |

---

## 1. Verdict Table

| # | Check | Verdict |
| --- | --- | --- |
| 1 | Schema | **PASS** |
| 2 | AttributeSource | **PASS**（附带 `APPLICATION_LEVEL_CONSTRAINT`，见 §2） |
| 3 | Visibility | **PASS** |
| 4 | Unique constraints | **PASS** |
| 5 | Foreign keys | **PASS** |
| 6 | Indexes | **PASS**（1 条设计说明，见 §10） |
| 7 | Existing data | **PASS** |
| 8 | Migration SQL | **PASS** |
| 9 | Rollback | **PASS** |
| 10 | Production DB | **UNKNOWN** |
| — | **Final** | **READY_FOR_MIGRATION** |

说明：`READY_FOR_MIGRATION` 表示**该 DDL 本身可以被安全地应用**，
不表示生产数据库已验证，也不授权在本阶段执行迁移。

---

## 2. Schema

**Verdict: PASS**

### 2.1 新增 enum（5 个）

| Enum | Line | 成员 |
| --- | --- | --- |
| `AttributeKind` | 143 | `ABOUT_ME`, `LOOKING_FOR` |
| `AttributeSource` | 150 | `SYSTEM`, `CUSTOM` |
| `AttributeValueType` | 157 | `BOOLEAN`, `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT` |
| `Visibility` | 166 | `PUBLIC`, `CONNECTIONS`, `PRIVATE` |
| `ReviewStatus` | 174 | `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN` |

命名冲突检查：全仓 18 个 enum，`Visibility` 与既有 enum **无重名**。
既有 `MomentSetting.visibleTo` 是普通 `String @db.VarChar(16)`（L431），
**不是** enum，因此不受 `Visibility` 新增影响。

### 2.2 新增 model（3 个）

| Model | Line | 主键 | 说明 |
| --- | --- | --- | --- |
| `AttributeDefinition` | 702 | `id` UUID | 系统/可维护标签目录；`isActive` 支持「停用不删除」 |
| `UserAttribute` | 728 | `id` UUID | 用户选择结果；SYSTEM 与 CUSTOM 共用一张表 |
| `ProfileFieldVisibility` | 762 | `@@id([userId, fieldKey])` | 逐字段可见性；缺行 = 使用默认值 |

### 2.3 `User` 变更

| 变更 | 位置 | 形态 |
| --- | --- | --- |
| `region String? @db.VarChar(80)` | L194（`city` 之后，`gender` 之前） | 可空，无 default，**无 index**（Q11） |
| `attributes UserAttribute[]` | L241 | 反向关系 |
| `fieldVisibilities ProfileFieldVisibility[]` | L242 | 反向关系 |

结构与 PC-1.1 Option B 设计**逐字一致**，无额外字段、无额外索引入侵既有模型。

### 2.4 `prisma validate` / `prisma generate`

Phase A 已记录：

- `prisma validate` → `The schema at prisma\schema.prisma is valid 🚀`
- `prisma generate` → `Generated Prisma Client (v6.19.3)`

本次只读评审未重复执行（不产生新证据，也不修改产物）。

---

## 3. AttributeSource 一致性

**Verdict: PASS**（约束性质：`APPLICATION_LEVEL_CONSTRAINT`）

### 3.1 目标数据语义

```
SYSTEM : definitionId != null
CUSTOM : definitionId == null  AND  label != null  AND  labelKey != null
```

### 3.2 Schema 表达能力

| 语义 | 能否由 schema/DDL 表达 | 说明 |
| --- | --- | --- |
| `CUSTOM ⇒ definitionId == null` | **不能**（仅可由 nullable 表达「可为空」） | Prisma 无 `@check`；plan SQL 中**没有** CHECK 约束 |
| `CUSTOM ⇒ label != null` | **不能** | 同上 |
| `CUSTOM ⇒ labelKey != null` | **不能** | 同上 |
| `SYSTEM ⇒ definitionId != null` | **不能** | 同上 |
| `SYSTEM ⇒ 被引用 definition.scope == SYSTEM` | **不能** | 需要 join 或 trigger 才能证明，schema 层无法表达 |

**结论：`APPLICATION_LEVEL_CONSTRAINT`。**

该规则**必须**由 service 层在写入 `UserAttribute` 时强制。
本评审阶段不新增 CHECK 约束，不新增 trigger，也不修改 plan SQL。

### 3.3 为什么这不是 FAIL

- 结构本身已为两条路径留好形状：`definitionId?` 可空 + `label?`/`labelKey?` 可空。
- 该不变式的正确执行点本来就是写入服务（同一个事务内决定路径），
  而不是数据库：`SYSTEM` 与 `CUSTOM` 的区别取决于 `AttributeDefinition.scope`，
  这是一个跨表事实，CHECK 无法在不引入 trigger 的前提下校验。
- 因此评分项是「schema 是否足以表达该规则」——
  答案是：**结构足够，约束判定在应用层**，并且必须显式记录。

### 3.4 必须由 Service 保证的清单（记录，不实现）

1. 每次写入**只走一条路径**：要么 `definitionId`，要么 `label` + `labelKey`，不得同时给出。
2. 走 SYSTEM 路径时，必须校验目标 `AttributeDefinition.isActive == true`
   （Q10：停用标签**不接受新选择**）；已存在行的解析不受 `isActive` 影响。
3. 走 CUSTOM 路径时，`labelKey` 必须按 Q12 归一化
   （NFKC → trim → collapse whitespace → Unicode casefold）。
4. `SYSTEM` 行的 `labelKey` 是否回填属于 service 选择；
   为 `null` 时 `@@unique([userId, kind, labelKey])` 天然不约束该行（见 §4.2）。

---

## 4. ProfileFieldVisibility — `PROFILE_VISIBILITY_FIELD_WHITELIST`

**Verdict: PASS**（设计产出，本阶段不改代码）

`fieldKey` 是 `String @db.VarChar(32)`。可扩展是设计意图（Q5），
但**可扩展不等于可任意**：API 必须持有**封闭白名单**，
库表的「新字段无需 schema 变更」不应变成「任意 key 都能写入」。

### 4.1 允许的 fieldKey（白名单）

依据 `apps/web/src/lib/profile.ts` 的 `PublicProfile` 与
`users.service.ts#getPublicProfile` 的真实输出：

| fieldKey | 数据来源 | 备注 |
| --- | --- | --- |
| `nickname` | `User.nickname` | |
| `avatarUrl` | `User.avatarUrl` | |
| `birthDate` | `User.birthDate` | 对外输出为 `age`；**key 用 `birthDate`，不是 `age`** |
| `countryCode` | `User.countryCode` | `countryName` / `countryFlag` 是派生值，共用此 key |
| `city` | `User.city` | |
| `region` | `User.region` | 本次新增字段 |
| `gender` | `User.gender` | Q7：纳入 profile visibility；Discover **仍不显示** gender |
| `bio` | `User.bio` | Q6：不拆分 bio |
| `languages` | `UserLanguage[]` | 聚合开关 |
| `interests` | `UserInterest[]` | 聚合开关 |
| `purposes` | `UserPurpose[]` | 聚合开关 |
| `preferredCountries` | `UserPreferredCountry[]` | 聚合开关 |
| `attributes` | `UserAttribute[]` | ABOUT_ME / LOOKING_FOR 的聚合开关 |

白名单共 **13** 个 key。缺行语义 = 默认 `PUBLIC`（Q5、Q9），无需回填。

### 4.2 明确禁止的 fieldKey（必须被 API 拒绝）

**永久不可见性开关化**（不得成为可见性候选，出现即视为无效输入）：

- `email`、`passwordHash`、`emailVerified`
- `isAdmin`、`adminUser`、`status`、`bannedAt`、`banReason`、`suspendedUntil`
- `lastActiveAt`、`createdAt`、`updatedAt`、`id`
- `refreshTokens`、`blocksMade`、`blocksReceived`、`reportsMade`、`reportsReceived`
- 任何 social handle / OAuth 凭证相关 key（`socialAccounts`、`sharedSocialAccounts`）
- `momentSetting`、`momentBindings`
- `relationship`（`getPublicProfile` 的派生结构，非用户属性）

### 4.3 与既有可见性机制的关系

| 机制 | 是否受 `ProfileFieldVisibility` 控制 |
| --- | --- |
| `SocialAccount.visibility` | **否**，仅账号默认状态（schema L390 注释） |
| `SharedSocialAccount` | **否**，逐对授权，是 handle 可见性的唯一真相来源 |
| `MomentSetting.visibleTo` | **否**，独立的 `VarChar(16)` 机制 |
| Profile 字段 | **是**，本次新增 |

`ProfileFieldVisibility` 不得被用来替代或放宽 `SharedSocialAccount` 的授权判定。

---

## 5. UserAttribute — kind 分离与唯一性

**Verdict: PASS（Unique constraints）**

### 5.1 kind 分离

`ABOUT_ME` 与 `LOOKING_FOR` 由 `kind` 列区分，共用同一张表、同一套约束。
二者是**不同语义**（「我是谁」vs「我想认识谁」，Q3），
不会因为共用一张表而被混为一个字段。

数量上限（Q2：各 10 个）是**产品规则**，
数据库不设硬上限 —— 与 §3 同属 `APPLICATION_LEVEL_CONSTRAINT`，
由 service 层在写入前校验。

### 5.2 两个 unique 如何共存

```
@@unique([userId, definitionId])
@@unique([userId, kind, labelKey])
```

PostgreSQL 的 unique 索引把 `NULL` 视为**互不相等**，
因此每个 `UserAttribute` 行**只会被其中一个约束实际约束**：

| 行形态 | `definitionId` | `labelKey` | 实际生效的约束 | 理由 |
| --- | --- | --- | --- | --- |
| SYSTEM | 非空 | 非空或 NULL | `(userId, definitionId)` | `(userId, kind, labelKey)` 在 `labelKey IS NULL` 时因 NULL 语义不约束；非 NULL 时二者均约束且方向一致 |
| CUSTOM | NULL | 非空 | `(userId, kind, labelKey)` | `(userId, definitionId)` 在 `definitionId IS NULL` 时因 NULL 语义不约束 |

**结论：**

1. 不存在「一个约束阻止另一个约束生效」的死锁形态。
2. 同一用户不会重复出现同一个系统标签（`(userId, definitionId)` 保证）。
3. 同一用户不会重复出现同一个自定义标签（`(userId, kind, labelKey)` 保证）。
4. `kind` 参与自定义唯一性，因此 `ABOUT_ME` 与 `LOOKING_FOR`
   可以各自拥有同名标签，互不冲突 —— 符合 Q2/Q3 的独立上限语义。
5. **约束不阻止 schema 层出现「形态错误」的行**
   （例如 `definitionId` 与 `label` 同时为空），
   这正是 §3 记录的 `APPLICATION_LEVEL_CONSTRAINT`；
   service 必须保证每行至少拥有一个可解析标识。

### 5.3 与迁移既有数据的关系

两表均为新建，`@@unique` 直接随 `CREATE TABLE` + `CREATE UNIQUE INDEX` 建立。
**不存在**用唯一索引去「清洗」既有重复数据的场景，
因此迁移不会因为唯一约束冲突而失败。

---

## 6. Review

**Verdict: PASS**

### 6.1 默认值

`UserAttribute.reviewStatus ReviewStatus @default(APPROVED)`（L743）

符合 Q1：新自定义属性**默认 APPROVED**，不进入人工审核队列。

### 6.2 写入前安全检查

Q1 要求：写入前调用既有 `SafetyService.scanText`，
`HIGH` / blocked 时**拒绝写入**。

`scanText` 的真实返回形状（`apps/api/src/safety/safety.service.ts` L6–12、L42–69）：

```ts
type SafetyScan = {
  level: RiskLevel;            // "LOW" | "MEDIUM" | "HIGH"
  reasons: string[];
  hasExternalLink: boolean;
  hasContactLeak: boolean;
  blocked: boolean;            // 独立的 CSAM 正则命中标志
};
```

关键事实：

- `level === "HIGH"` 由 `HIGH_RISK_PATTERNS` 命中产生（金钱/投资/加密/赌博/钓鱼）。
- `blocked === true` 是**独立**标志，不由 `level` 推导。
- 因此「拒绝写入」的判定条件是 **`level === "HIGH" || blocked === true`**，
  仅检查其中之一会漏判。

### 6.3 拒绝写入必须由调用方显式执行

`recordAutoFlag` 对 `level === "HIGH"` **提前返回**
`{ reportId: null, deduped: false }`（L117–119，注释说明机器信号不得写入 `Report`）。
即：HIGH 情况下**不会留下持久化的自动标记**。

因此正确实现是：

```
const scan = safety.scanText(label);
if (scan.level === "HIGH" || scan.blocked) {
  throw new BadRequestException(...)   // 直接拒绝，不落库
}
```

**不得**依赖「先写入、再靠 auto flag 事后处理」的路径。

### 6.4 本阶段边界

- **不修改** `SafetyService`。
- 不在 schema 层引入审核触发器。
- `PENDING` / `REJECTED` / `HIDDEN` 三个枚举成员在本期为**预留**：
  Q1 决策下自定义属性默认 APPROVED，
  因此第一期不会主动产生 `PENDING` 行；
  它们为后续人工/自动审核保留扩展位，不构成 schema 缺陷。

---

## 7. Visibility

**Verdict: PASS**

### 7.1 三级模型

```
PUBLIC       任何人（含未连接用户）可见
CONNECTIONS  仅 ACTIVE Connection 的对方可见
PRIVATE      仅本人可见
```

`ProfileFieldVisibility.visibility Visibility @default(PUBLIC)`（L766）
与 `UserAttribute.visibility Visibility @default(PUBLIC)`（L741）
使用同一 enum，语义一致。

### 7.2 Block > Visibility

**Block 的优先级高于任何 visibility 等级。**

既有 `getPublicProfile`（`users.service.ts` L101–151）的真实顺序是：

1. `isSelf` 判定
2. `status !== "ACTIVE"` ⇒ `404 USER_NOT_FOUND`（本人除外）
3. **Block 双向命中 ⇒ `403 BLOCKED`**
4. 之后才加载 `connection` / `country`，并构造响应

Visibility 的应用点必须**在 Block 之后**：
被 Block 的两个用户之间，无论字段设为哪一级，
都必须先返回 `403 BLOCKED`，不泄露字段是否存在。

### 7.3 CONNECTIONS 级在 Discover 的处理

Discover 的候选人是**非连接用户**。
因此对 Discover 场景，`CONNECTIONS` 级字段必须**整体省略（omit）**，
**不得降级为 PUBLIC**，也不得「省略但保留占位」。

`isConnected` 由 `connection` 查询得出（L137–151），
可用于区分 Profile Detail（可能有连接）与 Discover（通常无连接）两条读取路径。

### 7.4 完全独立的其它可见性机制

| 机制 | 结论 |
| --- | --- |
| `SocialAccount` / `SharedSocialAccount` | **完全独立**。handle 可见性只由逐对授权决定（schema L388–392、L757–758） |
| `MomentSetting.visibleTo` | **完全独立**。普通 `String @db.VarChar(16)`，不引用 `Visibility` enum |
| `Report` | 本阶段**不改动**（Q14：不新增 `targetType` / `targetId`） |

**Profile visibility ≠ Social handle visibility。**
`ProfileFieldVisibility` 不参与、不放宽、也不替代 `SharedSocialAccount` 的判定。

---

## 8. Existing Data

**Verdict: PASS**

### 8.1 Plan SQL 对既有表的全部触碰

全文件 21 条语句中，**唯一** 触碰既有表的语句是：

```sql
ALTER TABLE "User" ADD COLUMN "region" VARCHAR(80);
```

其性质：

- **可空**（无 `NOT NULL`）
- **无 default**
- **无 index**
- 在 PostgreSQL 11+ 中属于 metadata-only `ADD COLUMN`，**不重写表**

### 8.2 未受影响的既有对象

| 对象 | 是否出现在 plan SQL 中 |
| --- | --- |
| `User`（除新增 `region` 外） | 否 |
| `Interest` | 否 |
| `UserInterest` | 否 |
| `Purpose` | 否 |
| `UserPurpose` | 否 |
| `Language` | 否 |
| `UserLanguage` | 否 |
| `Country` | 否 |
| `UserPreferredCountry` | 否 |
| `SocialAccount` / `SharedSocialAccount` | 否 |
| `Moment` / `MomentSetting` / `MomentComment` / `MomentLike` | 否 |
| `Report` / `Block` / `Connection` / `ConnectionRequest` | 否 |
| `ExchangeRequest` | 否 |
| `Conversation` / `ConversationMember` / `Message` / `RefreshToken` | 否 |
| `Notification` | 否 |
| `AdminUser` / `AdminAuditLog` / `AdminNote` | 否 |

Q8 得到遵守：`Interest` / `Purpose` / `Language` / `Country`
**保持独立**，未与 `AttributeDefinition` 合并，未改类型，未改关系。
Q9 得到遵守：`bio` **未回填** 为 attribute。

### 8.3 破坏性语句检查

对 plan SQL 全文检索：

| 模式 | 结果 |
| --- | --- |
| `DROP TABLE` | 0 |
| `DROP COLUMN` | 0 |
| `DROP INDEX` | 0 |
| `DROP TYPE` | 0 |
| `ALTER COLUMN ... TYPE` / `SET DATA TYPE` | 0（仅出现在第 20 行的注释文字中，非语句） |
| `DELETE` | 0 |
| `UPDATE` | 0 |
| `TRUNCATE` | 0 |
| `ALTER TYPE`（枚举增删值） | 0 |

> 注：对 plan SQL 直接 `grep` 关键字时，`ON DELETE CASCADE` / `ON UPDATE CASCADE` 会命中 `DELETE` / `UPDATE`。
> 这些是 **外键的引用行为声明**（第 124、127、130 行），不是数据操作语句。
> 按语句类型统计：`DELETE` / `UPDATE` / `TRUNCATE` 数据语句数量为 **0**。

**既有数据不被读取、改写、回填或删除。**

---

## 9. Migration SQL

**Verdict: PASS**

`docs/architecture/PC-1.2-MIGRATION-PLAN.sql` 共 **21** 条可执行语句，
顺序如下（行号为 plan 文件内行号）：

| 序 | 类型 | 语句 | Line |
| --- | --- | --- | --- |
| 1 | CREATE TYPE | `"AttributeKind"` | 32 |
| 2 | CREATE TYPE | `"AttributeSource"` | 35 |
| 3 | CREATE TYPE | `"AttributeValueType"` | 38 |
| 4 | CREATE TYPE | `"Visibility"` | 41 |
| 5 | CREATE TYPE | `"ReviewStatus"` | 44 |
| 6 | ALTER TABLE | `"User" ADD COLUMN "region" VARCHAR(80)` | 47 |
| 7 | CREATE TABLE | `"AttributeDefinition"` | 50 |
| 8 | CREATE TABLE | `"UserAttribute"` | 69 |
| 9 | CREATE TABLE | `"ProfileFieldVisibility"` | 87 |
| 10 | CREATE UNIQUE INDEX | `AttributeDefinition_key_key` | 97 |
| 11 | CREATE INDEX | `AttributeDefinition_kind_isActive_idx` | 100 |
| 12 | CREATE INDEX | `AttributeDefinition_category_idx` | 103 |
| 13 | CREATE INDEX | `UserAttribute_userId_kind_idx` | 106 |
| 14 | CREATE INDEX | `UserAttribute_reviewStatus_idx` | 109 |
| 15 | CREATE INDEX | `UserAttribute_definitionId_idx` | 112 |
| 16 | CREATE UNIQUE INDEX | `UserAttribute_userId_definitionId_key` | 115 |
| 17 | CREATE UNIQUE INDEX | `UserAttribute_userId_kind_labelKey_key` | 118 |
| 18 | CREATE INDEX | `ProfileFieldVisibility_fieldKey_visibility_idx` | 121 |
| 19 | ADD FOREIGN KEY | `UserAttribute_userId_fkey` → `User` CASCADE | 124 |
| 20 | ADD FOREIGN KEY | `UserAttribute_definitionId_fkey` → `AttributeDefinition` SET NULL | 127 |
| 21 | ADD FOREIGN KEY | `ProfileFieldVisibility_userId_fkey` → `User` CASCADE | 130 |

### 9.1 依赖顺序正确性

1. **enum 先建**：3 张新表都以新 enum 作列类型，`CREATE TYPE` 必须排在 `CREATE TABLE` 前 —— 满足。
2. **表先于约束**：索引与 FK 都排在 3 个 `CREATE TABLE` 之后 —— 满足。
3. **FK 后置**：两条 FK 分别引用 `User`（已存在）与 `AttributeDefinition`（第 7 条已建），
   `ADD CONSTRAINT` 排在全部建表之后 —— 满足。
4. 无循环依赖，无「先引用后创建」形态。

该顺序可以在**单个事务**内执行（PostgreSQL 事务性 DDL），
即失败可整体回滚，不会留下半迁移状态。

### 9.2 与 datamodel 的一致性

plan SQL 与 `prisma/schema.prisma` 的 L702–771 逐条对照：

- 列名、类型、长度、可空性、默认值**全部一致**。
- 3 个 `@@unique` / 6 个 `@@index` / 1 个 `@@id` **全部出现在 SQL 中**，无遗漏也无多余。
- FK 的 `onDelete` 行为与 schema 声明一致（2× CASCADE、1× SET NULL）。

---

## 10. Migration Safety

**Verdict: PASS**

### 10.1 可空性与默认值

| 对象 | 声明 | 安全性 |
| --- | --- | --- |
| `User.region` | `String? @db.VarChar(80)`，无 default | 可空 + 无 default ⇒ metadata-only，旧行无需回填 |
| `UserAttribute.updatedAt` | `DateTime @updatedAt`（NOT NULL，无 default） | 表是**新建且空**，无既有行可违约 |
| `ProfileFieldVisibility.updatedAt` | `DateTime @updatedAt`（NOT NULL，无 default） | 同上 |
| `AttributeDefinition.updatedAt` | `DateTime @updatedAt`（NOT NULL，无 default） | 同上 |
| `UserAttribute.reviewStatus` | `NOT NULL DEFAULT 'APPROVED'` | 默认值在 SQL 中显式写出 |
| `UserAttribute.visibility` | `NOT NULL DEFAULT 'PUBLIC'` | 同上 |
| `AttributeDefinition.*` 布尔/枚举默认 | 均在 SQL 中显式 `DEFAULT` | 无隐式默认 |

说明：三个 `updatedAt NOT NULL 无 default` 在**空表**上合法；
若把它们加到既有非空表则会导致迁移失败 —— 本 plan 不属于该情形。

### 10.2 外键删除行为

| FK | onDelete | onUpdate | 语义 |
| --- | --- | --- | --- |
| `UserAttribute.userId` → `User.id` | **CASCADE** | CASCADE | 删用户时其属性随之删除（Q10：只由删用户触发） |
| `ProfileFieldVisibility.userId` → `User.id` | **CASCADE** | CASCADE | 同上 |
| `UserAttribute.definitionId` → `AttributeDefinition.id` | **SET NULL** | CASCADE | 删标签定义时**保留用户行**，降级为 custom 形态，不销毁用户数据 |

三者的 `onUpdate` 均为 `CASCADE`，而主键为 UUID 且从不更新，
因此不存在实际的 onUpdate 传播风险。

### 10.3 孤儿风险

- `UserAttribute.userId` 为 `NOT NULL` + CASCADE ⇒ **无法产生孤儿行**。
- `ProfileFieldVisibility.userId` 为 `NOT NULL` + CASCADE ⇒ 同上。
- `UserAttribute.definitionId` 为 NULL 是**合法且被设计**的形态（CUSTOM 行），
  不构成孤儿：`label` / `labelKey` 仍能独立解析该行。

### 10.4 生产执行注意（记录，不实施）

- 即使 `ADD COLUMN` 是 metadata-only，`ALTER TABLE` 仍需要短暂的
  `ACCESS EXCLUSIVE` 锁。生产应用时应选择低流量窗口，
  或采用「先加列、后发布代码」的两步发布。
- 本阶段**不**为 `region` 增加 index（Q11），因此不引入额外写入放大。
- 迁移必须在**单个事务**内完成，失败即回滚。

---

## 11. Index review

**Verdict: PASS**（1 条设计说明，不构成缺陷）

### 11.1 索引清单（9 条，来自 plan SQL）

| Index | 列 | 唯一 | 目的 |
| --- | --- | --- | --- |
| `AttributeDefinition_key_key` | `(key)` | 是 | 标签稳定标识查重 |
| `AttributeDefinition_kind_isActive_idx` | `(kind, isActive)` | 否 | 渲染选择器：按 kind 取启用标签 |
| `AttributeDefinition_category_idx` | `(category)` | 否 | 目录分组 |
| `UserAttribute_userId_kind_idx` | `(userId, kind)` | 否 | 读取某用户 ABOUT_ME / LOOKING_FOR |
| `UserAttribute_reviewStatus_idx` | `(reviewStatus)` | 否 | 审核队列扫描 |
| `UserAttribute_definitionId_idx` | `(definitionId)` | 否 | 反查：谁选了该定义（见 §11.2） |
| `UserAttribute_userId_definitionId_key` | `(userId, definitionId)` | 是 | SYSTEM 行去重 |
| `UserAttribute_userId_kind_labelKey_key` | `(userId, kind, labelKey)` | 是 | CUSTOM 行去重 |
| `ProfileFieldVisibility_fieldKey_visibility_idx` | `(fieldKey, visibility)` | 否 | 可见性批量解析 |

### 11.2 重叠索引说明（记录，标记为 retained by design）

`UserAttribute_definitionId_idx (definitionId)` 与
`UserAttribute_userId_definitionId_key (userId, definitionId)` 存在前缀重叠：

- 形如 `WHERE userId = ? AND definitionId = ?` 的查询
  由**复合唯一索引**（左前缀）覆盖，不需要单列索引。
- 但形如 `WHERE definitionId = ?` 的**反向查询**
  （例如「哪些用户选择了这个系统标签」、标签热度、停用影响面评估）
  **无法**由复合索引服务：`definitionId` 在其中是**非前导列**。
- 该列还可为 `NULL`，会让复合索引的可用性进一步受限。

**结论：`UserAttribute_definitionId_idx` 保留是有意设计，不是重复索引缺陷。**
除此之外，9 条索引中**没有**其它前缀重复或同列重复组合。

### 11.3 与 `@@unique` 的关系

3 条 `@@unique` 全部以 `CREATE UNIQUE INDEX` 落地（plan SQL 第 16、17 条与第 10 条），
与 schema 声明一一对应，无「声明了但 SQL 未生成」或反向的情况。

### 11.4 本阶段未新增任何索引

`region` **不加索引**（Q11）；既有模型**未新增索引**。
既有 `User` 的 `@@index([status])`、`@@index([countryCode])`、`@@index([createdAt])` 原样保留。

---

## 12. Production Statement

**Verdict: Production DB = UNKNOWN**

### 12.1 本次 diff 证据的准确范围

`prisma migrate diff --from-schema-datasource` 读取的是
**`localhost:5433` 上的本地开发数据库**。

因此本次 diff 能够证明的**只有**：

> **`localhost:5433` 当前数据库与 datamodel 的 delta 已验证。**

即：在该本地库上，`schema.prisma` 与数据库之间的差异
**恰好等于** 上表 21 条语句，没有其它未记录的漂移。

### 12.2 明确纠正的过度声明

**不得**据此得出以下任何结论：

- ~~「生产数据库已处于 datamodel head」~~ —— 未验证
- ~~「迁移可安全应用到生产」~~ —— 未验证
- ~~「生产库与 datamodel 无 schema drift」~~ —— 未验证

正确表述：

- **Production DB: UNKNOWN**
- 生产数据库的版本、扩展、既有 drift、`_prisma_migrations` 内容
  在本次评审中**没有被检查**，也没有被连接。
- 本 plan SQL 对生产是否已部分应用，**无法由本次证据判定**。

### 12.3 迁移前仍需在生产侧确认的项（记录，不实施）

1. 生产连接串指向的实例身份（本地 Docker PG / 云 PG）—— **UNKNOWN**
2. 生产库 `AttributeDefinition` / `UserAttribute` / `ProfileFieldVisibility`
   是否已存在（若曾手工建表会导致 `CREATE TABLE` 失败）
3. 生产 `Visibility` / `AttributeKind` 等同名 type 是否已存在
4. 生产 PostgreSQL 版本是否 ≥ 11（决定 `ADD COLUMN` 是否 metadata-only）
5. 生产迁移机制（是否使用 `prisma migrate deploy`，
   以及 `_prisma_migrations` 是否可追踪）

以上任一项未确认之前，不得把本次 `READY_FOR_MIGRATION` 解释为生产就绪。

---

## 13. Rollback

**Verdict: PASS**

### 13.1 回滚顺序

按依赖逆序执行：

```
1.  DROP FOREIGN KEY  UserAttribute_userId_fkey                    (on UserAttribute)
2.  DROP FOREIGN KEY  UserAttribute_definitionId_fkey              (on UserAttribute)
3.  DROP FOREIGN KEY  ProfileFieldVisibility_userId_fkey           (on ProfileFieldVisibility)
4.  DROP INDEX        ProfileFieldVisibility_fieldKey_visibility_idx
5.  DROP INDEX        UserAttribute_userId_kind_labelKey_key
6.  DROP INDEX        UserAttribute_userId_definitionId_key
7.  DROP INDEX        UserAttribute_definitionId_idx
8.  DROP INDEX        UserAttribute_reviewStatus_idx
9.  DROP INDEX        UserAttribute_userId_kind_idx
10. DROP INDEX        AttributeDefinition_category_idx
11. DROP INDEX        AttributeDefinition_kind_isActive_idx
12. DROP INDEX        AttributeDefinition_key_key
13. DROP TABLE        ProfileFieldVisibility
14. DROP TABLE        UserAttribute
15. DROP TABLE        AttributeDefinition
16. DROP TYPE         ReviewStatus
17. DROP TYPE         Visibility
18. DROP TYPE         AttributeValueType
19. DROP TYPE         AttributeSource
20. DROP TYPE         AttributeKind
21. ALTER TABLE "User" DROP COLUMN "region"
```

说明：`DROP TABLE` 会级联删除其自身索引，
第 4–12 步在真实回滚中是可选的显式写法（用于逐步脚本化）；
若采用「先 drop table」的简写，顺序依然安全，因为约束随表消失。

### 13.2 回滚不影响的对象（逐项确认）

| 对象 | 回滚是否触碰 |
| --- | --- |
| `User` | 仅移除 `region` 一列；其余列、既有索引、既有关系全部保留 |
| `Interest` / `UserInterest` | 保留 |
| `Purpose` / `UserPurpose` | 保留 |
| `Language` / `UserLanguage` | 保留 |
| `Country` / `UserPreferredCountry` | 保留 |
| `SocialAccount` / `SharedSocialAccount` | 保留 |
| `Moment*` 系列 | 保留 |
| `Report` / `Block` / `Connection*` | 保留 |
| `ExchangeRequest` | 保留 |
| `Conversation*` / `Message` / `RefreshToken` | 保留 |
| `Notification` | 保留 |
| `Admin*` 系列 | 保留 |
| 所有既有 enum（13 个） | 保留，无 `ALTER TYPE` |

### 13.3 回滚代价

- 回滚会**丢失** `UserAttribute` / `AttributeDefinition` /
  `ProfileFieldVisibility` 中的全部数据（这些表在回滚前只有本功能写入）。
- 回滚会**丢失** `User.region` 的值。
- 回滚**不会**影响任何既有业务数据 —— 这是选择「纯增量 DDL」的直接结果。

---

## 14. Final

```
Schema:              PASS
AttributeSource:     PASS  (APPLICATION_LEVEL_CONSTRAINT at service layer)
Visibility:          PASS
Unique constraints:  PASS
Foreign keys:        PASS
Indexes:             PASS  (1 retained-by-design note)
Existing data:       PASS
Migration SQL:       PASS
Rollback:            PASS
Production DB:       UNKNOWN
Final:               READY_FOR_MIGRATION
```

### 14.1 结论

该 DDL 是**纯增量**的：

- 对既有表的全部影响 = `User` 增加 1 个可空列。
- 对既有数据的影响 = 无（无读、无写、无回填、无删除）。
- 对既有 enum / 关系 / 约束的影响 = 无。
- 依赖顺序合法，可在单事务内执行，失败可整体回滚。
- 回滚路径明确且不伤及既有业务数据。

因此判定为 **READY_FOR_MIGRATION**：
该迁移**已通过评审，可以申请执行**。

### 14.2 执行前必须由负责人确认的前提

1. **Production DB 仍为 UNKNOWN** —— 生产侧 §12.3 的 5 项必须先确认。
2. `APPLICATION_LEVEL_CONSTRAINT`（§3）必须在 service 落地时一并实现，
   否则 SYSTEM / CUSTOM 的形态约束在数据库层没有任何保护。
3. 本评审**不授权**执行迁移。执行需要单独的明确指令。

### 14.3 本阶段未做的事（边界声明）

- 未执行 `prisma migrate dev` / `prisma migrate deploy` / `db push`
- 未创建任何 migration 目录或 SQL 迁移文件
- 未修改 `prisma/schema.prisma`
- 未修改任何业务代码、`SafetyService`、测试
- 未连接生产数据库
- 未新增 CHECK 约束、trigger、seed 或数据回填

**PC-1.2 MIGRATION PRE-FLIGHT REVIEW COMPLETE.**
