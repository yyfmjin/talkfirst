# PC-1.3 PROFILE ATTRIBUTE API FINAL RESULT

Status: **COMPLETE**

范围：只实现 Profile Attribute API。未进入 PC-1.4，未改动 schema，未新增 migration。

---

## 1. API

新增（全部挂在既有 `@Controller("users")` + `JwtAuthGuard` 下，`userId` 永远取自 JWT subject）：

| Method | Path | 说明 |
| --- | --- | --- |
| GET | `/api/v1/users/me/attributes` | 返回 `{ aboutMe: [], lookingFor: [] }`（仅自己可见，含非 APPROVED） |
| POST | `/api/v1/users/me/attributes` | 创建 SYSTEM（`definitionId`）或 CUSTOM（`label`）属性 |
| PATCH | `/api/v1/users/me/attributes/:id` | 改 `label`（仅 CUSTOM）/ `value` / `visibility` / `sortOrder` |
| DELETE | `/api/v1/users/me/attributes/:id` | 删除自己的属性 |
| GET | `/api/v1/users/me/profile-field-visibility` | 13 个字段的**有效**可见性（缺行=默认） |
| PUT | `/api/v1/users/me/profile-field-visibility` | 设置逐字段可见性（白名单校验） |
| GET | `/api/v1/meta/attributes` | 系统标签目录（仅 `isActive=true`；可选 `?kind=`） |

说明：
- 目录接口放在 `meta`（与既有 `meta/interests`、`meta/purposes`、`meta/languages`、`meta/countries` 同一 controller 风格），
  符合 spec §3「以现有 API convention 为准」。它是公开词典，无 PII。
- 没有任何路由接受 body/query 中的 `userId`/`ownerId`；`ValidationPipe` 的
  `forbidNonWhitelisted` 会把 `userId`、`labelKey`、`reviewStatus` 等直接判为 400（已在真实 HTTP 中验证）。

已有接口的增强（向后兼容、纯增量）：
- `PATCH /users/me` 新增 `region`（`@IsOptional @IsString @MaxLength(80)`）。
- `GET /users/me`（`getFullCard`）新增 `region`、`attributes`。
- `GET /users/:id`（`getPublicProfile`）新增 `region`、`attributes`，并对既有字段应用逐字段可见性。

---

## 2. AttributeDefinition

- 读取：`GET /meta/attributes` 只返回 `isActive=true`，按 `kind, sort, key` 排序；非法 `kind` → 400 `VALIDATION_ERROR`。
- 写入校验（`POST /users/me/attributes` 的 SYSTEM 分支）：definition 必须存在 → `isActive` 必须为 `true`
  → `definition.kind` 必须等于请求 `kind`。任一不满足 → 400 `VALIDATION_ERROR`。
- **Q10**：停用标签不可新选，但读取时不因 `isActive=false` 过滤用户已有行；
  `AttributeView.definitionActive` 会返回 `false` 供 UI 提示。已用真实 HTTP + Jest 覆盖。
- 用户**永远**不能删除或修改 `AttributeDefinition`（API 无此入口）。
- 初始系统标签：`prisma/seed.ts` 新增 `ATTRIBUTE_DEFINITIONS`（20 条，中英双 label），
  **幂等 upsert by `key`**，且 `update` 分支故意不含 `isActive`——管理员停用标签后重跑 seed 不会复活它。
  覆盖 Q4 要求的 5 条 LOOKING_FOR（语言交换/游戏好友/同城朋友/旅行伙伴/文化交流）。
  真实 HTTP 验证结果：`GET /meta/attributes -> 20 active definitions`。

---

## 3. UserAttribute

- 分组：`ABOUT_ME` / `LOOKING_FOR` 同一张表靠 `kind` 区分，读取时按 kind 分组返回。
- **数量上限（Q2）**：每 kind ≤ 10，在 `$transaction` 内计数，超出 → 400 `VALIDATION_ERROR`。
  不依赖数据库约束。
- **SYSTEM/CUSTOM 不变量**：schema 无 CHECK，故为 `APPLICATION_LEVEL_CONSTRAINT`，由 service 强制：
  - SYSTEM ⇒ `definitionId != null`
  - CUSTOM ⇒ `definitionId == null && label != null && labelKey != null`
  - `definitionId` + `label` 同时出现 → 400（不是"后者覆盖前者"）。
- **CUSTOM 字段约束**：`label` 归一化后非空、≤32 字符；`value` ≤80 字符、NFKC+trim、空串→null。
- **labelKey 由服务端生成**（Q12）：`NFKC → collapse whitespace → trim → toLowerCase → NFKC`，
  客户端传入的 `labelKey` 一律忽略（已测）。
  长度按 code point 截断到 32 以适配 `VarChar(32)`；归一化后超长的 label 在写入前就被拒绝，
  因此截断只可能造成"重复冲突"，不会造成静默别名。
- **去重**：CUSTOM 用 `(userId, kind, labelKey)`，SYSTEM 用 `(userId, definitionId)`；
  命中 → 409 `ATTRIBUTE_EXISTS`。并发下 `P2002` 也映射为同一错误，**绝不把 Prisma 错误码透给客户端**。
- **排序（sortOrder）**：只改自己的行；DTO `@IsInt @Min(0) @Max(1000)`，service 二次校验整数与范围。
- **删除**：`findFirst({ id, userId })` 把归属写进查询，别人的 id → 404 `ATTRIBUTE_NOT_FOUND`，不泄露存在性。
  非 UUID 的 id 直接 404，不会打到 Prisma。

---

## 4. Visibility

**每属性** `UserAttribute.visibility`：`PUBLIC | CONNECTIONS | PRIVATE`，默认 `PUBLIC`。

**逐字段** `ProfileFieldVisibility`：`fieldKey` 走**封闭白名单**（13 个 key）：
`nickname, avatarUrl, birthDate, countryCode, city, region, gender, bio, languages, interests, purposes, preferredCountries, attributes`。

- 非法 `fieldKey`（含 `email`、`passwordHash`、`status`、`isAdmin`、`socialAccounts`、`relationship` 等）
  → 400 `VALIDATION_ERROR`，不会产生垃圾行。
- 缺行 = 默认 `PUBLIC`（**lazy row**，Q5/Q9）：不为已有 11 个用户回填任何默认行；
  把字段设回 `PUBLIC` 时删除该行而不是存一条冗余默认值。
- 判定顺序（单点 `canViewField`）：
  1. **Block 优先**：`getPublicProfile` 在执行任何可见性判定前先做双向 block 检查，
     所以 Block > 所有 tier（含 PUBLIC）。真实 HTTP 已验证 403 `BLOCKED`。
  2. `isSelf` → 全可见。
  3. `PUBLIC` → 任何合格 viewer。
  4. `CONNECTIONS` → 仅 `Connection.status === ACTIVE`。
  5. `PRIVATE` → 仅本人。
- 隐藏语义：标量字段返回 `null`，聚合数组返回 `[]`（保持响应形状稳定，且不泄露"是否存在")。
- 与既有机制**完全独立**：`SocialAccount.visibility`、`SharedSocialAccount`（逐对授权）、
  `MomentSetting.visibleTo` 均不受本表影响；本表也**不能**被用来放宽 handle 授权。
- 非 `APPROVED` 的属性对他人不可见，但作者本人可见（为将来审核队列预留）。

---

## 5. Safety

- 所有用户自撰文本（CUSTOM `label`、以及任何来源的 `value`）在**写入前**调用既有
  `SafetyService.scanText()`，`scan.blocked === true` **或** `scan.level === "HIGH"` 即拒绝，
  返回 403 `MESSAGE_BLOCKED`（复用既有 code，不新增）。
- 这一点比现有聊天调用点更严格：现有调用只检查 `blocked`。按 spec §10 明确要求同时检查 HIGH。
- 未调用 `recordAutoFlag()`（它在 HIGH 时提前 return，不能作为写入拦截手段）。
- **`SafetyService` 未做任何修改**（文件 mtime 仍为 2026-09-17）。

---

## 6. Privacy

真实 HTTP 响应递归键扫描（stranger 视角 + connection 视角）确认以下 key 均不出现：
`email, passwordHash, tokenHash, refreshToken, accessToken, oauth, clientSecret, handle,
socialAccounts, sharedSocialAccounts, isAdmin, status, ip, userAgent`；
同时断言响应体不含被观察者的 email 值。结果：PASS。
`SharedSocialAccount` 未被读取或绕过。

---

## 7. Region

- `User.region`（`VarChar(80)`，nullable，无 default，**无 index**）为 PC-1.2 已建列，本阶段只接线。
- `PATCH /users/me`：`trim`，空白串 → `null`，`>80` → 400。
- 真实 HTTP：`"  Zhejiang  "` → `"Zhejiang"`；重新读取保持一致；`"   "` → `null`；81 字符 → 400。
- 独立设备/会话一致性由数据库持久化保证（非 localStorage）。前端表单尚未暴露该字段（见 §12）。

---

## 8. Existing Profile Compatibility

- 现有 5 个替换型接口（languages / interests / purposes / preferred-countries / avatar）**逻辑未改**。
- `getPublicProfile` 的既有字段（nickname/avatar/age/country/city/gender/bio/languages/interests/
  purposes/preferredCountries/relationship）保持原 key 与默认行为：
  没有可见性行时全部 `PUBLIC`，因此对现有数据输出与改动前一致（现有 `ProfileFieldVisibility` 行为 0 行）。
- `getFullCard` 为纯增量（多 `region`、`attributes`）。
- `PublicProfile.gender` 的类型放宽为 `string | null`（仅当用户把 gender 设为非 PUBLIC 时才可能为 null）。
- **未接入 Discover**：`discover.service.ts` 不调用 `getPublicProfile`（已 grep 确认），
  本阶段不动它，也未新增 filter / weight。
  未来接入位置（仅报告，不实施）：`DiscoverService.excludedCandidateIds()` /
  `findUser()` 若要展示标签，应把 `getPublicProfile` 的可见性投影复用，而不是另写一套规则。

---

## 9. Tests

### Jest（unit，真实 Prisma 查询逻辑以 mock 驱动；仓库既有测试风格）

命令：`cd apps/api && npm run typecheck && npm run lint && npm run build && npm test`

| 指标 | 结果 |
| --- | --- |
| typecheck (`tsc --noEmit`) | PASS (exit 0) |
| lint (`eslint "src/**/*.ts"`) | PASS (exit 0) |
| build (`nest build`) | PASS (exit 0) |
| jest | **27 suites / 702 tests, 0 failed** |

新增测试：**55 个**（两个新文件）
- `apps/api/src/users/profile-attributes.spec.ts` — 36 个：归一化（NFKC/空白/casefold/截断）、
  create（SYSTEM/CUSTOM、上限、去重、P2002、非法 kind、空 label、不变量、未知/停用/kind 不匹配的 definition、
  系统标签形状、HIGH/blocked safety、value 扫描、服务端派生字段不可伪造）、
  update（非 UUID、越权、visibility/sortOrder、拒改系统标签、labelKey 重算与冲突、空 payload、safety）、
  remove（自己的/别人的/非法 id）、field visibility（默认 13 行、非法 key、lazy upsert、default 删除）。
- `apps/api/src/users/profile-visibility.spec.ts` — 19 个：`resolveFieldVisibilityMap`/`canViewField` 语义、
  PUBLIC/CONNECTIONS/PRIVATE 三视角、缺行默认、非 APPROVED 可见性、停用标签仍可解析（Q10）、
  ABOUT_ME/LOOKING_FOR 分组、字段级 `attributes` 开关、region 受控、Block 覆盖一切、
  suspended/banned 目标 404、隐私键扫描、`updateProfile` 的 region trim/null/absent。

既有测试：**未删除、未弱化**。
`users-public-profile.spec.ts` 仅做了加法改动（在 mock 的 user 行上补 `region` / `attributes` /
`fieldVisibilities` 三个字段，以匹配新增的 `include`），4 个既有用例与断言原样保留。
`users-avatar.spec.ts`、`user-status.scheduler.spec.ts`、以及 admin/其它 22 个 suite 未改动，全部通过。

### Real HTTP（localhost:5433 / talkfirst，真实 PostgreSQL + 真实 HTTP）

执行方式：`bash .local-data/pc12/withpg.sh .local-data/pc13/http-verify.sh`
（启动本地 PG 5433 → 跑 `prisma/seed.ts` → `node dist/main.js` 监听 4010 → node `fetch` 脚本 → 关停）。
脚本：`.local-data/pc13/verify.cjs`；日志：`.local-data/pc13/{api.log,seed.log}`。

结果：**14/14 PASS**（`PC13_HTTP_OK steps=14`）

1. 注册 Alice / Bob / Carol
2. region：trim、空串→null、>80 拒绝、持久化
3. `GET /meta/attributes` → 20 条 active 系统标签（seed 生效）
4. CUSTOM 属性创建 + 归一化 + 归一化去重 409 + 伪造 `userId`/`labelKey` 400
5. safety：HIGH 与 blocked 均 403 拒绝
6. SYSTEM/CUSTOM 不变量：`definitionId`+`label` 400、无 label 400、非法 kind 400、未知 definition 400
7. 上限：真的创建到 10 条后第 11 条 400
8. per-attribute visibility：缺 id 404、非法 tier 400、CONNECTIONS/PRIVATE 写入成功
9. 字段可见性：`email` 400、13 行返回、缺行默认 PUBLIC
10. Bob → Alice 连接请求 + Alice accept ⇒ ACTIVE
11. 三视角读取：Carol（非连接）看不到 CONNECTIONS/PRIVATE；Bob（连接）看得到 CONNECTIONS、看不到 PRIVATE；
    Alice（self）全部可见
12. 隐私递归扫描（stranger + connection 两个视角）：无凭证 / handle / OAuth 泄漏
13. 删除：Carol 删 Alice 的属性 404；Alice 删自己的成功
14. Alice block Bob ⇒ Bob 读取 Alice 主页 403 `BLOCKED`（Block > visibility），随后解封

### Playwright / Browser

**NOT RUN — out of scope for this phase.**
本阶段 spec §1 的范围是 API；前端（Profile editor / Attribute picker / Profile card / Profile detail /
Profile visibility UI）一行未改，因此没有可供 Playwright 断言的 UI。
既有 Playwright 套件也未重跑：本次 API 改动为纯增量，且对无 `ProfileFieldVisibility` 行的现有数据
输出与改动前完全一致（默认 PUBLIC）。
建议：PC-1.4 实现前端后，再按 spec §13 的六个场景补 Playwright + 移动端（375/390/430）验收。

---

## 10. Schema / Migration

- `prisma/schema.prisma`：**UNCHANGED**（771 行）。
- `prisma/migrations/`：**UNCHANGED**（16 历史 + `20260919050334_profile_attributes`，无新增）。
- 本阶段未运行 `prisma migrate dev` / `migrate deploy` / `db push`。
- 未修改 `SafetyService`、未修改 `discover/`、未修改 `admin/`、未修改 `apps/web`、未修改 `apps/admin`、未修改 `packages/`。
- 未新增 OAuth / SMTP / Redis / S3 / Notification / Comment / Reply / Post Detail / Ads / Banner / Popup。

---

## 11. Files changed

新增：

| File | Lines |
| --- | --- |
| `apps/api/src/users/profile-visibility.constants.ts` | 88 |
| `apps/api/src/users/profile-attributes.view.ts` | 142 |
| `apps/api/src/users/profile-attributes.dto.ts` | 84 |
| `apps/api/src/users/profile-attributes.service.ts` | 387 |
| `apps/api/src/users/profile-attributes.spec.ts` | 514 |
| `apps/api/src/users/profile-visibility.spec.ts` | 355 |

修改：

| File | Before → After | 改动 |
| --- | --- | --- |
| `apps/api/src/users/users.service.ts` | 304 → 358 | `region`、`attributes`、逐字段可见性；`updateProfile` 加 region |
| `apps/api/src/users/users.controller.ts` | 141 → 199 | 6 个 attribute / field-visibility 路由 |
| `apps/api/src/users/users.dto.ts` | 128 → 134 | `UpdateProfileDto.region` |
| `apps/api/src/users/users.module.ts` | 16 → 21 | `imports: [AdminModule, SafetyModule]` + 注册 service |
| `apps/api/src/meta/meta.controller.ts` | 31 → 55 | `GET /meta/attributes` |
| `prisma/seed.ts` | 255 → 293 | 20 条系统标签（幂等 upsert，不复活已停用标签） |
| `apps/api/src/users/users-public-profile.spec.ts` | 98 → 106 | 仅补齐 mock 字段（加法，断言未改） |

未改动：`prisma/schema.prisma`、`prisma/migrations/**`、`apps/api/src/safety/**`、
`apps/api/src/discover/**`、`apps/api/src/admin/**`、`apps/web/**`、`apps/admin/**`、`packages/**`。

---

## 12. Known Issues

1. **前端类型漂移（本阶段故意不修）**：`apps/web/src/lib/profile.ts` 仍声明 `gender: string`，
   且没有 `region` / `attributes`。API 现在可能在 `gender` 非 PUBLIC 时返回 `null`。
   现有 `profile/[id]` 页面并不渲染 `gender`（已 grep 确认），因此无运行时破坏；
   待 PC-1.4 实现 Profile UI 时同步类型与展示。
2. **数量上限非严格并发安全**：计数在 `$transaction` 内，但 PostgreSQL 默认 `READ COMMITTED` 下
   两个并发请求仍可能都读到 9 并各插一条（结果是 11 条，仅影响该用户自己的资料）。
   彻底修复需要 `SERIALIZABLE` 重试或 DB 层约束（本阶段禁止 schema 变更，故未做）。
3. **JS 没有原生 Unicode casefold**：`labelKey` 用 `toLowerCase()` 近似。
   已知边界：德语 `ß`（casesfold 应为 `ss`）、土耳其语 `İ`（`toLowerCase` 得到 `i` + combining dot）。
   影响面仅限"极少数语言下两个不同写法可能不被判为重复"，不影响唯一性与安全。
4. **`valueType` 未被差异化实现**：`BOOLEAN/TEXT/SINGLE_SELECT/MULTI_SELECT` 已存库，
   但 API 对所有标签采取同一策略（`value` 可选、≤80）。未发明额外行为。
5. **审核闭环未接**：`ReviewStatus` 默认 `APPROVED`，`reviewStatus` 阈值过滤只在读取侧生效；
   未新增 Admin 审核 UI，未扩展 `moderation:read` / `moderation:write`（spec §28 要求不做）。
6. **系统标签依赖 seed**：`AttributeDefinition` 目录由 `prisma/seed.ts` 提供。
   生产部署必须执行该 seed（或等价操作），否则选择器为空。停用标签需由未来 Admin 能力完成。
7. **`region` 无索引**（Q11 决定，第一期）——当前无按 region 的查询需求。
8. **`User.region` 未进入 Discover**：只存储与展示，不参与匹配（spec §19 只要求安全兼容）。
9. **环境说明（必须诚实记录）**：
   - 本次真实 HTTP 验证仅针对 `localhost:5433 / talkfirst`。**生产数据库状态：UNKNOWN**。
   - 验证过程中本地工具链曾发生一次工作区回滚，导致既有文件
     `apps/api/src/users/users-public-profile.spec.ts` 一度丢失；已按原文**逐行恢复**，
     仅追加 mock 字段，4 个既有用例与断言与原文一致（见 §9）。未删除、未弱化任何测试。
   - 本阶段未运行 Playwright（见 §9）。

---

## 13. STOP

PC-1.3 COMPLETE。
未进入 PC-1.4。
STOP.
