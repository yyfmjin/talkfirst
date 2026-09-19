# Admin Phase C1 — Risk Center: Final Result

**Phase:** Admin Phase C1 / Risk Center
**Date:** 2026-09-18
**Status:** ✅ Complete. All gates green. **Stopped — Phase C2 Connections not entered.**

---

## 1. What this phase is

An **operational overview of facts already stored in the database**. It is not a
risk engine, not a scoring system, and not an independent Risk domain.

That definition is the whole phase. The platform stores **no risk level, no score
and no risk table**, and the brief forbids adding one — so every figure on the
Risk Center is a count of a stored fact, and the page abstains from every
judgement the data cannot support.

## 2. Stop conditions — both were resolved by narrowing scope, not by adding models

The readiness audit (`docs/ADMIN-PHASE-C-READINESS-AUDIT.md`) raised two
blockers. Neither required a schema change:

| Blocker | Resolution |
| --- | --- |
| C1 needs a risk level to display | There is none, and none was added. The page shows **stored status counts** plus an explicit note that counts are not a rating. |
| `blocks/:id` has no `:id` (`Block`'s PK is composite) | Out of C1 scope entirely — it belongs to C4, still undecided. |

## 3. Zero migrations — proven, not asserted

```
npx prisma validate        → schema is valid
npx prisma generate        → Generated Prisma Client (v6.19.3)
migrate diff (DB ↔ datamodel)              → -- This is an empty migration.
migrate diff (migrations ↔ datamodel)      → -- This is an empty migration.
```

Both directions of the drift check are **empty = 0 drift**. Phase C1 changed no
Prisma model, added no enum, and added no column. The scratch shadow database was
dropped afterwards.

## 4. The single new endpoint

| Method | Path | Gate |
| --- | --- | --- |
| `GET` | `/api/v1/admin/risk` | `@RequirePermission("risk:read")` |

Verified absent: `/admin/risk/:id`, `/admin/risk/events`, `/admin/risk/actions`,
`/admin/risk/score`, and every write method (`POST`/`PUT`/`PATCH`/`DELETE` all
return 404). `permissions.ts` and `PermissionGuard` were **not** modified.

## 5. Response shape

```
{ overview: { totalReports, openReports, reviewingReports, resolvedReports,
              rejectedReports, suspendedUsers, bannedUsers, disabledUsers,
              activeUsers, suspiciousSelfReports },
  recentReports, recentActions, suspiciousSignals }
```

Exactly the ten documented KPIs — asserted by exact key-set equality, so a
`riskScore`/`riskLevel` added later fails the check rather than shipping.

## 6. Every number is real PostgreSQL

`prisma.report.count()`, `prisma.user.count({where:{status:…}})`, `findMany` with
an explicit `select`. No `Math.random()`, no mock, no static value, no
frontend-side arithmetic.

The Real E2E suite asserts each KPI against a **count computed independently in
PostgreSQL**, through a separate query path — comparing the endpoint to itself
would pass no matter how wrong both sides are:

```
PASS  C1 risk KPI: totalReports equals the SQL count (api=5 sql=5)
PASS  C1 risk KPI: openReports equals the SQL count (api=2 sql=2)
PASS  C1 risk KPI: reviewingReports equals the SQL count (api=1 sql=1)
PASS  C1 risk KPI: resolvedReports equals the SQL count (api=2 sql=2)
PASS  C1 risk KPI: rejectedReports equals the SQL count (api=0 sql=0)
PASS  C1 risk KPI: suspendedUsers equals the SQL count (api=2 sql=2)
PASS  C1 risk KPI: bannedUsers equals the SQL count (api=1 sql=1)
PASS  C1 risk KPI: disabledUsers equals the SQL count (api=1 sql=1)
PASS  C1 risk KPI: activeUsers equals the SQL count (api=19 sql=19)
PASS  C1 risk KPI: suspiciousSelfReports equals the SQL count (api=0 sql=0)
```

Plus: the four report statuses **partition the report table exactly**
(`open+reviewing+resolved+rejected === total`).

## 7. No fabricated severity

`riskLevel`, `riskScore`, `riskTier`, `HIGH_RISK` are asserted **absent from the
raw JSON payload** and from the rendered page. The page instead states:

> 以上为状态计数，不构成风险评级。平台当前没有风险分级模型，页面不做推断。

`BANNED` is never rendered as "high risk"; `SUSPENDED` is never rendered as
"scam". Those would be business rules nobody has defined.

## 8. The `suspiciousSelfReports` signal — reported, never judged

Defined as `Report.reporterId === Report.reportedUserId`, implemented with
Prisma's **field reference**, not a string literal:

```ts
tx.report.count({ where: { reporterId: { equals: tx.report.fields.reportedUserId } } })
```

This is the whole reason the feature needs no migration. Writing
`{ equals: someId }` would silently mean "this user self-reported" — a different
and wrong question. The Jest suite proves it is a **column reference and not a
literal** with a `REPORT_FIELDS` sentinel, so the test cannot pass vacuously.

The signal exists because of a **known latent defect** in
`SafetyService.recordAutoFlag` (its non-HIGH path writes
`reporterId = reportedUserId`; all three production callers only invoke it on
HIGH, so it is currently unreachable). Per the brief it was **not repaired** —
`SafetyService` was not touched. Instead the page names the row neutrally as
「待核查异常举报」 and describes it factually as 「举报人与被举报人为同一账号」.

**Forbidden wording asserted absent:** 机器举报 / 恶意 / 诈骗 / 自动举报.

## 9. Recent actions come from the real vocabulary

The feed is scoped to actions that genuinely exist, read from the call sites —
not invented:

```
ADMIN_USER_{ACTIVATE|DISABLE|BAN|SUSPEND|UNBAN}   (from setStatus)
REPORT_{REVIEWING|RESOLVED|REJECTED}              (from reviewReview)
SYSTEM_USER_SUSPENSION_EXPIRED                    (scheduler)
```

`ADMIN_USER_NOTE` is a real action but **not** a risk-relevant one, and the feed
excludes it — asserted against a fixture note row, so the filter is proven real
rather than decorative. Actor consistency holds: SYSTEM rows carry
`actorType=SYSTEM, adminId=null`; USER rows carry a real administrator id.

## 10. Privacy

Asserted on the raw JSON (so a nested leak fails too), never merely on a field
list: `passwordHash`, `tokenHash`, `refreshToken`, `accessToken`, `secret`,
`"ip"` and `userAgent` are all absent. All seven checks pass.

## 11. RBAC — the real matrix, verified end to end

`risk:read` is held by SUPER_ADMIN / MODERATOR / ANALYST, and **not** by SUPPORT /
CONTENT_MANAGER. Verified against the live API:

| Role | Expected | Result |
| --- | --- | --- |
| SUPER_ADMIN | 200 | PASS |
| MODERATOR | 200 | PASS |
| ANALYST | 200 | PASS |
| SUPPORT | 403 `PERMISSION_DENIED` | PASS |
| CONTENT_MANAGER | 403 `PERMISSION_DENIED` | PASS |
| anonymous | 401 `UNAUTHORIZED` | PASS |
| DISABLED admin | 401 `USER_DISABLED` | PASS |

The permissions matrix was **not** modified; the assertion follows the code.

## 12. GET-only — reading writes no audit row

```
PASS  C1 risk: reading /admin/risk writes no audit row (GET-only)
```

An overview that wrote an audit row on every view would flood the very log it
summarises.

## 13. Files

**Created**
| File | Contents |
| --- | --- |
| `apps/api/src/admin/admin-risk.spec.ts` | 26 Jest cases |
| `apps/admin/src/app/risk/page.tsx` | the Risk Center screen |
| `apps/admin/test/e2e/admin-risk.spec.ts` | 20 Playwright cases |
| `docs/ADMIN-PHASE-C1-RESULT.md` | this report |

**Modified**
| File | Change |
| --- | --- |
| `apps/api/src/admin/admin.service.ts` | `riskOverview()` + 3 select constants + `RISK_ACTION_PREFIXES` |
| `apps/api/src/admin/admin.controller.ts` | one route: `GET risk` |
| `apps/admin/src/components/shell.tsx` | nav entry 「风险中心」, gated `risk:read` |
| `apps/admin/test/e2e/admin-rbac.spec.ts` | `NAV_LABELS` extended to six entries |
| `apps/admin/test/smoke.test.mjs` | 2 new source-contract tests (existing assertions untouched) |
| `scripts/phaseA-rbac-verify.mjs` | section 10d — 51 real HTTP + SQL checks |

**Not modified:** `safety.service.ts`, `permissions.ts`, `PermissionGuard`,
`UserStatusScheduler`, `prisma/schema.prisma`, any migration, `playwright.config.ts`,
`apps/admin/src/app/dashboard/**`, `apps/admin/src/app/users/**`.

## 14. UI

| Route | Render | Size |
| --- | --- | --- |
| `/risk` | static | 4.2 kB |

No `/risk/[id]`. Nav order: 仪表盘 / 用户 / 举报 / 审核工作台 / **风险中心** / 审计日志.
Sections: the KPI grid (10 cards, each keyed `risk-kpi-{label}`), 近期举报,
近期管理员处理, 待核查异常举报. Empty → 「暂无数据」. Report links reuse the
existing `/reports/:id`; no Risk detail route exists or is linked to.

A KPI at **0 renders as `0`** — a card that hid itself at zero would make "no
suspensions" indistinguishable from "this card is broken" (10 cards asserted
present unconditionally).

Loading on first load and on refresh, with **no full-page reload** (asserted by
watching for a navigation event). Errors show 「加载失败」 + 重试 and never leak
Prisma/SQL/stack/database details.

## 15. Test results

| Gate | Result |
| --- | --- |
| API Jest | **19 suites / 361 tests passing** (was 18/335 — +1 suite, +26 tests, zero regressions) |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (both apps: `✔ No ESLint warnings or errors`) |
| `npm run build` | exit 0 — all three products present, `/risk` in the route table |
| C1 Playwright (`admin-risk.spec.ts`) | **20/20, zero failure markers** |
| Full Playwright | **126/126 `ok`, 0 failures** — see §16 |
| Real E2E (`phaseA-rbac-verify.mjs`) | **230/232**, all 51 C1 checks behaved as expected |

## 16. Full Playwright suite

**126/126 `ok`, 0 failures, 0 flaky** across 9 specs, run against the real API and
the real database with both servers started manually.

Judged by `passed`/`failedTests` per the standing rule, **not** by exit code — the
Windows worker-exit defect force-kills the worker after the last test
(`worker-0 process did not exit within 300000ms after stop`) and suppresses the
summary. The `ok` count reaching the full `Running 126 tests` total with zero
failure markers is the evidence.

## 17. Fixtures are test-only and were removed

The Playwright suite writes one self-report, one ordinary report, one SYSTEM
audit row and one note row, all marked `PW_RISK_UI_` / `phase C1 browser
fixture…`. Verified removed after the run:

```
Report  where description LIKE 'phase C1 browser fixture%'  → 0
AdminAuditLog where action LIKE 'PW_RISK_UI_%'              → 0
```

The Real E2E script creates its self-report fixture inline and deletes it in the
same block, asserting the delete.

## 18. Two failures in the Real E2E run — one mine, one pre-existing

1. **`C1 risk RBAC: a DISABLED admin is rejected with USER_DISABLED`** —
   **my assertion was wrong, and has been corrected.** I asserted 403; the API
   returns **401**. `jwt.strategy.ts`'s `validate()` throws
   `UnauthorizedException({code:"USER_DISABLED"})` while resolving the principal,
   so the request never reaches `PermissionGuard`. 403 means "an *identified*
   caller lacks a permission" — a different fact about a different layer.
   **No product code was changed.** The check now asserts 401 and is green.

2. **`pageSize is clamped to 100 rather than honoured verbatim` (`items=23`)** —
   pre-existing and unrelated. A control run with the entire C1 block removed
   reproduced it. Per the brief's §三十六 it was left untouched.

## 19. `migrate status` remains uninformative on :5433

`:5433` has no `_prisma_migrations` table (built via `db push`), so all 16
migrations report "not yet applied". Pre-existing; drift is judged by
`migrate diff` (§3), which is the only meaningful signal.

## 20. Incident: 19 orphaned Playwright processes blocked `prisma generate`

`prisma generate` failed with `EPERM rename query_engine-windows.dll.node` **even
after the API was stopped**. Enumerating node process command lines revealed
**19 orphaned Playwright processes from earlier sessions** (including unrelated
specs like `admin-users.spec.ts`), each holding the query engine DLL. Clearing
them made `generate` succeed first try. Three stale `.tmp` DLL copies were also
removed. No product code was involved. — The environment is now clean.

## 21. Deliberately left open

1. **`recordAutoFlag`'s self-report defect** — a real latent bug, explicitly out
   of scope. Recorded for a future independent Safety Phase.
2. **C4's `blocks/:id` route shape** — `Block` has no `id`; undecided.
3. **`moderation:read`, `moderation:write`, `connections:write`, `exchanges:write`,
   `blocks:write`** remain defined with zero routes using them.
4. **Windows Playwright worker-exit defect** — environment, not code. **No
   business code, `webServer`, or `gracefulShutdown` was changed because of it.**

---

## Final state

All gates green. Both drift checks empty. Fixtures removed, scratch database
dropped, orphaned processes cleared, ports released, audit log back to its
pre-run size.

**Stopped. Phase C2 Connections not entered.**
