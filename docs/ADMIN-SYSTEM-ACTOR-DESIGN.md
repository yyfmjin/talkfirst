# Admin Audit — 系统自动操作（SYSTEM actor）设计方案

> **状态：已落地（2026-09-17）。**
>
> 实施结果见 `docs/ADMIN-SYSTEM-ACTOR-IMPLEMENTATION.md`。本文件保留原始设计，
> 作为"为什么是这个形状"的依据；其中 §4 末尾的"定时器写入的形状问题"仍然是一个
> **未决项**（见下）。
>
> 背景：`UserStatusScheduler` 的封禁到期自动恢复已经能正常运行，但 `AdminAuditLog.adminId` 是必填
> 且项目不存在 system actor，因此自动恢复**不留审计痕迹**。Phase A+ 报告已把这个缺口列为
> "越晚定越贵"的待决项。本方案给出可选设计，等确认后再落地。

约束（来自需求，均已满足）：

- 禁止借用真实管理员 UUID
- 禁止创建可登录的 system user
- 禁止伪造管理员行为

---

## 1. Prisma schema diff

### 现状

```prisma
model AdminAuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  adminId    String   @db.Uuid
  admin      User     @relation("AuditByAdmin", fields: [adminId], references: [id], onDelete: Restrict)
  action     String   @db.VarChar(64)
  targetType String?  @db.VarChar(32)
  targetId   String?  @db.VarChar(128)
  reason     String?  @db.VarChar(500)
  before     Json?
  after      Json?
  ip         String?  @db.VarChar(45)
  userAgent  String?  @db.VarChar(512)
  detail     String?  @db.VarChar(2000)
  createdAt  DateTime @default(now())

  @@index([adminId, createdAt])
  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

### 提案

```diff
+/// 审计动作的执行者类型。
+enum AuditActorType {
+  /// 人类管理员。adminId 必定非空。
+  USER
+  /// 自动化任务（定时器、后台作业）。adminId 必定为空。
+  SYSTEM
+}

 model AdminAuditLog {
   id         String   @id @default(uuid()) @db.Uuid
-  adminId    String   @db.Uuid
-  admin      User     @relation("AuditByAdmin", fields: [adminId], references: [id], onDelete: Restrict)
+
+  /// 谁执行了这次操作。默认 USER，因此所有历史行无需数据迁移即可保持原义。
+  actorType  AuditActorType @default(USER)
+
+  /// 可空：NULL 表示这次操作由平台自身完成，而非任何人类。
+  /// 与 actorType 的配对由 CHECK 约束强制（见下），
+  /// 因此 USER 行不可能失去执行者，SYSTEM 行也不可能夹带一个 adminId。
+  adminId    String?  @db.Uuid
+  admin      User?    @relation("AuditByAdmin", fields: [adminId], references: [id], onDelete: Restrict)
+
   action     String   @db.VarChar(64)
   targetType String?  @db.VarChar(32)
   targetId   String?  @db.VarChar(128)
   reason     String?  @db.VarChar(500)
   before     Json?
   after      Json?
   ip         String?  @db.VarChar(45)
   userAgent  String?  @db.VarChar(512)
   detail     String?  @db.VarChar(2000)
   createdAt  DateTime @default(now())

   @@index([adminId, createdAt])
   @@index([action, createdAt])
   @@index([targetType, targetId])
   @@index([createdAt])
 }
```

### 关键取舍

**1. 为什么不建一个 system User 行。**
即使给一个不可用的 passwordHash，它仍然会：(a) 在 `User` 表里留下一个假账号；
(b) 被 `AdminService.searchUsers` 搜到；(c) 一旦将来某条代码路径放松了哈希校验就变成可登录账号；
(d) 污染 `dashboard()` 的"总用户数"。**NULL 才是"没有人类执行者"的诚实表示。**

**2. 为什么 nullable FK + `Restrict` 是安全的。**
Postgres 对 NULL 不施加外键检查，所以 `ON DELETE RESTRICT` 继续保护所有人工行，
而 SYSTEM 行天然不受约束。`DROP NOT NULL` 是纯元数据变更，不重写表。

**3. 为什么必须加 CHECK 约束。**
Prisma schema 语言无法表达"条件非空"。没有 CHECK 的话，可以插入
`actorType=SYSTEM` 且 `adminId=<某个真实管理员>` —— 这正是需求明令禁止的伪造；
也可以插入 `actorType=USER` 且 `adminId=NULL` —— 一条无主的人工操作。
CHECK 让这两种情况**不可表示**。

> ⚠️ **必须记录的限制**：Prisma 无法声明这个 CHECK，它只存在于 migration SQL 中。
> 因此 `prisma migrate diff` / `db pull` 不认识它，将来若有 `migrate dev` 重新生成迁移
> 可能静默丢弃。建议：(a) 在迁移里用注释写明；(b) 在 `scripts/phaseA-rbac-verify.mjs`
> 里加一条断言，像现有的外键检查那样确认约束存在。
>
> 备选（较弱）：只在 `recordAudit` 里校验，不加 DB 约束。这样任何直接 SQL 写入都能伪造，
> 不推荐。

**4. `AdminNote.adminId` 保持必填。**
备注本质上是人类批注（"某个管理员认为…"）。定时任务绝不应该写备注。
保持必填就保住了这条不变量，也把改动半径压到最小。
将来若系统任务需要留痕，它属于审计日志，不属于内部备注。

**5. 不新增 `actorLabel` 之类的自由文本字段。**
人工行由 `adminId` 标识，系统行由 `action` + `targetType` 标识，已经足够。
自由文本的执行者标签只会引入新的伪造面。

---

## 2. Migration SQL 影响

```sql
-- 1. 新枚举
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

-- 2. 新列。常量默认值：PG 11+ 下是纯元数据操作，不重写表
ALTER TABLE "AdminAuditLog"
  ADD COLUMN "actorType" "AuditActorType" NOT NULL DEFAULT 'USER';

-- 3. 放宽执行者列。纯元数据操作，已有值原样保留
ALTER TABLE "AdminAuditLog" ALTER COLUMN "adminId" DROP NOT NULL;

-- 4. 配对规则（Prisma schema 无法表达）
ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actor_consistency_check"
  CHECK (
    ("actorType" = 'USER'   AND "adminId" IS NOT NULL) OR
    ("actorType" = 'SYSTEM' AND "adminId" IS NULL)
  );
```

| 维度 | 影响 |
| --- | --- |
| 外键 | `AdminAuditLog_adminId_fkey` **不变**，仍为 `ON DELETE RESTRICT` |
| 索引 | 无需改动。`@@index([adminId, createdAt])` 仍可用，btree 索引包含 NULL，`WHERE adminId IS NULL` 可走索引 |
| 数据回填 | **不需要**。DEFAULT 覆盖全部历史行 |
| 表重写 | **无**。四条语句都是元数据级；当前 17 行瞬时完成，即使千万行量级 `ADD COLUMN`+常量默认值 与 `DROP NOT NULL` 依然快 |
| 锁 | 每条短暂 `ACCESS EXCLUSIVE`，无长事务 |
| 可回滚 | DOWN = `DROP CONSTRAINT` → `DROP COLUMN actorType` → `ALTER COLUMN adminId SET NOT NULL` → `DROP TYPE`。注意 `SET NOT NULL` 在已有 SYSTEM 行时会失败 —— **这是正确的**，它应该失败而不是静默销毁证据 |
| 可选 | 若将来审计 UI 要按类型筛选，再加 `@@index([actorType, createdAt])`；**当前不需要** |

---

## 3. 现有数据兼容性

- 现有全部行（当前 17 条）通过 DEFAULT 得到 `actorType='USER'`，`adminId` 原样保留。
  **不重写、不重新解释任何一条历史记录。**
- `adminId` 变可空是**放宽**型变更：所有已有值依然合法，所有已有查询
  （`where: { adminId: ... }`、`include: { admin }`）行为完全一致。
- 原本不可能存在的状态（`adminId IS NULL`）变为可能，但被 CHECK 限制为 SYSTEM。
- 无孤儿风险：人工行继续享受 Restrict 保护。
- **唯一需要同步修改的读取方**：`apps/admin/src/app/audit/page.tsx` 无条件调用
  `item.adminId.slice(0, 8)`。一旦出现第一条 SYSTEM 行，该页面会**直接崩溃**。
  因此前端改动必须与"第一条 SYSTEM 写入"同批上线，不能分开。

---

## 4. Admin API 是否需要修改

**需要，但都是加法，不破坏现有调用方。**

| 位置 | 改动 | 说明 |
| --- | --- | --- |
| `AuditInput`（`admin.service.ts`） | `adminId: string` → `adminId?: string \| null`，新增 `actorType?: "USER" \| "SYSTEM"` | 类型放宽 |
| `AdminService.recordAudit` | 写入 `actorType: input.actorType ?? "USER"`、`adminId: input.adminId ?? null` | **默认 USER** ⇒ 所有现有调用点无需改动，全部仍是人工操作 |
| 新增 `recordSystemAudit(...)` | 内部固定 `adminId: null, actorType: "SYSTEM"` | 让"系统动作"只有一个入口，人类动作不可能被误记成 SYSTEM |
| `recordAudit` 增加自检 | `SYSTEM ⇒ adminId == null`、`USER ⇒ adminId != null`，否则抛错 | 把 DB CHECK 在应用层镜像一份，写错时在测试里立刻炸，而不是等到 insert |
| `AdminService.listAudit` | **无需改动** | 用 `findMany` 返回全部标量列，响应只是**多了一个 `actorType` 字段**，纯加法 |
| `userDetail` / `setStatus` / `reviewReport` / `addNote` | **不变** | 全部保持仅人工 |
| `UserStatusScheduler` | 唯一真正变化的调用方 | 见下 |

### 定时器写入的形状问题（**仍然未决**）

`UserStatusScheduler` 目前用**一条 `updateMany`** 批量恢复，这正是它幂等性的来源
（改后状态不再匹配查询条件）。如果要为每个被恢复的用户写一条审计行，就必须改成
`findMany` + 逐行事务，或者使用 `updateManyAndReturn`（**已确认** Prisma 6.19.3 生成的
客户端在 `User` delegate 上支持该方法）。

**这会改变定时器的形状**，因此建议作为**独立的、显式批准的一步**，
不要悄悄塞进这次 schema 变更里。

**本次落地的选择**：保持 `updateMany` 一字未改，在一次成功的扫描之后写**一条聚合的**
SYSTEM 审计行（`targetId = null`，`detail` 里带恢复条数）。这样
"一个恢复批次 → 一条审计行" 在重复执行下依然稳定：空扫描不写行，所以第二次 tick
不会追加重复记录。

**仍然待批准的两个替代方案**（都需要改动定时器形状）：

| 方案 | 形状变化 | 代价 |
| --- | --- | --- |
| `updateManyAndReturn` | 把 `updateMany` 换成 `updateManyAndReturn`，一次写入 N 条逐用户审计行 | UPDATE 语义与幂等性完全不变；扫描量大时要把 N 行结果读进内存 |
| `findMany` + 逐行更新 | 两条语句 | **不等价**：`findMany` 与 `updateMany` 可能观察到不同的行集，会产生错误的逐用户记录 |

产品问题依旧存在：逐用户粒度是否必要？聚合行已经回答了"平台在何时恢复了几个账号"，
但没有回答"具体是哪几个"。

---

## 5. Audit UI 如何显示 SYSTEM

### 现状（`apps/admin/src/app/audit/page.tsx:65`）

```tsx
{new Date(item.createdAt).toLocaleString()} · admin {item.adminId.slice(0, 8)} · target{" "}
{item.targetId ? item.targetId.slice(0, 8) : "-"}
```

`adminId.slice` 在 `null` 上会抛异常 ⇒ **第一条 SYSTEM 行就会让整页白屏。**

### 提案

```diff
 type AuditItem = {
   id: string;
+  actorType: "USER" | "SYSTEM";
-  adminId: string;
+  adminId: string | null;
   action: string;
   targetId: string | null;
   detail: string | null;
   createdAt: string;
 };
```

```tsx
const isSystem = item.actorType === "SYSTEM";
```

```diff
 <p className="mt-1 text-muted">
-  {new Date(item.createdAt).toLocaleString()} · admin {item.adminId.slice(0, 8)} · target{" "}
-  {item.targetId ? item.targetId.slice(0, 8) : "-"}
+  {new Date(item.createdAt).toLocaleString()} ·{" "}
+  {isSystem ? (
+    <span className="rounded-full bg-[#F7F9FF] px-2 py-0.5 text-[11px] text-muted">系统</span>
+  ) : (
+    `管理员 ${item.adminId?.slice(0, 8) ?? "-"}`
+  )}{" "}
+  · target {item.targetId ? item.targetId.slice(0, 8) : "-"}
 </p>
```

规则：

1. SYSTEM 行渲染标签 **系统**（可带"· 自动"），**绝不**显示任何管理员 id，也不显示空白的
   "admin -"。
2. 人工行渲染**完全不变**，现有页面预期与截图不漂移。
3. 防御性写法 `item.adminId?.slice(0, 8) ?? "-"`：即使将来出现脏数据也不会崩页。
4. 视觉上弱化（浅底徽章），让操作员扫一眼就能区分"平台自动"与"人工操作"——
   这正是引入这一列的全部意义。
5. 可选（**建议延后**）：加"全部 / 仅人工 / 仅系统"筛选。需要上面提到的
   `@@index([actorType, createdAt])`，属于独立小改动，不要混进来。

---

## 6. 为什么这个形状是对的

- **诚实**：没有人类执行者就写 NULL，而不是借一个身份来顶替。
- **不可伪造**：DB CHECK 让 "SYSTEM 带 adminId" 与 "USER 无 adminId" 都不可表示。
- **便宜**：不重写表、不回填、不改索引，历史行的语义一字不变。
- **对消费方是加法**：唯一的 API 变化是多一个字段。
- **有边界**：`AdminNote` 保持仅人工；项目里不存在任何可登录的假账号。

---

## 7. 落地顺序建议（确认后）

1. Prisma schema + 一个迁移（含 CHECK + 注释说明 CHECK 的来源与漂移风险）
2. `AuditInput` / `recordAudit` / `recordSystemAudit` + 应用层自检 + 单元测试
3. 审计 UI 的 `actorType` / nullable `adminId` 渲染（**必须与第 4 步同批**）
4. 定时器改造（单独确认）+ 幂等性与审计行的联合测试
5. `scripts/phaseA-rbac-verify.mjs` 增加：CHECK 约束存在性断言 + SYSTEM 行可写 + 伪造被拒
