# Admin Audit — SYSTEM actor 实施记录

> 落地日期：2026-09-17 · Migration：`20260917153000_admin_audit_system_actor`
>
> 设计依据：`docs/ADMIN-SYSTEM-ACTOR-DESIGN.md`（未做任何超出该设计的改动）

本阶段只做一件事：**让平台自身的动作能诚实地进入审计日志**。没有 Dashboard、没有
Users 新功能、没有 Reports / Moderation / Risk / Connections / Exchange / Blocks /
Settings / Announcements / OAuth / Activity / Redis / Subscription。

---

## 1. 数据库

### 变更

```prisma
enum AuditActorType {
  USER
  SYSTEM
}

model AdminAuditLog {
  actorType  AuditActorType @default(USER)   // 新增
  adminId    String?  @db.Uuid               // 由必填放宽为可空
  admin      User?    @relation("AuditByAdmin", ...)  // 随之可空
  // 其余字段与索引一字未改
}
```

### Migration 实际执行的 SQL

```sql
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

ALTER TABLE "AdminAuditLog"
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
  ALTER COLUMN "adminId" DROP NOT NULL;

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actor_consistency_check"
  CHECK (
    ("actorType" = 'USER'   AND "adminId" IS NOT NULL) OR
    ("actorType" = 'SYSTEM' AND "adminId" IS NULL)
  );
```

前两条由 `prisma migrate diff` 生成；第三条 Prisma schema 语言**无法表达**，只存在于
migration SQL 中。这带来一个必须记住的漂移风险：`prisma migrate diff` / `db pull` 不
认识它，将来若用 `migrate dev` 重新生成迁移可能静默丢弃。因此：

- migration 文件里用注释写明了它的来源与风险；
- `scripts/phaseA-rbac-verify.mjs` 增加了存在性断言（按 `pg_constraint` 查，并校验谓词
  的两个分支都在），以及**用真实 SQL 尝试伪造**、断言被 Postgres 拒绝。

### 执行前的安全检查（全部通过）

| 检查 | 结果 |
| --- | --- |
| 数据库备份 | `.local-data/backups/pre_system_actor_20260917.sql`（294,545 字节，含 `COPY public."AdminAuditLog"`） |
| 迁移前 schema 漂移 | `-- This is an empty migration.`（干净基线） |
| 现有 AuditLog 行数 | 17 |
| `adminId IS NULL` 的行 | **0** |
| distinct adminId | 4，且全部能解析到真实 `User` |
| 历史行是否都能归类为 USER | **是** → `@default(USER)` 恰好正确，无需回填、无需重写 |
| 原有 CHECK 约束 | 无（`existingCheckConstraints: []`），新约束不冲突 |
| `adminId` 原状态 | `is_nullable = NO`，`column_default = null` |

**没有 reset 数据库，没有删除任何历史 AuditLog 行。**

### 为什么没有建 system user

`NULL` 才是"没有人类执行者"的诚实表示。一个假账号即使密码不可用，仍然会：(a) 在
`User` 表留下真实行；(b) 被 `searchUsers` 搜到；(c) 一旦某条代码路径放松哈希校验就变成
可登录身份；(d) 污染 `dashboard()` 的总用户数。

### 为什么 nullable FK + `Restrict` 是安全的

Postgres 对 NULL 不施加外键检查，所以 `ON DELETE RESTRICT` 继续保护全部人工行，而
SYSTEM 行天然不受约束。`DROP NOT NULL` 是纯元数据操作，不重写表；`ADD COLUMN` 带常量
默认值在 PG 11+ 同样是纯元数据操作。17 行瞬时完成。

### 回滚

```sql
ALTER TABLE "AdminAuditLog" DROP CONSTRAINT "AdminAuditLog_actor_consistency_check";
ALTER TABLE "AdminAuditLog" DROP COLUMN "actorType";
ALTER TABLE "AdminAuditLog" ALTER COLUMN "adminId" SET NOT NULL;
DROP TYPE "AuditActorType";
```

注意 `SET NOT NULL` 在已有 SYSTEM 行时**会失败**——这是正确的，它应该失败，而不是静默
销毁证据。

---

## 2. AdminService

| 改动 | 说明 |
| --- | --- |
| `AuditInput.adminId: string` → `adminId?: string \| null` | 类型放宽 |
| `AuditInput` 新增 `actorType?: AuditActor` | `AuditActor = "USER" \| "SYSTEM"`，不引入 Prisma 生成类型 |
| `recordAudit` 写入 `actorType: input.actorType ?? "USER"`、`adminId: input.adminId ?? null` | **默认 USER** ⇒ 现有 10 处调用点一行未改，语义完全不变 |
| 新增 `assertActorConsistency` | 应用层镜像 DB CHECK |
| 新增 `recordSystemAudit(input: SystemAuditInput, client?)` | 固定 `actorType = "SYSTEM"`、`adminId = null` |

`SystemAuditInput = Omit<AuditInput, "adminId" | "actorType">` —— `adminId` 不是"可选"，
而是**结构上不存在**。调用方无法在类型层面给出一个管理员 id。实现上先展开调用方的
对象再覆盖，所以即使有人用 `as` 强行塞进来，运行时也不会生效（有专门测试钉住）。

应用层校验抛出的错误使用项目既有信封：

```json
{ "success": false, "error": { "code": "AUDIT_ACTOR_INVALID", "message": "..." } }
```

两条规则与 CHECK 一一对应：`SYSTEM` 不得带 `adminId`；`USER` 必须有 `adminId`。
两边保持一致，所以写错时在单测里就能看到可读的报错，而不是等到 insert 抛
`23514 check_violation`。

`AdminNote.adminId` **保持必填**：备注本质是人类批注，定时任务不该写备注。

---

## 3. Scheduler

`UserStatusScheduler` 现在在**一次成功的扫描之后**写一条 SYSTEM 审计行。

### 关键：`updateMany` 一字未改

需求明确要求"保持原有 updateMany 幂等逻辑"，并且"如果为了记录每个用户的恢复而必须改
变 updateMany：先停止并报告"。因此本次**没有**改成 `updateManyAndReturn`，也没有拆成
`findMany` + 逐行更新。扫描仍然是原来那一条语句：

```ts
const { count } = await this.prisma.user.updateMany({
  where: { status: "SUSPENDED", suspendedUntil: { not: null, lte: now } },
  data: { status: "ACTIVE", suspendedUntil: null, bannedAt: null, banReason: null },
});
```

谓词自消耗（更新后不再匹配），所以第二次 tick 更新 0 行。审计写入以 `count > 0` 为门
控，因此第二次 tick 也不会追加重复行——"一个恢复批次 → 一条审计行"在重复执行下稳定。

### 写入的行

```
actorType = SYSTEM        （由 recordSystemAudit 固定）
adminId   = NULL          （同上；没有任何真实管理员 UUID）
action    = SYSTEM_USER_SUSPENSION_EXPIRED
targetType= USER
targetId  = NULL          （一个批次没有单一目标，不假装有）
before    = { status: "SUSPENDED" }
after     = { status: "ACTIVE" }
detail    = "Auto-released N expired suspension(s)"
```

### 失败语义

审计写入**不在**事务里，而是在释放成功之后进行：释放是安全关键路径（账号被锁在外面），
不该被一次审计 insert 拖住。写入失败会以 `error` 级别记日志，释放计数照常返回，定时器
不会因此中断。代价是：若这一次 insert 失败，该批次不会补写（谓词已不再匹配）——这是
本设计明确接受的取舍，也是"逐用户审计行"方案的动机之一。

### 模块装配

`AdminModule` 现在 `exports: [AdminService]`，`UsersModule` `imports: [AdminModule]`，
让定时器通过 `recordSystemAudit` 这个唯一入口写入，而不是自己拼 `adminAuditLog.create`。
`AdminModule` 不 import 任何模块，因此不构成循环依赖。

---

## 4. Audit UI

`apps/admin/src/app/audit/page.tsx`：

```tsx
type AuditItem = {
  actorType?: "USER" | "SYSTEM";
  adminId: string | null;      // 由 string 放宽
  ...
};
```

渲染改为按 `actorType` 分支：

- **SYSTEM** → 浅底徽章 `系统 · 自动`，**绝不**读 `adminId`；
- **USER** → 保持原有 `admin ${adminId?.slice(0, 8) ?? "-"}`，人工行外观零漂移；
- 防御性 `?.`：即使将来出现脏数据也不会崩页。

改动前的写法 `item.adminId.slice(0, 8)` 在 `null` 上会抛异常，**第一条 SYSTEM 行就会让整
个审计页白屏**——这正是 UI 必须与第一条 SYSTEM 写入同批上线的原因。

未加"全部 / 仅人工 / 仅系统"筛选（需要 `@@index([actorType, createdAt])`），按设计留作
独立小改动。

---

## 5. 测试

### 应用层（`apps/api`，Jest）

`admin-audit.spec.ts` 新增 11 项，覆盖需求指定的 4 种组合：

| # | 用例 | 期望 |
| --- | --- | --- |
| 14 | USER + adminId | PASS |
| 15 | 不传 actorType（默认 USER） | PASS，且 `actorType = USER` |
| 16 | SYSTEM + null | PASS |
| 17 / 17b | SYSTEM + adminId | FAIL（400 `AUDIT_ACTOR_INVALID`，且**未尝试 insert**） |
| 18 / 18b | USER + null / undefined | FAIL（同上） |
| 19 | `recordSystemAudit` | 固定 SYSTEM + null |
| 20 | 调用方强行塞 `adminId` | 运行时被覆盖，持久化内容不含该 id |
| 21 | `recordSystemAudit` 走事务客户端 | 生效 |
| 22 | 人工动作（`addNote`） | 仍是 `actorType = USER` |

`user-status.scheduler.spec.ts` 新增 8 项，覆盖需求指定的 5 个 scheduler 场景：

| 用例 | 期望 |
| --- | --- |
| Test 5 到期恢复 | 写 1 条 SYSTEM 审计行，含 action/targetType/before/after |
| Test 6 非到期 | **不写**任何审计行 |
| Test 7 第二次 tick | 不追加重复行 |
| Test 8 / 8b BANNED | 不恢复、不写审计行 |
| Test 9 SYSTEM 审计不伪造身份 | 只走 `recordSystemAudit`，payload 里**没有 `adminId` 属性**，无任何 UUID |
| Test 9b 截断 | 与人工行共用同一套列长限制 |
| 审计写入失败 | 释放不回滚、定时器不中断、后续 tick 照常 |

### 真实数据库 + 真实 HTTP（`scripts/phaseA-rbac-verify.mjs`）

**57 → 72 项，全部通过。** 新增 15 项：

- 6 项 schema 断言：enum 恰为 `(USER, SYSTEM)`、`actorType` NOT NULL 且默认 USER、
  `adminId` 可空、CHECK 存在且两个分支谓词都正确、FK 仍是 `RESTRICT`、**全表无违反配对
  规则的行**（一个错误的 DEFAULT 会静默把整段历史重标为机器动作，所以必须实测）。
- 5 项 SYSTEM 写入实测：跑**真实编译产物**的 `UserStatusScheduler` + `AdminService`
  对真实 PostgreSQL，断言恰好写 1 条、`actorType=SYSTEM` 且 `adminId=null`、记录了
  状态迁移、行内除自身主键外无任何 UUID、空扫描不追加第二行。
- 4 项伪造拒绝实测：直接用 SQL 插 `SYSTEM + 真实 adminId`、`USER + NULL`，断言被
  Postgres 以 `AdminAuditLog_actor_consistency_check` 拒绝，且没有留下任何行。

### 浏览器（`apps/admin`，Playwright）

新增 `test/e2e/admin-audit-ui.spec.ts`，**10 → 14 项**：

| 用例 | 期望 |
| --- | --- |
| Test 10 | 人工行仍渲染 `admin <8位>`，且**不出现**"系统" |
| Test 11 | SYSTEM 行渲染 `系统 · 自动`，不出现 `admin `、`null`、`undefined`；target 显示 `-` |
| Test 12 | `adminId = null` 不崩溃：标题仍在、两种行同时存在、列表非空、`pageerror` 为空、无错误边界文案 |
| Test 12b | SYSTEM 行只渲染一次（key 正确），detail 完整输出，两个分支都跑到了 |

夹具侧：`seedAuditRows` / `cleanupAuditRows` 直接经 Prisma 写入一条人工行与一条
SYSTEM 行（没有任何 API 能产生 SYSTEM 行——唯一生产者是定时器），用
`PW_AUDIT_UI_` 前缀标记以便精确清理。`cleanup()` 也补上了按前缀删除：
SYSTEM 行的 `adminId` 与 `targetId` **都是 null**，原有的按 id 删除结构上根本看不见它，
不补这一步机器行会逐次累积。

---

## 6. 回归验证

| 项目 | 结果 |
| --- | --- |
| `npm run typecheck` | exit 0（5 个 workspace 全通过） |
| `npm run lint` | exit 0，无 warning |
| `npm run test` | exit 0 |
| API Jest | **14 suites / 145 tests**（Phase A 基线 13 / 122 → 上一阶段 14 / 126 → 现在 14 / 145） |
| Admin smoke | 2 / 2 |
| Admin Playwright | **14 / 14**（原 10） |
| Web node:test | 5 / 5 |
| `npm run build` | exit 0，三个产物齐全（`apps/api/dist` 64 个 js，含 `main.js`、`user-status.scheduler.js`、`admin.service.js`；两个 `.next` 存在） |
| 真实 E2E | **72 / 72**（原 57 / 57） |
| `prisma validate` | valid |
| `prisma migrate status` | 16 migrations，up to date |
| `prisma migrate diff` | `-- This is an empty migration.`（无漂移） |

**无任何回归**：原有 13 suites / 122 tests 与 57 / 57 真实 E2E 全部保持通过，且数量只增不减。

### 数据库最终状态（与迁移前逐项一致）

| 项目 | 迁移前 | 迁移后 |
| --- | --- | --- |
| `AdminAuditLog` 行数 | 17 | **17** |
| 其中 `adminId IS NULL` | 0 | **0** |
| 违反配对规则的行 | — | **0** |
| `User` | 168 | **168** |
| `AdminUser` | 9 | **9** |
| `AdminNote` | 16 | **16** |
| `Report` | 10 | **10** |

所有验证夹具（含 SYSTEM 审计行）已清理干净，审计日志回到运行前的规模。

---

## 7. 一个实现期的坑

`prisma migrate deploy` **不会**重新生成 Prisma Client。迁移完成后 `tsc` 立刻报：

```
src/admin/admin.service.ts(560,9): error TS2322:
  Type 'string | null' is not assignable to type 'string | undefined'.
```

因为生成的类型里 `adminId` 还是旧的必填形状。跑一次 `npx prisma generate` 即可。
任何"改了 schema + 跑了 migrate"之后立刻 typecheck 的流程都会撞到这个。

---

## 8. 遗留问题

1. **逐用户审计粒度未做**（需显式批准）。当前是"一个批次一条聚合行"，回答了"平台何时
   恢复了几个账号"，没回答"具体是哪几个"。要逐用户就必须改定时器形状：换成
   `updateManyAndReturn`（UPDATE 语义与幂等性完全不变，已确认 Prisma 6.19.3 支持）是
   干净方案；`findMany` + 逐行更新**不等价**，两条语句可能观察到不同行集，会产生错误的
   逐用户记录。
2. **审计写入失败会留下永久缺口**。释放成功后 insert 失败时，该批次不会补写（谓词已不
   再匹配）。当前以 error 日志暴露。要闭合这个缺口需要把"释放 + 审计"放进同一事务——
   那会改变释放的失败语义（审计写不进去就不释放账号），属于需要单独确认的取舍。
3. **CHECK 约束的漂移风险**。Prisma schema 无法声明它，只存在于 migration SQL 中。
   已有存在性断言兜底，但若有人用 `migrate dev` 重新生成迁移，需要人工检查。
4. **审计页缺筛选**。"全部 / 仅人工 / 仅系统"需要 `@@index([actorType, createdAt])`，
   按设计延后。
