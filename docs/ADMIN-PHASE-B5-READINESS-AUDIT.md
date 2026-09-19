# Admin Phase B5 — Readiness Audit

**Date:** 2026-09-17
**Scope:** read-only. No code written, no schema changed, no migration run.
**Method:** read the real source files and the real schema; do not trust the brief's
model names. Every claim below is backed by a file path and a line number.

---

## 0. Baseline recorded before touching anything

| Gate | Value measured now |
|---|---|
| `prisma/migrations` entries | **17** = 16 migrations + `migration_lock.toml` |
| latest migration | `20260917153000_admin_audit_system_actor` |
| `prisma/schema.prisma` mtime | **2026-09-17 15:15:30** (unchanged since B1) |
| API Jest `admin/*.spec.ts` `it(`/`test(` count | audit 24 / dashboard 22 / rbac 35 / **reports 68** / user-detail 29 / user-status 24 / users 51 |
| Admin Playwright `test(` count | audit-ui 4 / dashboard 15 / rbac 5 / **report-detail 9** / reports-ui 8 / user-detail 12 / users 21 = **74** |
| Admin smoke (static) | 6 `test(` |
| Routes present under `apps/admin/src/app/` | `login`, `dashboard`, `users`, `users/[id]`, `reports`, `reports/[id]`, `audit`, `page.tsx` (redirect) |

Per B4's final report these correspond to **18 suites / 335 API tests** and
**74 passed / 0 failed** Playwright. Nothing here contradicts that.

---

## 1. `Report` state machine — the real shape

`prisma/schema.prisma`, `model Report`:

```
id             String       @id @default(uuid())
reporterId     String       @db.Uuid
reportedUserId String       @db.Uuid
messageId      String?      @db.Uuid      // NO foreign key
reason         String       @db.VarChar(64)   // free-form, NOT an enum
description    String?      @db.VarChar(1000)
status         ReportStatus @default(OPEN)
createdAt      DateTime     @default(now())
```

`enum ReportStatus { OPEN REVIEWING RESOLVED REJECTED }`.

**Confirmed absent:** `updatedAt`, `reviewedAt`, `reviewedBy`, any resolution field,
any `targetType` column, any FK on `messageId`.

The four states and the three transitions the API accepts
(`apps/api/src/admin/admin.service.ts:1275`) are exactly:

```
reviewing -> REVIEWING
resolved  -> RESOLVED
rejected  -> REJECTED
```

There is **no** "dismiss" and no transition back to `OPEN`. The brief's action
list must map onto these three names verbatim; inventing a fourth transition
would require a new enum value and therefore a migration.

### 1.1 `targetType` is derived, and there is exactly one definition

`apps/api/src/admin/admin.service.ts:368`:

```ts
function deriveTargetType(messageId: string | null): "USER" | "MESSAGE" {
  return messageId ? "MESSAGE" : "USER";
}
```

Its twin is the filter clause in `buildReportWhere` (`:1105-1109`), which uses
`messageId: null` / `{ not: null }`. Audit note in the source (`:1020-1031`) says
adding a column would create a second source of truth. **B5 must reuse these, not
reimplement them.** The UI mirror is `targetTypeOf()` at
`apps/admin/src/app/reports/page.tsx:67`.

---

## 2. Existing endpoints that already cover the B5 surface

`apps/api/src/admin/admin.controller.ts` — the full route table:

| Route | Permission | Throttle | Notes |
|---|---|---|---|
| `GET /admin/dashboard` | `dashboard:read` | global | B1 |
| `GET /admin/me` | *(none)* | global | own identity |
| `GET /admin/users` | `users:read` | global | B2 |
| `GET /admin/users/:id` | `users:read` | global | B3 |
| `POST /admin/users/:id/status` | `users:write` | 60/min | B3 |
| `PATCH /admin/users/:id/status` | `users:write` | 60/min | B3, same `applyStatus` |
| `POST /admin/users/:id/notes` | `users:write` | global | |
| `GET /admin/reports` | `reports:read` | global | B2/B4 |
| `GET /admin/reports/:id` | `reports:read` | global | B4 |
| `POST /admin/reports/:id/review` | `reports:write` | global | Phase A |
| `GET /admin/audit` | `audit:read` | global | |

### 2.1 The important finding

**`GET /admin/reports` is already, functionally, the moderation queue.**
`listReports()` (`admin.service.ts:1057`) supports `status` / `reason` /
`targetType` / `reporter` / `reportedUser` / `createdFrom` / `createdTo` /
`page` / `pageSize`, backs it with a whitelist-free but fully-pushed-down
`buildReportWhere`, and returns `{items, total, page, pageSize, totalPages}`.

**`GET /admin/reports/:id` is already the moderation detail.**
`reportDetail()` (`:1158`) returns report + reporter + reportedUser + derived
target + `messageSummary` (the `NO_MESSAGE`/`DELETED` discriminated union) +
`history` from `AdminAuditLog`.

**`POST /admin/reports/:id/review` is already the action endpoint.**
`reviewReport()` (`:1248`) enforces a mandatory reason (`400 REASON_REQUIRED`),
404s an unknown id (`REPORT_NOT_FOUND`), updates the status and writes exactly one
audit row **inside the same transaction**, with `before`/`after` status snapshots
and `targetType: "REPORT"` + `targetId`.

### 2.2 Consequence for B5 — this is the central design decision

The brief's B5.1/B5.2/B5.3 ("Moderation Queue API", "Moderation Detail",
"Available Actions") describe endpoints that **already exist under a different
name**. Two readings, and they are not equivalent:

* **(A) New parallel routes** `GET /admin/moderation` + `/admin/moderation/:id`
  that delegate to the same `listReports` / `reportDetail` / `reviewReport`.
  This satisfies the brief literally. Cost: two names for one thing, and a new
  place for the RBAC gate to diverge.
* **(B) Reuse `/admin/reports*` as-is** and put the moderation UI on top of it,
  adding only the nav entry and the page. Zero new API surface.

The brief is explicit that duplicate business logic is forbidden and that
`listReports()` / `reportDetail()` / `reviewReport()` must be reused. Both
readings honour that. **(A) is the safer reading** because the brief names the
routes, and because `moderation:read` / `moderation:write` exist precisely to be
used — but it must be thin delegation with no logic of its own.

**This is flagged as a decision point for the user, not resolved unilaterally.**

---

## 3. RBAC — the part that is *not* a no-op

`apps/api/src/admin/permissions.ts`. The two moderation permissions are already
in the matrix but have **zero routes**, and crucially their role sets **differ**
from the reports permissions:

| Role | `reports:read` | `reports:write` | `moderation:read` | `moderation:write` |
|---|---|---|---|---|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ |
| MODERATOR | ✅ | ✅ | ✅ | ✅ |
| SUPPORT | ✅ | ❌ | ❌ | ❌ |
| ANALYST | ✅ | ❌ | ❌ | ❌ |
| CONTENT_MANAGER | ✅ | ❌ | ✅ | ✅ |

**So SUPPORT and ANALYST can read the same data today via `reports:read` but would
be denied via `moderation:read`.** If B5 adds `GET /admin/moderation` gated on
`moderation:read`, then SUPPORT and ANALYST lose access to a view they currently
have — that is a **regression in access**, introduced by adding the endpoint the
brief asks for. This must be decided explicitly (see §9, blocker 2).

Note also: `moderation:write` and `reports:write` coincide for every role
(CONTENT_MANAGER has `moderation:write` but not `reports:write`; it is the only
role where they differ in the "write" direction — CONTENT_MANAGER currently
**cannot** review a report, and would be able to act via a moderation route).

`ROLE_ALLOWED_STATUS_ACTIONS` (`permissions.ts:124`) is an orthogonal axis and
gives ANALYST / CONTENT_MANAGER `[]` — neither may change a user's status. A
moderation action that also touches user status must respect this.

---

## 4. Audit rules — already satisfied by the existing implementation

The brief's rules map onto existing code with no change required:

| B5 rule | Where it already holds |
|---|---|
| exactly one audit row per successful human action | `reviewReport` writes one `recordAudit` inside the update transaction (`:1282`) |
| no audit on failure | reason check (`:1257`) and existence check (`:1268`) both throw **before** the transaction |
| no audit on GET | `listReports` / `reportDetail` / `dashboard` write nothing; there is already a dashboard assertion for this |
| human action ⇒ `actorType = USER` | `recordAudit` default (`permissions.ts` / `admin.service.ts` `AuditInput.actorType?`) |
| never fake a system actor | `recordSystemAudit` exists and is the only SYSTEM path |

**No engine work needed here.** New B5 endpoints must simply not add writes.

---

## 5. Schema change required? — **No, if reuse is accepted**

Everything the brief's §2 forbids already does not exist:

* no `ModerationRecord` / `MessageModeration`
* no `Report.targetType` column
* no FK on `Report.messageId`
* no `AdminRiskRecord` / `AdminConnectionRecord` / `AdminExchangeRecord` / `AdminBlockRecord`

And nothing in the B5 surface *needs* one: status lives on `Report`, history lives
on `AdminAuditLog` (indexed `@@index([targetType, targetId])` — exactly the query
`reportDetail` runs), and the message lookup is deliberately fallible.

**Conclusion: B5 is achievable with zero migrations**, provided §2.2 is resolved
in favour of delegation-or-reuse.

---

## 6. Front-end state — what exists, what is missing

* `apps/admin/src/app/reports/page.tsx` (565 lines) — the B4 queue. Filters,
  two distinct empty states, `data-testid`s (`reports-summary`, `reports-empty`,
  `report-row`, `report-target-badge`, `status-badge`, `report-detail-link`),
  draft/applied state with a request sequence guard, and review actions with
  `ConfirmDialog`.
* `apps/admin/src/app/reports/[id]/page.tsx` (368 lines) — the B4 detail screen
  with the review history from `AdminAuditLog` and its own "report not found" screen.
* `apps/admin/src/components/shell.tsx` — `NAV` has a comment at the `/reports`
  entry stating `/moderation` is **deliberately absent until B5 ships the page**.
  Adding the entry is a one-line change; the permission to filter on is the open
  question from §3.

**Missing:** `apps/admin/src/app/moderation/` does not exist. There is no
`/moderation` route (confirmed: no such directory under `src/app/`).

**Reuse hazard:** `permissions.ts` has a hand-maintained mirror at
`apps/admin/src/lib/permissions.ts`, including a duplicated `ALL` array. Any
matrix change must be made in **both** files or the console and the API disagree.

---

## 7. Test surface — current and required

Existing coverage that already exercises the B5 logic:

* `apps/api/src/admin/admin-reports.spec.ts` — **68 tests**, covering filters,
  the derived `targetType`, `messageSummary`'s three outcomes, `REPORT_NOT_FOUND`,
  history ordering, and reason enforcement.
* `apps/admin/test/e2e/admin-report-detail.spec.ts` — **9 tests**, including
  "empty history is stated explicitly" and "a real review action writes a real
  audit row".
* `apps/admin/test/e2e/admin-reports-ui.spec.ts` — **8 tests** (filters, both
  empty states).
* `apps/admin/test/smoke.test.mjs` — 6 static assertions, including one that
  pins every B4 filter parameter and the `T23:59:59.999Z` day completion.

**The test gate may only grow.** Adding `/moderation` routes means new spec files;
it must not mean deleting or relaxing the above. Note the smoke test reads source
files by path, so **if the moderation page becomes the canonical queue, the smoke
assertions currently pointing at `reports/page.tsx` need a decision** — extending
them (keeping the `reports` assertions) is safe; moving them is a contract change.

---

## 8. Fixture and environment facts that shape the spec

* Playwright fixtures run against **:5433** (`.local-data/pgdata`), which has
  **no `_prisma_migrations` table** — it is a `db push` schema. The B5 specs must
  self-seed like B4's did.
* `globalSetup` seeds 6 admin role fixtures and `globalTeardown` removes them;
  audit cleanup is **by `action` prefix** (`PW_AUDIT_UI_`) because SYSTEM rows have
  `adminId = null` and are invisible to id-based cleanup.
* The Windows worker-hang is a **Playwright 1.63 + Node 22 environment defect**,
  content-independent (a no-Prisma spec hangs too). Judge by `passed` and
  `failedTests`, never by exit code.
* Report data is thin: B4 recorded `OPEN 0 / REVIEWING 6 / RESOLVED 4 / REJECTED 0`.
  A queue defaulting to `OPEN` is empty on arrival — B4 already changed the
  default to "all" for this reason, and a moderation queue inherits that lesson.

---

## 9. Blockers to resolve before writing code

1. **[decided by policy, needs confirmation] Route shape.** Add thin
   `GET /admin/moderation` + `GET /admin/moderation/:id` delegating to the
   existing service methods, or point the moderation UI at `/admin/reports*`?
   Both are zero-migration. The brief names the routes; the reuse constraint
   forbids new logic. Delegation satisfies both — but it must be confirmed that
   two URLs over one implementation is intended.

2. **[real access regression risk] Permission choices.** `moderation:read` is
   held by SUPER_ADMIN / MODERATOR / CONTENT_MANAGER, whereas `reports:read` is
   held by all five roles. Gating a moderation queue on `moderation:read` would
   **remove SUPPORT and ANALYST access** they have today. And
   `moderation:write` would **grant CONTENT_MANAGER** report-review ability it
   does not have today. Neither is a bug in the matrix — it is a consequence of
   activating permissions that were defined but never wired. The brief forbids
   modifying `permissions.ts`, so the resolution must be at the route level
   (which permission each new route declares), and it needs an explicit decision.

3. **[contract] Nav entry.** `shell.tsx` already anticipates `/moderation`.
   Adding it requires picking the permission in (2).

## 10. Conclusion

* **No migration is required.** No forbidden model exists and none is needed.
* **All three action/service primitives already exist** and already implement the
  audit rules exactly as the brief requires.
* **Two decisions gate the start of work**, both about *naming and access*, not
  about data: the route shape (§9.1) and the permission each route declares (§9.2).
* **No stop condition from the brief is currently triggered** — nothing needs a new
  model, nothing needs a schema change, and no existing RBAC rule has to be edited
  (only *used*, which is the difference between §9.2 being a decision and being a
  violation).

**Recommendation:** resolve §9.1 and §9.2, then proceed from B5.1 as thin
delegation, reusing `listReports` / `reportDetail` / `reviewReport` unchanged.

---

## 11. Resolution — how §9's blockers were decided and what shipped

The FINAL B5 spec settled both blockers against the *first* option in each case:

1. **Route shape → reuse `reports*`; add no Moderation API.** No
   `GET /admin/moderation`, no `GET /admin/moderation/:id`, no
   `POST /admin/moderation/:id/action`. The three report endpoints **are** the
   moderation backend. This removed the "two URLs over one implementation"
   concern entirely.
2. **Permission → `reports:read` for reads, `reports:write` for review.**
   `moderation:read` / `moderation:write` stay defined, unused and undeleted,
   reserved for a future standalone moderation domain. This avoided both the
   SUPPORT/ANALYST access *loss* and the CONTENT_MANAGER access *gain* flagged
   in §9.2 — no matrix edit was needed, exactly as predicted.
3. **Nav** → added, gated on `reports:read`.

### 11.1 What was actually built

Nine files, all front-end / test / docs / script — **zero backend source files**:

| File | Change |
| --- | --- |
| `apps/admin/src/app/moderation/page.tsx` | new — queue |
| `apps/admin/src/app/moderation/[id]/page.tsx` | new — detail + actions |
| `apps/admin/test/e2e/admin-moderation.spec.ts` | new — 32 tests (Test 40–71) |
| `apps/admin/src/components/shell.tsx` | nav entry, `reports:read` |
| `apps/admin/test/fixtures/admin-roles.ts` | added an **active** CONTENT_MANAGER fixture |
| `apps/admin/test/e2e/admin-rbac.spec.ts` | `NAV_LABELS` 4 → 5 entries |
| `apps/admin/test/smoke.test.mjs` | 6 → 8 tests |
| `scripts/phaseA-rbac-verify.mjs` | new §10c, ~12.1 KB, 30 checks |
| `docs/ADMIN-PHASE-B5-READINESS-AUDIT.md` | this document |

Untouched, as required: `prisma/schema.prisma`, every migration, every file under
`apps/api/src/` (business code), both `permissions.ts` copies, `AdminGuard`,
`PermissionGuard`, `SafetyService`, `UserStatusScheduler`, the SYSTEM actor.

### 11.2 The one genuine design problem, and its resolution

§七 asked the queue to default to **OPEN + REVIEWING**. §八/§二十七 forbade
extending the API filter for a UI page, and required stopping to report if a
change were truly needed.

Measurement showed `AdminReportListQuery.status` is **single-valued**, and
`buildReportWhere` **silently ignores an unrecognised value** rather than
returning 400. So the "obvious" `status=OPEN,REVIEWING` would not have errored —
it would have silently returned **every** report, including RESOLVED and
REJECTED. That is worse than not implementing it, because it looks like it works.

Resolution: an explicit **two-tab switch** (待处理 / 审核中), issuing one
single-valued request at a time and landing on OPEN. §七's intent is met using
only existing API capability; §八/§二十七 is satisfied; no extension was needed,
so no stop-and-report was triggered.

### 11.3 Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | exit 0 (6 workspaces) |
| `npm run lint` | exit 0, 0 warnings / 0 errors |
| `npm run build` | exit 0, all three artifacts; `/moderation` (5.16 kB, static) + `/moderation/[id]` (3.64 kB, dynamic) in the route table |
| Admin Playwright (full) | **106 / 106 passed, 0 failed, 0 flaky** (32 of them B5) |
| API Jest | **18 suites / 335 tests, all passed** — identical to the B4 baseline |
| smoke | 8 / 8 |
| Real E2E | **30 / 30 B5 checks pass** (179/181 overall) |
| `prisma validate` | schema valid |
| `prisma migrate diff` (DB ↔ datamodel) | empty migration → **0 drift** |
| `prisma migrate diff` (migrations ↔ datamodel) | empty migration → **0 drift** |

Two caveats, stated plainly:

* `prisma migrate status` reports all 16 migrations as "not yet applied" because
  the **:5433** database has **no `_prisma_migrations` table** (it was created
  with `db push`; 33 real tables, no ledger). Pre-existing, unrelated to B5.
  Drift must be judged with `migrate diff`, which is clean.
* Real E2E has **2 pre-existing failures** (`dashboard.todayNewUsers`,
  `pageSize is clamped to 100`). A control run with the entire B5 block removed
  reproduced both identically, so they are script defects, not B5 regressions.
  One API-Jest run also flaked once in `api-exception.filter.spec.ts` (a file
  untouched by B5 and green on immediate re-run).

