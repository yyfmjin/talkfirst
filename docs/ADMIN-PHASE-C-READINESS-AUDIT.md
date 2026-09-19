# Admin Phase C — Readiness Audit

**Phase:** Admin Phase C (C1 Risk / C2 Connections / C3 Contact Exchange / C4 Blocks / C5 Integration)
**Date:** 2026-09-18
**Status:** Audit complete. **Two stop conditions triggered — see §11. Awaiting decision before C1.**

Per §二 of the spec: no code is written until this audit is delivered.

---

## 0. Verified baseline (recorded before touching anything)

| Gate | B5 value (verified 2026-09-18) |
| --- | --- |
| API Jest | **18 suites / 335 tests** |
| Admin Playwright | **106 / 106** |
| Real E2E | **179 / 181** (2 pre-existing) |
| typecheck / lint / build | exit 0 / 0 warnings / exit 0 |
| prisma validate | valid |
| migrate diff | 0 drift (both directions) |

Existing admin API specs: 7. Existing admin E2E specs: 8.
Test counts may only increase.

---

## A. Risk — current capability

**There is NO persisted risk model.** Verified against `prisma/schema.prisma`:
no `RiskRecord`, no `RiskEvent`, no `riskLevel` column on any of the 33 models.
`grep -iE "risk|autoFlag"` over the schema returns **zero** rows.

`SafetyService` (`apps/api/src/safety/safety.service.ts`) exposes exactly five members:

| Member | Signature | Persists? |
| --- | --- | --- |
| `scanText` | `(content) => SafetyScan` | **No** — pure |
| `trustedAccount` | `(userId) => …` | No |
| `sayHelloLimit` | `(userId) => …` | No |
| `extractLinks` | `(content) => …` | No |
| `recordAutoFlag` | `({userId,reasons,messageId,source,level}) => {reportId,deduped}` | **Yes — writes a `Report` row** |

`RiskLevel = "LOW" | "MEDIUM" | "HIGH"` is a **TypeScript type only, never persisted**.
`scanText` computes it in memory: `reasons.length > 0 ? "HIGH" : (contactLeak||externalLink) ? "MEDIUM" : "LOW"`.

**Consequence:** a "Risk Center" has no risk table to read. The only persisted machine
signal is the `Report` row written by `recordAutoFlag`, plus `AdminAuditLog` and
`User.status`.

### A.1 `recordAutoFlag` — a latent defect that blocks C1 (see §11.1)

`apps/api/src/safety/safety.service.ts:103-143`. The code contradicts its own comment:

* The comment (lines 116-120) states a machine signal **must not** be written into
  `Report`, because `Report.reporterId` is a required FK to `User`, "so an automated
  flag written as a report would file the *victim* as their own reporter".
* Lines 136-140 then do exactly that: `reporterId: userId, reportedUserId: userId`.
* The guard `if (level === "HIGH") return {reportId: null}` means HIGH writes nothing,
  while **any non-HIGH falls through to the self-report write**.

**Reachability, measured:** all three call sites guard with
`if (scan.level === "HIGH")` before calling:

* `apps/api/src/chat/chat.gateway.ts:183`
* `apps/api/src/connections/connections.service.ts:147`
* `apps/api/src/social/social-safety.controller.ts:199`

Since HIGH is precisely the branch that returns early, the self-report write is
**currently unreachable from production callers**. It is a latent bug, not an active one.

Either way it is **not fixable in this phase**: §十 forbids silently repairing it and
requires stopping and recording a separate Safety Phase.

## B. Connection — current capability

`model Connection` (`prisma/schema.prisma:468`) — **buildable, no change needed**:

| Field | Type | Note |
| --- | --- | --- |
| `id` | `String @db.Uuid` | ✅ route key exists |
| `userAId` / `userA` | FK → `User` ("ConnectionsA") | |
| `userBId` / `userB` | FK → `User` ("ConnectionsB") | |
| `conversationId` | `String? @unique` | optional |
| `status` | `ConnectionStatus @default(ACTIVE)` | real enum: `ACTIVE` \| `REMOVED` |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | — | **does not exist** (§十四 anticipated this) |

Constraints: `@@unique([userAId, userBId])`, indexes on `userAId`, `userBId`.

## C. Contact Exchange — current capability

`model ExchangeRequest` (`prisma/schema.prisma:631`) — **buildable, no change needed**:

| Field | Type | Note |
| --- | --- | --- |
| `id` | `String @db.Uuid` | ✅ route key |
| `connectionId` | `String @db.Uuid` | **bare UUID, no FK relation defined** |
| `conversationId` | FK → `Conversation` | |
| `requesterId` / `receiverId` | FK → `User` ("ExchangeSent"/"ExchangeReceived") | |
| `platforms` | `SocialPlatform[]` | **array**, not scalar |
| `message` | `String? @db.VarChar(200)` | user-supplied text |
| `status` | `ExchangeStatus @default(PENDING)` | `PENDING`\|`ACCEPTED`\|`REJECTED`\|`CANCELLED` |
| `createdAt` / `updatedAt` | `DateTime` | both exist ✅ |
| `shares` | `SharedSocialAccount[]` | |

`model SharedSocialAccount` (`:348`) — the pair-scoped authorization record:

| Field | Type |
| --- | --- |
| `id` | `String @db.Uuid` |
| `ownerId` / `owner` | FK → `User` ("SharesGranted") |
| `viewerId` / `viewer` | FK → `User` ("SharesReceived") |
| `platform` | `SocialPlatform` |
| `socialAccountId` / `socialAccount` | FK → `SocialAccount` |
| `exchangeId` / `exchange` | FK → `ExchangeRequest` |
| `createdAt` | `DateTime` |

Constraints: `@@unique([ownerId, viewerId, platform])`, indexes `[viewerId,ownerId]`, `[ownerId]`, `[exchangeId]`.

### C.1 The security model, quoted from the schema

`SocialAccount` carries a schema comment that is the authoritative statement of intent:

> *Per-pair authorization: owner grants viewer the right to see ONE account. This is the
> single source of truth for "who may see whose handle". Visibility on `SocialAccount` is
> only the account's default state and must never be treated as proof that a specific
> viewer is authorized.*

**Therefore C3 must read `SharedSocialAccount` for pair-scoped relationships and must not
fall back to a global `SocialAccount.visibility` model** (§十七). Note there is in fact
**no `visibility` column on `SocialAccount`** at all — so the regression §十七 warns about
is structurally impossible. Good.

### C.2 `SocialAccount` contains no credentials

| Field | Type |
| --- | --- |
| `id`, `userId`, `platform` | |
| `handle` | `String @VarChar(128)` |
| `syncEnabled` | `Boolean @default(false)` |
| `createdAt`, `updatedAt` | |

**No access token, no refresh token, no OAuth secret, no provider credential column.**
The only sensitive field is `handle` (the person's actual account identifier).
`@@unique([userId, platform])`.

## D. Block — current capability

`model Block` (`prisma/schema.prisma:549`) — **a real constraint for the spec's route shape**:

| Field | Type |
| --- | --- |
| `blockerId` / `blocker` | FK → `User` ("BlocksMade") |
| `blockedId` / `blocked` | FK → `User` ("BlocksReceived") |
| `createdAt` | `DateTime @default(now())` |

Primary key: **`@@id([blockerId, blockedId])` — composite.**

**There is NO `id` column, no `status`, no `updatedAt`.**

Spec §二十三–§二十五 ask for `GET /api/v1/admin/blocks/:id` and a "Block ID" column.
Neither is directly available: a block has no single-column identity. This is solvable
(the natural key is the pair) but it is a **deviation from the spec's literal wording**
and needs a decision — see §11.2.

## E. Real relations, summarised

```
User ──1:N── Report (ReportsMade / ReportsReceived)   [two FKs to User]
User ──1:N── Block (BlocksMade / BlocksReceived)      [composite PK]
User ──M:N── Connection (ConnectionsA / ConnectionsB) [explicit A/B, unique pair]
User ──1:N── ExchangeRequest (ExchangeSent / ExchangeReceived)
ExchangeRequest ──1:N── SharedSocialAccount ──N:1── SocialAccount
Conversation ──1:N── Message ──1:N── MessageTranslation
ConversationMember ── Conversation × User (composite PK)
```

Notes that matter:
* `Connection` uses **`userAId`/`userBId`**, not `participants`. (Same trap as `Conversation.members` vs `participants` recorded in MEMORY.md.)
* `ExchangeRequest.connectionId` is a **bare UUID with no relation** — you cannot `include` a Connection through it.
* `Report.messageId` is likewise a **bare UUID with no FK** (unchanged from B4/B5).

## F. Current API

`apps/api/src/admin/admin.controller.ts` — 11 routes, **none Phase C**:

| Route | Method |
| --- | --- |
| `dashboard` | GET |
| `me` | GET |
| `users` | GET |
| `users/:id` | GET |
| `users/:id/status` | POST + PATCH |
| `users/:id/notes` | POST |
| `reports` | GET |
| `reports/:id` | GET |
| `reports/:id/review` | POST |
| `audit` | GET |

**No `/admin/risk`, `/admin/connections`, `/admin/exchanges`, `/admin/blocks`.**

## G. Current front-end pages

`/login`, `/` (redirect → `/dashboard`), `/dashboard`, `/users`, `/users/[id]`,
`/reports`, `/reports/[id]`, `/moderation`, `/moderation/[id]`, `/audit`.

**None of `/risk`, `/connections`, `/exchanges`, `/blocks` exists.**

## H. Current RBAC — read from the real matrix, not assumed

`apps/api/src/admin/permissions.ts`. The spec's §五 guesses were checked against the code:

| Permission | Spec §五 guessed | **Actual `ROLE_PERMISSIONS`** | Match |
| --- | --- | --- | --- |
| `risk:read` | SUPER_ADMIN, MODERATOR, ANALYST | SUPER_ADMIN, MODERATOR, ANALYST | ✅ |
| `connections:read` | SUPER_ADMIN, ANALYST | SUPER_ADMIN, ANALYST | ✅ |
| `exchanges:read` | SUPER_ADMIN, ANALYST | SUPER_ADMIN, ANALYST | ✅ |
| `blocks:read` | SUPER_ADMIN, ANALYST | SUPER_ADMIN, ANALYST | ✅ |

Also defined but held by nobody except SUPER_ADMIN: `connections:write`,
`exchanges:write`, `blocks:write`. Phase C is read-only (§二十六), so these stay unused —
same treatment as `moderation:read/write` in B5.

**No RBAC change is required or permitted.** SUPPORT / MODERATOR / CONTENT_MANAGER gain
nothing from Phase C.

## I. Methods that can be reused directly

| Reusable | Location | For |
| --- | --- | --- |
| Pagination / `totalPages` convention | `admin.service.ts` (`Math.ceil(total/pageSize)`, 0 when empty) | all four lists |
| `sort` whitelist-Map pattern | `admin.service.ts` | all four lists |
| `normalize*` / date-filter convention | `admin.service.ts` | all four lists |
| Explicit-`select` constants (`USER_LIST_SELECT`, `REPORT_LIST_SELECT`) | `admin.service.ts` | all four lists |
| `recordAudit` | `admin.service.ts` | not needed (read-only phase) |
| `deriveTargetType` | `admin.service.ts:368` | C1 (if it reads reports) |
| `AdminAuditLog` history query | `admin.service.ts` | C2/C3/C4 detail audit summary |
| `PermissionGuard` + `@RequirePermission` | `admin/` | all four |

## J. Methods that must be added

* `listConnections()` / `connectionDetail()`
* `listExchanges()` / `exchangeDetail()`
* `listBlocks()` / `blockDetail()`
* Something for C1 — **scope unresolved, see §11.1**

Each is a new read-only query. No new model, no mutation.

## K. Migration required?

**No.** All four domains are expressible against existing models. Zero migrations, zero
schema edits, no `db push`, no `reset`. Nothing in §五十's forbidden list is needed.

## L. Data volume — measured, not assumed

| Table | Rows |
| --- | --- |
| `User` | 10 |
| `Report` | 1 |
| `Block` | **0** |
| `Connection` | **0** |
| `ExchangeRequest` | **0** |
| `SharedSocialAccount` | **0** |
| `SocialAccount` | **0** |
| `Message` | **0** |
| `AdminAuditLog` | 3 |

**C2, C3 and C4 have zero rows. C1's only risk source has one row.**

§四 forbids mock and random data; §十一 requires an honest 「暂无数据」 empty state. So all
four pages will legitimately render empty. **This is a verification problem, not a design
one**: correctness can be proven (structure, RBAC, pagination, 404, leak checks, and
empty-state honesty), but "the page shows real rows" can only be proven after seeding
realistic fixtures in a test-only setup that is torn down, exactly as B5 did.

## M. Data-consistency issues found

1. **`Block` has no `id`** (§D). Affects the spec's route shape.
2. **`ExchangeRequest.connectionId` is a bare UUID with no FK** — a Connection can be
   deleted leaving a dangling id (same class as `Report.messageId`).
3. **`Connection` has no `updatedAt`** — §十四's "只有 schema 真有才显示" applies; the
   column must simply be omitted.
4. **`Connection.status` includes `REMOVED`** — a soft-delete-ish state. Phase C must
   display it but must not add a mutation to change it.

## N. Privacy risks

| Risk | Assessment |
| --- | --- |
| OAuth / provider credentials | **Structurally impossible** — no such column exists on `SocialAccount` |
| `handle` (C3) | **The real sensitive payload.** It is the user's actual account identifier. Must be justified as a moderation necessity and must never be joined through a global model |
| Email on C2/C3/C4 lists | §十四/§二十四 say "必要时"; §二十四 says only `id` + `nickname` required. **Default: omit email from lists**, return `id` + `nickname` only |
| `Message` content on C3 | §二十 says exchange metadata ≠ the private content. Do not surface message bodies for exchanges |
| `ip` / `userAgent` | Already excluded from all `REPORT_*_SELECT`; must stay excluded from the new selects |
| Tokens | `RefreshToken.tokenHash` exists but no admin response selects it — must remain so |

## O. Test gaps

| Required by spec | Exists? |
| --- | --- |
| `admin-risk.spec.ts` (§三十八) | ❌ |
| `admin-connections.spec.ts` (§三十九) | ❌ |
| `admin-exchanges.spec.ts` (§四十) | ❌ |
| `admin-blocks.spec.ts` (§四十一) | ❌ |
| `admin-risk.spec.ts` / `admin-connections.spec.ts` / `admin-exchanges.spec.ts` / `admin-blocks.spec.ts` (Playwright, §四十四) | ❌ |
| Real E2E §10d–10g (§四十二) | ❌ |
| Recursive JSON key scan for secrets (§四十五) | ❌ (new) |

All eight spec files are greenfield.

---

## 11. STOP CONDITIONS — the spec requires stopping and reporting

### 11.1 C1 Risk cannot be built without violating §十 or §五十一

§七 says: *"如果没有持久化 Risk 模型：不要直接新增 RiskRecord"* and *"如果实现某项功能必须新增 Risk schema：立即停止并报告"*.
§十 says: *"SafetyService.recordAutoFlag() … 本阶段：不要默默修"* and *"如果 Risk Center 发现这个问题必须处理：停止并记录为独立 Safety Phase"*.
§五十一 says: *"Risk 如果必须修改 SafetyService 才能正常工作：停止。单独建立 Safety Phase。"*

Measured reality:

* There is **no persisted risk data** (§A) — so a literal "riskLevel" filter or a
  "high-risk users"列表 has no backing column and **cannot be implemented** without a new
  schema or a `SafetyService` change.
* The only machine-risk artifact is the self-report write in `recordAutoFlag`, which is
  (a) currently unreachable, and (b) explicitly **not to be repaired** in this phase.

**What IS possible without violating anything:** a **Risk Overview built purely from
existing tables** — which is exactly §七's sanctioned fallback ("第一版可以基于已有：
Report / AdminAuditLog / 用户状态"):

* reports with `reporterId === reportedUserId` (the machine-flag signature) as
  "suspected machine signals"
* report volume by reason / status / time
* users under an active status (`SUSPENDED` / `BANNED` / `DISABLED`)
* recent report-related `AdminAuditLog` activity

This yields a useful, honest, **read-only** screen with **no schema change, no
`SafetyService` change, and no invented `riskLevel` enum**.

**Decision needed.** Building a `riskLevel`-filtered Risk Center as literally specified
would require a new Risk model and/or a `SafetyService` change — both stop conditions.

### 11.2 `GET /admin/blocks/:id` has no `:id` to route on

`Block`'s primary key is the composite `[blockerId, blockedId]`; there is no `id` column
(§D). §二十三–§二十五 specify a singular `:id` route and a "Block ID" column.

Two honest options:

* **(a)** Route on the pair — `GET /admin/blocks/:blockerId/:blockedId` — and show the
  composite as the identifier. Zero schema change. Deviates from the spec's literal URL.
* **(b)** Add a surrogate `id` to `Block` — **requires a migration**, which §五十/§三十四
  forbid.

**(a) is the only option consistent with the "zero migration" rule.** Needs confirmation
because it changes a URL the spec wrote literally.

---

## 12. Recommendation

1. **C2 Connections, C3 Exchanges, C4 Blocks are clear to build** — real models, real
   enums, zero migration, read-only, RBAC already correct. (C4 subject to the §11.2 route decision.)
2. **C1 Risk should be built as the §七-sanctioned "existing-tables-only" overview**,
   with no new model, no new enum, and no `SafetyService` change. Any attempt to add a
   `riskLevel` filter should trigger the stop condition instead.
3. **The `recordAutoFlag` self-report write should be recorded as a separate Safety
   Phase** and explicitly **not** touched here, per §十.
4. **Expect empty pages.** C2/C3/C4 have 0 rows today. Test-only fixtures, torn down
   afterwards, are the only way to prove row rendering without violating the no-mock rule.

**Awaiting the §11.1 and §11.2 decisions before starting C1.**
