# PC-1.2 MIGRATION BASELINE + EXECUTION FINAL RESULT

> 任务：LOCAL PRISMA MIGRATION BASELINE + PC-1.2 EXECUTION
> 作用域：**仅** `localhost:5433 / talkfirst`
> 生产数据库：**UNKNOWN**（本阶段未连接、未验证、未提及）
> 报告时间：2026-09-19
> 前置：`PC-1.2-MIGRATION-PREFLIGHT.md`（已 READY_FOR_MIGRATION）

---

## 0. 结论摘要

```
Baseline:                        PASS
Baseline target:                 localhost:5433/talkfirst
Historical migrations:           16
Historical migrations resolved:  16 / 16
PC-1.2 migration:                20260919050334_profile_attributes
Applied:                         YES
_prisma_migrations:              17 rows / 17 finished / 0 rolled back / 0 duplicate
Schema diff:                     PASS
Existing data:                   PASS
New enums:                       PASS
New tables:                      PASS
Indexes:                         PASS
Foreign keys:                    PASS
User.region:                     PASS
Business code changed:           NO
Production DB touched:           NO

Overall:  PC-1.2 MIGRATION COMPLETE
```

---

## 1. 授权边界（本阶段实际遵守情况）

| 禁止项 | 是否触碰 |
| --- | --- |
| `prisma migrate reset` | NO |
| `prisma db push` | NO |
| 手工 `INSERT` 到 `_prisma_migrations` | NO（全部使用 `prisma migrate resolve --applied`） |
| 手工修改 migration checksum | NO |
| 修改 / 删除 / 重命名已有 16 个 migration | NO |
| 连接生产数据库 | NO |
| 修改 `apps/api` / `apps/web` / `apps/admin` / `packages` / `SafetyService` | NO |
| 修改 `prisma/schema.prisma` | NO（仍为 771 行，本阶段零改动） |
| 进入 PC-1.3 | NO |

本阶段写入范围：`prisma/migrations/`（新增 1 个目录）、`docs/architecture/`、
`.local-data/pc12/`（本地临时脚本与证据）。业务代码零改动（mtime 校验，见 §16）。

---

## 2. Baseline 前数据快照（§3）

25 张业务表，快照文件 `.local-data/pc12/baseline-counts.json`：

| 表 | 行数 | 表 | 行数 |
| --- | ---: | --- | ---: |
| User | 11 | Interest | 18 |
| AdminUser | 6 | UserInterest | 14 |
| AdminNote | 0 | Purpose | 7 |
| AdminAuditLog | 2 | UserPurpose | 11 |
| Report | 1 | Language | 20 |
| Connection | 0 | UserLanguage | 9 |
| ExchangeRequest | 0 | Country | 20 |
| SharedSocialAccount | 0 | UserPreferredCountry | 0 |
| SocialAccount | 0 | Notification | 1 |
| Block | 0 | Moment | 4 |
| Conversation | 28 | MomentComment | 1 |
| ConversationMember | 0 | MomentLike | 1 |
| Message | 0 | | |

基线时现存 migration 目录：**16 个**（`20260915083412_phase2_core_models` …
`20260917153000_admin_audit_system_actor`）。

Baseline 前 `_prisma_migrations` **不存在**（这是本阶段被阻塞的唯一原因，现已解决）。

---

## 3. §4 —— 历史 migration 与当前 DB 结构一致性（baseline 的前置证明）

未假设「16 个文件 = 已应用」。使用双向 `migrate diff`（带 shadow database）
逐向证明：

| 方向 | 命令 | 结果 |
| --- | --- | --- |
| migrations-result → live DB | `--from-migrations prisma/migrations --to-schema-datasource prisma/schema.prisma` | `-- This is an empty migration.` （0 条语句） |
| live DB → migrations-result | `--from-schema-datasource prisma/schema.prisma --to-migrations prisma/migrations` | `-- This is an empty migration.` （0 条语句） |

**结论：没有任何历史 migration 未被当前数据库结构反映。**
因此可以对这 16 个 migration 执行 baseline（`resolve --applied`）。
证据文件：`.local-data/pc12/s4-A.sql`、`.local-data/pc12/s4-B.sql`。

---

## 4. §5 —— Baseline 执行

对 16 个历史 migration 逐个执行 Prisma 正式命令：

```
npx prisma migrate resolve --applied <migration_name>     × 16
```

- 结果：**16 / 16 "marked as applied"**
- 未手工写入 tracking table
- 未修改任何历史 migration 文件、checksum、名称

Baseline 后 `prisma migrate status`：

```
16 migrations found in prisma/migrations
Database schema is up to date!
```

无 drift、0 pending。

---

## 5. §6 —— Baseline 后数据不变验证

Baseline 后再次统计 25 张表 → **`MISMATCH_COUNT: 0`**（与 §2 完全一致）。
`_prisma_migrations`：16 rows / 16 finished / 0 rolled back / 0 duplicate name。

---

## 6. §8 —— PC-1.2 正式 migration

```
npx prisma migrate dev --name profile_attributes --skip-seed
```

- 使用 `--skip-seed`：`package.json#prisma.seed` = `npx tsx prisma/seed.ts`，
  必须排除任何数据写入风险。**seed 未执行。**
- 结果：创建并应用 `20260919050334_profile_attributes`
- migration 目录数：**16 → 17**（未产生第二个重复 migration）
- 退出码 0

---

## 7. §9 —— 新 migration 内容核对

`prisma/migrations/20260919050334_profile_attributes/migration.sql`（100 行）：

| 语句类型 | 数量 |
| --- | ---: |
| `CREATE TYPE` | 5 |
| `ALTER TABLE "User" ADD COLUMN "region" VARCHAR(80)` | 1 |
| `CREATE TABLE` | 3 |
| `CREATE INDEX`（普通） | 6 |
| `CREATE UNIQUE INDEX` | 3 |
| `FOREIGN KEY`（`ADD CONSTRAINT`） | 3 |
| **合计** | **21** |

破坏性语句 census：`DROP` = 0、`DELETE` = 0、`UPDATE` = 0、`TRUNCATE` = 0、
`ALTER COLUMN TYPE` = 0、`ALTER TYPE`（既有 enum）= 0。

**与已审查计划 `docs/architecture/PC-1.2-MIGRATION-PLAN.sql` 逐字节核对：**

- 计划文件 131 行；其中第 1–30 行是 `-- PC-1.2 PROFILE ATTRIBUTE MIGRATION PLAN
  (NOT A MIGRATION)` 说明性注释头，末行 131 为空行。
- 第 31–130 行（生成 DDL 正文，100 行）与 migration 第 1–100 行
  `diff` 结果为空 → **`DDL_BODY_IDENTICAL=YES`**。
- 差异仅限计划文件的注释头与一个空行，均为不可执行内容。

唯一被改动的既有表：`"User"`，仅新增一个可空、无默认值列。

---

## 8. §10 —— Migration 后 Prisma 状态

| 命令 | 结果 |
| --- | --- |
| `npx prisma migrate status` | `17 migrations found` / `Database schema is up to date!` |
| `npx prisma validate` | `The schema at prisma\schema.prisma is valid 🚀` |
| `npx prisma generate` | client 生成成功 |

0 pending migration。

---

## 9. §11 —— Schema Diff（双向）

| 方向 | 结果 |
| --- | --- |
| datamodel → DB | empty |
| DB → datamodel | empty |
| migrations-result → DB（带 shadow） | empty |

证据：`.local-data/pc12/diff-db-to-datamodel.sql`、`.local-data/pc12/s11c.sql`、
`.local-data/pc12/s11c2.sql`。

> 备注：§11C 首次执行因内联 shell 脚本的引号拼接错误
> （`tf_shadow_v10schema=public`）失败，属脚本缺陷而非 Prisma 问题；
> 修正后重跑为空 diff。

---

## 10. §12 —— Migration 后数据对账

25 张表 → **`MISMATCH_COUNT: 0`**（baseline = after migration）。
特别核对保持原值：`User`、`Interest`、`UserInterest`、`Purpose`、`UserPurpose`、
`Language`、`UserLanguage`、`Country`、`UserPreferredCountry`。

`.local-data/pc12/after-migration-counts.json` ＝ `.local-data/pc12/baseline-counts.json`。

---

## 11. §13 —— PC-1.2 新对象验证（真实 SQL）

### 11.1 枚举（5）

| 枚举 | 成员 |
| --- | --- |
| `AttributeKind` | `ABOUT_ME`, `LOOKING_FOR` |
| `AttributeSource` | `SYSTEM`, `CUSTOM` |
| `AttributeValueType` | `BOOLEAN`, `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT` |
| `Visibility` | `PUBLIC`, `CONNECTIONS`, `PRIVATE` |
| `ReviewStatus` | `PENDING`, `APPROVED`, `REJECTED`, `HIDDEN` |

`public` schema enum 总数：**18**（13 个既有 + 5 个新增）。

### 11.2 表

`AttributeDefinition`、`UserAttribute`、`ProfileFieldVisibility` 三表均存在。

`public` schema 表总数：**37** = 36 张业务表 + `_prisma_migrations`
（已逐项枚举确认；相对 36 的多出项**仅为** `_prisma_migrations`）。

### 11.3 外键（3）

| 外键 | 指向 | ON DELETE |
| --- | --- | --- |
| `UserAttribute_userId_fkey` | `User` | CASCADE |
| `UserAttribute_definitionId_fkey` | `AttributeDefinition` | **SET NULL** |
| `ProfileFieldVisibility_userId_fkey` | `User` | CASCADE |

### 11.4 索引（12 = 3 pkey + 9 声明）

`AttributeDefinition_pkey`、`UserAttribute_pkey`、`ProfileFieldVisibility_pkey`
+ 9 个声明索引（3 unique：`AttributeDefinition_key_key`、
`UserAttribute_userId_definitionId_key`、`UserAttribute_userId_kind_labelKey_key`；
6 普通：`AttributeDefinition_kind_isActive_idx`、`AttributeDefinition_category_idx`、
`UserAttribute_userId_kind_idx`、`UserAttribute_reviewStatus_idx`、
`UserAttribute_definitionId_idx`、`ProfileFieldVisibility_fieldKey_visibility_idx`）。

> `UserAttribute_definitionId_idx` 依 preflight §11.2 为**刻意保留**
> （服务反查 `WHERE definitionId = ?`），非缺陷。

### 11.5 `User.region`

| 属性 | 值 |
| --- | --- |
| 存在 | YES |
| nullable | YES |
| 类型 | `character varying(80)` |
| default | NONE |
| 索引 | **0**（依 Q11，第一期不加索引） |
| 现有 `User` 行 | 11 行，`region` 全为 `NULL` |

---

## 12. §14 —— Migration History

`_prisma_migrations` 最终状态：**17 行**

- `finished_at IS NOT NULL AND rolled_back_at IS NULL` → 17
- `rolled_back_at IS NOT NULL` → 0
- 重复 `migration_name` → 0
- 历史 16 个 migration 的 checksum 未被修改

`applied_steps_count` 分布：

| migration | steps |
| --- | ---: |
| 16 个历史 migration | 0 |
| `20260919050334_profile_attributes` | 1 |

> `steps=0` 是 `prisma migrate resolve --applied` 的**正常产物**，
> 不是 drift，也不是错误，未做任何「修正」。

---

## 13. §15 —— Rollback 验证（临时数据库）

**未在 `talkfirst` 主库回滚。** 使用临时库 `talkfirst_pc12_rollback`
（+ shadow `tf_shadow_rb`），流程：

1. 新建临时库 `talkfirst_pc12_rollback`
2. `prisma migrate deploy` → 17 个 migration 全部成功应用
3. 验证 PC-1.2 对象存在
4. 执行回滚 SQL（preflight §13.1 依赖逆序：
   3 个 FK → 9 个 index → 3 个 table → 5 个 type → `User.region`）
5. 验证恢复
6. `DROP DATABASE` 两个临时库

| 检查项 | 回滚前 | 回滚后 |
| --- | ---: | ---: |
| `public` enum 数 | 18 | **13** |
| `public` 表数 | 37 | **34** |
| `User.region` 列 | 1 | **0** |
| PC-1.2 外键数 | 3 | **0** |
| PC-1.2 表数 | 3 | **0** |
| PC-1.2 enum 数 | 5 | **0** |
| 既有 21 张关键表存活 | 21 | **21** |

回滚脚本退出码 0，21 条语句全部执行（`ON_ERROR_STOP=1`）。

**恢复精确性证明**：以「仅含 16 个历史 migration 的 migrations 目录」为基准，
对回滚后的临时库做 `migrate diff`：

```
-- This is an empty migration.
```

→ 回滚后结构与 PC-1.2 之前的状态**完全一致**（无残留、无缺口）。

清理：两个临时库已删除；`localhost:5433` 上仅剩 `talkfirst`。
`.local-data/pc12/rb-rollback.sql`、`.local-data/pc12/rb-verify.sql`、
`.local-data/pc12/rb/` 为本次证据。

> 备注：rollback 脚本首轮执行因 verification SQL 的 shell 引号写法有误
> （`''` 在单引号串内不构成转义），导致校验查询报 SQL 语法错；
> 已改为 `psql -f <file>` 方式并重跑，最终结果如上。回滚本身首轮即正确。

---

## 14. §16 —— 业务代码与生产数据库

| 检查 | 结果 |
| --- | --- |
| `apps/api` 修改 | NO |
| `apps/web` 修改 | NO |
| `apps/admin` 修改 | NO |
| `packages/*` 修改 | NO |
| `SafetyService` 修改 | NO |
| `prisma/schema.prisma` 修改 | NO（仍 771 行） |
| 生产数据库连接 | NO |
| PC-1.3 启动 | NO |

本阶段（baseline + migration + rollback 验证）内写入的文件，经 mtime 校验
（`find -newermt '-25 minutes'`）为：

- `.local-data/pc12/**`（本地临时脚本与证据）
- `docs/architecture/PC-1.2-*.md` / `PC-1.2-MIGRATION-PLAN.sql`（文档）
- `prisma/migrations/20260919050334_profile_attributes/migration.sql`（新增 migration）
- `prisma/migrations/migration_lock.toml`（`migrate dev` 重写为同一内容：
  `provider = "postgresql"`，内容无变化）

**无任何 `apps/`、`packages/` 文件被修改。**

---

## 15. 环境与运行条件

| 项 | 值 |
| --- | --- |
| datasource | `postgresql://talkfirst:***@localhost:5433/talkfirst?schema=public` |
| `DIRECT_URL` | 同上（:5433） |
| `current_database()` | `talkfirst` |
| PostgreSQL | 18.1（本地集群，port 5433） |
| 另一 5432 集群 | Windows 服务实例，**全程未使用** |
| DB role `talkfirst` | `rolcreatedb = true`（shadow DB 所需）、`rolsuper = false` |
| Prisma | 6.19.3 |

`localhost:5433` 当前**未监听**（本阶段所有 PostgreSQL 进程已停止）；
临时数据库 `talkfirst_pc12_rollback`、`tf_shadow_*` 均已删除。

---

## 16. 遗留事项（不影响本阶段结论）

| 项 | 级别 | 说明 |
| --- | --- | --- |
| `SYSTEM ⇒ definitionId != null` / `CUSTOM ⇒ definitionId == null AND label != null AND labelKey != null` | P1（PC-1.3） | schema 层无法表达（无 `@check`；跨表 `scope` 校验需 trigger）。**migration 中不存在任何 CHECK 约束**，必须由 service 层保证。见 preflight §3 |
| `_prisma_migrations` 中 16 个历史 migration `applied_steps_count = 0` | 非问题 | `resolve --applied` 的正常产物 |
| `.local-data/pc12/` 脚本与证据 | 本地临时 | 保留以支持复现；非业务代码；如不需要可整体删除 |
| `UserAttribute_definitionId_idx` | 非问题 | 依设计保留 |

---

## 17. 作用域声明（对历史表述的纠正）

本报告中的全部证据**仅**来自 `localhost:5433`。

本地 `talkfirst` 数据库与 `prisma/schema.prisma` datamodel 之间的 delta
已验证为空。

**生产数据库状态：UNKNOWN。** 本阶段未连接、未查询、未假设生产数据库
处于任何 migration 位置。任何「生产已就绪 / 生产已 head」的推论均**不成立**。

---

## 18. 最终判定

```
Baseline:                        PASS
Baseline target:                 localhost:5433/talkfirst
Historical migrations:           16
Historical migrations resolved:  16 / 16
PC-1.2 migration:                20260919050334_profile_attributes
Applied:                         YES
_prisma_migrations:              17 rows / 17 finished / 0 rolled back / 0 duplicate
Schema diff:                     PASS   (datamodel↔DB, migrations↔DB 均为 empty)
Existing data:                   PASS   (25/25 表, MISMATCH_COUNT 0)
New enums:                       PASS   (5/5)
New tables:                      PASS   (3/3)
Indexes:                         PASS   (12 = 3 pkey + 9 declared)
Foreign keys:                    PASS   (3/3, CASCADE / SET NULL / CASCADE)
User.region:                     PASS   (varchar(80), nullable, no default, 0 index)
Rollback test:                   PASS   (临时库 diff 为 empty)
Business code changed:           NO
Production DB touched:           NO

Overall:  PC-1.2 MIGRATION COMPLETE
```

---

## 附：本阶段证据文件索引

| 文件 | 内容 |
| --- | --- |
| `.local-data/pc12/baseline-counts.json` | baseline 前 25 表快照 |
| `.local-data/pc12/after-baseline-counts.json` | baseline 后快照 |
| `.local-data/pc12/after-migration-counts.json` | migration 后快照 |
| `.local-data/pc12/s4-A.sql` / `s4-B.sql` | §4 双向 empty diff 证明 |
| `.local-data/pc12/s11c.sql` / `s11c2.sql` | §11 migrations→DB diff |
| `.local-data/pc12/rb-rollback.sql` / `rb-verify.sql` / `rb/` | §15 回滚验证证据 |
| `.local-data/pc12/migrations-base/` | 仅含 16 个历史 migration 的基准目录 |
| `prisma/migrations/20260919050334_profile_attributes/migration.sql` | 本次正式 migration |
| `docs/architecture/PC-1.2-MIGRATION-PREFLIGHT.md` | 迁移前审查（READY_FOR_MIGRATION） |
| `docs/architecture/PC-1.2-MIGRATION-PLAN.sql` | 已审查的 DDL 计划 |
