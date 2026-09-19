# Admin Phase B5 — Final Result

**Phase:** Admin Phase B5 / Moderation Workbench
**Date:** 2026-09-18
**Status:** ✅ Complete. All gates green. **Stopped — Phase C not entered.**

---

## 1. Readiness audit outcome

The audit (`docs/ADMIN-PHASE-B5-READINESS-AUDIT.md`) concluded — and measurement
confirmed — that the phase required **zero migrations** and **zero new backend
business logic**. The three "moderation" endpoints the brief described already
existed under report names.

## 2. Why no Moderation API was added

`GET /admin/reports`, `GET /admin/reports/:id` and
`POST /admin/reports/:id/review` already are the moderation backend. Adding
`/admin/moderation*` would have meant two URLs over one implementation. Per the
spec, none was added — verified: no `/admin/moderation` route exists in
`apps/api/src/`.

## 3. UI routes added

| Route | Render | Size |
| --- | --- | --- |
| `/moderation` | static | 5.16 kB |
| `/moderation/[id]` | dynamic | 3.64 kB |

Both appear in the `next build` route table. No backend route was added.

## 4. APIs actually called

| Purpose | Endpoint | Method |
| --- | --- | --- |
| Queue | `/admin/reports?…` | GET |
| Detail | `/admin/reports/:id` | GET |
| Review | `/admin/reports/:id/review` | POST |
| Suspend / Ban | `/admin/users/:id/status` | POST |

Verified by grepping `apiFetch` / `apiSend` across both new pages — those four
are the complete set.

## 5. RBAC matrix as shipped

| Role | Read queue/detail | Review | Suspend | Ban |
| --- | --- | --- | --- | --- |
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ |
| MODERATOR | ✅ | ✅ | ✅ | ❌ |
| CONTENT_MANAGER | ✅ | ❌ | ❌ | ❌ |
| SUPPORT | ✅ | ❌ | ❌ | ❌ |
| ANALYST | ✅ | ❌ | ❌ | ❌ |

Confirmed against the live API in `phaseA-rbac-verify.mjs` §10c (30 checks).

## 6. `moderation:read` / `moderation:write` handling

Left **defined, unused, unmodified** — reserved for a future standalone
moderation domain. Not activated. Verified: they appear only as matrix
definitions in `permissions.ts`, with no route consuming them.

Reads gate on `reports:read` (held by all five roles); review gates on
`reports:write`. Gating on `moderation:read` would have **removed** SUPPORT and
ANALYST access they hold today.

## 7. Audit behaviour

- Exactly one audit row per successful human action; `actorType=USER`.
- **No** audit row on failure (asserted live for both review and status).
- **No** audit row on GET (asserted live for queue and detail).
- History is served from `AdminAuditLog` (`targetType='REPORT'`,
  `targetId=:id`), never from a Report column.
- `SYSTEM` renders as 「系统 · 自动」; `USER` renders `admin xxxxxxxx`. The
  `actorType` check happens **before** any `adminId.slice()`.

## 8. Message-unavailable handling

`NO_MESSAGE` and `DELETED` are distinct and neither 500s. The `USER`-target case
renders no message block at all.

## 9. Sensitive fields

No `passwordHash` / `tokenHash` / `refreshToken` / `accessToken` / `oauth` /
`secret` reaches the DOM. `ip` / `userAgent` are not returned by the API's
`REPORT_*_SELECT` constants at all. Asserted by Playwright Test 59.

## 10. Playwright

`apps/admin/test/e2e/admin-moderation.spec.ts` — **32 tests**, numbered
Test 40–71, in five describes (queue / detail / review / role gating /
enforcement).

**Full suite: 106 / 106 passed, 0 failed, 0 flaky.**

## 11. Real E2E

`scripts/phaseA-rbac-verify.mjs` extended with §10c — **30 new checks**, no B4
re-run needed. **All 30 pass.** Overall 179/181.

## 12. Jest

**18 suites / 335 tests, all passed** — byte-identical to the B4 baseline.

## 13. B5 backend business logic = 0

Explicitly confirmed: no file under `apps/api/src/` was modified by this phase.
The unchanged Jest count is the mechanical proof. The only API-adjacent change is
to the verification *script*.

## 14. typecheck

`npm run typecheck` → **exit 0**, all 6 workspaces.

## 15. lint

`npm run lint` → **exit 0, 0 warnings / 0 errors**.

## 16. build

`npm run build` → **exit 0**, api + web + admin artifacts, both new routes
present.

## 17. Prisma validate

`npx prisma validate` → **"The schema at prisma\schema.prisma is valid 🚀"**.

## 18. Prisma migrate status

Reports all 16 migrations as "not yet applied". **This is pre-existing and not a
B5 regression**: the :5433 database has **no `_prisma_migrations` table** (proven
via psql: `to_regclass('public._prisma_migrations')` → NULL, while 33 real tables
exist). It was created with `db push`, so there is no ledger to read.

## 19. Prisma migrate diff — 0 drift

| Comparison | Result |
| --- | --- |
| Live DB ↔ datamodel | `-- This is an empty migration.` |
| 16 migrations ↔ datamodel | `-- This is an empty migration.` |

**0 drift confirmed both ways.** A scratch shadow database was created and
dropped for this check.

## 20. Database changes

**None.** No schema edit, no migration, no `db push`, no `reset`. `ReportStatus`,
`UserStatus` and `ROLE_ALLOWED_STATUS_ACTIONS` are unchanged. No new model. No
FK was added to `Report.messageId`. `prisma/schema.prisma` was not touched.

## 21. Deletions

None. The Reports API, the Reports pages and the Reports tests are all intact.
Nothing was deleted to make B5 pass.

## 22. Open issues

1. **Two pre-existing Real E2E failures** — `dashboard.todayNewUsers matches a
   direct SQL count` (`api=20 sql=13`) and `pageSize is clamped to 100`
   (`items=23`). A control run **with the entire B5 block removed** reproduced
   both, so they are script defects: the first compares an API snapshot taken
   before fixtures exist against a SQL count taken after; the second asserts 100
   rows against a ~23-row database. Out of B5 scope; the API is not to be
   changed for them.

2. **One intermittent API-Jest flake** — `api-exception.filter.spec.ts` failed
   once under `--maxWorkers=2` and passed on immediate re-run and in isolation
   (6/6). The file is untouched by B5 (mtime hours before B5 began) and imports
   nothing B5-related. Pre-existing timing sensitivity around the filter's
   deliberate `console.error` on the expected-500 path.

3. **`migrate status` is uninformative on :5433** (see §18). Drift must be judged
   with `migrate diff`. Pre-existing.

4. **Windows Playwright worker-exit defect** — the worker still fails to exit
   after the suite completes, so the process is force-killed. Per §四十三 this is
   an environment issue; judged by `passed`/`failedTests`, not exit code. **No
   business code, `webServer`, or `gracefulShutdown` was changed because of it.**

---

## Final state

All gates green. Fixtures removed, ports released, temp scripts deleted, reports
table back to its baseline (`OPEN: 1`).

**Stopped. Admin Phase C not entered.**
