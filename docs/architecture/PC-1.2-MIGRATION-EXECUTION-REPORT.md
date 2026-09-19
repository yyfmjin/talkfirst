# PC-1.2 MIGRATION EXECUTION REPORT

Status: **MIGRATION BLOCKED — STOPPED BEFORE EXECUTION**

本阶段**未执行任何迁移**。
触发的是用户指令 §3 中明确规定的硬性 STOP 条件。

---

## 0. Executive Summary

| 项 | 结果 |
| --- | --- |
| 目标数据库 | `localhost:5433` / `talkfirst` ✅ 符合 §1 |
| 生产数据库 | **未连接** |
| §3 前置条件（`_prisma_migrations` 必须存在） | ❌ **FAIL** |
| 迁移 | **未执行** |
| migration 文件 | **未创建** |
| 业务代码 | **未修改** |
| 结论 | **STOP** |

触发 STOP 的唯一原因：

> `localhost:5433` 的 `talkfirst` 库中**不存在 `_prisma_migrations` 表**。

依据用户指令 §3：

> 如果当前数据库没有 `_prisma_migrations`：先 STOP。
> 不要使用 `db push`。不要通过 psql 手工执行然后假装 Prisma migration 已完成。

该条件已触发，因此在生成 migration 之前即停止。

---

## 1. 目标数据库验证（§1）

`DATABASE_URL` / `DIRECT_URL` 均来自 `.env`（密码不在此处记录）：

| 项 | 值 |
| --- | --- |
| URL host:port | `localhost:5433` |
| `current_database()` | `talkfirst` |
| `current_user` | `talkfirst` |
| `inet_server_addr()` | `::1/128`（loopback） |
| `inet_server_port()` | `5433` |
| server version | PostgreSQL **18.1** on x86_64-windows |
| 非系统 schema | 仅 `public` |

**PASS** —— 连接目标是本地 5433 环回地址。
`5432`（另一套 Windows 服务集群）**未被连接**，生产库**未被连接**。

注：`.env.example` 中的示例值为 `:5432`，但实际 `.env` 为 `:5433`，
本次执行以实际 `.env` 为准。

---

## 2. 迁移前快照（§2）

### 2.1 行数快照（迁移前）

| 表 | 行数 |
| --- | --- |
| `User` | 11 |
| `Interest` | 18 |
| `UserInterest` | 14 |
| `Purpose` | 7 |
| `UserPurpose` | 11 |
| `Language` | 20 |
| `UserLanguage` | 9 |
| `Country` | 20 |
| `UserPreferredCountry` | 0 |

快照已落盘：`.local-data/pc12/pre-snapshot.json`

### 2.2 schema / migration state

| 项 | 值 |
| --- | --- |
| `public` 表数量 | **33** |
| `public` enum 数量 | **13** |
| `_prisma_migrations` | **不存在**（全库 `pg_class` 检索 `%migration%` → 无任何匹配） |
| `prisma/migrations` 目录 | **16** 个 migration + `migration_lock.toml` |
| `SchemaMeta` 行 | `id=talkfirst`, `phase=15-moments`, `updatedAt=2026-09-17 10:35:54` |
| PC-1.2 新对象 | `region` 列不存在；3 张新表不存在；5 个新 enum 不存在 |

`SchemaMeta.phase` 是业务侧自记标签（停在 `15-moments`），
**不是** Prisma 迁移追踪表，不能替代 `_prisma_migrations`。

### 2.3 数据库实际结构位置

现有 13 个 enum 全部存在，且全部为 PC-1.2 之前的 enum：

```
AdminRole, AuditActorType, ConnectionStatus, ExchangeStatus, Gender,
LanguageLevel, LanguageType, MessageType, MomentSource, ReportStatus,
RequestStatus, SocialPlatform, UserStatus
```

即：**数据库内容已经具备全部 16 个 migration 的对象形态**，
但**没有任何迁移历史记录**。

---

## 3. §3 前置条件 —— BLOCKED

### 3.1 `prisma migrate status` 实际输出

```
Datasource "db": PostgreSQL database "talkfirst", schema "public" at "localhost:5433"

16 migrations found in prisma/migrations
Following migrations have not yet been applied:
20260915083412_phase2_core_models
20260915093221_phase4_discover
20260915200039_phase5_connection_conversation
20260915202602_phase7_exchange
20260915211738_phase10_admin
20260915224945_phase13_admin_console
20260915231253_phase14_translate_cache
20260915235218_phase15_moments
20260917090000_phase15_foreign_keys_and_indexes
20260917091500_phase16_social_platform_talkfirst
20260917092000_phase16_shared_social_account
20260917094000_phase16_drop_social_visibility
20260917095500_phase16_moment_source
20260917121000_phase17_admin_rbac_enums
20260917121100_phase17_admin_rbac
20260917153000_admin_audit_system_actor
```

Prisma 把全部 16 个 migration 都判定为「未应用」，
因为**没有追踪表可以读取**（而不是因为对象不存在）。

### 3.2 STOP 判定

```
STOP_CONDITION: _prisma_migrations MISSING
→ 不得生成 migration
→ 不得执行 migrate dev / migrate deploy / db push
→ 不得手工补写迁移历史
```

**已停止。** 未执行 §3–§11 中的任何迁移步骤。

---

## 4. 为什么常用命令在此状态下不可用（分析，均未执行）

| 命令 | 在当前状态下会发生什么 | 是否已执行 |
| --- | --- | --- |
| `prisma migrate dev` | 无追踪表 ⇒ Prisma 找不到 baseline，会把库视为 drift，**提示 reset（清空数据库）**。这会销毁 11 个 User 及全部业务数据。 | **否** |
| `prisma migrate deploy` | 会把 16 个 migration **全部**当作待应用；第一个 `CREATE TABLE` 就会因对象已存在而失败。 | **否** |
| `prisma db push` | 明确禁止。 | **否** |
| `psql` 直接执行 plan SQL | 明确禁止（会造成「DB 已改但没有迁移历史」，比现在更糟）。 | **否** |
| 手工向 `_prisma_migrations` 插入记录 | 明确禁止（伪造迁移历史）。 | **否** |
| `prisma migrate resolve --applied` | 属于「建立 baseline」的历史操作，**本阶段未获授权**，需要单独指令。 | **否** |

**因此本阶段的正确动作是停止，而不是绕过。**

---

## 5. Delta 验证（解除阻塞所需的证据，已取得）

运行只读命令：

```
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel  prisma/schema.prisma --script
```

输出**恰好等于** PC-1.2 已审查的 21 条语句，无任何多余差异：

| 语句类型 | 数量 | 期望 |
| --- | --- | --- |
| `CREATE TYPE` | 5 | 5 ✅ |
| `ALTER TABLE "User" ADD COLUMN "region"` | 1 | 1 ✅ |
| `CREATE TABLE` | 3 | 3 ✅ |
| `CREATE INDEX` / `CREATE UNIQUE INDEX` | 9 | 9 ✅ |
| `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` | 3 | 3 ✅ |
| **合计** | **21** | **21** ✅ |

输出已留存：`.local-data/pc12/diff-db-to-datamodel.sql`

**结论：`localhost:5433` 不存在 PC-1.2 以外的 schema drift。**
该库的结构 == datamodel 减去 PC-1.2 的增量。

这同时说明：当前的阻塞点是**纯粹的迁移历史缺失（tracking gap）**，
不是结构差异（structure gap）。

---

## 6. 未修改确认（§12）

| 对象 | 状态 |
| --- | --- |
| `prisma/schema.prisma` | 未修改，仍 771 行 |
| `prisma/migrations/` | 未新增，仍 16 个 migration + lock 文件 |
| `prisma/migrations/migration_lock.toml` | 未修改，`provider = "postgresql"` |
| `apps/api` / `apps/web` / `apps/admin` / `packages` | 未修改 |
| `SafetyService` | 未修改 |
| 任何迁移 SQL | **未生成** |
| 生产数据库 | **未连接、未触碰** |

新增文件仅限：
- `docs/architecture/PC-1.2-MIGRATION-EXECUTION-REPORT.md`（本文件）
- `.local-data/pc12/`（本地证据：快照 + diff 输出）

---

## 7. 验收项状态（§4–§11 均未执行）

| 验收项 | 状态 | 原因 |
| --- | --- | --- |
| §4 Migration SQL 内容检查 | **NOT EXECUTED** | 未生成 migration |
| §5 `migrate status` / validate / generate | 部分：`migrate status` 已运行（只读） | 阻塞中 |
| §6 双向 schema diff | 部分：DB→datamodel 已运行（只读） | 阻塞中 |
| §7 数据对账（前 = 后） | **NOT EXECUTED** | 无「后」可对账 |
| §8 新对象真实 SQL 验证 | **NOT EXECUTED** | 新对象未创建 |
| §9 `User.region` 验证 | **NOT EXECUTED** | 列未创建 |
| §10 Rollback test（临时库） | **NOT EXECUTED** | 无 migration 可回滚 |
| §11 Migration tracking | 已确认**缺失** | 本节即阻塞根因 |

迁移前的数据快照已完成（§2），这是本阶段唯一可以并已完成的准备工作。

---

## 8. 解除阻塞的候选方案（仅列出，**未实施**）

以下方案都需要**明确授权**，本阶段一律未执行。

### 方案 A —— 为本地库建立 baseline，再应用 PC-1.2

思路：把现有 16 个 migration 标记为「已应用」，使 PC-1.2 成为第 17 个。

- 需要：`prisma migrate resolve --applied <name>`（×16）或等价 baseline 操作
- 影响：`_prisma_migrations` 被创建并写入历史
- 风险：历史记录由人工补写，与「真实应用过」不等价；
  但由于 §5 已证明结构完全一致，补写是**结构性可辩护**的
- 需要用户决策：**是**

### 方案 B —— 用 migration 重建本地库

思路：新建一个空库，让 16 个 migration + PC-1.2 顺序应用。

- 影响：现有本地数据（11 User 等）需要迁移或丢弃
- 优点：迁移历史 100% 真实
- 风险：会丢失本地测试数据（含既有 E2E fixture）
- 需要用户决策：**是**

### 方案 C —— 只产出 migration 文件，不应用

思路：创建 `prisma/migrations/2026xxxx_profile_attributes/migration.sql`，
但不执行任何 apply。

- 影响：仓库获得可追溯的 migration；本地库状态不变
- 风险：`migrate dev` 在无追踪表时仍不可用；
  文件生成需手工复制已审查 SQL（必须逐字一致）
- 需要用户决策：**是**

**本报告不对以上方案排序，也不推荐。** 由用户决定。

---

## 9. 文档修正

本阶段发现并修正了 PC-1.2 Pre-flight Review 中的一处事实错误：

| 文档 | 原表述 | 修正为 | 依据 |
| --- | --- | --- | --- |
| `PC-1.2-MIGRATION-PREFLIGHT.md` §0 | `prisma/migrations` 仍为 **17 项**（+ lock） | 仍为 **16 个 migration**（+ lock） | `ls \| wc -l` 此前把 `migration_lock.toml` 也计入了；Prisma 自报为 "16 migrations found" |

该修正不改变 §0–§14 的任何判定结论（当时的关键论点是「未新增 migration」，
该结论依然成立）。

文档行数保持 737 行未变。

---

## 10. 结论

```
Target DB:              localhost:5433 / talkfirst  (PASS — 非生产)
Hard precondition §3:   FAIL (_prisma_migrations MISSING)
Migration:              NOT CREATED
Applied:                NO
Rollback test:          NOT EXECUTED (no migration to roll back)
Business code changed:  NO
Production DB touched:  NO
Overall:                MIGRATION BLOCKED
```

阻塞根因单一且明确：**本地 5433 库缺少 Prisma 迁移追踪表**。

在获得解除阻塞的明确指令之前，不再继续。

**PC-1.2 MIGRATION EXECUTION: STOPPED AT §3 PRECONDITION.**
