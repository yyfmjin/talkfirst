# Admin Phase C2 — Connections Management: Final Result

**Phase:** Admin Phase C2 / Connections Management
**Date:** 2026-09-18
**Status:** ✅ Complete. All gates green. **Stopped — Phase C3 Contact Exchange not entered.**

---

## 1. Readiness confirmation

C1's final result was read before any code was written, and the baseline was
re-measured rather than taken from the brief. The brief quoted `Real E2E
179/181`; the actual measured figure at the start of C2 was **285 checks** (C1
left it at 230/232 with two known script defects). The brief's counts were
stale, so everything below is a measured number, not a quoted one.

Confirmed before starting:

| Claim | Verified |
| --- | --- |
| `Connection` has `id`, no `updatedAt`, enum `ACTIVE \| REMOVED` | ✅ read from `schema.prisma` |
| `connections:read` = SUPER_ADMIN + ANALYST only | ✅ read from `permissions.ts` |
| The database holds **zero** connections | ✅ `SELECT count(*) FROM "Connection"` = 0 |
| `connections:write` exists in the matrix but no route uses it | ✅ read from `permissions.ts` |
| Normal-user `ConnectionsService` semantics | ✅ read from `connections.service.ts` |

**Stop conditions:** none triggered. No schema change, no migration, no new
model, no enum change, no RBAC change, no `setStatus`/`SafetyService`/scheduler
change, and `POST` was not touched (it does not exist on this route family).

## 2. The Connection schema actually used

Read from `prisma/schema.prisma`, not assumed:

```prisma
model Connection {
  id             String           @id @default(uuid()) @db.Uuid
  userAId        String           @db.Uuid
  userA          User             @relation("ConnectionsA", ...)
  userBId        String           @db.Uuid
  userB          User             @relation("ConnectionsB", ...)
  conversationId String?          @unique @db.Uuid
  conversation   Conversation?    @relation("ConnectionConversation", ...)
  status         ConnectionStatus @default(ACTIVE)
  createdAt      DateTime         @default(now())

  @@unique([userAId, userBId])
  @@index([userAId])
  @@index([userBId])
}
```

Six columns, **no `updatedAt`**, and the relation fields are `userA`/`userB`
while the relation *names* are `ConnectionsA`/`ConnectionsB` — the names are not
the field names, which is exactly the trap §三 warned about.

## 3. List API

| Method | Path | Gate |
| --- | --- | --- |
| `GET` | `/api/v1/admin/connections` | `@RequirePermission("connections:read")` |

No `/admin/connection-list`, no `/admin/network`. Response:

```
{ success: true, data: { items, total, page, pageSize, totalPages } }
```

## 4. Detail API

| Method | Path | Gate |
| --- | --- | --- |
| `GET` | `/api/v1/admin/connections/:id` | `@RequirePermission("connections:read")` |

```
{ success: true, data: { connection: { id, status, createdAt, conversationId },
                         userA: { id, nickname }, userB: { id, nickname },
                         history: [] } }
```

An unknown id is a **404 `CONNECTION_NOT_FOUND`** — the code the normal-user
service already uses for the same situation, reused rather than invented. Never
`200 { data: null }`.

## 5. Query parameters

`page`, `pageSize`, `status`, `user`, `createdFrom`, `createdTo`, `sort`.

All defaults, validation and whitelists live in `AdminService`; the controller
forwards as-is, so the rules exist in one place. `sort` was implemented because
the detail/list pair genuinely needs a stable, ordered list — not copied from
Users for symmetry.

## 6. Status semantics

`ConnectionStatus` is exactly `ACTIVE | REMOVED`. An unknown value (`DELETED`)
is **ignored** — the list behaves as unfiltered — matching the existing
`USER_STATUSES` / `REPORT_STATUSES` policy. No third status was added.

**`REMOVED` is a visible stored state, not a delete.** `removeConnection` is a
soft delete: the row is updated, never removed. The list therefore applies **no
implicit `status: "ACTIVE"`** — the normal-user API filters to ACTIVE, but an
operations console needs the opposite, and a REMOVED row is the only surviving
evidence that a pair once connected. Verified: `status=REMOVED` returns the
fixture, and its detail page renders (200, not 404).

## 7. `user` filter semantics

A `Connection` has **no owner column**. It is `userAId` + `userBId`, and which
participant lands in which column depends on the UUID sort the normal-user
service performs at creation. So the filter is inherently either-side:

- **well-formed UUID** → `userAId = id OR userBId = id` (exact, never fuzzy)
- **any other text** → `userA.nickname ILIKE %kw% OR userB.nickname ILIKE %kw%`

Both clauses are Prisma filters evaluated **in the database**; nothing is
fetched and then filtered in JavaScript. `email` is deliberately **not**
searched: §十 says the default projection is `id` + `nickname`, and an operator
who needs the address follows the link to `/users/:id`.

The fixture makes the either-side rule non-vacuous: Bob is `userB` of the ACTIVE
row and `userA` of the REMOVED one, so a filter that only inspected `userAId`
would return one row instead of two and fail.

## 8. Date semantics

`createdFrom` → `createdAt gte`, `createdTo` → `createdAt lte`, both literal.

Parsing reuses B2/B4's `parseDateBoundary`: shape check, then a **real calendar
check**, then `new Date()`. `2026-02-30` is rejected with **400
`VALIDATION_ERROR` + `details.createdTo`** rather than silently rolling over to
2 March. Malformed input is likewise a 400, never a Prisma internal error.

## 9. Pagination

`page` 1–1000, `pageSize` 1–100, `skip = (page - 1) * pageSize`.

`totalPages = ceil(total / pageSize)`; `total = 0` → **`totalPages = 0`**. A page
past the end is a **200 with `items: []`** and an unchanged `total` — never an
error and never a rewritten total. `count` and `findMany` share one `where`, so
the total a caller renders can never disagree with the page they were given.

## 10. Sorting

A whitelist, never `orderBy = req.query.sort`:

```
createdAt_desc / createdAt_asc
status_asc / status_desc
userA_nickname_asc / userA_nickname_desc
userB_nickname_asc / userB_nickname_desc
```

Typed as `as const satisfies Record<string, Prisma.ConnectionOrderByWithRelationInput>`,
so a key that is not a real Prisma order-by fails to compile. An unknown key is
a **400**, not a silent fallback. The nickname sorts use
`{ sort, nulls: "last" }` because PostgreSQL's default for `ORDER BY … DESC` is
NULLS FIRST, which would lead with participants who have no nickname.

## 11. Explicit select

Two named constants, no bare `include` anywhere:

```ts
CONNECTION_LIST_SELECT = { id, status, createdAt, conversationId,
                           userA: { select: { id, nickname } },
                           userB: { select: { id, nickname } } }
CONNECTION_DETAIL_SELECT = { …same shape… }
CONNECTION_HISTORY_SELECT = { id, action, targetType, targetId, actorType,
                              adminId, reason, detail, before, after, createdAt }
```

Declared separately rather than shared, so the two screens can diverge
deliberately if a future phase adds a field that is safe on one only. The
`history` select excludes `ip`/`userAgent`.

## 12. Privacy

Verified by scanning the **raw JSON** of both endpoints, so a nested leak fails
too. Absent: `passwordHash`, `tokenHash`, `refreshToken`, `accessToken`,
`oauth`, `secret`, `userAgent`, and any `ip` field. Also asserted absent:
participant `email`, and any `updatedAt` (the column does not exist).

Out-of-scope relations asserted absent: `exchange`, `sharedSocial`, `handle`,
`blocked`, `blocker`. **A connection is not a Contact Exchange (C3) and not a
Block (C4)**, and the payload must not imply either exists.

## 13. RBAC

`permissions.ts` was **not modified**. The assertion follows the code:

| Role | List | Detail |
| --- | --- | --- |
| SUPER_ADMIN | 200 | 200 |
| ANALYST | 200 | 200 |
| MODERATOR | 403 `PERMISSION_DENIED` | 403 `PERMISSION_DENIED` |
| SUPPORT | 403 `PERMISSION_DENIED` | 403 `PERMISSION_DENIED` |
| CONTENT_MANAGER | 403 `PERMISSION_DENIED` | 403 `PERMISSION_DENIED` |
| anonymous | 401 `UNAUTHORIZED` | — |

A MODERATOR holds `moderation:read` and must **not** gain connection access by
virtue of it — different jobs. Verified live against the API, not asserted from
the matrix alone.

## 14. Navigation

`apps/admin/src/components/shell.tsx` gains one entry, gated `connections:read`:

```
仪表盘 / 用户 / 举报 / 审核工作台 / 风险中心 / 连接 / 审计日志
```

Visible to SUPER_ADMIN and ANALYST only. Hiding the link is UX only — the API
enforces the same permission.

**This broke two exhaustive nav assertions**, which is the tests working as
designed:

- `admin-rbac.spec.ts` — `NAV_LABELS` grew to seven; the MODERATOR case now uses
  an explicit `MODERATOR_NAV_LABELS` (six entries, no 连接), because a MODERATOR
  legitimately sees a shorter nav. The equality assertion was **kept strict**,
  not weakened to a subset.
- `admin-risk.spec.ts` — the "Risk nav entry sits between …" list grew to seven.

No assertion was deleted or relaxed.

## 15. Detail behaviour

Route `/connections/[id]`. Shows the connection (status badge, creation time,
conversation id), 用户 A and 用户 B (each linking to `/users/:id`), and 处理历史.

**A/B are reported as stored, never re-sorted or swapped** — they are database
semantics, not display order. Asserted live.

`conversationId` is `String? @unique`, so `null` is legal stored data. It is
returned as `null` (not substituted) and rendered as **未关联**, so "no
conversation" is distinguishable from a load failure.

## 16. Empty behaviour

`total = 0` renders **暂无连接**. The database genuinely holds zero connections,
so the real environment shows the empty state honestly — no fabricated row was
ever inserted to make the screen look populated. Fixture rows exist only inside
tests and are removed afterwards (§18).

Loading shows 加载中… and keeps the page structure; a request-sequence guard
(`seqRef`) ensures a stale response can never overwrite a newer one. Errors show
a safe message plus 重试, and never leak Prisma/SQL/stack/database details.

## 17. Audit behaviour

Every route added is a `GET`, so **none writes an `AdminAuditLog` row**. Verified
live: two list reads and one detail read leave the audit count unchanged.

The detail's `history` block is **queried, not hardcoded** — from
`AdminAuditLog` where `targetType = 'CONNECTION'`. That returns nothing today
(no connection mutation in the codebase writes an admin audit row), and an empty
array is the honest answer. Querying rather than hardcoding `[]` means a later
phase that begins auditing connections gets the history for free.

"An operator viewed a connection" is deliberately **not** recorded.

## 18. Fixture cleanup

The Real E2E script creates three users (Alice / Bob / Carol) and two
connections (Alice–Bob ACTIVE, Bob–Carol REMOVED), then deletes the connections
**explicitly before** the users and asserts the table is back to zero rows — the
`onDelete: Cascade` would remove them anyway, which would have made the
assertion vacuous.

The Playwright suite seeds its own rows and removes them; the suite's known
residue (2 audit + 3 note rows targeting `pw.victim`, pre-existing behaviour)
was cleaned to restore the baseline.

```
User 10 · Connection 0 · AdminAuditLog 2 · Report 1 · AdminUser 6 · AdminNote 0
```

## 19. Jest

| | Before C2 | After |
| --- | --- | --- |
| API Jest | 19 suites / 361 | **20 suites / 414** |

`admin-connections.spec.ts` adds **53 tests** covering the 38 enumerated cases:
5-role read access, no-identity rejection, empty/ACTIVE/REMOVED, status filter,
user by UUID and by nickname, either-side matching, date bounds, invalid date,
`total`/`totalPages`, page 1/2/past-end, sort, detail ACTIVE/REMOVED/missing,
eight forbidden keys, no relation leak, audit-free reads, and schema semantics
(`conversationId` nullable, no invented `updatedAt`, status enum limited to
ACTIVE/REMOVED).

**A pre-existing flake was found and fixed** (see §29.1): the B3 POST/PATCH
equivalence test compared an execution-time `new Date()` for equality, so it
passed only when both calls landed in the same millisecond — 2 of 3 runs failed.
Fixed by normalising the volatile timestamp while comparing every other column
exactly. Verified green on 4 consecutive full-suite runs.

## 20. Playwright

| | Before C2 | After |
| --- | --- | --- |
| Full suite | 126 | **150** |

`admin-connections.spec.ts` adds **24 browser tests** covering §32's 24
behaviours: navigation and its permission gating, page title, real fixture rows
for ACTIVE and REMOVED, status filter, user search by UUID and nickname
(including the both-sides case), date filter, pagination, empty, loading, error,
retry, detail for ACTIVE and REMOVED, 404, `conversationId` null, role access
and refusal, no sensitive UI, and back navigation.

**Full suite: 150/150 `ok`, 0 failed, 0 flaky.** Judged by `ok` count against
`Running 150 tests` with zero failure markers — the Windows worker-exit defect
(`worker-0 process did not exit within 300000ms`) is an environment artifact, not
a test failure, and **no business code or Playwright config was changed for it**.

## 21. Real E2E

`scripts/phaseA-rbac-verify.mjs` gains a **section 10e** with **54 checks**,
all passing. Every filter is compared against a count computed **independently in
PostgreSQL** through a separate query path — comparing the endpoint to itself
would pass however wrong both sides were.

Covered: 5-role RBAC + anonymous, unfiltered total vs SQL, the two statuses vs
SQL and their partition of the table, unknown status ignored, `user` by UUID and
nickname on **both** sides vs SQL, a participant with no connections, date range
vs SQL, malformed date, non-existent date, unknown sort, disjoint pages,
`totalPages` ceiling, page past the end, default order, ACTIVE/REMOVED detail,
A/B preserved, `conversationId` null, 404, no write route (`POST`/`PATCH`/`DELETE`
all 404), eight forbidden keys, no email, no out-of-scope relation, no invented
`updatedAt`, and audit-free reads.

**Run result: 284/285.** The single failure is the pre-existing `pageSize clamp`
script defect, which §43 explicitly says not to fix in C2.

## 22. typecheck

`npm run typecheck` → **exit 0** across all six workspaces.

## 23. lint

`npm run lint` → **exit 0**; `✔ No ESLint warnings or errors` for both Next apps
and `eslint "src/**/*.ts"` clean for the API.

## 24. build

`npm run build` → **exit 0**, all three products present:

```
○ /connections       4.02 kB   110 kB
ƒ /connections/[id]  3.60 kB   110 kB
```

## 25. prisma validate

`npx prisma validate` → **The schema at prisma\schema.prisma is valid 🚀**
`npx prisma generate` → **exit 0**.

## 26. migrate status

`16 migrations found in prisma/migrations`. On `:5433` the list reports "not yet
applied" — **pre-existing and documented**: this database was built with
`db push`, so `_prisma_migrations` does not exist. Drift is judged by
`migrate diff` (§27), which is the only meaningful signal here.

## 27. migrate diff

Both directions, empty:

```
diff (live DB ↔ datamodel)        → No difference detected.
diff (migrations ↔ datamodel)     → No difference detected.
```

**Zero drift. Zero migrations added.** `prisma/schema.prisma` mtime is still
`2026-09-17 15:15:30` and `prisma/migrations` still holds **16** directories. The
scratch shadow database was dropped afterwards; only `talkfirst` remains.

## 28. Database counts

| Table | Count |
| --- | --- |
| `User` | 10 |
| `Connection` | **0** |
| `AdminAuditLog` | 2 |
| `Report` | 1 |
| `AdminUser` | 6 |
| `AdminNote` | 0 |

`Connection` is back to its pre-run value of 0, `User` to 10, and no
`CONNECTION`-targeted audit row exists. Ports 4000/3001 released.

## 29. Unresolved issues

1. **`pageSize` clamp script defect (pre-existing, left alone).** The Real E2E
   check expects a page of 100 items and observes 23. §43 says not to fix it in
   C2, so it was not touched. It is the only failing check in the suite.
2. **`dashboard.todayNewUsers` (pre-existing, not observed this run).** Listed in
   the brief as a known script defect; it passed in both C2 runs, consistent with
   being time-dependent rather than broken.
3. **A third script defect was found and fixed** — see §29.1. Reported because it
   was not in the brief's list and it was producing false failures.
4. **`blocks/:id` route shape (C4).** `Block` has no `id` (composite PK), so the
   spec's literal URL is not implementable without a migration. Still undecided.
5. **`recordAutoFlag`'s self-report defect.** A real latent bug, explicitly out of
   scope; recorded for a standalone Safety phase.
6. **`connections:write` / `exchanges:write` / `blocks:write`** remain defined
   with zero routes using them. C2 shipped no mutation, as mandated.
7. **`conversationId` is returned in the list.** §十五 permits it only if the
   page needs it. The list renders a conversation column only via the detail
   link, so this is a candidate for removal if the field proves unused — flagged
   rather than changed, since removing it is a contract change.
8. **Windows Playwright worker-exit defect** — environment, not code. No
   `webServer`/`gracefulShutdown` change was made because of it.

### 29.1 Newly discovered: the date-range verification bound two different instants

Two B2 checks failed on the first C2 E2E run:

```
FAIL  users createdTo is an inclusive upper bound on createdAt   api=0 sql=3
FAIL  both bounds together produce a closed range                api=0 sql=3
```

**Diagnosis.** `User.createdAt` is `timestamp without time zone` and Prisma
reads it as naive UTC. The script's independent count binds a JS `Date` through
`$queryRawUnsafe`, which PostgreSQL receives as `timestamptz`; PostgreSQL then
applies the session timezone (Asia/Shanghai, +08:00), so the SQL side compared an
instant **eight hours away** from the one the API used.

Proven directly:

```
"createdAt" <= TIMESTAMPTZ '2026-09-17T03:41:19.951Z'  → 3   (what the script did)
"createdAt" <= '2026-09-17 03:41:19.951'::timestamp    → 0   (what the API did)
```

and the API was independently confirmed correct: `createdTo=2026-09-17T11:00:00Z`
→ 3 and `…T10:00:00Z` → 0, matching Prisma's own reading of the column
(`alex.demo` reads back as `2026-09-17T10:35:54.358Z`).

**It is time-of-day dependent**, which is why it passed in earlier runs and fails
now: the two sides disagree only while `now - 24h` falls between the stored value
and that value shifted by eight hours.

**Verdict: a defect in the verification script, not in the product.** The SQL
side now binds the same naive-UTC string Prisma itself uses, so both sides
measure the predicate the check claims to measure. The assertion was not
weakened — it is now deterministic and actually meaningful. Both checks pass.

---

## Final state

All gates green: Jest 20/414, Playwright 150/150, Real E2E 284/285 (the one
failure being the pre-existing `pageSize` defect), typecheck/lint/build exit 0,
`prisma validate` valid, both drift checks empty, fixtures removed, shadow
database dropped, ports released, database back to baseline.

**Stopped. Phase C3 Contact Exchange not entered.**
