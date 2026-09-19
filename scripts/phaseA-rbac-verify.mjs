/**
 * Phase A — live end-to-end verification against the real API + real database.
 *
 * Everything here is observed behaviour over HTTP: no mocked guards, no stubbed
 * Prisma. It creates throwaway accounts, exercises the admin API with real
 * signed JWTs, inspects the rows that were actually written, and then removes
 * everything it created.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const API = "http://localhost:4000/api/v1";
const SECRET = process.env.JWT_SECRET;
const TAG = "phasea.verify";
/** A well-formed UUID that no fixture or seed can collide with. */
const MISSING_USER_ID = "00000000-0000-4000-8000-000000000000";
const prisma = new PrismaClient();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 220) });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rawCall(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Cookie = `tf_access=${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, code: json?.error?.code };
}

/**
 * One HTTP call, waiting out the rate limiter if it answers instead.
 *
 * The API allows 120 requests per minute per IP (`app.module.ts`) and this
 * script is a deliberate burst of ~85 of them. Without this, running it twice
 * inside the same minute produced a wall of bogus failures: every assertion
 * after the limit was reached observed a 429 rather than the behaviour it was
 * checking, which reads exactly like a regression. Waiting for the window to
 * roll keeps the report honest — it shows the API's answer, not the limiter's.
 *
 * A throttled request never reached the handler, so retrying it cannot
 * double-apply anything.
 */
async function call(path, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await rawCall(path, options);
    if (result.status !== 429 || attempt >= 4) return result;
    await sleep(15_000);
  }
}

const expectStatus = async (name, path, opts, want) => {
  const r = await call(path, opts);
  const ok = r.status === want;
  check(name, ok, `got ${r.status}${r.code ? `/${r.code}` : ""} want ${want}`);
  return r;
};

const expectCode = async (name, path, opts, wantStatus, wantCode) => {
  const r = await call(path, opts);
  const ok = r.status === wantStatus && r.code === wantCode;
  check(name, ok, `got ${r.status}/${r.code} want ${wantStatus}/${wantCode}`);
  return r;
};

async function main() {
  if (!SECRET) throw new Error("JWT_SECRET is not set in the environment");

  // ---------------------------------------------------------------- fixtures
  const mk = async (key, { role, isAdmin = false, adminActive = true } = {}) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "ACTIVE",
        nickname: `PA ${key}`,
        countryCode: "US",
        isAdmin,
        ...(role
          ? { adminUser: { create: { role, isActive: adminActive } } }
          : {}),
      },
      select: { id: true, email: true },
    });

  // Deadlines for the suspension-expiry sweep. The database is verified to hold
  // no pre-existing SUSPENDED rows before this runs, so a real sweep can only
  // touch the fixtures created here.
  const pastDeadline = new Date(Date.now() - 60_000);
  const futureDeadline = new Date(Date.now() + 6 * 60 * 60 * 1000);

  const suspendedUser = (key, suspendedUntil, banReason) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "SUSPENDED",
        suspendedUntil,
        banReason,
        nickname: `PA ${key}`,
        countryCode: "US",
      },
      select: { id: true, email: true },
    });

  const u = {
    analyst: await mk("analyst", { role: "ANALYST" }),
    support: await mk("support", { role: "SUPPORT" }),
    moderator: await mk("moderator", { role: "MODERATOR" }),
    contentmgr: await mk("contentmgr", { role: "CONTENT_MANAGER" }),
    superadmin: await mk("superadmin", { role: "SUPER_ADMIN" }),
    // AdminUser row exists but is soft-disabled, while User.isAdmin is true:
    // proves ADMIN_INACTIVE beats the compatibility fallback.
    inactive: await mk("inactive", { role: "CONTENT_MANAGER", isAdmin: true, adminActive: false }),
    // No AdminUser row at all: the isAdmin compatibility path.
    legacy: await mk("legacy", { isAdmin: true }),
    plain: await mk("plain"),
    victim1: await mk("victim1"),
    victim2: await mk("victim2"),
    // A DISABLED account: its token must be rejected with USER_DISABLED, which
    // is a different code from "no valid identity" (UNAUTHORIZED).
    disabled: await prisma.user.create({
      data: {
        email: `${TAG}.disabled@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "DISABLED",
        nickname: "PA disabled",
        countryCode: "US",
      },
      select: { id: true, email: true },
    }),
    // Suspension-expiry fixtures.
    suspendedExpired: await suspendedUser("suspended-expired", pastDeadline, "expired suspension"),
    suspendedPending: await suspendedUser("suspended-pending", futureDeadline, "pending suspension"),
  };

  const ids = Object.values(u).map((x) => x.id);
  const token = (user) =>
    jwt.sign({ sub: user.id, email: user.email, type: "access" }, SECRET, {
      expiresIn: "15m",
    });

  const t = {
    analyst: token(u.analyst),
    support: token(u.support),
    moderator: token(u.moderator),
    contentmgr: token(u.contentmgr),
    superadmin: token(u.superadmin),
    inactive: token(u.inactive),
    legacy: token(u.legacy),
    plain: token(u.plain),
    disabled: token(u.disabled),
  };

  const report = await prisma.report.create({
    data: {
      reporterId: u.plain.id,
      reportedUserId: u.victim1.id,
      reason: "HARASSMENT",
      description: "phase A live verification",
      status: "OPEN",
    },
    select: { id: true },
  });

  const auditBefore = await prisma.adminAuditLog.count();
  const noteBefore = await prisma.adminNote.count();

  // ------------------------------------------------- 1. authentication layer
  // Phase A+ unified these: every authentication failure now carries a domain
  // code instead of the generic HTTP_ERROR.
  const anon = await call("/admin/users", {});
  check(
    "no cookie -> 401 UNAUTHORIZED",
    anon.status === 401 && anon.code === "UNAUTHORIZED",
    `got ${anon.status}/${anon.code}`,
  );

  const garbage = await call("/admin/users", { token: "not.a.jwt" });
  check(
    "invalid token -> 401 UNAUTHORIZED",
    garbage.status === 401 && garbage.code === "UNAUTHORIZED",
    `got ${garbage.status}/${garbage.code}`,
  );

  const expired = jwt.sign(
    { sub: u.superadmin.id, email: u.superadmin.email, type: "access" },
    SECRET,
    { expiresIn: -60 },
  );
  const expiredRes = await call("/admin/users", { token: expired });
  check(
    "expired token -> 401 UNAUTHORIZED",
    expiredRes.status === 401 && expiredRes.code === "UNAUTHORIZED",
    `got ${expiredRes.status}/${expiredRes.code} msg=${expiredRes.json?.error?.message}`,
  );

  const wrongType = jwt.sign(
    { sub: u.superadmin.id, email: u.superadmin.email, type: "refresh" },
    SECRET,
    { expiresIn: "15m" },
  );
  const wrongTypeRes = await call("/admin/users", { token: wrongType });
  check(
    "wrong token type -> 401 INVALID_TOKEN (specific code survives)",
    wrongTypeRes.status === 401 && wrongTypeRes.code === "INVALID_TOKEN",
    `got ${wrongTypeRes.status}/${wrongTypeRes.code}`,
  );

  const disabledRes = await call("/admin/users", { token: t.disabled });
  check(
    "disabled account -> 401 USER_DISABLED (not UNAUTHORIZED)",
    disabledRes.status === 401 && disabledRes.code === "USER_DISABLED",
    `got ${disabledRes.status}/${disabledRes.code}`,
  );

  await expectCode(
    "normal user -> 403 ADMIN_REQUIRED",
    "/admin/users",
    { token: t.plain },
    403,
    "ADMIN_REQUIRED",
  );
  await expectCode(
    "normal user cannot read own admin identity",
    "/admin/me",
    { token: t.plain },
    403,
    "ADMIN_REQUIRED",
  );
  await expectCode(
    "normal user cannot change a user status",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.plain, body: { action: "ban", reason: "escalation attempt" } },
    403,
    "ADMIN_REQUIRED",
  );

  // ---------------------------------------------------- 2. read capabilities
  await expectStatus("ANALYST may list users (users:read)", "/admin/users", { token: t.analyst }, 200);
  await expectStatus(
    "ANALYST may read a user detail",
    `/admin/users/${u.victim1.id}`,
    { token: t.analyst },
    200,
  );
  await expectStatus("ANALYST may read the audit log", "/admin/audit", { token: t.analyst }, 200);
  await expectStatus(
    "ANALYST may read reports",
    "/admin/reports?status=OPEN",
    { token: t.analyst },
    200,
  );
  await expectStatus(
    "SUPPORT may read the dashboard",
    "/admin/dashboard",
    { token: t.support },
    200,
  );

  // --------------------------------- 2b. unknown id is a 404, not 200+null
  // Phase A+ fix: `userDetail` used to return `findUnique`'s null straight into
  // the success envelope, so the route answered 200 with `data: null` for an id
  // that does not exist.
  const missing = await call(`/admin/users/${MISSING_USER_ID}`, { token: t.superadmin });
  check(
    "unknown user id -> 404 USER_NOT_FOUND",
    missing.status === 404 && missing.code === "USER_NOT_FOUND",
    `got ${missing.status}/${missing.code}`,
  );
  check(
    "unknown user id never returns a 200 success envelope",
    !(missing.status === 200 && missing.json?.success === true),
    `status=${missing.status} success=${missing.json?.success}`,
  );
  check(
    "404 body uses the project envelope and carries no data key",
    missing.json?.success === false &&
      !Object.prototype.hasOwnProperty.call(missing.json ?? {}, "data"),
    JSON.stringify(missing.json),
  );
  // The same guarantee for a caller who may only read.
  const missingAnalyst = await call(`/admin/users/${MISSING_USER_ID}`, { token: t.analyst });
  check(
    "unknown user id -> 404 for ANALYST too (permission checked first)",
    missingAnalyst.status === 404 && missingAnalyst.code === "USER_NOT_FOUND",
    `got ${missingAnalyst.status}/${missingAnalyst.code}`,
  );

  // ------------------------------- 2c. dashboard (Phase B1, real statistics)
  // Verifying HTTP 200 alone would prove nothing about a dashboard: the whole
  // point is that each figure means what its label says. So every number the API
  // returns is compared against an independent SQL aggregate over the same
  // database, read through a different path than the service uses.
  const dashboardRoles = [
    ["SUPER_ADMIN", t.superadmin],
    ["MODERATOR", t.moderator],
    ["SUPPORT", t.support],
    ["ANALYST", t.analyst],
    ["CONTENT_MANAGER", t.contentmgr],
  ];
  const auditRowsBeforeDashboard = await prisma.adminAuditLog.count();

  for (const [role, roleToken] of dashboardRoles) {
    await expectStatus(`dashboard -> 200 for ${role}`, "/admin/dashboard", { token: roleToken }, 200);
  }

  const dash = await call("/admin/dashboard", { token: t.superadmin });
  const d = dash.json?.data ?? {};

  // Boundaries are computed here in JS and passed as parameters, rather than
  // using `date_trunc('day', now())`, so the SQL uses byte-identical instants to
  // the service. A timezone mismatch between the DB session and the Node process
  // would otherwise make this comparison flaky for reasons unrelated to the code.
  const todayBoundary = new Date();
  todayBoundary.setHours(0, 0, 0, 0);
  const sevenDayBoundary = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const sql = await prisma.$queryRawUnsafe(
    `SELECT
       (SELECT count(*)::int FROM "User")                                  AS users,
       (SELECT count(*)::int FROM "User" WHERE status = 'ACTIVE')          AS active,
       (SELECT count(*)::int FROM "User" WHERE status = 'SUSPENDED')       AS suspended,
       (SELECT count(*)::int FROM "User" WHERE status = 'BANNED')          AS banned,
       (SELECT count(*)::int FROM "User" WHERE "createdAt" >= $1)          AS "todayNewUsers",
       (SELECT count(*)::int FROM "User" WHERE "createdAt" >= $2)          AS "newUsers7d",
       (SELECT count(*)::int FROM "Report" WHERE status = 'OPEN')          AS "reportsOpen",
       (SELECT count(*)::int FROM "AdminUser" WHERE "isActive" = true)     AS admins`,
    todayBoundary,
    sevenDayBoundary,
  );
  const sqlRow = sql[0];

  for (const field of [
    "users",
    "active",
    "suspended",
    "banned",
    "todayNewUsers",
    "newUsers7d",
    "reportsOpen",
    "admins",
  ]) {
    check(
      `dashboard.${field} matches a direct SQL count`,
      d[field] === Number(sqlRow[field]),
      `api=${d[field]} sql=${sqlRow[field]}`,
    );
  }

  // The pre-existing fields must keep their exact meanings.
  const [activeTodaySql, messagesTodaySql, connectionsSql] = await Promise.all([
    prisma.user.count({ where: { lastActiveAt: { gte: todayBoundary } } }),
    prisma.message.count({ where: { createdAt: { gte: todayBoundary }, deletedAt: null } }),
    prisma.connection.count({ where: { status: "ACTIVE" } }),
  ]);
  check(
    "dashboard keeps the pre-existing fields (activeToday/messagesToday/connections)",
    d.activeToday === activeTodaySql &&
      d.messagesToday === messagesTodaySql &&
      d.connections === connectionsSql,
    `activeToday=${d.activeToday}/${activeTodaySql} messagesToday=${d.messagesToday}/${messagesTodaySql} connections=${d.connections}/${connectionsSql}`,
  );

  // `admins` changed meaning in Phase B1: it counts active AdminUser rows, not
  // the legacy `User.isAdmin` flag. The fixtures make the two differ on purpose
  // (one legacy isAdmin account with no AdminUser row, one soft-disabled
  // AdminUser whose isAdmin is still true), so this is a real assertion rather
  // than a tautology.
  const isAdminFlagCount = await prisma.user.count({ where: { isAdmin: true } });
  check(
    "dashboard.admins equals count(AdminUser WHERE isActive), not count(User.isAdmin)",
    d.admins === Number(sqlRow.admins) && d.admins !== isAdminFlagCount,
    `api=${d.admins} adminUser=${sqlRow.admins} isAdminFlag=${isAdminFlagCount}`,
  );

  // The three status buckets must partition the user table exactly.
  const statusSum = await prisma.user.groupBy({ by: ["status"], _count: { _all: true } });
  check(
    "ACTIVE + SUSPENDED + BANNED + DISABLED accounts for every user",
    statusSum.reduce((acc, row) => acc + row._count._all, 0) === d.users,
    `sum=${statusSum.reduce((acc, row) => acc + row._count._all, 0)} users=${d.users}`,
  );

  // Lists are arrays, so an empty feed is distinguishable from a failed load.
  check(
    "dashboard returns the three recent feeds as arrays",
    Array.isArray(d.recentAudit) &&
      Array.isArray(d.recentResolvedReports) &&
      Array.isArray(d.recentSystemEvents),
    `audit=${typeof d.recentAudit} reports=${typeof d.recentResolvedReports} system=${typeof d.recentSystemEvents}`,
  );
  check(
    "recentAudit entries carry actorType and a nullable adminId",
    d.recentAudit.length === 0 ||
      d.recentAudit.every(
        (row) =>
          (row.actorType === "USER" && typeof row.adminId === "string") ||
          (row.actorType === "SYSTEM" && row.adminId === null),
      ),
    JSON.stringify(d.recentAudit.slice(0, 2)),
  );
  check(
    "recentSystemEvents contains only machine actions",
    d.recentSystemEvents.length === 0 || d.recentSystemEvents.every((row) => !("adminId" in row)),
    `count=${d.recentSystemEvents.length}`,
  );

  // §四: the dashboard is a summary. `ip` and `userAgent` live on the audit rows
  // it reads, and must not ride along.
  const dashboardKeys = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        dashboardKeys.add(key);
        walk(child);
      }
    }
  };
  walk(d);
  for (const forbidden of ["ip", "userAgent", "passwordHash", "tokenHash"]) {
    check(
      `dashboard response exposes no ${forbidden}`,
      !dashboardKeys.has(forbidden),
      `keys=${[...dashboardKeys].join(",")}`,
    );
  }

  // §四: the dashboard is read-only. Reading it must not append audit rows —
  // a summary that audits its own viewers would flood the log it summarises.
  const auditRowsAfterDashboard = await prisma.adminAuditLog.count();
  check(
    "reading the dashboard writes no audit row",
    auditRowsAfterDashboard === auditRowsBeforeDashboard,
    `before=${auditRowsBeforeDashboard} after=${auditRowsAfterDashboard}`,
  );

  // ------------------------------- 2d. users list (Phase B2, real filters)
  // The list is the first screen where the *query* is the feature, so an HTTP
  // 200 proves nothing: a filter wired to the wrong parameter still returns
  // 200 and a plausible-looking page. Every filter below is therefore checked
  // twice — once through the API, once against an independent SQL aggregate
  // over the same database.
  const usersRoles = [
    ["SUPER_ADMIN", t.superadmin],
    ["MODERATOR", t.moderator],
    ["SUPPORT", t.support],
    ["ANALYST", t.analyst],
    ["CONTENT_MANAGER", t.contentmgr],
  ];
  for (const [role, roleToken] of usersRoles) {
    await expectStatus(`users list -> 200 for ${role}`, "/admin/users", { token: roleToken }, 200);
  }

  const listUsers = (qs, token = t.superadmin) => call(`/admin/users?${qs}`, { token });

  /** An independent count over the same predicate the API was asked for. */
  const countSql = async (where = "TRUE", params = []) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "User" WHERE ${where}`,
      ...params,
    );
    return Number(rows[0].n);
  };

  /** Mirrors the service's keyword semantics: email OR nickname, ILIKE. */
  const searchPredicate = `("email" ILIKE $1 OR "nickname" ILIKE $1)`;

  // --- search: email / nickname / exact id -------------------------------
  const byKeyword = await listUsers("search=phasea.verify.victim1");
  const keywordSql = await countSql(searchPredicate, ["%phasea.verify.victim1%"]);
  check(
    "users search matches SQL for the same email/nickname predicate",
    byKeyword.status === 200 && byKeyword.json?.data?.total === keywordSql,
    `api=${byKeyword.json?.data?.total} sql=${keywordSql}`,
  );
  check(
    "the search returned the row that was asked for",
    (byKeyword.json?.data?.items ?? []).some((row) => row.id === u.victim1.id),
    JSON.stringify((byKeyword.json?.data?.items ?? []).map((row) => row.email)),
  );

  const byId = await listUsers(`search=${u.victim1.id}`);
  check(
    "a full UUID is an exact id lookup, not a text match",
    byId.json?.data?.total === 1 && byId.json?.data?.items?.[0]?.id === u.victim1.id,
    `total=${byId.json?.data?.total} first=${byId.json?.data?.items?.[0]?.id}`,
  );

  // A prefix must NOT be treated as an id: `contains` on a uuid column is not
  // meaningful, and a prefix match would quietly return unrelated rows.
  const partial = u.victim1.id.slice(0, 8);
  const byPartialId = await listUsers(`search=${partial}`);
  const partialSql = await countSql(searchPredicate, [`%${partial}%`]);
  check(
    "a partial UUID falls back to the text search rather than matching the id",
    byPartialId.json?.data?.total === partialSql && partialSql !== 1,
    `api=${byPartialId.json?.data?.total} sql=${partialSql}`,
  );

  const legacyQ = await listUsers("q=phasea.verify.victim2");
  check(
    "the pre-B2 q parameter still works",
    legacyQ.status === 200 &&
      (legacyQ.json?.data?.items ?? []).some((row) => row.id === u.victim2.id),
    `total=${legacyQ.json?.data?.total}`,
  );

  const bothParams = await listUsers("q=phasea.verify.victim2&search=phasea.verify.victim1");
  check(
    "search wins over q when both are sent",
    (bothParams.json?.data?.items ?? []).some((row) => row.id === u.victim1.id) &&
      !(bothParams.json?.data?.items ?? []).some((row) => row.id === u.victim2.id),
    `total=${bothParams.json?.data?.total}`,
  );

  // --- status / country / dates -----------------------------------------
  for (const status of ["ACTIVE", "DISABLED", "SUSPENDED", "BANNED"]) {
    const res = await listUsers(`status=${status}`);
    const sqlN = await countSql(`status = $1::"UserStatus"`, [status]);
    check(
      `users status=${status} matches a direct SQL count`,
      res.json?.data?.total === sqlN,
      `api=${res.json?.data?.total} sql=${sqlN}`,
    );
  }
  const allUsersSql = await countSql();
  const unknownStatus = await listUsers("status=OPEN");
  check(
    "an unknown status is ignored and falls back to ALL (pre-B2 behaviour)",
    unknownStatus.json?.data?.total === allUsersSql,
    `api=${unknownStatus.json?.data?.total} sql=${allUsersSql}`,
  );

  const usList = await listUsers("country=US");
  const usSql = await countSql(`"countryCode"::text = $1`, ["US"]);
  check(
    "users country=US matches a direct SQL count",
    usList.json?.data?.total === usSql,
    `api=${usList.json?.data?.total} sql=${usSql}`,
  );
  const cnLower = await listUsers("country=cn");
  const cnSql = await countSql(`"countryCode"::text = $1`, ["CN"]);
  check(
    "a lower-case country code is normalised before matching",
    cnLower.json?.data?.total === cnSql,
    `api=${cnLower.json?.data?.total} sql=${cnSql}`,
  );
  const badCountry = await listUsers("country=USA");
  check(
    "a value that cannot be a Char(2) code is ignored rather than matching nothing",
    badCountry.json?.data?.total === allUsersSql,
    `api=${badCountry.json?.data?.total} sql=${allUsersSql}`,
  );

  // Fixed instants, well away from "now", so the API and the SQL aggregate
  // cannot disagree because of the milliseconds between the two calls.
  //
  // Both sides must bind the **same instant**. `User.createdAt` is
  // `timestamp without time zone` and Prisma reads it as naive UTC, so a JS
  // `Date` passed to `$queryRawUnsafe` is *not* the same value the API used:
  // the raw path binds it as `timestamptz`, PostgreSQL then applies the session
  // timezone (Asia/Shanghai, +08:00), and the two comparisons end up eight
  // hours apart. That is invisible for most of the day and produces a false
  // failure whenever the range straddles the shift — which is exactly what
  // happened here (api=0 sql=3). The SQL side therefore binds the same
  // naive-UTC string Prisma itself uses, so the assertion measures the
  // predicate it claims to measure instead of the server's clock offset.
  const naiveUtc = (date) => date.toISOString().slice(0, 19).replace("T", " ");
  const rangeFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rangeTo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fromList = await listUsers(`createdFrom=${rangeFrom.toISOString()}`);
  const fromSql = await countSql(`"createdAt" >= $1::timestamp`, [naiveUtc(rangeFrom)]);
  check(
    "users createdFrom is an inclusive lower bound on createdAt",
    fromList.json?.data?.total === fromSql,
    `api=${fromList.json?.data?.total} sql=${fromSql}`,
  );
  const toList = await listUsers(`createdTo=${rangeTo.toISOString()}`);
  const toSql = await countSql(`"createdAt" <= $1::timestamp`, [naiveUtc(rangeTo)]);
  check(
    "users createdTo is an inclusive upper bound on createdAt",
    toList.json?.data?.total === toSql,
    `api=${toList.json?.data?.total} sql=${toSql}`,
  );
  const rangeList = await listUsers(
    `createdFrom=${rangeFrom.toISOString()}&createdTo=${rangeTo.toISOString()}`,
  );
  const rangeSql = await countSql(
    `"createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp`,
    [naiveUtc(rangeFrom), naiveUtc(rangeTo)],
  );
  check(
    "both bounds together produce a closed range",
    rangeList.json?.data?.total === rangeSql,
    `api=${rangeList.json?.data?.total} sql=${rangeSql}`,
  );
  const inverted = await listUsers(
    `createdFrom=${rangeTo.toISOString()}&createdTo=${rangeFrom.toISOString()}`,
  );
  check(
    "an inverted range is a valid query that simply matches nothing",
    inverted.status === 200 && inverted.json?.data?.total === 0,
    `status=${inverted.status} total=${inverted.json?.data?.total}`,
  );
  const unfiltered = await listUsers("pageSize=100");
  const unfilteredSql = await countSql();
  check(
    "omitting the dates applies no time bound at all (all time is the default)",
    unfiltered.json?.data?.total === unfilteredSql,
    `api=${unfiltered.json?.data?.total} sql=${unfilteredSql}`,
  );

  const badDate = await listUsers("createdFrom=not-a-date");
  check(
    "a malformed date is a 400 VALIDATION_ERROR naming the field",
    badDate.status === 400 &&
      badDate.code === "VALIDATION_ERROR" &&
      "createdFrom" in (badDate.json?.error?.details ?? {}),
    `got ${badDate.status}/${badDate.code} ${JSON.stringify(badDate.json?.error?.details)}`,
  );
  const badCalendar = await listUsers("createdTo=2026-02-30");
  check(
    "a non-existent calendar day is rejected, not rolled over into March",
    badCalendar.status === 400 && badCalendar.code === "VALIDATION_ERROR",
    `got ${badCalendar.status}/${badCalendar.code}`,
  );
  check(
    "a rejected query never leaks a driver error or a stack trace",
    badDate.json?.error?.message === "Invalid query parameters" &&
      !/prisma|at \w|Invalid `prisma/i.test(JSON.stringify(badDate.json)),
    JSON.stringify(badDate.json).slice(0, 160),
  );

  // --- sort --------------------------------------------------------------
  const sortCases = [
    ["createdAt_asc", "createdAt", "asc"],
    ["createdAt_desc", "createdAt", "desc"],
    ["lastActiveAt_desc", "lastActiveAt", "desc"],
    ["nickname_asc", "nickname", "asc"],
    ["status_asc", "status", "asc"],
  ];
  for (const [key, column, direction] of sortCases) {
    const res = await listUsers(`sort=${key}&pageSize=20`);
    const values = (res.json?.data?.items ?? [])
      .map((row) => row[column])
      .filter((value) => value !== null);
    // Compared as an ordered list rather than by first element alone: a sort
    // that is applied to only part of the page would still look right.
    const expected = [...values].sort((a, b) => {
      if (a === b) return 0;
      const ascending = a > b ? 1 : -1;
      return direction === "asc" ? ascending : -ascending;
    });
    check(
      `users sort=${key} really orders the whole page by ${column} ${direction}`,
      values.length > 1 && JSON.stringify(values) === JSON.stringify(expected),
      `n=${values.length} first=${JSON.stringify(values[0])} last=${JSON.stringify(values[values.length - 1])}`,
    );
  }

  // `lastActiveAt` is nullable and PostgreSQL's default for DESC is NULLS
  // FIRST, so without an explicit placement "最近活跃 倒序" would lead with the
  // accounts that have never been active. Checked for both directions.
  for (const direction of ["desc", "asc"]) {
    const res = await listUsers(`sort=lastActiveAt_${direction}&pageSize=100`);
    const items = res.json?.data?.items ?? [];
    const firstNull = items.findIndex((row) => row.lastActiveAt === null);
    const lastValue = items.reduce(
      (acc, row, index) => (row.lastActiveAt === null ? acc : index),
      -1,
    );
    check(
      `users sort=lastActiveAt_${direction} keeps never-active accounts at the end`,
      items.length > 0 && (firstNull === -1 || firstNull > lastValue),
      `firstNull=${firstNull} lastValue=${lastValue}`,
    );
  }

  const ascFirst = (await listUsers("sort=createdAt_asc&pageSize=1")).json?.data?.items?.[0]?.id;
  // No `sort` at all, so this also proves the default order is the pre-B2 one.
  const clampedPage = await listUsers("pageSize=1000");
  const descFirst = clampedPage.json?.data?.items?.[0]?.id;
  const sqlAsc = await prisma.$queryRawUnsafe(
    `SELECT id FROM "User" ORDER BY "createdAt" ASC LIMIT 1`,
  );
  const sqlDesc = await prisma.$queryRawUnsafe(
    `SELECT id FROM "User" ORDER BY "createdAt" DESC LIMIT 1`,
  );
  check(
    "both sort directions are honoured and agree with SQL at each end",
    ascFirst === sqlAsc[0].id && descFirst === sqlDesc[0].id && ascFirst !== descFirst,
    `asc=${ascFirst}/${sqlAsc[0].id} desc=${descFirst}/${sqlDesc[0].id}`,
  );

  const badSort = await listUsers("sort=email_asc");
  check(
    "an unknown sort is rejected rather than silently replaced by the default",
    badSort.status === 400 && badSort.code === "VALIDATION_ERROR",
    `got ${badSort.status}/${badSort.code}`,
  );
  check(
    "omitting sort keeps the pre-B2 order (newest first)",
    descFirst === sqlDesc[0].id,
    `first=${descFirst} want=${sqlDesc[0].id}`,
  );

  // --- pagination --------------------------------------------------------
  const p1 = await listUsers("page=1&pageSize=10");
  const p2 = await listUsers("page=2&pageSize=10");
  const page1 = p1.json?.data ?? {};
  const page2 = p2.json?.data ?? {};
  check(
    "page 1 and page 2 return full, disjoint pages",
    page1.items?.length === 10 &&
      page2.items?.length === 10 &&
      !page1.items.some((row) => page2.items.some((other) => other.id === row.id)),
    `p1=${page1.items?.length} p2=${page2.items?.length}`,
  );
  check(
    "total is stable across pages and totalPages is its ceiling",
    page1.total === page2.total && page1.totalPages === Math.ceil(page1.total / 10),
    `total=${page1.total}/${page2.total} totalPages=${page1.totalPages}`,
  );
  // Same pageSize as above on purpose: `totalPages` depends on it, so comparing
  // across two different sizes would be comparing two different questions.
  const hugePage = await listUsers("page=1000&pageSize=10");
  check(
    "a page past the end is an empty list — not an error, not a clamped duplicate",
    hugePage.status === 200 &&
      hugePage.json?.data?.items?.length === 0 &&
      hugePage.json?.data?.total === page1.total &&
      hugePage.json?.data?.page === 1000 &&
      hugePage.json?.data?.totalPages === page1.totalPages,
    `status=${hugePage.status} items=${hugePage.json?.data?.items?.length} page=${hugePage.json?.data?.page} totalPages=${hugePage.json?.data?.totalPages}/${page1.totalPages}`,
  );
  check(
    "the unfiltered total and totalPages agree with the database",
    unfiltered.json?.data?.total === unfilteredSql &&
      unfiltered.json?.data?.totalPages === Math.ceil(unfilteredSql / 100),
    `api=${unfiltered.json?.data?.total}/${unfiltered.json?.data?.totalPages} sql=${unfilteredSql}`,
  );
  check(
    "pageSize is clamped to 100 rather than honoured verbatim",
    clampedPage.json?.data?.pageSize === 100 && clampedPage.json?.data?.items?.length === 100,
    `pageSize=${clampedPage.json?.data?.pageSize} items=${clampedPage.json?.data?.items?.length}`,
  );

  // --- sensitive fields --------------------------------------------------
  const listKeys = new Set();
  const walkList = (value) => {
    if (Array.isArray(value)) return value.forEach(walkList);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        listKeys.add(key);
        walkList(child);
      }
    }
  };
  walkList(byKeyword.json);
  for (const forbidden of [
    "passwordHash",
    "tokenHash",
    "refreshToken",
    "accessToken",
    "ip",
    "userAgent",
    "oauth",
    "secret",
  ]) {
    check(
      `users list exposes no ${forbidden}`,
      !listKeys.has(forbidden),
      `keys=${[...listKeys].join(",")}`,
    );
  }
  check(
    "users list loads no relation, so no nested object can appear",
    (unfiltered.json?.data?.items ?? []).every((row) =>
      Object.values(row).every((value) => value === null || typeof value !== "object"),
    ),
    JSON.stringify(Object.keys(unfiltered.json?.data?.items?.[0] ?? {})),
  );
  check(
    "no users-list value has the shape of a bcrypt hash or a JWT",
    !/\$2[aby]\$/.test(JSON.stringify(byKeyword.json)) &&
      !/eyJ[A-Za-z0-9_-]{8,}\./.test(JSON.stringify(byKeyword.json)),
    "",
  );

  const auditRowsBeforeList = await prisma.adminAuditLog.count();
  check(
    "reading the users list writes no audit row",
    auditRowsBeforeList === auditRowsBeforeDashboard,
    `before=${auditRowsBeforeDashboard} after=${auditRowsBeforeList}`,
  );

  // ----------------------------- 2e. user detail aggregates (Phase B3)
  const detail = await call(`/admin/users/${u.victim1.id}`, { token: t.superadmin });
  check(
    "user detail returns 200 with aggregate fields",
    detail.status === 200 &&
      typeof detail.json?.data?.profileCompletion === "object" &&
      typeof detail.json?.data?.connectionCount === "number" &&
      typeof detail.json?.data?.reportsReceivedCount === "number" &&
      typeof detail.json?.data?.reportsMadeCount === "number" &&
      typeof detail.json?.data?.blocksMadeCount === "number" &&
      typeof detail.json?.data?.blocksReceivedCount === "number" &&
      typeof detail.json?.data?.socialAccountCount === "number" &&
      Array.isArray(detail.json?.data?.auditSummary),
    `status=${detail.status} keys=${Object.keys(detail.json?.data ?? {}).join(",")}`,
  );

  // Profile completion must match the product rule (nickname + birthDate).
  const victim1Row = await prisma.user.findUnique({
    where: { id: u.victim1.id },
    select: { nickname: true, birthDate: true },
  });
  const shouldBeComplete = Boolean(victim1Row?.nickname && victim1Row?.birthDate);
  check(
    "profileCompletion.completed matches the product rule",
    detail.json?.data?.profileCompletion?.completed === (shouldBeComplete ? 2 : 1),
    `completed=${detail.json?.data?.profileCompletion?.completed} expected=${shouldBeComplete ? 2 : 1}`,
  );

  // The response must not carry secrets at any depth.
  const detailText = JSON.stringify(detail.json?.data ?? {});
  check(
    "user detail payload contains no passwordHash/tokenHash/refreshToken",
    !/passwordHash|tokenHash|refreshToken|accessToken|oauth|secret/i.test(detailText),
    "sensitive key scan",
  );
  check(
    "user detail payload contains no ip or userAgent",
    !/("ip"|"userAgent")/.test(detailText),
    "ip/userAgent scan",
  );

  // ------------------------------------- 3. write capability is per-endpoint
  await expectCode(
    "ANALYST cannot write user status -> PERMISSION_DENIED",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.analyst, body: { action: "disable", reason: "analyst is read-only" } },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "ANALYST cannot review reports -> PERMISSION_DENIED",
    `/admin/reports/${report.id}/review`,
    { method: "POST", token: t.analyst, body: { action: "resolved", reason: "nope" } },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "CONTENT_MANAGER cannot write user status -> PERMISSION_DENIED",
    `/admin/users/${u.victim1.id}/status`,
    {
      method: "POST",
      token: t.contentmgr,
      body: { action: "disable", reason: "not my job" },
    },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "CONTENT_MANAGER cannot PATCH user status -> PERMISSION_DENIED",
    `/admin/users/${u.victim1.id}/status`,
    {
      method: "PATCH",
      token: t.contentmgr,
      body: { action: "disable", reason: "not my job" },
    },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "CONTENT_MANAGER cannot review reports -> PERMISSION_DENIED",
    `/admin/reports/${report.id}/review`,
    { method: "POST", token: t.contentmgr, body: { action: "resolved", reason: "nope" } },
    403,
    "PERMISSION_DENIED",
  );

  // ------------------------------------------- 4. role-level action gating
  await expectStatus(
    "SUPPORT may disable (basic account handling)",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.support, body: { action: "disable", reason: "support disable" } },
    201,
  );

  await expectCode(
    "SUPPORT cannot ban -> ACTION_NOT_ALLOWED_FOR_ROLE",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.support, body: { action: "ban", reason: "support overreach" } },
    403,
    "ACTION_NOT_ALLOWED_FOR_ROLE",
  );
  await expectCode(
    "SUPPORT cannot suspend -> ACTION_NOT_ALLOWED_FOR_ROLE",
    `/admin/users/${u.victim1.id}/status`,
    {
      method: "POST",
      token: t.support,
      body: { action: "suspend", reason: "x", expiresAt: new Date(Date.now() + 86400000).toISOString() },
    },
    403,
    "ACTION_NOT_ALLOWED_FOR_ROLE",
  );
  await expectStatus(
    "SUPPORT may re-activate",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.support, body: { action: "activate", reason: "support re-activate" } },
    201,
  );
  await expectCode(
    "MODERATOR cannot permanently ban -> ACTION_NOT_ALLOWED_FOR_ROLE",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.moderator, body: { action: "ban", reason: "moderator overreach" } },
    403,
    "ACTION_NOT_ALLOWED_FOR_ROLE",
  );

  // ------------------------------------------- 5. reason + expiry enforcement
  await expectCode(
    "missing reason -> 400 REASON_REQUIRED",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.superadmin, body: { action: "ban" } },
    400,
    "REASON_REQUIRED",
  );
  await expectCode(
    "blank reason -> 400 REASON_REQUIRED",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.superadmin, body: { action: "ban", reason: "    " } },
    400,
    "REASON_REQUIRED",
  );
  await expectCode(
    "suspend without expiresAt -> 400 EXPIRES_AT_REQUIRED",
    `/admin/users/${u.victim1.id}/status`,
    { method: "POST", token: t.moderator, body: { action: "suspend", reason: "no expiry given" } },
    400,
    "EXPIRES_AT_REQUIRED",
  );
  await expectCode(
    "suspend with past expiresAt -> 400 INVALID_EXPIRES_AT",
    `/admin/users/${u.victim1.id}/status`,
    {
      method: "POST",
      token: t.moderator,
      body: {
        action: "suspend",
        reason: "expiry in the past",
        expiresAt: new Date(Date.now() - 60000).toISOString(),
      },
    },
    400,
    "INVALID_EXPIRES_AT",
  );
  await expectStatus(
    "MODERATOR may suspend with a future expiry",
    `/admin/users/${u.victim1.id}/status`,
    {
      method: "POST",
      token: t.moderator,
      body: {
        action: "suspend",
        reason: "cooling off",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
    201,
  );
  const suspended = await prisma.user.findUnique({
    where: { id: u.victim1.id },
    select: { status: true, suspendedUntil: true, bannedAt: true },
  });
  check(
    "suspension persisted with expiry and no ban columns",
    suspended.status === "SUSPENDED" && !!suspended.suspendedUntil && suspended.bannedAt === null,
    JSON.stringify(suspended),
  );

  // -------------------------------------------------- 6. self / admin protection
  await expectCode(
    "admin cannot change own status -> CANNOT_MODIFY_SELF",
    `/admin/users/${u.superadmin.id}/status`,
    { method: "POST", token: t.superadmin, body: { action: "ban", reason: "self ban attempt" } },
    403,
    "CANNOT_MODIFY_SELF",
  );
  await expectCode(
    "MODERATOR cannot modify an active admin -> CANNOT_MODIFY_ADMIN",
    `/admin/users/${u.superadmin.id}/status`,
    {
      method: "POST",
      token: t.moderator,
      body: {
        action: "suspend",
        reason: "moderator vs admin",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    },
    403,
    "CANNOT_MODIFY_ADMIN",
  );
  // Done while the moderator is still enabled — a disabled admin loses access
  // immediately (asserted right below), so ordering matters here.
  await expectStatus(
    "MODERATOR may resolve a report (reports:write)",
    `/admin/reports/${report.id}/review`,
    { method: "POST", token: t.moderator, body: { action: "resolved", reason: "confirmed abuse" } },
    201,
  );
  await expectStatus(
    "SUPER_ADMIN may disable another admin",
    `/admin/users/${u.moderator.id}/status`,
    { method: "POST", token: t.superadmin, body: { action: "disable", reason: "role revoked in test" } },
    201,
  );
  const afterDisable = await call("/admin/users", { token: t.moderator });
  check(
    "disabling an admin revokes their existing session immediately",
    afterDisable.status === 401 && afterDisable.code === "USER_DISABLED",
    `got ${afterDisable.status}/${afterDisable.code}`,
  );

  // --------------------------------- 7. soft-disabled admin + legacy fallback
  await expectCode(
    "soft-disabled AdminUser -> 403 ADMIN_INACTIVE (beats isAdmin)",
    "/admin/users",
    { token: t.inactive },
    403,
    "ADMIN_INACTIVE",
  );
  await expectStatus(
    "isAdmin without AdminUser row still gets in (legacy fallback)",
    "/admin/users",
    { token: t.legacy },
    200,
  );
  const meLegacy = await call("/admin/me", { token: t.legacy });
  check(
    "legacy admin resolves as SUPER_ADMIN and is flagged legacy",
    meLegacy.status === 200 && meLegacy.json?.data?.role === "SUPER_ADMIN" && meLegacy.json?.data?.legacy === true,
    JSON.stringify({ status: meLegacy.status, role: meLegacy.json?.data?.role, legacy: meLegacy.json?.data?.legacy }),
  );
  const meMod = await call("/admin/me", { token: t.contentmgr });
  check(
    "GET /admin/me returns role + permission list and no secrets",
    meMod.status === 200 &&
      Array.isArray(meMod.json?.data?.permissions) &&
      !JSON.stringify(meMod.json).match(/passwordHash|password|token/i),
    JSON.stringify({ role: meMod.json?.data?.role, n: meMod.json?.data?.permissions?.length }),
  );

  // ------------------------------------------------ 8. payload hardening
  await expectCode(
    "unknown body field rejected -> VALIDATION_ERROR (mass-assignment closed)",
    `/admin/users/${u.victim2.id}/status`,
    {
      method: "POST",
      token: t.superadmin,
      body: { action: "disable", reason: "legit", isAdmin: true, status: "ACTIVE" },
    },
    400,
    "VALIDATION_ERROR",
  );
  const victim2AfterReject = await prisma.user.findUnique({
    where: { id: u.victim2.id },
    select: { status: true, isAdmin: true },
  });
  check(
    "rejected payload changed nothing",
    victim2AfterReject.status === "ACTIVE" && victim2AfterReject.isAdmin === false,
    JSON.stringify(victim2AfterReject),
  );

  // ------------------------------------------------------ 9. audit integrity
  await expectStatus(
    "SUPER_ADMIN bans victim2 (final audited action)",
    `/admin/users/${u.victim2.id}/status`,
    {
      method: "POST",
      token: t.superadmin,
      body: { action: "ban", reason: "live verification ban" },
    },
    201,
  );

  const banAudit = await prisma.adminAuditLog.findFirst({
    where: { action: "ADMIN_USER_BAN", targetId: u.victim2.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    "ban audit row has targetType/targetId/reason/before/after/ip",
    !!banAudit &&
      banAudit.targetType === "USER" &&
      banAudit.targetId === u.victim2.id &&
      banAudit.reason === "live verification ban" &&
      banAudit.before?.status === "ACTIVE" &&
      banAudit.after?.status === "BANNED" &&
      !!banAudit.ip &&
      !!banAudit.userAgent,
    JSON.stringify({
      targetType: banAudit?.targetType,
      reason: banAudit?.reason,
      before: banAudit?.before,
      after: banAudit?.after,
      ip: banAudit?.ip,
      ua: banAudit?.userAgent?.slice(0, 20),
    }),
  );
  check(
    "ban audit row is attributed to the acting admin",
    banAudit?.adminId === u.superadmin.id,
    `adminId=${banAudit?.adminId}`,
  );

  const reportAudit = await prisma.adminAuditLog.findFirst({
    where: { action: "REPORT_RESOLVED", targetId: report.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    "report audit row targets the REPORT, not a user id",
    !!reportAudit &&
      reportAudit.targetType === "REPORT" &&
      reportAudit.targetId === report.id &&
      reportAudit.reason === "confirmed abuse" &&
      reportAudit.before?.status === "OPEN" &&
      reportAudit.after?.status === "RESOLVED",
    JSON.stringify({ tt: reportAudit?.targetType, ti: reportAudit?.targetId, reason: reportAudit?.reason }),
  );

  const auditAfter = await prisma.adminAuditLog.count();
  const noteAfter = await prisma.adminNote.count();
  // Expected: support disable, support activate, moderator suspend,
  // moderator report-resolve, superadmin disable moderator, superadmin ban.
  check(
    "audit log grew by exactly the six audited admin actions",
    auditAfter - auditBefore === 6,
    `delta=${auditAfter - auditBefore}`,
  );
  check(
    "admin notes recorded for the five status changes (report review adds none)",
    noteAfter - noteBefore === 5,
    `delta=${noteAfter - noteBefore}`,
  );
  const rejectedActionAudited = await prisma.adminAuditLog.count({
    where: { targetId: u.victim2.id, action: "ADMIN_USER_DISABLE" },
  });
  check(
    "a rejected (400) request writes no audit row",
    rejectedActionAudited === 0,
    `rows=${rejectedActionAudited}`,
  );

  const orphanAudit = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "AdminAuditLog" a LEFT JOIN "User" u ON u."id" = a."adminId" WHERE a."adminId" IS NOT NULL AND u."id" IS NULL`,
  );
  check("no audit row references a missing admin", Number(orphanAudit[0].n) === 0, JSON.stringify(orphanAudit));

  // ------------------------------------- 9b. SYSTEM actor schema (real DDL)
  // The actor pairing rule is a CHECK constraint that Prisma's schema language
  // cannot express, so it exists only in migration SQL. `prisma migrate diff`
  // and `db pull` therefore do not know about it, and a regenerated migration
  // could drop it silently. These checks are the tripwire for that.
  const enumLabels = await prisma.$queryRawUnsafe(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'AuditActorType' ORDER BY e.enumsortorder`,
  );
  check(
    "AuditActorType enum is exactly (USER, SYSTEM)",
    enumLabels.length === 2 &&
      enumLabels[0].enumlabel === "USER" &&
      enumLabels[1].enumlabel === "SYSTEM",
    enumLabels.map((r) => r.enumlabel).join(","),
  );

  const actorCol = await prisma.$queryRawUnsafe(
    `SELECT is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'AdminAuditLog' AND column_name = 'actorType'`,
  );
  check(
    "actorType is NOT NULL and defaults to USER (so history needs no backfill)",
    actorCol.length === 1 &&
      actorCol[0].is_nullable === "NO" &&
      String(actorCol[0].column_default).includes("USER"),
    JSON.stringify(actorCol),
  );

  const adminIdCol = await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'AdminAuditLog' AND column_name = 'adminId'`,
  );
  check(
    "adminId was widened to nullable",
    adminIdCol.length === 1 && adminIdCol[0].is_nullable === "YES",
    JSON.stringify(adminIdCol),
  );

  const checkConstraints = await prisma.$queryRawUnsafe(
    `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'AdminAuditLog' AND con.contype = 'c'`,
  );
  const consistencyDef = String(
    checkConstraints.find((c) => c.conname === "AdminAuditLog_actor_consistency_check")?.def ?? "",
  ).replace(/\s+/g, " ");
  check(
    "actor-consistency CHECK exists and forbids both illegal pairings",
    checkConstraints.length === 1 &&
      /'USER'::"AuditActorType"/.test(consistencyDef) &&
      /"adminId" IS NOT NULL/.test(consistencyDef) &&
      /'SYSTEM'::"AuditActorType"/.test(consistencyDef) &&
      /"adminId" IS NULL/.test(consistencyDef),
    `count=${checkConstraints.length} def=${consistencyDef.slice(0, 150)}`,
  );

  const fkRestrict = await prisma.$queryRawUnsafe(
    `SELECT con.confdeltype FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'AdminAuditLog' AND con.contype = 'f' AND con.conname = 'AdminAuditLog_adminId_fkey'`,
  );
  check(
    "the adminId FK is still ON DELETE RESTRICT for human rows",
    fkRestrict.length === 1 && fkRestrict[0].confdeltype === "r",
    JSON.stringify(fkRestrict),
  );

  // Every pre-existing row must still read as a human action. A DEFAULT can
  // only be trusted if it is verified, and a mis-set default would silently
  // relabel the entire history as machine-generated.
  const mislabelled = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "AdminAuditLog"
     WHERE ("actorType" = 'USER' AND "adminId" IS NULL)
        OR ("actorType" = 'SYSTEM' AND "adminId" IS NOT NULL)`,
  );
  check(
    "no audit row violates the actor pairing rule",
    Number(mislabelled[0].n) === 0,
    `violations=${mislabelled[0].n}`,
  );

  // --------------------------------------- 10. suspension auto-recovery (real)
  // Runs the ACTUAL compiled scheduler and the ACTUAL compiled AdminService
  // against the real database, so PostgreSQL — not a hand-written fake —
  // evaluates the expiry predicate and the actor-consistency rule.
  const { UserStatusScheduler } = require("../apps/api/dist/users/user-status.scheduler.js");
  const { AdminService } = require("../apps/api/dist/admin/admin.service.js");
  const adminService = new AdminService(prisma);
  const scheduler = new UserStatusScheduler(prisma, adminService);

  // Snapshotted by id, not by count: SYSTEM rows have `adminId = null` and
  // `targetId = null`, so the fixture-scoped cleanup below cannot see them. The
  // ids let cleanup remove exactly what this run created and nothing older.
  const systemAuditPreexisting = await prisma.adminAuditLog.findMany({
    where: { action: "SYSTEM_USER_SUSPENSION_EXPIRED" },
    select: { id: true },
  });
  const systemAuditBefore = systemAuditPreexisting.length;
  const preexistingSystemIds = new Set(systemAuditPreexisting.map((r) => r.id));

  const bannedBefore = await prisma.user.count({ where: { status: "BANNED" } });
  const released = await scheduler.releaseExpiredSuspensions(new Date());
  const bannedAfter = await prisma.user.count({ where: { status: "BANNED" } });

  check(
    "expired suspension is released to ACTIVE",
    released === 1,
    `released=${released} (expected exactly the 1 expired fixture)`,
  );

  const expiredRow = await prisma.user.findUnique({
    where: { id: u.suspendedExpired.id },
    select: {
      status: true,
      suspendedUntil: true,
      bannedAt: true,
      banReason: true,
      updatedAt: true,
    },
  });
  check(
    "released row has every status column cleared",
    expiredRow.status === "ACTIVE" &&
      expiredRow.suspendedUntil === null &&
      expiredRow.bannedAt === null &&
      expiredRow.banReason === null,
    JSON.stringify(expiredRow),
  );

  const pendingRow = await prisma.user.findUnique({
    where: { id: u.suspendedPending.id },
    select: { status: true, suspendedUntil: true, banReason: true, updatedAt: true },
  });
  check(
    "unexpired suspension is left alone, deadline preserved",
    pendingRow.status === "SUSPENDED" &&
      pendingRow.suspendedUntil?.getTime() === futureDeadline.getTime() &&
      pendingRow.banReason === "pending suspension",
    JSON.stringify(pendingRow),
  );

  // The baseline is 3, not 2: this script bans victim2 earlier, on top of the 2
  // pre-existing banned rows. Only the invariant matters — the sweep must not
  // move the number at all.
  check(
    "the sweep never touches BANNED users",
    bannedBefore === bannedAfter,
    `before=${bannedBefore} after=${bannedAfter}`,
  );

  // Idempotency against real PostgreSQL: a second sweep must match zero rows and
  // must not rewrite `updatedAt` on the row it already released.
  const releasedAt = expiredRow.updatedAt.getTime();
  const secondSweep = await scheduler.releaseExpiredSuspensions(new Date());
  const afterSecond = await prisma.user.findUnique({
    where: { id: u.suspendedExpired.id },
    select: { status: true, updatedAt: true },
  });
  check(
    "second sweep is a no-op (idempotent, no re-write)",
    secondSweep === 0 && afterSecond.updatedAt.getTime() === releasedAt,
    `released=${secondSweep} updatedAtChanged=${afterSecond.updatedAt.getTime() !== releasedAt}`,
  );

  // ------------------------------- 10b. the release is audited as SYSTEM (real)
  // The whole point of the SYSTEM actor: the sweep's state change is on the
  // record, and the record does not name a human.
  const systemAudit = await prisma.adminAuditLog.findMany({
    where: { action: "SYSTEM_USER_SUSPENSION_EXPIRED" },
    orderBy: { createdAt: "desc" },
  });
  const releaseAudit = systemAudit[0];
  check(
    "the auto-recovery wrote exactly one SYSTEM audit row",
    systemAudit.length - systemAuditBefore === 1,
    `delta=${systemAudit.length - systemAuditBefore}`,
  );
  check(
    "SYSTEM audit row is machine-attributed, not a borrowed admin identity",
    releaseAudit?.actorType === "SYSTEM" && releaseAudit?.adminId === null,
    `actorType=${releaseAudit?.actorType} adminId=${releaseAudit?.adminId}`,
  );
  check(
    "SYSTEM audit row records the transition it caused",
    releaseAudit?.targetType === "USER" &&
      releaseAudit?.before?.status === "SUSPENDED" &&
      releaseAudit?.after?.status === "ACTIVE" &&
      String(releaseAudit?.detail ?? "").includes("1"),
    JSON.stringify({
      targetType: releaseAudit?.targetType,
      before: releaseAudit?.before,
      after: releaseAudit?.after,
      detail: releaseAudit?.detail,
    }),
  );
  // `id` is excluded on purpose: it is this row's own primary key, not an actor
  // reference. Everything else must be free of any UUID — there is no
  // administrator anywhere in the entry.
  const { id: _ownRowId, ...systemActorFields } = releaseAudit ?? {};
  check(
    "SYSTEM audit row names no human actor (no UUID outside its own row id)",
    releaseAudit?.adminId === null &&
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
        JSON.stringify(systemActorFields),
      ),
    JSON.stringify(systemActorFields).slice(0, 160),
  );
  check(
    "the no-op sweep appended no second SYSTEM row",
    systemAudit.length - systemAuditBefore === 1,
    `total=${systemAudit.length}`,
  );

  // The CHECK constraint must reject both illegal shapes at the database level,
  // not merely in application code — a direct SQL writer must not be able to
  // forge a SYSTEM action attributed to a real administrator.
  const forgedActor = await prisma
    .$executeRawUnsafe(
      `INSERT INTO "AdminAuditLog" (id, "actorType", "adminId", action, "createdAt")
       VALUES (gen_random_uuid(), 'SYSTEM', $1::uuid, 'FORGED_SYSTEM_ACTION', now())`,
      u.superadmin.id,
    )
    .then(
      () => null,
      (e) => e,
    );
  check(
    "database rejects a SYSTEM row carrying a real adminId (no forgery possible)",
    forgedActor !== null && String(forgedActor.message).includes("AdminAuditLog_actor_consistency_check"),
    forgedActor === null ? "INSERT SUCCEEDED — the CHECK is missing!" : String(forgedActor.message).slice(0, 120),
  );

  const ownerlessHuman = await prisma
    .$executeRawUnsafe(
      `INSERT INTO "AdminAuditLog" (id, "actorType", "adminId", action, "createdAt")
       VALUES (gen_random_uuid(), 'USER', NULL, 'OWNERLESS_HUMAN_ACTION', now())`,
    )
    .then(
      () => null,
      (e) => e,
    );
  check(
    "database rejects a USER row with no adminId (no unattributable human action)",
    ownerlessHuman !== null &&
      String(ownerlessHuman.message).includes("AdminAuditLog_actor_consistency_check"),
    ownerlessHuman === null ? "INSERT SUCCEEDED — the CHECK is missing!" : String(ownerlessHuman.message).slice(0, 120),
  );

  const stillClean = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "AdminAuditLog" WHERE action IN ('FORGED_SYSTEM_ACTION', 'OWNERLESS_HUMAN_ACTION')`,
  );
  check(
    "neither rejected insert left a row behind",
    Number(stillClean[0].n) === 0,
    `rows=${stillClean[0].n}`,
  );

  // ----------------------------------- 10b. Phase B3 PATCH equivalence
  // Every previous test used POST; verify that PATCH hits the same service.
  const patchBan = await call(`/admin/users/${u.victim2.id}/status`, {
    method: "PATCH",
    token: t.superadmin,
    body: { action: "ban", reason: "B3 live verification" },
  });
  check(
    "PATCH ban returns 200 and produces the same audit shape as POST",
    patchBan.status === 200 && patchBan.json?.data?.status === "BANNED",
    `status=${patchBan.status}`,
  );
  const patchAudit = await prisma.adminAuditLog.findFirst({
    where: { targetId: u.victim2.id, action: "ADMIN_USER_BAN" },
    orderBy: { createdAt: "desc" },
    select: { actorType: true, adminId: true },
  });
  check(
    "PATCH ban audit row is actorType=USER with the acting admin",
    patchAudit?.actorType === "USER" && patchAudit?.adminId === u.superadmin.id,
    JSON.stringify(patchAudit),
  );

  // ---------------------------- 10c. Phase B5: reports as moderation backend
  //
  // Phase B5 adds **no** admin endpoint. The moderation workbench in the console
  // reads the existing report routes, so what is verified here is precisely the
  // claim that makes that safe: those routes behave as a moderation backend, and
  // reusing them grants no role any capability it did not already have.
  //
  // This deliberately does NOT re-run the Phase B4 report suite (filters,
  // pagination, date bounds) — that coverage lives in `admin-reports.spec.ts`
  // and duplicating it here would only add runtime, not evidence.
  //
  // Ordering note: section 6 above deliberately *disables* `u.moderator` and
  // asserts the session is revoked. The moderator's token is therefore dead by
  // the time this block runs, so the account is re-activated first — otherwise
  // every MODERATOR assertion below would observe a 401 and read as a
  // regression. The re-activation is a fixture reset, not a behaviour under test.
  await prisma.user.update({
    where: { id: u.moderator.id },
    data: { status: "ACTIVE" },
  });
  const moderatorAdmin = await prisma.adminUser.findUnique({
    where: { userId: u.moderator.id },
    select: { id: true },
  });
  if (moderatorAdmin) {
    await prisma.adminUser.update({ where: { id: moderatorAdmin.id }, data: { isActive: true } });
  }
  // `AdminGuard` reads the admin row per request, but the revocation above was
  // asserted through a dead token; a fresh one is signed so this block does not
  // depend on the old one remaining valid.
  const moderatorToken = token(u.moderator);

  // --- the queue endpoint answers for every report-reading role -------------
  // `reports:read` is held by all five roles. This is the access-preservation
  // property: keying a moderation surface on `moderation:read` instead would
  // drop SUPPORT and ANALYST, who can read reports today.
  const queueRoles = [
    ["SUPER_ADMIN", t.superadmin],
    ["MODERATOR", moderatorToken],
    ["SUPPORT", t.support],
    ["ANALYST", t.analyst],
    ["CONTENT_MANAGER", t.contentmgr],
  ];
  for (const [role, roleToken] of queueRoles) {
    const r = await call("/admin/reports?status=OPEN&page=1&pageSize=1", { token: roleToken });
    check(
      `B5 moderation queue: ${role} can read /admin/reports (reports:read)`,
      r.status === 200 && Array.isArray(r.json?.data?.items),
      `status=${r.status}${r.code ? `/${r.code}` : ""}`,
    );
  }

  // --- the detail endpoint answers, and derives the target type --------------
  const detailRes = await call(`/admin/reports/${report.id}`, { token: t.support });
  check(
    "B5 moderation detail: SUPPORT can read /admin/reports/:id and targetType is derived",
    detailRes.status === 200 &&
      detailRes.json?.data?.report?.id === report.id &&
      detailRes.json?.data?.target?.targetType === "USER",
    `status=${detailRes.status} targetType=${detailRes.json?.data?.target?.targetType}`,
  );
  check(
    "B5 moderation detail: history is served from the audit log, not a report column",
    Array.isArray(detailRes.json?.data?.history),
    `history=${Array.isArray(detailRes.json?.data?.history)}`,
  );

  // --- review is gated on reports:write, and the gate is real ---------------
  // Create a dedicated report per role that may review, so each assertion is
  // about its own row and the audit count is unambiguous.
  const mkReport = (reason, status = "OPEN") =>
    prisma.report.create({
      data: {
        reporterId: u.plain.id,
        reportedUserId: u.victim1.id,
        reason,
        description: "phase B5 live verification",
        status,
      },
      select: { id: true },
    });

  const b5ReportSuper = await mkReport("B5 SUPER");
  const b5ReportMod = await mkReport("B5 MODERATOR");

  const reviewSuper = await expectStatus(
    "B5 review: SUPER_ADMIN may review (reports:write)",
    `/admin/reports/${b5ReportSuper.id}/review`,
    { method: "POST", token: t.superadmin, body: { action: "resolved", reason: "B5 live super" } },
    201,
  );
  check(
    "B5 review: the write actually changed the status",
    reviewSuper.json?.data?.status === "RESOLVED",
    `status=${reviewSuper.json?.data?.status}`,
  );

  await expectStatus(
    "B5 review: MODERATOR may review (reports:write)",
    `/admin/reports/${b5ReportMod.id}/review`,
    { method: "POST", token: moderatorToken, body: { action: "reviewing", reason: "B5 live mod" } },
    201,
  );

  // The three roles that must NOT gain review ability. This is the regression
  // CONTENT_MANAGER is the interesting one for: it holds `moderation:write` but
  // not `reports:write`, and B5 must not conflate the two.
  const b5ReportNoWrite = await mkReport("B5 NOWRITE");
  for (const [role, roleToken] of [
    ["SUPPORT", t.support],
    ["ANALYST", t.analyst],
    ["CONTENT_MANAGER", t.contentmgr],
  ]) {
    await expectCode(
      `B5 review: ${role} is refused with 403 PERMISSION_DENIED`,
      `/admin/reports/${b5ReportNoWrite.id}/review`,
      { method: "POST", token: roleToken, body: { action: "resolved", reason: "must not apply" } },
      403,
      "PERMISSION_DENIED",
    );
  }

  // A refused review must leave the report untouched and write no audit row.
  const refusedReport = await prisma.report.findUnique({
    where: { id: b5ReportNoWrite.id },
    select: { status: true },
  });
  const refusedAudit = await prisma.adminAuditLog.count({
    where: { targetType: "REPORT", targetId: b5ReportNoWrite.id },
  });
  check(
    "B5 review: a refused review changes nothing and writes no audit row",
    refusedReport?.status === "OPEN" && refusedAudit === 0,
    `status=${refusedReport?.status} audit=${refusedAudit}`,
  );

  // --- exactly one audit row per successful review, attributed to a human ----
  const superAudit = await prisma.adminAuditLog.findMany({
    where: { targetType: "REPORT", targetId: b5ReportSuper.id },
    select: { actorType: true, adminId: true, action: true, before: true, after: true },
  });
  check(
    "B5 review audit: exactly one row, actorType=USER, with the acting admin and before/after",
    superAudit.length === 1 &&
      superAudit[0].actorType === "USER" &&
      superAudit[0].adminId === u.superadmin.id &&
      superAudit[0].action === "REPORT_RESOLVED" &&
      superAudit[0].before?.status === "OPEN" &&
      superAudit[0].after?.status === "RESOLVED",
    JSON.stringify(superAudit.map((a) => ({ a: a.action, t: a.actorType, b: a.before, f: a.after }))),
  );

  const modAudit = await prisma.adminAuditLog.findMany({
    where: { targetType: "REPORT", targetId: b5ReportMod.id },
    select: { actorType: true, adminId: true },
  });
  check(
    "B5 review audit: MODERATOR's review is attributed to the moderator, not a system actor",
    modAudit.length === 1 && modAudit[0].actorType === "USER" && modAudit[0].adminId === u.moderator.id,
    JSON.stringify(modAudit),
  );

  // --- enforcement reuses the user-status endpoint and its role table -------
  // The moderation UI calls `POST /admin/users/:id/status` for suspend and ban.
  // These assertions prove the *existing* gate already produces the required
  // matrix, so the UI needs no backend change to be safe.
  //
  // The two failure kinds are deliberately distinguished, because they come from
  // different layers and mean different things:
  //
  //   PERMISSION_DENIED               — the role does not hold `users:write` at
  //                                     all, so `PermissionGuard` refuses before
  //                                     the service is reached (ANALYST and
  //                                     CONTENT_MANAGER).
  //   ACTION_NOT_ALLOWED_FOR_ROLE     — the role holds `users:write` but not this
  //                                     particular action in
  //                                     `ROLE_ALLOWED_STATUS_ACTIONS` (SUPPORT and
  //                                     MODERATOR both hold the permission; only
  //                                     MODERATOR may suspend).

  await expectCode(
    "B5 status: SUPPORT cannot suspend (has users:write, action not in its role table)",
    `/admin/users/${u.victim2.id}/status`,
    {
      method: "POST",
      token: t.support,
      body: {
        action: "suspend",
        reason: "B5 must be refused",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
    403,
    "ACTION_NOT_ALLOWED_FOR_ROLE",
  );
  await expectCode(
    "B5 status: ANALYST cannot ban (does not hold users:write)",
    `/admin/users/${u.victim2.id}/status`,
    { method: "POST", token: t.analyst, body: { action: "ban", reason: "B5 must be refused" } },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "B5 status: CONTENT_MANAGER cannot ban (does not hold users:write)",
    `/admin/users/${u.victim2.id}/status`,
    { method: "POST", token: t.contentmgr, body: { action: "ban", reason: "B5 must be refused" } },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "B5 status: MODERATOR cannot ban (users:write, but ban is not in its role table)",
    `/admin/users/${u.victim2.id}/status`,
    { method: "POST", token: moderatorToken, body: { action: "ban", reason: "B5 must be refused" } },
    403,
    "ACTION_NOT_ALLOWED_FOR_ROLE",
  );

  // The positive cases the UI renders buttons for must actually work. A status
  // change answers 201 (it creates the new state), not 200.
  const modSuspend = await call(`/admin/users/${u.victim2.id}/status`, {
    method: "POST",
    token: moderatorToken,
    body: {
      action: "suspend",
      reason: "B5 live moderator suspend",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  check(
    "B5 status: MODERATOR may suspend",
    modSuspend.status === 201 && modSuspend.json?.data?.status === "SUSPENDED",
    `status=${modSuspend.status} seq=${modSuspend.json?.data?.status}`,
  );

  const superBan = await call(`/admin/users/${u.victim2.id}/status`, {
    method: "POST",
    token: t.superadmin,
    body: { action: "ban", reason: "B5 live superadmin ban" },
  });
  check(
    "B5 status: SUPER_ADMIN may ban",
    superBan.status === 201 && superBan.json?.data?.status === "BANNED",
    `status=${superBan.status} seq=${superBan.json?.data?.status}`,
  );

  // Enforcement audit rows are USER-actor and carry before/after — never SYSTEM.
  // Scoped to the B5 reason so it counts only this block's write, not the ban
  // that section 10 performed on the same user earlier in the run.
  const statusAudit = await prisma.adminAuditLog.findMany({
    where: { targetType: "USER", targetId: u.victim2.id, reason: "B5 live superadmin ban" },
    orderBy: { createdAt: "desc" },
    select: { actorType: true, adminId: true, before: true, after: true },
  });
  check(
    "B5 status audit: the ban is exactly one USER row with the acting admin and before/after",
    statusAudit.length === 1 &&
      statusAudit[0].actorType === "USER" &&
      statusAudit[0].adminId === u.superadmin.id &&
      statusAudit[0].after?.status === "BANNED",
    JSON.stringify(statusAudit.map((a) => ({ t: a.actorType, f: a.after }))),
  );

  // A refused status change must not have written anything.
  const refusedStatusAudit = await prisma.adminAuditLog.count({
    where: { targetType: "USER", targetId: u.victim2.id, reason: "B5 must be refused" },
  });
  check(
    "B5 status audit: no audit row was written for any refused status action",
    refusedStatusAudit === 0,
    `rows=${refusedStatusAudit}`,
  );

  // --- GET must never write -------------------------------------------------
  const auditBeforeReads = await prisma.adminAuditLog.count();
  await call(`/admin/reports/${report.id}`, { token: t.superadmin });
  await call("/admin/reports?page=1&pageSize=1", { token: t.superadmin });
  const auditAfterReads = await prisma.adminAuditLog.count();
  check(
    "B5: reading the queue and the detail writes no audit row",
    auditBeforeReads === auditAfterReads,
    `before=${auditBeforeReads} after=${auditAfterReads}`,
  );

  // ------------------------- 10d. Phase C1: risk overview vs real PostgreSQL
  //
  // The Risk Center's whole claim is that **every number on it is a count of a
  // stored fact**. That is only meaningful if the API's numbers are checked
  // against something independently derived — comparing the endpoint to itself
  // would pass no matter how wrong both sides are. So each KPI is compared
  // against a count computed here, directly in PostgreSQL, through Prisma's own
  // query builder (a different code path from `AdminService`, which is the
  // point).
  //
  // Phase C adds exactly one endpoint and it is a GET. Nothing below writes an
  // audit row, and the read-only property is asserted explicitly at the end.
  //
  // Ordering note: this block runs after section 6 disabled and re-enabled the
  // moderator, and after section 10 changed several user statuses — so the
  // status counts are read live, immediately before the HTTP call, rather than
  // from a snapshot taken earlier.
  const riskRes = await call("/admin/risk", { token: t.superadmin });
  check(
    "C1 risk: SUPER_ADMIN receives the four-part payload (risk:read)",
    riskRes.status === 200 &&
      typeof riskRes.json?.data?.overview === "object" &&
      Array.isArray(riskRes.json?.data?.recentReports) &&
      Array.isArray(riskRes.json?.data?.recentActions) &&
      Array.isArray(riskRes.json?.data?.suspiciousSignals),
    `status=${riskRes.status}${riskRes.code ? `/${riskRes.code}` : ""}`,
  );

  const riskOverview = riskRes.json?.data?.overview ?? {};

  // --- every KPI equals an independent SQL count ---------------------------
  // Counted in the same shape the service uses, but issued separately. Where a
  // stored status exists it is counted by status; where nothing exists it must
  // be 0 rather than absent.
  const [
    sqlTotalReports,
    sqlOpen,
    sqlReviewing,
    sqlResolved,
    sqlRejected,
    sqlSuspended,
    sqlBanned,
    sqlDisabled,
    sqlActive,
    sqlSelfReports,
  ] = await Promise.all([
    prisma.report.count(),
    prisma.report.count({ where: { status: "OPEN" } }),
    prisma.report.count({ where: { status: "REVIEWING" } }),
    prisma.report.count({ where: { status: "RESOLVED" } }),
    prisma.report.count({ where: { status: "REJECTED" } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.user.count({ where: { status: "BANNED" } }),
    prisma.user.count({ where: { status: "DISABLED" } }),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.report.count({ where: { reporterId: { equals: prisma.report.fields.reportedUserId } } }),
  ]);

  const kpiPairs = [
    ["totalReports", sqlTotalReports],
    ["openReports", sqlOpen],
    ["reviewingReports", sqlReviewing],
    ["resolvedReports", sqlResolved],
    ["rejectedReports", sqlRejected],
    ["suspendedUsers", sqlSuspended],
    ["bannedUsers", sqlBanned],
    ["disabledUsers", sqlDisabled],
    ["activeUsers", sqlActive],
    ["suspiciousSelfReports", sqlSelfReports],
  ];
  for (const [key, sql] of kpiPairs) {
    check(
      `C1 risk KPI: ${key} equals the SQL count (api=${riskOverview[key]} sql=${sql})`,
      riskOverview[key] === sql,
      `api=${riskOverview[key]} sql=${sql}`,
    );
  }

  // The report statuses must partition the report table exactly. A KPI set that
  // disagrees with its own total means one of the buckets is filtering on
  // something other than `status`.
  check(
    "C1 risk KPI: the four report statuses partition the report table",
    sqlOpen + sqlReviewing + sqlResolved + sqlRejected === sqlTotalReports,
    `open=${sqlOpen} reviewing=${sqlReviewing} resolved=${sqlResolved} rejected=${sqlRejected} total=${sqlTotalReports}`,
  );

  // --- no fabricated severity anywhere in the payload ----------------------
  // There is no `riskLevel` column and no scoring algorithm in this codebase,
  // so any of these keys would be an invented value presented as fact.
  const riskBody = JSON.stringify(riskRes.json);
  for (const invented of ["riskLevel", "riskScore", "riskTier", "HIGH_RISK"]) {
    check(
      `C1 risk: the payload invents no severity (${invented})`,
      !riskBody.includes(invented),
      `payload contains ${invented}`,
    );
  }
  check(
    "C1 risk: the overview exposes exactly the ten documented KPIs",
    JSON.stringify(Object.keys(riskOverview).sort()) ===
      JSON.stringify(
        [
          "totalReports",
          "openReports",
          "reviewingReports",
          "resolvedReports",
          "rejectedReports",
          "suspendedUsers",
          "bannedUsers",
          "disabledUsers",
          "activeUsers",
          "suspiciousSelfReports",
        ].sort(),
      ),
    `keys=${Object.keys(riskOverview).join(",")}`,
  );

  // --- the recent reports feed is real, ordered and bounded ----------------
  const sqlRecentReports = await prisma.report.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true },
  });
  check(
    "C1 risk feed: recentReports is the newest ten, createdAt DESC",
    JSON.stringify(riskRes.json?.data?.recentReports?.map((r) => r.id)) ===
      JSON.stringify(sqlRecentReports.map((r) => r.id)),
    `api=${riskRes.json?.data?.recentReports?.length} sql=${sqlRecentReports.length}`,
  );
  check(
    "C1 risk feed: recentReports is capped at 10",
    (riskRes.json?.data?.recentReports?.length ?? 99) <= 10,
    `len=${riskRes.json?.data?.recentReports?.length}`,
  );

  // --- suspiciousSignals is exactly the self-report set --------------------
  // Phase C1's spec forbids repairing `SafetyService.recordAutoFlag`, so this
  // signal is reported as-is. To prove the filter is a real comparison rather
  // than a coincidence on the current data, a self-report fixture is created
  // here and removed again below.
  const selfReportFixture = await prisma.report.create({
    data: {
      reporterId: u.victim2.id,
      reportedUserId: u.victim2.id,
      reason: "SPAM",
      description: "phase C1 live verification — self report",
      status: "OPEN",
    },
    select: { id: true },
  });

  const riskSelf = await call("/admin/risk", { token: t.superadmin });
  const selfSignals = riskSelf.json?.data?.suspiciousSignals ?? [];
  const sqlSelfCount = await prisma.report.count({
    where: { reporterId: { equals: prisma.report.fields.reportedUserId } },
  });
  check(
    "C1 risk signal: the self-report fixture is counted as suspiciousSelfReports",
    riskSelf.json?.data?.overview?.suspiciousSelfReports === sqlSelfCount && sqlSelfCount >= 1,
    `api=${riskSelf.json?.data?.overview?.suspiciousSelfReports} sql=${sqlSelfCount}`,
  );
  check(
    "C1 risk signal: the fixture appears in suspiciousSignals",
    selfSignals.some((r) => r.id === selfReportFixture.id),
    `ids=${selfSignals.map((r) => r.id).join(",")}`,
  );
  check(
    "C1 risk signal: every suspiciousSignal really has reporter === reportedUser",
    selfSignals.length > 0 && selfSignals.every((r) => r.reporter?.id === r.reportedUser?.id),
    `n=${selfSignals.length} mismatched=${selfSignals.filter((r) => r.reporter?.id !== r.reportedUser?.id).length}`,
  );
  // The ordinary report this script created up front has two different parties
  // and must never be presented as a self-report signal.
  check(
    "C1 risk signal: an ordinary two-party report is not a suspicious signal",
    !selfSignals.some((r) => r.id === report.id),
    `contains ordinary report=${selfSignals.some((r) => r.id === report.id)}`,
  );

  // The fixture is removed immediately, so nothing downstream can observe it
  // and a crash between here and cleanup would leave at most this one row.
  await prisma.report.deleteMany({ where: { id: selfReportFixture.id } });
  const afterFixtureCleanup = await prisma.report.count({
    where: { description: "phase C1 live verification — self report" },
  });
  check(
    "C1 risk signal: the self-report fixture was removed again",
    afterFixtureCleanup === 0,
    `rows=${afterFixtureCleanup}`,
  );

  // --- recent actions come from the real audit vocabulary ------------------
  const sqlRecentActions = await prisma.adminAuditLog.findMany({
    where: {
      action: {
        in: [
          "ADMIN_USER_ACTIVATE",
          "ADMIN_USER_DISABLE",
          "ADMIN_USER_BAN",
          "ADMIN_USER_SUSPEND",
          "ADMIN_USER_UNBAN",
          "REPORT_REVIEWING",
          "REPORT_RESOLVED",
          "REPORT_REJECTED",
          "SYSTEM_USER_SUSPENSION_EXPIRED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true },
  });
  check(
    "C1 risk feed: recentActions matches the risk-relevant audit vocabulary",
    JSON.stringify(riskRes.json?.data?.recentActions?.map((a) => a.id)) ===
      JSON.stringify(sqlRecentActions.map((a) => a.id)),
    `api=${riskRes.json?.data?.recentActions?.length} sql=${sqlRecentActions.length}`,
  );
  // A note is a real admin action but not a risk-relevant one; the feed must
  // filter it out rather than showing everything the log contains.
  const noteRow = await prisma.adminAuditLog.findFirst({
    where: { action: "ADMIN_USER_NOTE" },
    select: { id: true },
  });
  if (noteRow) {
    check(
      "C1 risk feed: an ADMIN_USER_NOTE row is excluded from recentActions",
      !(riskRes.json?.data?.recentActions ?? []).some((a) => a.id === noteRow.id),
      `note row present=${(riskRes.json?.data?.recentActions ?? []).some((a) => a.id === noteRow.id)}`,
    );
  }

  // --- actor consistency: SYSTEM rows carry no administrator ---------------
  const systemActions = (riskRes.json?.data?.recentActions ?? []).filter(
    (a) => a.actorType === "SYSTEM",
  );
  check(
    "C1 risk feed: every SYSTEM action has actorType=SYSTEM and adminId=null",
    systemActions.every((a) => a.actorType === "SYSTEM" && a.adminId === null),
    `system rows=${systemActions.length} with adminId=${systemActions.filter((a) => a.adminId !== null).length}`,
  );
  const userActions = (riskRes.json?.data?.recentActions ?? []).filter(
    (a) => a.actorType === "USER",
  );
  check(
    "C1 risk feed: every USER action carries a real administrator id",
    userActions.every((a) => a.actorType === "USER" && typeof a.adminId === "string"),
    `user rows=${userActions.length} without adminId=${userActions.filter((a) => typeof a.adminId !== "string").length}`,
  );

  // --- privacy: no secret and no network metadata leaves the API -----------
  // Asserted on the raw JSON, not on a field list, so a nested leak fails too.
  for (const secret of [
    "passwordHash",
    "tokenHash",
    "refreshToken",
    "accessToken",
    "secret",
    '"ip"',
    "userAgent",
  ]) {
    check(
      `C1 risk privacy: the payload never exposes ${secret}`,
      !riskBody.includes(secret),
      `payload contains ${secret}`,
    );
  }

  // --- RBAC: the real matrix, not a guess ----------------------------------
  // `risk:read` is held by SUPER_ADMIN, MODERATOR and ANALYST. SUPPORT and
  // CONTENT_MANAGER do not hold it and must be refused by the API itself — not
  // merely hidden in the UI.
  for (const [role, roleToken] of [
    ["SUPER_ADMIN", t.superadmin],
    ["MODERATOR", moderatorToken],
    ["ANALYST", t.analyst],
  ]) {
    const r = await call("/admin/risk", { token: roleToken });
    check(
      `C1 risk RBAC: ${role} can read /admin/risk (risk:read)`,
      r.status === 200,
      `status=${r.status}${r.code ? `/${r.code}` : ""}`,
    );
  }
  for (const [role, roleToken] of [
    ["SUPPORT", t.support],
    ["CONTENT_MANAGER", t.contentmgr],
  ]) {
    const r = await call("/admin/risk", { token: roleToken });
    check(
      `C1 risk RBAC: ${role} is refused with PERMISSION_DENIED`,
      r.status === 403 && r.code === "PERMISSION_DENIED",
      `status=${r.status}${r.code ? `/${r.code}` : ""}`,
    );
  }
  // Unauthenticated access is a different failure from an unauthorized one.
  const anonRisk = await call("/admin/risk");
  check(
    "C1 risk RBAC: an anonymous caller is rejected with UNAUTHORIZED",
    anonRisk.status === 401 && anonRisk.code === "UNAUTHORIZED",
    `status=${anonRisk.status}${anonRisk.code ? `/${anonRisk.code}` : ""}`,
  );
  // A DISABLED account is refused by the identity layer, before permissions are
  // consulted. The status is 401 with a *domain* code — the request is rejected
  // while resolving the principal (`JwtStrategy.validate` throws
  // `UnauthorizedException`), so it never reaches `PermissionGuard`. Asserting
  // 403 here would be wrong: 403 would mean an identified caller lacked a
  // permission, which is a different fact about a different layer.
  const disabledRisk = await call("/admin/risk", { token: t.disabled });
  check(
    "C1 risk RBAC: a DISABLED admin is rejected as USER_DISABLED before permissions",
    disabledRisk.status === 401 && disabledRisk.code === "USER_DISABLED",
    `status=${disabledRisk.status}${disabledRisk.code ? `/${disabledRisk.code}` : ""}`,
  );

  // --- the phase adds exactly one endpoint, and it is read-only -----------
  for (const missing of [
    "/admin/risk/00000000-0000-4000-8000-000000000000",
    "/admin/risk/events",
    "/admin/risk/actions",
    "/admin/risk/score",
  ]) {
    const r = await call(missing, { token: t.superadmin });
    check(
      `C1 risk scope: ${missing} does not exist`,
      r.status === 404,
      `status=${r.status}`,
    );
  }
  // A write to the single risk route must not be routed to a handler.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await call("/admin/risk", { method, token: t.superadmin });
    check(
      `C1 risk scope: ${method} /admin/risk is not a route`,
      r.status === 404,
      `status=${r.status}`,
    );
  }

  // --- reading the Risk Center writes no audit row -------------------------
  const auditBeforeRiskReads = await prisma.adminAuditLog.count();
  await call("/admin/risk", { token: t.superadmin });
  await call("/admin/risk", { token: t.superadmin });
  const auditAfterRiskReads = await prisma.adminAuditLog.count();
  check(
    "C1 risk: reading /admin/risk writes no audit row (GET-only)",
    auditBeforeRiskReads === auditAfterRiskReads,
    `before=${auditBeforeRiskReads} after=${auditAfterRiskReads}`,
  );

  // ------------------- 10e. Phase C2: connections list/detail vs real SQL
  //
  // The connections console claims to show stored `Connection` rows and nothing
  // else. Two things make that claim testable:
  //
  //   1. Every filter is compared against a count computed here, in PostgreSQL,
  //      through a *separate* query path (Prisma's query builder rather than
  //      `AdminService`). Comparing the endpoint to itself would pass however
  //      wrong both sides were.
  //   2. The `user` filter is the one that is easy to get subtly wrong. A
  //      `Connection` has no owner column: it is `userAId` + `userBId`, and
  //      which participant lands in which column depends on the UUID sort the
  //      normal-user service performs at creation. So "connections involving
  //      Bob" must match `userAId` **or** `userBId` — a filter that inspected
  //      only `userAId` would still return plausible-looking rows and would
  //      pass a single-sided fixture.
  //
  // The database is verified to hold **zero** connections before this block, so
  // every row the API returns here is one of the two created below.
  //
  // Read-only phase: both routes are GET, and the absence of audit writes is
  // asserted explicitly at the end.
  const connectionsBefore = await prisma.connection.count();
  check(
    "C2 connections: the database starts with zero connections (honest empty state)",
    connectionsBefore === 0,
    `count=${connectionsBefore}`,
  );

  const c2User = (key, nickname) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "ACTIVE",
        nickname,
        countryCode: "US",
      },
      select: { id: true, email: true },
    });

  const c2Alice = await c2User("c2alice", "PA C2 Alice");
  const c2Bob = await c2User("c2bob", "PA C2 Bob");
  const c2Carol = await c2User("c2carol", "PA C2 Carol");
  const c2Ids = [c2Alice.id, c2Bob.id, c2Carol.id];
  ids.push(...c2Ids);

  // Bob sits on **both** sides: `userB` of the ACTIVE row and `userA` of the
  // REMOVED one. That is what makes the either-side assertions non-vacuous.
  const c2Active = await prisma.connection.create({
    data: {
      userAId: c2Alice.id,
      userBId: c2Bob.id,
      status: "ACTIVE",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
  const c2Removed = await prisma.connection.create({
    data: {
      userAId: c2Bob.id,
      userBId: c2Carol.id,
      status: "REMOVED",
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
    },
    select: { id: true },
  });

  // --- RBAC: the real matrix, not a guess ---------------------------------
  // `connections:read` is held by SUPER_ADMIN and ANALYST only. A MODERATOR
  // holds `moderation:read` and must not gain connection access by virtue of
  // it — those are different jobs.
  const c2ListSuper = await expectStatus(
    "C2 connections RBAC: SUPER_ADMIN may read the list",
    "/admin/connections",
    { token: t.superadmin },
    200,
  );
  await expectStatus(
    "C2 connections RBAC: ANALYST may read the list",
    "/admin/connections",
    { token: t.analyst },
    200,
  );
  await expectCode(
    "C2 connections RBAC: MODERATOR is refused (moderation is not connections)",
    "/admin/connections",
    { token: t.moderator },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C2 connections RBAC: SUPPORT is refused",
    "/admin/connections",
    { token: t.support },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C2 connections RBAC: CONTENT_MANAGER is refused",
    "/admin/connections",
    { token: t.contentmgr },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C2 connections RBAC: anonymous is rejected before any role check",
    "/admin/connections",
    {},
    401,
    "UNAUTHORIZED",
  );
  await expectCode(
    "C2 connections RBAC: the detail route carries the same gate (MODERATOR refused)",
    `/admin/connections/${c2Active.id}`,
    { token: t.moderator },
    403,
    "PERMISSION_DENIED",
  );

  // --- the unfiltered total equals an independent SQL count ----------------
  const sqlAllConns = await prisma.connection.count();
  check(
    "C2 connections: unfiltered total equals the SQL count",
    c2ListSuper.json?.data?.total === sqlAllConns,
    `api=${c2ListSuper.json?.data?.total} sql=${sqlAllConns}`,
  );
  check(
    "C2 connections: the list sees both fixture rows (ACTIVE and REMOVED)",
    sqlAllConns === 2,
    `sql=${sqlAllConns}`,
  );

  // --- status filter: REMOVED is a visible stored state, not a hidden one ---
  const c2ActiveOnly = await call("/admin/connections?status=ACTIVE", { token: t.superadmin });
  const sqlActiveConns = await prisma.connection.count({ where: { status: "ACTIVE" } });
  check(
    "C2 connections: status=ACTIVE equals the SQL count",
    c2ActiveOnly.json?.data?.total === sqlActiveConns && sqlActiveConns === 1,
    `api=${c2ActiveOnly.json?.data?.total} sql=${sqlActiveConns}`,
  );

  const c2RemovedOnly = await call("/admin/connections?status=REMOVED", { token: t.superadmin });
  const sqlRemovedConns = await prisma.connection.count({ where: { status: "REMOVED" } });
  check(
    "C2 connections: status=REMOVED equals the SQL count (removed rows stay visible)",
    c2RemovedOnly.json?.data?.total === sqlRemovedConns && sqlRemovedConns === 1,
    `api=${c2RemovedOnly.json?.data?.total} sql=${sqlRemovedConns}`,
  );

  check(
    "C2 connections: the two statuses partition the connection table",
    sqlActiveConns + sqlRemovedConns === sqlAllConns,
    `active=${sqlActiveConns} removed=${sqlRemovedConns} total=${sqlAllConns}`,
  );

  // An unknown status is ignored (the existing Admin policy), so it must behave
  // exactly like no filter at all rather than inventing a third bucket.
  const c2BogusStatus = await call("/admin/connections?status=DELETED", { token: t.superadmin });
  check(
    "C2 connections: an unknown status is ignored, not invented as a filter",
    c2BogusStatus.json?.data?.total === sqlAllConns,
    `api=${c2BogusStatus.json?.data?.total} sql=${sqlAllConns}`,
  );

  // --- the user filter is "either side", which is the whole point ----------
  const c2BobUuid = await call(`/admin/connections?user=${c2Bob.id}`, { token: t.superadmin });
  const sqlBobUuid = await prisma.connection.count({
    where: { OR: [{ userAId: c2Bob.id }, { userBId: c2Bob.id }] },
  });
  check(
    "C2 connections: user=<uuid> matches userA OR userB (independent SQL)",
    c2BobUuid.json?.data?.total === sqlBobUuid && sqlBobUuid === 2,
    `api=${c2BobUuid.json?.data?.total} sql=${sqlBobUuid}`,
  );

  const c2AliceUuid = await call(`/admin/connections?user=${c2Alice.id}`, { token: t.superadmin });
  check(
    "C2 connections: user=<uuid> for a one-sided participant returns exactly one row",
    c2AliceUuid.json?.data?.total === 1,
    `total=${c2AliceUuid.json?.data?.total}`,
  );

  const c2BobName = await call("/admin/connections?user=Bob", { token: t.superadmin });
  const sqlBobName = await prisma.connection.count({
    where: {
      OR: [
        { userA: { nickname: { contains: "Bob", mode: "insensitive" } } },
        { userB: { nickname: { contains: "Bob", mode: "insensitive" } } },
      ],
    },
  });
  check(
    "C2 connections: user=<nickname> matches either participant's nickname (independent SQL)",
    c2BobName.json?.data?.total === sqlBobName && sqlBobName === 2,
    `api=${c2BobName.json?.data?.total} sql=${sqlBobName}`,
  );

  const c2AliceName = await call("/admin/connections?user=Alice", { token: t.superadmin });
  check(
    "C2 connections: a nickname held by one participant returns only their row",
    c2AliceName.json?.data?.total === 1,
    `total=${c2AliceName.json?.data?.total}`,
  );

  const c2Nobody = await call(`/admin/connections?user=${MISSING_USER_ID}`, { token: t.superadmin });
  check(
    "C2 connections: a user with no connections yields an empty page, not an error",
    c2Nobody.status === 200 && c2Nobody.json?.data?.total === 0 && c2Nobody.json?.data?.totalPages === 0,
    `status=${c2Nobody.status} total=${c2Nobody.json?.data?.total} totalPages=${c2Nobody.json?.data?.totalPages}`,
  );

  // --- date range, compared against the stored timestamps ------------------
  const c2From = "2026-03-02T00:00:00.000Z";
  const c2To = "2026-03-02T23:59:59.999Z";
  const c2Range = await call(
    `/admin/connections?createdFrom=${encodeURIComponent(c2From)}&createdTo=${encodeURIComponent(c2To)}`,
    { token: t.superadmin },
  );
  const sqlC2Range = await prisma.connection.count({
    where: { createdAt: { gte: new Date(c2From), lte: new Date(c2To) } },
  });
  check(
    "C2 connections: createdFrom/createdTo equal the SQL range count",
    c2Range.json?.data?.total === sqlC2Range && sqlC2Range === 1,
    `api=${c2Range.json?.data?.total} sql=${sqlC2Range}`,
  );

  const c2BadDate = await call("/admin/connections?createdFrom=not-a-date", { token: t.superadmin });
  check(
    "C2 connections: a malformed createdFrom is a 400 VALIDATION_ERROR",
    c2BadDate.status === 400 && c2BadDate.code === "VALIDATION_ERROR",
    `status=${c2BadDate.status} code=${c2BadDate.code}`,
  );

  // `new Date("2026-02-30")` does not fail — it silently rolls over to 2 March,
  // so a shape-only check would accept it and filter on the wrong day.
  const c2RolledDate = await call("/admin/connections?createdTo=2026-02-30", { token: t.superadmin });
  check(
    "C2 connections: a non-existent date (2026-02-30) is rejected, not rolled over",
    c2RolledDate.status === 400 && c2RolledDate.code === "VALIDATION_ERROR",
    `status=${c2RolledDate.status} code=${c2RolledDate.code}`,
  );

  const c2BadSort = await call("/admin/connections?sort=userAId_asc", { token: t.superadmin });
  check(
    "C2 connections: an unknown sort is a 400, never handed to Prisma",
    c2BadSort.status === 400 && c2BadSort.code === "VALIDATION_ERROR",
    `status=${c2BadSort.status} code=${c2BadSort.code}`,
  );

  // --- pagination ---------------------------------------------------------
  const c2Page1 = await call("/admin/connections?page=1&pageSize=1", { token: t.superadmin });
  const c2Page2 = await call("/admin/connections?page=2&pageSize=1", { token: t.superadmin });
  check(
    "C2 connections: pages are disjoint and each holds pageSize rows",
    c2Page1.json?.data?.items?.length === 1 &&
      c2Page2.json?.data?.items?.length === 1 &&
      c2Page1.json?.data?.items?.[0]?.id !== c2Page2.json?.data?.items?.[0]?.id,
    `p1=${c2Page1.json?.data?.items?.[0]?.id} p2=${c2Page2.json?.data?.items?.[0]?.id}`,
  );
  check(
    "C2 connections: totalPages is the ceiling of total/pageSize",
    c2Page1.json?.data?.totalPages === Math.ceil(sqlAllConns / 1) &&
      c2Page1.json?.data?.total === sqlAllConns,
    `totalPages=${c2Page1.json?.data?.totalPages} total=${c2Page1.json?.data?.total}`,
  );

  const c2Beyond = await call("/admin/connections?page=9999&pageSize=10", { token: t.superadmin });
  check(
    "C2 connections: a page past the end is an empty page, not an error and not a changed total",
    c2Beyond.status === 200 &&
      c2Beyond.json?.data?.items?.length === 0 &&
      c2Beyond.json?.data?.total === sqlAllConns &&
      c2Beyond.json?.data?.totalPages === Math.ceil(sqlAllConns / 10),
    `status=${c2Beyond.status} items=${c2Beyond.json?.data?.items?.length} total=${c2Beyond.json?.data?.total}`,
  );

  const c2DefaultOrder = await call("/admin/connections?pageSize=10", { token: t.superadmin });
  check(
    "C2 connections: the default order is newest first",
    c2DefaultOrder.json?.data?.items?.[0]?.id === c2Removed.id &&
      c2DefaultOrder.json?.data?.items?.[1]?.id === c2Active.id,
    `first=${c2DefaultOrder.json?.data?.items?.[0]?.id}`,
  );

  // --- detail -------------------------------------------------------------
  const c2DetailActive = await call(`/admin/connections/${c2Active.id}`, { token: t.superadmin });
  check(
    "C2 connections: the ACTIVE detail returns both participants and the status",
    c2DetailActive.status === 200 &&
      c2DetailActive.json?.data?.connection?.status === "ACTIVE" &&
      c2DetailActive.json?.data?.userA?.id === c2Alice.id &&
      c2DetailActive.json?.data?.userB?.id === c2Bob.id,
    `status=${c2DetailActive.status} conn=${c2DetailActive.json?.data?.connection?.status}`,
  );

  // The A/B columns are database semantics, not display order: the API must
  // report them as stored rather than normalising the pair.
  check(
    "C2 connections: userA/userB are reported as stored, not re-sorted",
    c2DetailActive.json?.data?.userA?.id === c2Alice.id &&
      c2DetailActive.json?.data?.userB?.id === c2Bob.id,
    `A=${c2DetailActive.json?.data?.userA?.id} B=${c2DetailActive.json?.data?.userB?.id}`,
  );

  const c2DetailRemoved = await call(`/admin/connections/${c2Removed.id}`, { token: t.superadmin });
  check(
    "C2 connections: a REMOVED connection is still readable (not a 404, not hidden)",
    c2DetailRemoved.status === 200 && c2DetailRemoved.json?.data?.connection?.status === "REMOVED",
    `status=${c2DetailRemoved.status} conn=${c2DetailRemoved.json?.data?.connection?.status}`,
  );

  check(
    "C2 connections: no conversation reports null rather than an invented id",
    c2DetailActive.json?.data?.connection?.conversationId === null,
    `conversationId=${JSON.stringify(c2DetailActive.json?.data?.connection?.conversationId)}`,
  );

  await expectCode(
    "C2 connections: an unknown connection id is a 404 CONNECTION_NOT_FOUND",
    `/admin/connections/${MISSING_USER_ID}`,
    { token: t.superadmin },
    404,
    "CONNECTION_NOT_FOUND",
  );

  // --- the phase adds no write route --------------------------------------
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const r = await call("/admin/connections", { method, token: t.superadmin, body: {} });
    check(
      `C2 connections: ${method} /admin/connections is not a route`,
      r.status === 404,
      `status=${r.status}`,
    );
  }

  // --- privacy: no secret, no network metadata, no out-of-scope relation ---
  const c2Payload = JSON.stringify(c2ListSuper.json) + JSON.stringify(c2DetailActive.json);
  for (const forbidden of [
    "passwordHash",
    "tokenHash",
    "refreshToken",
    "accessToken",
    "oauth",
    "secret",
    "userAgent",
  ]) {
    check(
      `C2 connections: the payload carries no ${forbidden}`,
      !c2Payload.includes(forbidden),
      `payload contains ${forbidden}`,
    );
  }
  check(
    "C2 connections: the payload carries no client ip field",
    !/"ip"\s*:/.test(c2Payload),
    "payload contains an ip field",
  );

  // The default participant projection is `id` + `nickname`; an operator who
  // needs the address follows the link to `/users/:id`.
  check(
    "C2 connections: the payload does not expose participant email addresses",
    !c2Payload.includes("email") && !c2Payload.includes("@example.test"),
    "payload exposes an email",
  );

  // A connection is not a Contact Exchange (C3) and not a Block (C4), and the
  // payload must not imply either exists.
  for (const outOfScope of ["exchange", "Exchange", "sharedSocial", "handle", "blocked", "blocker"]) {
    check(
      `C2 connections: no out-of-scope relation leaks (${outOfScope})`,
      !c2Payload.includes(outOfScope),
      `payload contains ${outOfScope}`,
    );
  }
  check(
    "C2 connections: no `updatedAt` is invented (the column does not exist)",
    !c2Payload.includes("updatedAt"),
    "payload contains updatedAt",
  );

  // --- audit: reads stay reads --------------------------------------------
  const auditBeforeC2Reads = await prisma.adminAuditLog.count();
  await call("/admin/connections", { token: t.superadmin });
  await call(`/admin/connections/${c2Active.id}`, { token: t.superadmin });
  const auditAfterC2Reads = await prisma.adminAuditLog.count();
  check(
    "C2 connections: reading the list and the detail writes no audit row (GET-only)",
    auditBeforeC2Reads === auditAfterC2Reads,
    `before=${auditBeforeC2Reads} after=${auditAfterC2Reads}`,
  );

  // The detail's history block is queried rather than hardcoded, and its honest
  // answer today is empty: nothing in the codebase writes a CONNECTION audit.
  const connectionAuditRows = await prisma.adminAuditLog.count({
    where: { targetType: "CONNECTION" },
  });
  check(
    "C2 connections: the detail history is honestly empty (no CONNECTION audit rows exist)",
    connectionAuditRows === 0 &&
      Array.isArray(c2DetailActive.json?.data?.history) &&
      c2DetailActive.json.data.history.length === 0,
    `rows=${connectionAuditRows} history=${c2DetailActive.json?.data?.history?.length}`,
  );

  // ------------------- 10f. Phase C3: contact exchanges list/detail vs real SQL
  //
  // The exchanges console claims to show stored `ExchangeRequest` rows, their
  // two parties, and the `SharedSocialAccount` relations granted under them —
  // and to never show the social account itself. Three things make that testable
  // against the real database rather than against the API's own opinion:
  //
  //   1. Every filter is compared against a count computed here, in PostgreSQL,
  //      through a *separate* query path.
  //   2. `platforms` is a `SocialPlatform[]`, so the platform filter is
  //      "array contains". The SQL side uses `$1 = ANY("platforms"::text[])`,
  //      which is the same predicate expressed independently — and the fixture
  //      deliberately puts one of the two platforms in the *second* slot, so an
  //      equality filter would return nothing and be caught.
  //   3. The share direction is verified one-to-one against
  //      `SharedSocialAccount`. The fixture contains a share in each direction,
  //      so an implementation that normalised or reversed the pair cannot pass.
  //
  // The database is verified to hold **zero** exchanges before this block, so
  // every row the API returns here is one of the two created below.
  //
  // Read-only phase: both routes are GET, and the absence of audit writes is
  // asserted explicitly at the end.
  const exchangesBefore = await prisma.exchangeRequest.count();
  const sharesBefore = await prisma.sharedSocialAccount.count();
  const socialAccountsBefore = await prisma.socialAccount.count();
  check(
    "C3 exchanges: the database starts with zero exchanges and zero shares",
    exchangesBefore === 0 && sharesBefore === 0,
    `exchanges=${exchangesBefore} shares=${sharesBefore}`,
  );

  const c3User = (key, nickname) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "ACTIVE",
        nickname,
        countryCode: "US",
      },
      select: { id: true, email: true },
    });

  const c3Alice = await c3User("c3alice", "PA C3 Alice");
  const c3Bob = await c3User("c3bob", "PA C3 Bob");
  const c3Carol = await c3User("c3carol", "PA C3 Carol");
  const c3Ids = [c3Alice.id, c3Bob.id, c3Carol.id];
  ids.push(...c3Ids);

  // The handles are recognisable literals on purpose: a leak must be provable by
  // searching the raw response for a string that cannot occur by accident.
  const C3_SECRET_HANDLE_ALICE = "PW_EXCHANGE_SECRET_HANDLE_phasea_alice_tg";
  const C3_SECRET_HANDLE_BOB = "PW_EXCHANGE_SECRET_HANDLE_phasea_bob_wa";
  const C3_PRIVATE_CHAT_BODY = "PA_C3_PRIVATE_CHAT_BODY_MUST_NOT_BE_RETURNED";

  // `conversationId` is a required column with a real FK, so a real conversation
  // has to exist. A real `Message` is written into it so "the chat was never
  // loaded" is a provable claim rather than an absence of evidence.
  const c3Conversation = await prisma.conversation.create({
    data: {},
    select: { id: true },
  });
  await prisma.message.create({
    data: {
      conversationId: c3Conversation.id,
      senderId: c3Alice.id,
      content: C3_PRIVATE_CHAT_BODY,
      type: "TEXT",
    },
  });

  const c3Connection = await prisma.connection.create({
    data: {
      userAId: [c3Alice.id, c3Bob.id].sort()[0],
      userBId: [c3Alice.id, c3Bob.id].sort()[1],
      status: "ACTIVE",
      conversationId: c3Conversation.id,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
    },
    select: { id: true },
  });

  const c3AliceTelegram = await prisma.socialAccount.create({
    data: {
      userId: c3Alice.id,
      platform: "TELEGRAM",
      handle: C3_SECRET_HANDLE_ALICE,
      syncEnabled: true,
    },
    select: { id: true },
  });
  const c3BobWhatsapp = await prisma.socialAccount.create({
    data: {
      userId: c3Bob.id,
      platform: "WHATSAPP",
      handle: C3_SECRET_HANDLE_BOB,
      syncEnabled: false,
    },
    select: { id: true },
  });

  // A well-formed UUID that is not in the database. `connectionId` has no
  // foreign key, so this is legal stored data and the detail screen must report
  // it rather than fail.
  const C3_DANGLING_CONNECTION_ID = "deadbeef-0000-4000-8000-00000000c3c3";

  // Alice is the *requester* of one row and the *receiver* of the other, so a
  // single-sided user filter returns 1 instead of 2 and is caught.
  const c3Accepted = await prisma.exchangeRequest.create({
    data: {
      connectionId: c3Connection.id,
      conversationId: c3Conversation.id,
      requesterId: c3Alice.id,
      receiverId: c3Bob.id,
      platforms: ["TELEGRAM"],
      message: "Let's swap Telegram",
      status: "ACCEPTED",
      createdAt: new Date("2026-03-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
  const c3Pending = await prisma.exchangeRequest.create({
    data: {
      connectionId: C3_DANGLING_CONNECTION_ID,
      conversationId: c3Conversation.id,
      requesterId: c3Bob.id,
      receiverId: c3Alice.id,
      // Two platforms, with DISCORD in the second slot.
      platforms: ["WHATSAPP", "DISCORD"],
      message: null,
      status: "PENDING",
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
    },
    select: { id: true },
  });

  await prisma.sharedSocialAccount.createMany({
    data: [
      {
        ownerId: c3Alice.id,
        viewerId: c3Bob.id,
        platform: "TELEGRAM",
        socialAccountId: c3AliceTelegram.id,
        exchangeId: c3Accepted.id,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        ownerId: c3Bob.id,
        viewerId: c3Alice.id,
        platform: "WHATSAPP",
        socialAccountId: c3BobWhatsapp.id,
        exchangeId: c3Accepted.id,
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
      },
    ],
  });

  // --- RBAC: the real matrix, not a guess ---------------------------------
  // `exchanges:read` is held by SUPER_ADMIN and ANALYST only — the same holder
  // set as `connections:read`. A MODERATOR holds `moderation:read` and must not
  // gain exchange access by virtue of it.
  const c3ListSuper = await expectStatus(
    "C3 exchanges RBAC: SUPER_ADMIN may read the list",
    "/admin/exchanges",
    { token: t.superadmin },
    200,
  );
  await expectStatus(
    "C3 exchanges RBAC: ANALYST may read the list",
    "/admin/exchanges",
    { token: t.analyst },
    200,
  );
  await expectCode(
    "C3 exchanges RBAC: MODERATOR is refused (moderation is not exchanges)",
    "/admin/exchanges",
    { token: t.moderator },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C3 exchanges RBAC: SUPPORT is refused",
    "/admin/exchanges",
    { token: t.support },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C3 exchanges RBAC: CONTENT_MANAGER is refused",
    "/admin/exchanges",
    { token: t.contentmgr },
    403,
    "PERMISSION_DENIED",
  );
  await expectCode(
    "C3 exchanges RBAC: anonymous is rejected before any role check",
    "/admin/exchanges",
    {},
    401,
    "UNAUTHORIZED",
  );
  await expectCode(
    "C3 exchanges RBAC: the detail route carries the same gate (MODERATOR refused)",
    `/admin/exchanges/${c3Accepted.id}`,
    { token: t.moderator },
    403,
    "PERMISSION_DENIED",
  );

  // --- independent SQL helpers, one per filter shape -----------------------
  // `ExchangeRequest.createdAt` is `timestamp without time zone`, exactly like
  // `User.createdAt` — so the same naive-UTC binding rule applies, and the same
  // helper from the B2 section is reused rather than re-derived. Binding a JS
  // `Date` here would make PostgreSQL treat it as `timestamptz` and shift it by
  // the session offset, comparing instants eight hours apart.

  const countExchangeSql = async (where = "TRUE", params = []) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "ExchangeRequest" WHERE ${where}`,
      ...params,
    );
    return Number(rows[0].n);
  };

  /** Array-contains, expressed independently of Prisma's `has`. */
  const countExchangeByPlatform = async (platform) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "ExchangeRequest" WHERE $1 = ANY("platforms"::text[])`,
      platform,
    );
    return Number(rows[0].n);
  };

  /** Either-side nickname match, expressed as a join rather than a relation. */
  const countExchangeByNickname = async (nickname) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "ExchangeRequest" e
         JOIN "User" r ON r.id = e."requesterId"
         JOIN "User" s ON s.id = e."receiverId"
        WHERE r.nickname ILIKE $1 OR s.nickname ILIKE $1`,
      `%${nickname}%`,
    );
    return Number(rows[0].n);
  };

  // --- the unfiltered total equals an independent SQL count ----------------
  const sqlAllExchanges = await countExchangeSql();
  check(
    "C3 exchanges: unfiltered total equals the SQL count",
    c3ListSuper.json?.data?.total === sqlAllExchanges,
    `api=${c3ListSuper.json?.data?.total} sql=${sqlAllExchanges}`,
  );
  check(
    "C3 exchanges: the list sees both fixture rows",
    sqlAllExchanges === 2,
    `sql=${sqlAllExchanges}`,
  );

  // --- status: each of the four real values, plus the ignored case ---------
  for (const status of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"]) {
    const res = await call(`/admin/exchanges?status=${status}`, { token: t.superadmin });
    const sql = await countExchangeSql(`"status" = $1::"ExchangeStatus"`, [status]);
    check(
      `C3 exchanges: status=${status} equals the SQL count`,
      res.json?.data?.total === sql,
      `api=${res.json?.data?.total} sql=${sql}`,
    );
  }
  const c3AcceptedSql = await countExchangeSql(`"status" = 'ACCEPTED'::"ExchangeStatus"`);
  const c3PendingSql = await countExchangeSql(`"status" = 'PENDING'::"ExchangeStatus"`);
  check(
    "C3 exchanges: the two used statuses partition the table and each is non-zero",
    c3AcceptedSql === 1 && c3PendingSql === 1 && c3AcceptedSql + c3PendingSql === sqlAllExchanges,
    `accepted=${c3AcceptedSql} pending=${c3PendingSql} total=${sqlAllExchanges}`,
  );

  const c3BogusStatus = await call("/admin/exchanges?status=EXPIRED", { token: t.superadmin });
  check(
    "C3 exchanges: an unknown status is ignored, not invented as a filter",
    c3BogusStatus.json?.data?.total === sqlAllExchanges,
    `api=${c3BogusStatus.json?.data?.total} all=${sqlAllExchanges}`,
  );
  check(
    "C3 exchanges: no exchange can reach a state the enum does not have",
    (await countExchangeSql(`"status"::text NOT IN ('PENDING','ACCEPTED','REJECTED','CANCELLED')`)) === 0,
    "every stored status is one of the four",
  );

  // --- platform: array-contains, verified against `= ANY(...)` -------------
  const c3TelegramSql = await countExchangeByPlatform("TELEGRAM");
  const c3Telegram = await call("/admin/exchanges?platform=TELEGRAM", { token: t.superadmin });
  check(
    "C3 exchanges: platform=TELEGRAM equals the SQL array-contains count",
    c3Telegram.json?.data?.total === c3TelegramSql && c3TelegramSql === 1,
    `api=${c3Telegram.json?.data?.total} sql=${c3TelegramSql}`,
  );

  // DISCORD is the *second* element of a two-platform array. An equality filter
  // would return 0 here, so this check is what pins the array semantics.
  const c3DiscordSql = await countExchangeByPlatform("DISCORD");
  const c3Discord = await call("/admin/exchanges?platform=DISCORD", { token: t.superadmin });
  check(
    "C3 exchanges: platform=DISCORD matches a non-first array element (array-contains, not equality)",
    c3Discord.json?.data?.total === c3DiscordSql && c3DiscordSql === 1,
    `api=${c3Discord.json?.data?.total} sql=${c3DiscordSql}`,
  );

  const c3BogusPlatform = await call("/admin/exchanges?platform=MYSPACE", { token: t.superadmin });
  check(
    "C3 exchanges: an unknown platform is ignored, not invented as a filter",
    c3BogusPlatform.json?.data?.total === sqlAllExchanges,
    `api=${c3BogusPlatform.json?.data?.total} all=${sqlAllExchanges}`,
  );

  // Every member of the real enum must be accepted as a filter. Derived from the
  // database's own type, so a hardcoded subset in the service is caught here.
  const c3EnumPlatforms = await prisma.$queryRawUnsafe(
    `SELECT unnest(enum_range(NULL::"SocialPlatform"))::text AS p`,
  );
  const c3EnumNames = c3EnumPlatforms.map((r) => r.p);
  check(
    "C3 exchanges: the real SocialPlatform enum has the twelve expected members",
    c3EnumNames.length === 12,
    `count=${c3EnumNames.length}`,
  );
  let c3PlatformAllAccepted = true;
  for (const platform of c3EnumNames) {
    const res = await call(`/admin/exchanges?platform=${encodeURIComponent(platform)}`, {
      token: t.superadmin,
    });
    const sql = await countExchangeByPlatform(platform);
    if (res.status !== 200 || res.json?.data?.total !== sql) {
      c3PlatformAllAccepted = false;
      break;
    }
  }
  check(
    "C3 exchanges: every real enum member is accepted as a platform filter",
    c3PlatformAllAccepted,
    `enum=${c3EnumNames.join(",")}`,
  );

  // --- user: either side, id and nickname ----------------------------------
  for (const [label, id] of [
    ["Alice (requester of one, receiver of the other)", c3Alice.id],
    ["Bob (the other side in both directions)", c3Bob.id],
  ]) {
    const res = await call(`/admin/exchanges?user=${id}`, { token: t.superadmin });
    const sql = await countExchangeSql(
      `("requesterId" = $1::uuid OR "receiverId" = $1::uuid)`,
      [id],
    );
    check(
      `C3 exchanges: user=<uuid> for ${label} matches either side (independent SQL)`,
      res.json?.data?.total === sql && sql === 2,
      `api=${res.json?.data?.total} sql=${sql}`,
    );
  }

  const c3CarolByUuid = await call(`/admin/exchanges?user=${c3Carol.id}`, { token: t.superadmin });
  check(
    "C3 exchanges: a user who is party to nothing yields an empty page, not an error",
    c3CarolByUuid.status === 200 && c3CarolByUuid.json?.data?.total === 0,
    `status=${c3CarolByUuid.status} total=${c3CarolByUuid.json?.data?.total}`,
  );

  const c3NicknameSql = await countExchangeByNickname("PA C3 Alice");
  const c3Nickname = await call("/admin/exchanges?user=PA%20C3%20Alice", { token: t.superadmin });
  check(
    "C3 exchanges: user=<nickname> matches either party's nickname (independent SQL join)",
    c3Nickname.json?.data?.total === c3NicknameSql && c3NicknameSql === 2,
    `api=${c3Nickname.json?.data?.total} sql=${c3NicknameSql}`,
  );

  const c3CarolNickname = await call("/admin/exchanges?user=PA%20C3%20Carol", {
    token: t.superadmin,
  });
  check(
    "C3 exchanges: a nickname held by nobody returns an empty page",
    c3CarolNickname.json?.data?.total === 0,
    `total=${c3CarolNickname.json?.data?.total}`,
  );

  // --- dates ---------------------------------------------------------------
  const c3From = new Date("2026-03-01T00:00:00.000Z");
  const c3To = new Date("2026-03-01T23:59:59.999Z");
  const c3Range = await call(
    `/admin/exchanges?createdFrom=2026-03-01&createdTo=2026-03-01T23:59:59.999Z`,
    { token: t.superadmin },
  );
  const c3RangeSql = await countExchangeSql(
    `"createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp`,
    [naiveUtc(c3From), naiveUtc(c3To)],
  );
  check(
    "C3 exchanges: createdFrom/createdTo equal the SQL range count",
    c3Range.json?.data?.total === c3RangeSql && c3RangeSql === 1,
    `api=${c3Range.json?.data?.total} sql=${c3RangeSql}`,
  );

  await expectCode(
    "C3 exchanges: a malformed createdFrom is a 400 VALIDATION_ERROR",
    "/admin/exchanges?createdFrom=not-a-date",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );
  await expectCode(
    "C3 exchanges: a non-existent date (2026-02-30) is rejected, not rolled over",
    "/admin/exchanges?createdTo=2026-02-30",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );

  // --- sort and pagination -------------------------------------------------
  await expectCode(
    "C3 exchanges: an unknown sort is a 400, never handed to Prisma",
    "/admin/exchanges?sort=platform_asc",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );

  const c3Page1 = await call("/admin/exchanges?page=1&pageSize=1", { token: t.superadmin });
  const c3Page2 = await call("/admin/exchanges?page=2&pageSize=1", { token: t.superadmin });
  const c3Page1Id = c3Page1.json?.data?.items?.[0]?.id;
  const c3Page2Id = c3Page2.json?.data?.items?.[0]?.id;
  check(
    "C3 exchanges: pages are disjoint and each holds pageSize rows",
    c3Page1.json?.data?.items?.length === 1 &&
      c3Page2.json?.data?.items?.length === 1 &&
      c3Page1Id !== c3Page2Id,
    `p1=${c3Page1Id} p2=${c3Page2Id}`,
  );
  check(
    "C3 exchanges: totalPages is the ceiling of total/pageSize",
    c3Page1.json?.data?.totalPages === Math.ceil(sqlAllExchanges / 1),
    `api=${c3Page1.json?.data?.totalPages} expected=${Math.ceil(sqlAllExchanges / 1)}`,
  );

  const c3PastEnd = await call("/admin/exchanges?page=99&pageSize=20", { token: t.superadmin });
  check(
    "C3 exchanges: a page past the end is an empty page, not an error and not a changed total",
    c3PastEnd.status === 200 &&
      c3PastEnd.json?.data?.items?.length === 0 &&
      c3PastEnd.json?.data?.total === sqlAllExchanges &&
      c3PastEnd.json?.data?.page === 99,
    `status=${c3PastEnd.status} items=${c3PastEnd.json?.data?.items?.length} total=${c3PastEnd.json?.data?.total} page=${c3PastEnd.json?.data?.page}`,
  );

  check(
    "C3 exchanges: the default order is newest first",
    c3ListSuper.json?.data?.items?.[0]?.id === c3Pending.id &&
      c3ListSuper.json?.data?.items?.[1]?.id === c3Accepted.id,
    `first=${c3ListSuper.json?.data?.items?.[0]?.id}`,
  );

  const c3SortAsc = await call("/admin/exchanges?sort=createdAt_asc", { token: t.superadmin });
  check(
    "C3 exchanges: sort=createdAt_asc reverses the default order",
    c3SortAsc.json?.data?.items?.[0]?.id === c3Accepted.id,
    `first=${c3SortAsc.json?.data?.items?.[0]?.id}`,
  );

  // --- detail --------------------------------------------------------------
  const c3DetailAccepted = await call(`/admin/exchanges/${c3Accepted.id}`, {
    token: t.superadmin,
  });
  const c3DetailPending = await call(`/admin/exchanges/${c3Pending.id}`, {
    token: t.superadmin,
  });
  const d3 = c3DetailAccepted.json?.data;

  check(
    "C3 exchanges: the ACCEPTED detail reports its own columns",
    d3?.exchange?.id === c3Accepted.id &&
      d3?.exchange?.connectionId === c3Connection.id &&
      d3?.exchange?.conversationId === c3Conversation.id &&
      d3?.exchange?.status === "ACCEPTED" &&
      d3?.exchange?.message === "Let's swap Telegram",
    `id=${d3?.exchange?.id} status=${d3?.exchange?.status}`,
  );
  check(
    "C3 exchanges: requester and receiver are the named sides, not interchangeable",
    d3?.requester?.id === c3Alice.id && d3?.receiver?.id === c3Bob.id,
    `requester=${d3?.requester?.id} receiver=${d3?.receiver?.id}`,
  );
  check(
    "C3 exchanges: platforms are returned in full, not truncated to the first element",
    Array.isArray(d3?.exchange?.platforms) &&
      d3.exchange.platforms.length === 1 &&
      d3.exchange.platforms[0] === "TELEGRAM" &&
      Array.isArray(c3DetailPending.json?.data?.exchange?.platforms) &&
      c3DetailPending.json.data.exchange.platforms.join(",") === "WHATSAPP,DISCORD",
    `accepted=${JSON.stringify(d3?.exchange?.platforms)} pending=${JSON.stringify(c3DetailPending.json?.data?.exchange?.platforms)}`,
  );
  check(
    "C3 exchanges: a null message is reported as null, not as an empty string",
    c3DetailPending.json?.data?.exchange?.message === null,
    `message=${JSON.stringify(c3DetailPending.json?.data?.exchange?.message)}`,
  );

  // --- SharedSocialAccount: the share relation, verified one-to-one --------
  const c3ShareRows = await prisma.sharedSocialAccount.findMany({
    where: { exchangeId: c3Accepted.id },
    select: { ownerId: true, viewerId: true, platform: true },
    orderBy: { createdAt: "asc" },
  });
  const c3ShareRowsSql = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "SharedSocialAccount" WHERE "exchangeId" = $1::uuid`,
    c3Accepted.id,
  );
  const c3ApiShares = d3?.sharedAccounts ?? [];
  check(
    "C3 exchanges: sharedAccounts count equals an independent SQL count",
    c3ApiShares.length === Number(c3ShareRowsSql[0].n) && c3ApiShares.length === 2,
    `api=${c3ApiShares.length} sql=${Number(c3ShareRowsSql[0].n)}`,
  );

  const c3ShareKey = (s) => `${s.ownerId}|${s.viewerId}|${s.platform}`;
  check(
    "C3 exchanges: the share direction is reported exactly as stored (owner granted, viewer received)",
    JSON.stringify([...c3ApiShares].map(c3ShareKey).sort()) ===
      JSON.stringify([...c3ShareRows].map(c3ShareKey).sort()),
    `api=${c3ApiShares.map(c3ShareKey).join(" , ")} sql=${c3ShareRows.map(c3ShareKey).join(" , ")}`,
  );
  check(
    "C3 exchanges: the two shares point in opposite directions on different platforms",
    c3ApiShares.some(
      (s) => s.ownerId === c3Alice.id && s.viewerId === c3Bob.id && s.platform === "TELEGRAM",
    ) &&
      c3ApiShares.some(
        (s) => s.ownerId === c3Bob.id && s.viewerId === c3Alice.id && s.platform === "WHATSAPP",
      ),
    `shares=${c3ApiShares.map(c3ShareKey).join(" , ")}`,
  );
  check(
    "C3 exchanges: a share row is never returned with the owner/viewer pair reversed",
    !c3ApiShares.some((s) => s.ownerId === c3Bob.id && s.platform === "TELEGRAM"),
    `shares=${c3ApiShares.map(c3ShareKey).join(" , ")}`,
  );
  check(
    "C3 exchanges: the PENDING exchange has no shares of its own",
    (c3DetailPending.json?.data?.sharedAccounts ?? []).length === 0,
    `shares=${(c3DetailPending.json?.data?.sharedAccounts ?? []).length}`,
  );

  // --- connectionId has no FK: available and dangling are both normal data --
  check(
    "C3 exchanges: an existing connection is loaded and reported as available",
    d3?.connectionAvailable === true &&
      d3?.connection?.id === c3Connection.id &&
      d3?.connection?.status === "ACTIVE",
    `available=${d3?.connectionAvailable} id=${d3?.connection?.id}`,
  );
  const d3Pending = c3DetailPending.json?.data;
  check(
    "C3 exchanges: a dangling connectionId is 200 with connectionAvailable=false, never a 500",
    c3DetailPending.status === 200 &&
      d3Pending?.connectionAvailable === false &&
      d3Pending?.connection === null &&
      d3Pending?.exchange?.connectionId === C3_DANGLING_CONNECTION_ID,
    `status=${c3DetailPending.status} available=${d3Pending?.connectionAvailable} connection=${JSON.stringify(d3Pending?.connection)}`,
  );

  // --- conversation: an id, and nothing from the chat ----------------------
  check(
    "C3 exchanges: the conversation is reported as an id and the chat body never appears",
    d3?.exchange?.conversationId === c3Conversation.id &&
      !JSON.stringify(c3DetailAccepted.json).includes(C3_PRIVATE_CHAT_BODY),
    `conversationId=${d3?.exchange?.conversationId}`,
  );

  // --- 404 -----------------------------------------------------------------
  await expectCode(
    "C3 exchanges: an unknown exchange id is a 404 EXCHANGE_NOT_FOUND",
    `/admin/exchanges/00000000-0000-4000-8000-000000000000`,
    { token: t.superadmin },
    404,
    "EXCHANGE_NOT_FOUND",
  );

  // --- GET-only ------------------------------------------------------------
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const res = await rawCall("/admin/exchanges", { method, token: t.superadmin, body: {} });
    check(
      `C3 exchanges: ${method} /admin/exchanges is not a route`,
      res.status === 404,
      `status=${res.status}`,
    );
  }
  const c3PostDetail = await rawCall(`/admin/exchanges/${c3Accepted.id}`, {
    method: "POST",
    token: t.superadmin,
    body: {},
  });
  check(
    "C3 exchanges: POST /admin/exchanges/:id is not a route",
    c3PostDetail.status === 404,
    `status=${c3PostDetail.status}`,
  );

  // --- privacy: recursive scan of both payloads ---------------------------
  const collectPaths = (value, prefix = "") => {
    if (Array.isArray(value)) {
      return value.flatMap((entry, i) => collectPaths(entry, `${prefix}[${i}]`));
    }
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([k, v]) => [
        `${prefix}.${k}`,
        ...collectPaths(v, `${prefix}.${k}`),
      ]);
    }
    return [];
  };

  const c3Forbidden = [
    "passwordHash",
    "tokenHash",
    "refreshToken",
    "accessToken",
    "oauth",
    "secret",
    "clientSecret",
    "ip",
    "userAgent",
    "handle",
  ];
  for (const [label, payload] of [
    ["the list", c3ListSuper.json],
    ["the detail", c3DetailAccepted.json],
  ]) {
    const paths = collectPaths(payload);
    for (const forbidden of c3Forbidden) {
      check(
        `C3 exchanges: ${label} payload carries no ${forbidden} field`,
        paths.filter((p) => p.toLowerCase().endsWith(`.${forbidden.toLowerCase()}`)).length === 0,
        `paths=${paths.length}`,
      );
    }
  }

  // The literal, not just the key name: a leak that renamed the field would
  // still be a disclosure, and only a content scan catches it.
  for (const [label, payload] of [
    ["the list", c3ListSuper.json],
    ["the detail", c3DetailAccepted.json],
  ]) {
    const serialised = JSON.stringify(payload);
    check(
      `C3 exchanges: ${label} payload contains no social handle value`,
      !serialised.includes("PW_EXCHANGE_SECRET_HANDLE"),
      `len=${serialised.length}`,
    );
  }

  check(
    "C3 exchanges: the payloads expose no participant email address",
    !JSON.stringify(c3ListSuper.json).includes("@example.test") &&
      !JSON.stringify(c3DetailAccepted.json).includes("@example.test"),
    "no email substring found",
  );

  // --- read-only: no audit rows written ------------------------------------
  const auditBeforeExchangeReads = await prisma.adminAuditLog.count();
  await call("/admin/exchanges?status=ACCEPTED", { token: t.superadmin });
  await call(`/admin/exchanges/${c3Accepted.id}`, { token: t.superadmin });
  const auditAfterExchangeReads = await prisma.adminAuditLog.count();
  check(
    "C3 exchanges: reading the list and the detail writes no audit row (GET-only)",
    auditBeforeExchangeReads === auditAfterExchangeReads,
    `before=${auditBeforeExchangeReads} after=${auditAfterExchangeReads}`,
  );

  const c3ExchangeAuditRows = await prisma.adminAuditLog.count({
    where: { targetType: "EXCHANGE" },
  });
  check(
    "C3 exchanges: the detail history is honestly empty (no EXCHANGE audit rows exist)",
    c3ExchangeAuditRows === 0 && (d3?.history ?? []).length === 0,
    `rows=${c3ExchangeAuditRows} history=${(d3?.history ?? []).length}`,
  );

  // ------------------- 10g. Phase C4: blocks list/detail vs real SQL
  //
  // The blocks console claims to show stored `Block` rows — and only those —
  // with their direction intact and no social handle anywhere. Four things make
  // that testable against the real database rather than against the API's own
  // opinion:
  //
  //   1. Every count is computed here, in PostgreSQL, through a *separate*
  //      query path (`countBlockSql`), never through the endpoint being judged.
  //   2. `Block` has **no `id`** — `@@id([blockerId, blockedId])` — so the
  //      detail route is pair-addressed and the response must carry the pair.
  //      There is no single value that could be used as a key.
  //   3. The direction is verified one-to-one against the stored row. The
  //      fixture contains `Alice → Bob` **and** `Bob → Alice`, so an
  //      implementation that normalised the pair (sorted the ids, `min`/`max`,
  //      deduplicated) cannot satisfy both.
  //   4. `user` must match **either** side. Alice is the blocker of one fixture
  //      and the blocked party of two others, so a one-sided filter returns 1
  //      where the SQL returns 3.
  //
  // The database is verified to hold **zero** blocks before this block, so every
  // row the API returns here is one of the three created below.
  //
  // Read-only phase: both routes are GET, and the absence of audit writes is
  // asserted explicitly at the end.
  const blocksBefore = await prisma.block.count();
  check(
    "C4 blocks: the database starts with zero blocks",
    blocksBefore === 0,
    `blocks=${blocksBefore}`,
  );

  const c4User = (key, nickname) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "ACTIVE",
        nickname,
        countryCode: "US",
      },
      select: { id: true, email: true },
    });

  const c4Alice = await c4User("c4alice", "PA C4 Alice");
  const c4Bob = await c4User("c4bob", "PA C4 Bob");
  const c4Carol = await c4User("c4carol", "PA C4 Carol");
  const c4Ids = [c4Alice.id, c4Bob.id, c4Carol.id];
  ids.push(...c4Ids);

  // A recognisable handle on a real `SocialAccount`. A `Block` has no relation
  // to this table, so there is no legitimate path by which it could appear —
  // which is exactly why its absence is worth asserting.
  const C4_SECRET_HANDLE = "PW_BLOCK_SECRET_HANDLE_phasea_alice_tg";
  await prisma.socialAccount.create({
    data: {
      userId: c4Alice.id,
      platform: "TELEGRAM",
      handle: C4_SECRET_HANDLE,
      syncEnabled: true,
    },
  });

  const c4AliceToBobAt = new Date("2026-03-01T10:00:00.000Z");
  const c4BobToAliceAt = new Date("2026-03-02T10:00:00.000Z");
  const c4CarolToAliceAt = new Date("2026-03-03T10:00:00.000Z");

  // The direction is the row's meaning: `blockerId` did the blocking.
  await prisma.block.create({
    data: { blockerId: c4Alice.id, blockedId: c4Bob.id, createdAt: c4AliceToBobAt },
  });
  await prisma.block.create({
    data: { blockerId: c4Carol.id, blockedId: c4Alice.id, createdAt: c4CarolToAliceAt },
  });
  await prisma.block.create({
    data: { blockerId: c4Bob.id, blockedId: c4Alice.id, createdAt: c4BobToAliceAt },
  });

  /**
   * The independent count: raw SQL, a different query path from Prisma's
   * `block.count()`. `$1::uuid` is cast explicitly so a text parameter cannot
   * silently compare as text against a uuid column.
   */
  const countBlockSql = async (where = "TRUE", params = []) => {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM "Block" WHERE ${where}`,
      ...params,
    );
    return rows[0].n;
  };

  // --- RBAC ---------------------------------------------------------------
  const c4Super = await expectStatus(
    "C4 blocks: SUPER_ADMIN may read the list",
    "/admin/blocks",
    { token: t.superadmin },
    200,
  );
  await expectStatus(
    "C4 blocks: ANALYST may read the list",
    "/admin/blocks",
    { token: t.analyst },
    200,
  );
  for (const [role, token] of [
    ["MODERATOR", t.moderator],
    ["SUPPORT", t.support],
    ["CONTENT_MANAGER", t.contentmgr],
  ]) {
    await expectCode(
      `C4 blocks: ${role} is refused with 403 PERMISSION_DENIED`,
      "/admin/blocks",
      { token },
      403,
      "PERMISSION_DENIED",
    );
  }
  await expectCode(
    "C4 blocks: an anonymous caller is refused with 401 UNAUTHORIZED",
    "/admin/blocks",
    {},
    401,
    "UNAUTHORIZED",
  );
  await expectCode(
    "C4 blocks: a disabled admin is refused with 401 USER_DISABLED",
    "/admin/blocks",
    { token: t.disabled },
    401,
    "USER_DISABLED",
  );

  // --- total --------------------------------------------------------------
  const c4SqlTotal = await countBlockSql();
  check(
    "C4 blocks: the list total equals an independent SQL count",
    c4Super.json?.data?.total === c4SqlTotal && c4SqlTotal === 3,
    `api=${c4Super.json?.data?.total} sql=${c4SqlTotal}`,
  );
  check(
    "C4 blocks: every row carries the composite pair and no synthetic id",
    (c4Super.json?.data?.items ?? []).length === 3 &&
      (c4Super.json?.data?.items ?? []).every(
        (row) =>
          typeof row.blockerId === "string" &&
          typeof row.blockedId === "string" &&
          !Object.prototype.hasOwnProperty.call(row, "id"),
      ),
    `items=${(c4Super.json?.data?.items ?? []).length}`,
  );

  // --- user matches EITHER side -------------------------------------------
  const c4SqlEither = await countBlockSql(
    `("blockerId" = $1::uuid OR "blockedId" = $1::uuid)`,
    [c4Alice.id],
  );
  const c4Either = await call(`/admin/blocks?user=${c4Alice.id}`, { token: t.superadmin });
  check(
    "C4 blocks: user = Alice matches both columns and equals the SQL either-side count",
    c4Either.json?.data?.total === c4SqlEither && c4SqlEither === 3,
    `api=${c4Either.json?.data?.total} sql=${c4SqlEither}`,
  );
  // The one-sided reading of the same question, computed independently, so the
  // assertion above cannot be satisfied by a filter that only checks one column.
  const c4SqlAsBlocker = await countBlockSql(`"blockerId" = $1::uuid`, [c4Alice.id]);
  const c4SqlAsBlocked = await countBlockSql(`"blockedId" = $1::uuid`, [c4Alice.id]);
  check(
    "C4 blocks: Alice is on both sides, so a one-sided filter would have returned 1",
    c4SqlAsBlocker === 1 && c4SqlAsBlocked === 2 && c4SqlAsBlocker + c4SqlAsBlocked === c4SqlEither,
    `blocker=${c4SqlAsBlocker} blocked=${c4SqlAsBlocked} either=${c4SqlEither}`,
  );

  const c4SqlBobEither = await countBlockSql(
    `("blockerId" = $1::uuid OR "blockedId" = $1::uuid)`,
    [c4Bob.id],
  );
  const c4BobEither = await call(`/admin/blocks?user=${c4Bob.id}`, { token: t.superadmin });
  check(
    "C4 blocks: user = Bob matches both columns",
    c4BobEither.json?.data?.total === c4SqlBobEither && c4SqlBobEither === 2,
    `api=${c4BobEither.json?.data?.total} sql=${c4SqlBobEither}`,
  );

  const c4ByNickname = await call("/admin/blocks?user=PA%20C4%20Alice", { token: t.superadmin });
  check(
    "C4 blocks: a nickname search matches both sides too",
    c4ByNickname.json?.data?.total === 3,
    `total=${c4ByNickname.json?.data?.total}`,
  );

  // --- blocker / blocked are directional ----------------------------------
  const c4AsBlocker = await call(`/admin/blocks?blocker=${c4Alice.id}`, { token: t.superadmin });
  const c4AsBlocked = await call(`/admin/blocks?blocked=${c4Alice.id}`, { token: t.superadmin });
  check(
    "C4 blocks: blocker and blocked answer different sets for the same person",
    c4AsBlocker.json?.data?.total === c4SqlAsBlocker &&
      c4AsBlocked.json?.data?.total === c4SqlAsBlocked &&
      c4AsBlocker.json?.data?.total !== c4AsBlocked.json?.data?.total,
    `blocker=${c4AsBlocker.json?.data?.total} blocked=${c4AsBlocked.json?.data?.total}`,
  );

  // --- dates --------------------------------------------------------------
  const c4From = new Date("2026-03-02T00:00:00.000Z");
  const c4SqlFrom = await countBlockSql(`"createdAt" >= $1::timestamp`, [naiveUtc(c4From)]);
  const c4ApiFrom = await call("/admin/blocks?createdFrom=2026-03-02T00:00:00.000Z", {
    token: t.superadmin,
  });
  check(
    "C4 blocks: createdFrom is an inclusive lower bound, matching the SQL count",
    c4ApiFrom.json?.data?.total === c4SqlFrom && c4SqlFrom === 2,
    `api=${c4ApiFrom.json?.data?.total} sql=${c4SqlFrom}`,
  );

  const c4To = new Date("2026-03-02T23:59:59.999Z");
  const c4SqlTo = await countBlockSql(`"createdAt" <= $1::timestamp`, [naiveUtc(c4To)]);
  const c4ApiTo = await call("/admin/blocks?createdTo=2026-03-02T23:59:59.999Z", {
    token: t.superadmin,
  });
  check(
    "C4 blocks: createdTo is an inclusive upper bound, matching the SQL count",
    c4ApiTo.json?.data?.total === c4SqlTo && c4SqlTo === 2,
    `api=${c4ApiTo.json?.data?.total} sql=${c4SqlTo}`,
  );

  const c4SqlRange = await countBlockSql(
    `"createdAt" >= $1::timestamp AND "createdAt" <= $2::timestamp`,
    [naiveUtc(new Date("2026-03-02T00:00:00.000Z")), naiveUtc(c4To)],
  );
  const c4ApiRange = await call(
    "/admin/blocks?createdFrom=2026-03-02T00:00:00.000Z&createdTo=2026-03-02T23:59:59.999Z",
    { token: t.superadmin },
  );
  check(
    "C4 blocks: a closed date range matches the SQL count",
    c4ApiRange.json?.data?.total === c4SqlRange && c4SqlRange === 1,
    `api=${c4ApiRange.json?.data?.total} sql=${c4SqlRange}`,
  );

  await expectCode(
    "C4 blocks: a malformed date is a 400 VALIDATION_ERROR",
    "/admin/blocks?createdFrom=not-a-date",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );
  await expectCode(
    "C4 blocks: 2026-02-30 is rejected rather than rolled over to 2 March",
    "/admin/blocks?createdFrom=2026-02-30",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );

  // --- sort ---------------------------------------------------------------
  const c4Default = await call("/admin/blocks", { token: t.superadmin });
  check(
    "C4 blocks: the default sort is newest first, matching the SQL ordering",
    c4Default.json?.data?.items?.[0]?.blockerId === c4Carol.id &&
      c4Default.json?.data?.items?.[0]?.blockedId === c4Alice.id,
    `first=${c4Default.json?.data?.items?.[0]?.blockerId}/${c4Default.json?.data?.items?.[0]?.blockedId}`,
  );

  const c4OldestSql = await prisma.$queryRawUnsafe(
    `SELECT "blockerId"::text AS b, "blockedId"::text AS d FROM "Block" ORDER BY "createdAt" ASC LIMIT 1`,
  );
  const c4Asc = await call("/admin/blocks?sort=createdAt_asc", { token: t.superadmin });
  check(
    "C4 blocks: createdAt_asc leads with the SQL-oldest row",
    c4Asc.json?.data?.items?.[0]?.blockerId === c4OldestSql[0].b &&
      c4Asc.json?.data?.items?.[0]?.blockedId === c4OldestSql[0].d,
    `api=${c4Asc.json?.data?.items?.[0]?.blockerId}/${c4Asc.json?.data?.items?.[0]?.blockedId} sql=${c4OldestSql[0].b}/${c4OldestSql[0].d}`,
  );

  await expectCode(
    "C4 blocks: an unknown sort is a 400 VALIDATION_ERROR, never a silent fallback",
    "/admin/blocks?sort=createdAt%3B%20DROP%20TABLE",
    { token: t.superadmin },
    400,
    "VALIDATION_ERROR",
  );

  // --- pagination ---------------------------------------------------------
  const c4Page1 = await call("/admin/blocks?page=1&pageSize=2", { token: t.superadmin });
  const c4Page2 = await call("/admin/blocks?page=2&pageSize=2", { token: t.superadmin });
  const c4Page9 = await call("/admin/blocks?page=9&pageSize=2", { token: t.superadmin });
  check(
    "C4 blocks: pagination splits the real rows without losing or duplicating any",
    c4Page1.json?.data?.items?.length === 2 &&
      c4Page2.json?.data?.items?.length === 1 &&
      c4Page1.json?.data?.total === 3 &&
      c4Page2.json?.data?.total === 3 &&
      c4Page1.json?.data?.totalPages === 2,
    `p1=${c4Page1.json?.data?.items?.length} p2=${c4Page2.json?.data?.items?.length} total=${c4Page1.json?.data?.total}`,
  );
  check(
    "C4 blocks: the two pages are disjoint and together cover the SQL row count",
    c4Page1.json?.data?.items?.length + c4Page2.json?.data?.items?.length === c4SqlTotal,
    `p1+p2=${c4Page1.json?.data?.items?.length + c4Page2.json?.data?.items?.length} sql=${c4SqlTotal}`,
  );
  check(
    "C4 blocks: an out-of-range page is an empty page, not an error and not a moved page",
    c4Page9.status === 200 &&
      c4Page9.json?.data?.items?.length === 0 &&
      c4Page9.json?.data?.page === 9 &&
      c4Page9.json?.data?.total === 3,
    `status=${c4Page9.status} items=${c4Page9.json?.data?.items?.length} page=${c4Page9.json?.data?.page}`,
  );

  // --- direction ----------------------------------------------------------
  const c4ForwardSql = await countBlockSql(
    `"blockerId" = $1::uuid AND "blockedId" = $2::uuid`,
    [c4Alice.id, c4Bob.id],
  );
  const c4ReverseSql = await countBlockSql(
    `"blockerId" = $1::uuid AND "blockedId" = $2::uuid`,
    [c4Bob.id, c4Alice.id],
  );
  check(
    "C4 blocks: the stored table holds one row in each direction",
    c4ForwardSql === 1 && c4ReverseSql === 1,
    `forward=${c4ForwardSql} reverse=${c4ReverseSql}`,
  );

  const d4Forward = await call(`/admin/blocks/${c4Alice.id}/${c4Bob.id}`, { token: t.superadmin });
  const d4Reverse = await call(`/admin/blocks/${c4Bob.id}/${c4Alice.id}`, { token: t.superadmin });
  check(
    "C4 blocks: Alice -> Bob is reported with Alice as the blocker",
    d4Forward.status === 200 &&
      d4Forward.json?.data?.block?.blockerId === c4Alice.id &&
      d4Forward.json?.data?.block?.blockedId === c4Bob.id &&
      d4Forward.json?.data?.blocker?.id === c4Alice.id &&
      d4Forward.json?.data?.blocked?.id === c4Bob.id,
    `status=${d4Forward.status} blocker=${d4Forward.json?.data?.block?.blockerId}`,
  );
  check(
    "C4 blocks: Bob -> Alice is reported with Bob as the blocker — not the reverse",
    d4Reverse.status === 200 &&
      d4Reverse.json?.data?.block?.blockerId === c4Bob.id &&
      d4Reverse.json?.data?.block?.blockedId === c4Alice.id,
    `status=${d4Reverse.status} blocker=${d4Reverse.json?.data?.block?.blockerId}`,
  );
  // The decisive assertion: the two directions must not resolve to the same row.
  check(
    "C4 blocks: the two directions are never normalised into one another",
    d4Forward.json?.data?.block?.blockerId !== d4Reverse.json?.data?.block?.blockerId &&
      d4Forward.json?.data?.block?.blockerId === d4Reverse.json?.data?.block?.blockedId &&
      d4Forward.json?.data?.block?.blockedId === d4Reverse.json?.data?.block?.blockerId,
    `forward=${d4Forward.json?.data?.block?.blockerId} reverse=${d4Reverse.json?.data?.block?.blockerId}`,
  );
  // And no inverted pseudo-row: a filter for the forward pair returns the
  // forward row and nothing else.
  const c4ForwardFiltered = await call(
    `/admin/blocks?blocker=${c4Alice.id}&blocked=${c4Bob.id}`,
    { token: t.superadmin },
  );
  check(
    "C4 blocks: filtering the forward pair returns exactly the forward row",
    c4ForwardFiltered.json?.data?.total === c4ForwardSql &&
      c4ForwardFiltered.json?.data?.items?.[0]?.blockerId === c4Alice.id &&
      c4ForwardFiltered.json?.data?.items?.[0]?.blockedId === c4Bob.id,
    `total=${c4ForwardFiltered.json?.data?.total}`,
  );

  check(
    "C4 blocks: the detail response carries no synthetic id",
    d4Forward.json?.data?.block !== undefined &&
      !Object.prototype.hasOwnProperty.call(d4Forward.json.data.block, "id"),
    `keys=${Object.keys(d4Forward.json?.data?.block ?? {}).join(",")}`,
  );

  // --- unknown pair -------------------------------------------------------
  await expectCode(
    "C4 blocks: an unknown pair is a 404 BLOCK_NOT_FOUND, never 200 with null",
    `/admin/blocks/${c4Carol.id}/${c4Bob.id}`,
    { token: t.superadmin },
    404,
    "BLOCK_NOT_FOUND",
  );
  const c4MissingPair = await call(`/admin/blocks/${c4Carol.id}/${c4Bob.id}`, {
    token: t.superadmin,
  });
  check(
    "C4 blocks: the 404 body carries no data envelope",
    c4MissingPair.json?.data === undefined && c4MissingPair.json?.success === false,
    `body=${JSON.stringify(c4MissingPair.json).slice(0, 80)}`,
  );

  // --- GET-only -----------------------------------------------------------
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const path =
      method === "POST"
        ? "/admin/blocks"
        : `/admin/blocks/${c4Alice.id}/${c4Bob.id}`;
    await expectStatus(
      `C4 blocks: ${method} ${path} does not exist (404)`,
      path,
      { method, token: t.superadmin, body: {} },
      404,
    );
  }

  // --- privacy ------------------------------------------------------------
  const c4ListPayload = JSON.stringify(c4Super.json);
  const c4DetailPayload = JSON.stringify(d4Forward.json);
  for (const [label, payload] of [
    ["the list", c4ListPayload],
    ["the detail", c4DetailPayload],
  ]) {
    check(
      `C4 blocks: ${label} payload contains no social handle value`,
      !payload.includes("PW_BLOCK_SECRET_HANDLE"),
      `len=${payload.length}`,
    );
    check(
      `C4 blocks: ${label} payload contains no participant email address`,
      !payload.includes("@example.test"),
      `len=${payload.length}`,
    );
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "oauth",
      "clientSecret",
      "userAgent",
    ]) {
      check(
        `C4 blocks: ${label} payload carries no ${forbidden} field`,
        !payload.includes(forbidden),
        `len=${payload.length}`,
      );
    }
  }
  check(
    "C4 blocks: the stored handle really exists, so its absence above is meaningful",
    (await prisma.socialAccount.count({ where: { handle: C4_SECRET_HANDLE } })) === 1,
    "fixture handle present",
  );

  // --- read-only: no audit rows written -----------------------------------
  const auditBeforeBlockReads = await prisma.adminAuditLog.count();
  await call("/admin/blocks", { token: t.superadmin });
  await call(`/admin/blocks/${c4Alice.id}/${c4Bob.id}`, { token: t.superadmin });
  const auditAfterBlockReads = await prisma.adminAuditLog.count();
  check(
    "C4 blocks: reading the list and the detail writes no audit row (GET-only)",
    auditBeforeBlockReads === auditAfterBlockReads,
    `before=${auditBeforeBlockReads} after=${auditAfterBlockReads}`,
  );

  const c4BlockAuditRows = await prisma.adminAuditLog.count({ where: { targetType: "BLOCK" } });
  check(
    "C4 blocks: the detail history is honestly empty (no BLOCK audit rows exist)",
    c4BlockAuditRows === 0 && (d4Forward.json?.data?.history ?? []).length === 0,
    `rows=${c4BlockAuditRows} history=${(d4Forward.json?.data?.history ?? []).length}`,
  );

  // ------------------- 10h. Phase C5: cross-domain integration vs real SQL
  //
  // C1–C4 each verified one domain against the database. This section asks the
  // different question Phase C5 exists to answer: do the finished domains agree
  // with *each other*?
  //
  // Three things make that testable rather than tautological:
  //
  //   1. `/admin/me` is the console's own statement of what the signed-in role
  //      may do, and the sidebar is built from exactly that list. So every nav
  //      route is called with every role, and the answer must match the
  //      permission the endpoint advertises. A route that 403s for a role whose
  //      sidebar shows it — or 200s for one whose sidebar hides it — is a real
  //      integration defect, and it is the one class of bug no per-domain test
  //      can see.
  //   2. Every count is recomputed in PostgreSQL through `$queryRawUnsafe`, a
  //      different query path from the Prisma calls inside the service. The
  //      service is never the only source of truth for a number it reports.
  //   3. The cross-domain boundaries are asserted directly: a social handle
  //      must not surface in a connection, block, risk or audit payload, and a
  //      read must not append an audit row.
  //
  // The fixtures are prefixed `PW_INT` and are removed again at the end of this
  // section — before the shared cleanup runs — so the per-phase zero-row
  // assertions below keep describing C2/C3/C4 and not C5.
  const c5Baseline = {
    users: await prisma.user.count(),
    connections: await prisma.connection.count(),
    conversations: await prisma.conversation.count(),
    exchanges: await prisma.exchangeRequest.count(),
    shares: await prisma.sharedSocialAccount.count(),
    socialAccounts: await prisma.socialAccount.count(),
    blocks: await prisma.block.count(),
    reports: await prisma.report.count(),
    notes: await prisma.adminNote.count(),
    audit: await prisma.adminAuditLog.count(),
  };

  /**
   * The independent count: raw SQL, a different query path from the Prisma
   * calls the service makes. `$1::uuid` is cast explicitly so a text parameter
   * cannot silently compare as text against a uuid column.
   */
  const c5SqlCount = async (sql, ...params) => (await prisma.$queryRawUnsafe(sql, ...params))[0].n;

  // --- fixtures -----------------------------------------------------------
  const c5User = (key, nickname) =>
    prisma.user.create({
      data: {
        email: `${TAG}.${key}@example.test`,
        passwordHash: "$2a$10$phaseaverifyplaceholderplaceholderplaceholder",
        emailVerified: true,
        status: "ACTIVE",
        nickname,
        countryCode: "US",
      },
      select: { id: true, email: true },
    });

  const c5Alice = await c5User("pw_int_alice", "PW_INT_Alice");
  const c5Bob = await c5User("pw_int_bob", "PW_INT_Bob");
  const c5Carol = await c5User("pw_int_carol", "PW_INT_Carol");
  const c5Ids = [c5Alice.id, c5Bob.id, c5Carol.id];

  // A conversation is required: `ExchangeRequest.conversationId` is non-null.
  const c5Conversation = await prisma.conversation.create({ data: {}, select: { id: true } });

  // Two connections on purpose. One ACTIVE and one REMOVED, both with Alice as
  // a participant — so a list that filters to ACTIVE, or that only looks at
  // `userAId`, disagrees with the independent SQL below.
  const c5ConnActive = await prisma.connection.create({
    data: {
      userAId: c5Alice.id,
      userBId: c5Bob.id,
      conversationId: c5Conversation.id,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const c5ConnRemoved = await prisma.connection.create({
    data: { userAId: c5Alice.id, userBId: c5Carol.id, status: "REMOVED" },
    select: { id: true },
  });

  const c5Exchange = await prisma.exchangeRequest.create({
    data: {
      connectionId: c5ConnActive.id,
      conversationId: c5Conversation.id,
      requesterId: c5Alice.id,
      receiverId: c5Bob.id,
      platforms: ["TELEGRAM"],
      status: "PENDING",
    },
    select: { id: true },
  });

  // A recognisable handle on a real `SocialAccount`. Only the exchange domain
  // has any legitimate route to this table, so its absence from every other
  // payload is exactly what the cross-domain privacy check asserts.
  const C5_SECRET_HANDLE = "PW_INT_SECRET_HANDLE_phasea_alice_tg";
  await prisma.socialAccount.create({
    data: { userId: c5Alice.id, platform: "TELEGRAM", handle: C5_SECRET_HANDLE, syncEnabled: true },
  });
  const c5SocialAccount = await prisma.socialAccount.findFirstOrThrow({
    where: { userId: c5Alice.id, platform: "TELEGRAM" },
    select: { id: true },
  });
  await prisma.sharedSocialAccount.create({
    data: {
      ownerId: c5Alice.id,
      viewerId: c5Bob.id,
      platform: "TELEGRAM",
      socialAccountId: c5SocialAccount.id,
      exchangeId: c5Exchange.id,
    },
  });

  // Direction matters: Bob blocked Alice. Alice blocked nobody.
  await prisma.block.create({ data: { blockerId: c5Bob.id, blockedId: c5Alice.id } });

  const c5Report = await prisma.report.create({
    data: {
      reporterId: c5Carol.id,
      reportedUserId: c5Bob.id,
      reason: "SPAM",
      description: "PW_INT integration fixture",
      status: "OPEN",
    },
    select: { id: true },
  });

  // --- A. the navigation contract, at the API layer -----------------------
  //
  // The console derives its sidebar from the `permissions` array `/admin/me`
  // returns, so that array is the console's own promise. Each route is then
  // asked directly, and the two answers must agree.
  const C5_ROLE_TOKENS = [
    ["SUPER_ADMIN", t.superadmin],
    ["MODERATOR", t.moderator],
    ["SUPPORT", t.support],
    ["ANALYST", t.analyst],
    ["CONTENT_MANAGER", t.contentmgr],
  ];
  // `/moderation` is deliberately absent: it reuses `/admin/reports` and has no
  // endpoint of its own (pinned by the console's smoke test).
  const C5_NAV_ROUTES = [
    ["/admin/dashboard", "dashboard:read"],
    ["/admin/users", "users:read"],
    ["/admin/reports", "reports:read"],
    ["/admin/risk", "risk:read"],
    ["/admin/connections", "connections:read"],
    ["/admin/exchanges", "exchanges:read"],
    ["/admin/blocks", "blocks:read"],
    ["/admin/audit", "audit:read"],
  ];

  const c5AuditBeforeReads = await prisma.adminAuditLog.count();
  const c5NavMatrix = {};
  for (const [roleName, token] of C5_ROLE_TOKENS) {
    const me = await call("/admin/me", { token });
    const granted = new Set(me.json?.data?.permissions ?? []);
    const mismatches = [];
    for (const [path, permission] of C5_NAV_ROUTES) {
      const res = await call(path, { token });
      (c5NavMatrix[path] ??= {})[roleName] = res.status;
      const want = granted.has(permission) ? 200 : 403;
      if (res.status !== want) mismatches.push(`${path} got ${res.status} want ${want}`);
    }
    check(
      `C5 integration: /admin/me predicts every nav route's status for ${roleName}`,
      granted.size > 0 && mismatches.length === 0,
      mismatches.join("; ") || `permissions=${granted.size}`,
    );
  }

  const c5Holders = (path) =>
    C5_ROLE_TOKENS.map(([roleName]) => roleName).filter(
      (roleName) => c5NavMatrix[path]?.[roleName] === 200,
    );
  const c5ConnectionHolders = c5Holders("/admin/connections");
  check(
    "C5 integration: the three relationship domains share one holder set (SUPER_ADMIN + ANALYST)",
    JSON.stringify(c5ConnectionHolders) === JSON.stringify(["SUPER_ADMIN", "ANALYST"]) &&
      JSON.stringify(c5Holders("/admin/exchanges")) === JSON.stringify(c5ConnectionHolders) &&
      JSON.stringify(c5Holders("/admin/blocks")) === JSON.stringify(c5ConnectionHolders),
    `connections=${c5ConnectionHolders} exchanges=${c5Holders("/admin/exchanges")} blocks=${c5Holders("/admin/blocks")}`,
  );
  check(
    "C5 integration: risk:read admits MODERATOR where the relationship domains do not",
    c5Holders("/admin/risk").includes("MODERATOR") &&
      !c5ConnectionHolders.includes("MODERATOR"),
    `risk=${c5Holders("/admin/risk")}`,
  );

  // --- B. a malformed path id is a 400, never a 500 -----------------------
  //
  // This is the Phase C5 defect. Before the fix every one of these routes
  // answered `500 INTERNAL_ERROR`: the raw string reached Prisma's UUID parser,
  // which threw a `PrismaClientKnownRequestError` — not an `HttpException` — so
  // `ApiExceptionFilter` classified it as an unhandled server fault. The status
  // alone is therefore not enough: the code and the field name are asserted
  // too, so a future change cannot satisfy this check with a generic error.
  const C5_BAD_ID = "not-a-uuid";
  // The two halves of the block key are probed separately, with the other half
  // well-formed. Passing `not-a-uuid` for both would be ambiguous: whichever
  // pipe Nest resolves first throws, so the test could not tell a missing guard
  // on `blockedId` from a missing guard on `blockerId`.
  const C5_ID_ROUTES = [
    ["GET /admin/users/…", "GET", `/admin/users/${C5_BAD_ID}`, "id", undefined],
    ["GET /admin/reports/…", "GET", `/admin/reports/${C5_BAD_ID}`, "id", undefined],
    ["GET /admin/connections/…", "GET", `/admin/connections/${C5_BAD_ID}`, "id", undefined],
    ["GET /admin/exchanges/…", "GET", `/admin/exchanges/${C5_BAD_ID}`, "id", undefined],
    [
      "GET /admin/blocks/…/blockedId",
      "GET",
      `/admin/blocks/${C5_BAD_ID}/${MISSING_USER_ID}`,
      "blockerId",
      undefined,
    ],
    [
      "GET /admin/blocks/blockerId/…",
      "GET",
      `/admin/blocks/${MISSING_USER_ID}/${C5_BAD_ID}`,
      "blockedId",
      undefined,
    ],
    [
      "POST /admin/users/…/status",
      "POST",
      `/admin/users/${C5_BAD_ID}/status`,
      "id",
      { action: "disable", reason: "PW_INT probe" },
    ],
    [
      "PATCH /admin/users/…/status",
      "PATCH",
      `/admin/users/${C5_BAD_ID}/status`,
      "id",
      { action: "disable", reason: "PW_INT probe" },
    ],
    ["POST /admin/users/…/notes", "POST", `/admin/users/${C5_BAD_ID}/notes`, "id", { body: "PW_INT probe" }],
    [
      "POST /admin/reports/…/review",
      "POST",
      `/admin/reports/${C5_BAD_ID}/review`,
      "id",
      { action: "reviewing" },
    ],
  ];
  for (const [label, method, path, field, body] of C5_ID_ROUTES) {
    const res = await call(path, { method, token: t.superadmin, body });
    const details = res.json?.error?.details ?? {};
    const named = Array.isArray(details[field]) && details[field].length > 0;
    check(
      `C5 integration: ${label} -> 400 VALIDATION_ERROR naming ${field}`,
      res.status === 400 && res.code === "VALIDATION_ERROR" && named,
      `got ${res.status}/${res.code} details=${JSON.stringify(details)}`,
    );
  }

  // A well-formed but unknown id keeps its domain 404 — the guard must not
  // turn a genuine "no such row" into a validation error.
  await expectCode(
    "C5 integration: an unknown user id is still 404 USER_NOT_FOUND",
    `/admin/users/${MISSING_USER_ID}`,
    { token: t.superadmin },
    404,
    "USER_NOT_FOUND",
  );
  await expectCode(
    "C5 integration: an unknown report id is still 404 REPORT_NOT_FOUND",
    `/admin/reports/${MISSING_USER_ID}`,
    { token: t.superadmin },
    404,
    "REPORT_NOT_FOUND",
  );
  await expectCode(
    "C5 integration: an unknown connection id is still 404 CONNECTION_NOT_FOUND",
    `/admin/connections/${MISSING_USER_ID}`,
    { token: t.superadmin },
    404,
    "CONNECTION_NOT_FOUND",
  );
  await expectCode(
    "C5 integration: an unknown exchange id is still 404 EXCHANGE_NOT_FOUND",
    `/admin/exchanges/${MISSING_USER_ID}`,
    { token: t.superadmin },
    404,
    "EXCHANGE_NOT_FOUND",
  );
  await expectCode(
    "C5 integration: an unknown block pair is still 404 BLOCK_NOT_FOUND",
    `/admin/blocks/${MISSING_USER_ID}/${c5Alice.id}`,
    { token: t.superadmin },
    404,
    "BLOCK_NOT_FOUND",
  );

  // --- C. every domain read, captured once -------------------------------
  //
  // One pass over all nine screens plus the four detail routes. The payloads
  // are reused by the privacy scan and the audit check below, so the whole
  // cross-domain surface is exercised without re-requesting it.
  const C5_READS = [
    ["dashboard", "/admin/dashboard"],
    ["users", "/admin/users"],
    ["reports", "/admin/reports"],
    ["risk", "/admin/risk"],
    ["connections", "/admin/connections"],
    ["exchanges", "/admin/exchanges"],
    ["blocks", "/admin/blocks"],
    ["audit", "/admin/audit"],
    ["user detail", `/admin/users/${c5Alice.id}`],
    ["report detail", `/admin/reports/${c5Report.id}`],
    ["connection detail", `/admin/connections/${c5ConnActive.id}`],
    ["exchange detail", `/admin/exchanges/${c5Exchange.id}`],
    ["block detail", `/admin/blocks/${c5Bob.id}/${c5Alice.id}`],
  ];
  const c5Payloads = {};
  for (const [label, path] of C5_READS) {
    const res = await call(path, { token: t.superadmin });
    c5Payloads[label] = {
      status: res.status,
      raw: JSON.stringify(res.json ?? null),
      json: res.json,
    };
  }
  const c5FailedReads = Object.entries(c5Payloads)
    .filter(([, payload]) => payload.status !== 200)
    .map(([label, payload]) => `${label}=${payload.status}`);
  check(
    "C5 integration: all nine screens and all four detail routes answer 200 for SUPER_ADMIN",
    c5FailedReads.length === 0,
    c5FailedReads.join(" ") || `${C5_READS.length} routes`,
  );

  // --- D. dashboard and risk counts vs independent SQL --------------------
  const c5Dash = c5Payloads.dashboard.json?.data ?? {};
  const c5Risk = c5Payloads.risk.json?.data?.overview ?? {};

  const c5CountChecks = [
    ["dashboard users", c5Dash.users, `SELECT COUNT(*)::int AS n FROM "User"`],
    ["dashboard active", c5Dash.active, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'ACTIVE'`],
    ["dashboard banned", c5Dash.banned, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'BANNED'`],
    ["dashboard suspended", c5Dash.suspended, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'SUSPENDED'`],
    ["dashboard admins", c5Dash.admins, `SELECT COUNT(*)::int AS n FROM "AdminUser" WHERE "isActive" = true`],
    [
      "dashboard connections",
      c5Dash.connections,
      `SELECT COUNT(*)::int AS n FROM "Connection" WHERE status = 'ACTIVE'`,
    ],
    ["dashboard reportsOpen", c5Dash.reportsOpen, `SELECT COUNT(*)::int AS n FROM "Report" WHERE status = 'OPEN'`],
    ["risk totalReports", c5Risk.totalReports, `SELECT COUNT(*)::int AS n FROM "Report"`],
    ["risk openReports", c5Risk.openReports, `SELECT COUNT(*)::int AS n FROM "Report" WHERE status = 'OPEN'`],
    ["risk activeUsers", c5Risk.activeUsers, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'ACTIVE'`],
    ["risk bannedUsers", c5Risk.bannedUsers, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'BANNED'`],
    ["risk suspendedUsers", c5Risk.suspendedUsers, `SELECT COUNT(*)::int AS n FROM "User" WHERE status = 'SUSPENDED'`],
    [
      "risk suspiciousSelfReports",
      c5Risk.suspiciousSelfReports,
      `SELECT COUNT(*)::int AS n FROM "Report" WHERE "reporterId" = "reportedUserId"`,
    ],
  ];
  for (const [label, reported, sql] of c5CountChecks) {
    const independent = await c5SqlCount(sql);
    check(
      `C5 integration: ${label} equals the independent SQL count`,
      reported === independent,
      `api=${reported} sql=${independent}`,
    );
  }

  // The two screens describe the same rows, so they must not disagree. This is
  // the cross-domain half: each count was verified above, and these assert the
  // two views of one fact agree with each other.
  for (const [field, a, b] of [
    ["open reports", c5Dash.reportsOpen, c5Risk.openReports],
    ["active users", c5Dash.active, c5Risk.activeUsers],
    ["banned users", c5Dash.banned, c5Risk.bannedUsers],
    ["suspended users", c5Dash.suspended, c5Risk.suspendedUsers],
  ]) {
    check(
      `C5 integration: dashboard and risk agree on ${field}`,
      a === b,
      `dashboard=${a} risk=${b}`,
    );
  }

  // --- E. user detail vs independent SQL ----------------------------------
  const c5AliceDetail = c5Payloads["user detail"].json?.data ?? {};
  const c5UserChecks = [
    [
      "connectionCount",
      c5AliceDetail.connectionCount,
      `SELECT COUNT(*)::int AS n FROM "Connection" WHERE status = 'ACTIVE' AND ("userAId" = $1::uuid OR "userBId" = $1::uuid)`,
      [c5Alice.id],
    ],
    [
      "reportsReceivedCount",
      c5AliceDetail.reportsReceivedCount,
      `SELECT COUNT(*)::int AS n FROM "Report" WHERE "reportedUserId" = $1::uuid`,
      [c5Alice.id],
    ],
    [
      "reportsMadeCount",
      c5AliceDetail.reportsMadeCount,
      `SELECT COUNT(*)::int AS n FROM "Report" WHERE "reporterId" = $1::uuid`,
      [c5Alice.id],
    ],
    [
      "blocksMadeCount",
      c5AliceDetail.blocksMadeCount,
      `SELECT COUNT(*)::int AS n FROM "Block" WHERE "blockerId" = $1::uuid`,
      [c5Alice.id],
    ],
    [
      "blocksReceivedCount",
      c5AliceDetail.blocksReceivedCount,
      `SELECT COUNT(*)::int AS n FROM "Block" WHERE "blockedId" = $1::uuid`,
      [c5Alice.id],
    ],
    [
      "socialAccountCount",
      c5AliceDetail.socialAccountCount,
      `SELECT COUNT(*)::int AS n FROM "SocialAccount" WHERE "userId" = $1::uuid`,
      [c5Alice.id],
    ],
  ];
  for (const [label, reported, sql, params] of c5UserChecks) {
    const independent = await c5SqlCount(sql, ...params);
    check(
      `C5 integration: user detail ${label} equals the independent SQL count`,
      reported === independent,
      `api=${reported} sql=${independent}`,
    );
  }
  // The fixture is built so these are non-trivial: a one-sided or ACTIVE-only
  // filter returns a different number from the SQL above.
  check(
    "C5 integration: the user-detail fixture actually exercises the counts (ACTIVE connection + REMOVED connection + received block)",
    c5AliceDetail.connectionCount === 1 &&
      c5AliceDetail.blocksReceivedCount === 1 &&
      c5AliceDetail.blocksMadeCount === 0,
    `connections=${c5AliceDetail.connectionCount} received=${c5AliceDetail.blocksReceivedCount} made=${c5AliceDetail.blocksMadeCount}`,
  );

  // --- F. list totals vs independent SQL ----------------------------------
  const c5ListChecks = [
    ["connections", "/admin/connections", `SELECT COUNT(*)::int AS n FROM "Connection"`],
    ["exchanges", "/admin/exchanges", `SELECT COUNT(*)::int AS n FROM "ExchangeRequest"`],
    ["blocks", "/admin/blocks", `SELECT COUNT(*)::int AS n FROM "Block"`],
    ["reports", "/admin/reports", `SELECT COUNT(*)::int AS n FROM "Report"`],
    ["users", "/admin/users", `SELECT COUNT(*)::int AS n FROM "User"`],
  ];
  for (const [label, path, sql] of c5ListChecks) {
    const res = await call(`${path}?pageSize=1`, { token: t.superadmin });
    const independent = await c5SqlCount(sql);
    check(
      `C5 integration: the ${label} list total equals the independent SQL count`,
      res.json?.data?.total === independent,
      `api=${res.json?.data?.total} sql=${independent}`,
    );
  }

  // The `user` filter is bidirectional, and a REMOVED connection is stored
  // data rather than a tombstone: Alice is `userA` of both fixtures, one
  // ACTIVE and one REMOVED, so a filter that only reads `userAId` or that
  // implies `status: ACTIVE` returns 1 where the SQL returns 2.
  const c5ConnFiltered = await call(`/admin/connections?user=${c5Alice.id}&pageSize=50`, {
    token: t.superadmin,
  });
  const c5ConnSql = await c5SqlCount(
    `SELECT COUNT(*)::int AS n FROM "Connection" WHERE "userAId" = $1::uuid OR "userBId" = $1::uuid`,
    c5Alice.id,
  );
  check(
    "C5 integration: the connection `user` filter matches both sides and keeps REMOVED rows",
    c5ConnFiltered.json?.data?.total === c5ConnSql && c5ConnSql === 2,
    `api=${c5ConnFiltered.json?.data?.total} sql=${c5ConnSql}`,
  );

  const c5BlockFiltered = await call(`/admin/blocks?user=${c5Alice.id}&pageSize=50`, {
    token: t.superadmin,
  });
  const c5BlockSql = await c5SqlCount(
    `SELECT COUNT(*)::int AS n FROM "Block" WHERE "blockerId" = $1::uuid OR "blockedId" = $1::uuid`,
    c5Alice.id,
  );
  check(
    "C5 integration: the block `user` filter matches both sides (Alice is blocked, never the blocker)",
    c5BlockFiltered.json?.data?.total === c5BlockSql && c5BlockSql === 1,
    `api=${c5BlockFiltered.json?.data?.total} sql=${c5BlockSql}`,
  );

  // --- G. cross-domain privacy -------------------------------------------
  //
  // A social handle belongs to the exchange domain, and even there only as an
  // authorization relation — no admin screen is supposed to name one. The
  // fixture handle is real, so its absence from every payload means something.
  for (const [label, payload] of Object.entries(c5Payloads)) {
    for (const forbidden of ["passwordHash", "tokenHash", "clientSecret", "refreshToken"]) {
      check(
        `C5 integration: the ${label} payload carries no ${forbidden}`,
        !payload.raw.includes(forbidden),
        `len=${payload.raw.length}`,
      );
    }
    check(
      `C5 integration: the ${label} payload never names a social handle`,
      !payload.raw.includes(C5_SECRET_HANDLE),
      `len=${payload.raw.length}`,
    );
    // `ip` / `userAgent` belong to the audit screen alone.
    if (label !== "audit") {
      check(
        `C5 integration: the ${label} payload carries no ip / userAgent`,
        !payload.raw.includes('"userAgent"') && !payload.raw.includes('"ip"'),
        `len=${payload.raw.length}`,
      );
    }
  }
  check(
    "C5 integration: the stored handle really exists, so its absence above is meaningful",
    (await prisma.socialAccount.count({ where: { handle: C5_SECRET_HANDLE } })) === 1,
    "fixture handle present",
  );
  // The audit screen is the one place an operator's address is shown — and it is
  // also the one list that deliberately omits `totalPages` (the console computes
  // the ceiling itself). Both halves are structural, so neither depends on how
  // many rows happen to exist at this point in the run.
  const c5AuditRows = c5Payloads.audit.json?.data?.items ?? [];
  const c5AuditData = c5Payloads.audit.json?.data ?? {};
  check(
    "C5 integration: the audit screen is the one list exposing userAgent, and the one list without totalPages",
    c5AuditRows.every((row) => "userAgent" in row) &&
      !("totalPages" in c5AuditData) &&
      "totalPages" in (c5Payloads.connections.json?.data ?? {}),
    `rows=${c5AuditRows.length} auditKeys=${Object.keys(c5AuditData).join(",")}`,
  );

  // --- H. reads write no audit -------------------------------------------
  const c5AuditAfterReads = await prisma.adminAuditLog.count();
  check(
    "C5 integration: reading all nine screens and four detail routes writes no audit row",
    c5AuditBeforeReads === c5AuditAfterReads,
    `before=${c5AuditBeforeReads} after=${c5AuditAfterReads}`,
  );

  // --- I. the write paths still audit, with the right actor ---------------
  //
  // Read-only phases are easy to over-apply: the point of this check is that
  // the GET-only boundary did not take the audit trail away from the writes
  // that already existed.
  const c5StatusRes = await call(`/admin/users/${c5Carol.id}/status`, {
    method: "POST",
    token: t.superadmin,
    body: { action: "disable", reason: "PW_INT integration status probe" },
  });
  check(
    "C5 integration: a status change still succeeds after the read-only phases",
    // 201 is Nest's default for a POST handler that returns a plain value; the
    // two verbs share one implementation and one status. What matters is that
    // the write happened, which is asserted on the returned state.
    [200, 201].includes(c5StatusRes.status) && c5StatusRes.json?.data?.status === "DISABLED",
    `got ${c5StatusRes.status} status=${c5StatusRes.json?.data?.status}`,
  );
  const c5StatusAudit = await prisma.adminAuditLog.findFirst({
    where: { targetType: "USER", targetId: c5Carol.id, action: "ADMIN_USER_DISABLE" },
    orderBy: { createdAt: "desc" },
    select: { actorType: true, adminId: true, action: true, before: true, after: true },
  });
  check(
    "C5 integration: the status audit row is a USER actor carrying the real adminId",
    c5StatusAudit?.actorType === "USER" && c5StatusAudit?.adminId === u.superadmin.id,
    `actorType=${c5StatusAudit?.actorType} adminId=${c5StatusAudit?.adminId}`,
  );
  check(
    "C5 integration: the status audit row records the before/after state",
    c5StatusAudit?.before?.status === "ACTIVE" && c5StatusAudit?.after?.status === "DISABLED",
    `before=${JSON.stringify(c5StatusAudit?.before)} after=${JSON.stringify(c5StatusAudit?.after)}`,
  );

  const c5ReviewRes = await call(`/admin/reports/${c5Report.id}/review`, {
    method: "POST",
    token: t.superadmin,
    body: { action: "resolved", reason: "PW_INT integration review probe" },
  });
  check(
    "C5 integration: a report review still succeeds and moves the report out of OPEN",
    [200, 201].includes(c5ReviewRes.status) && c5ReviewRes.json?.data?.status === "RESOLVED",
    `got ${c5ReviewRes.status} status=${c5ReviewRes.json?.data?.status}`,
  );
  const c5ReviewAudit = await prisma.adminAuditLog.findFirst({
    where: { targetType: "REPORT", targetId: c5Report.id, action: "REPORT_RESOLVED" },
    orderBy: { createdAt: "desc" },
    select: { actorType: true, adminId: true },
  });
  check(
    "C5 integration: the report-review audit row is a USER actor carrying the real adminId",
    c5ReviewAudit?.actorType === "USER" && c5ReviewAudit?.adminId === u.superadmin.id,
    `actorType=${c5ReviewAudit?.actorType} adminId=${c5ReviewAudit?.adminId}`,
  );

  // --- J. fixture cleanup -------------------------------------------------
  //
  // Removed here rather than in the shared cleanup so the per-phase zero-row
  // assertions below keep describing C2/C3/C4. Every row is deleted explicitly
  // — relying on the user cascade would empty the tables anyway and the
  // equality check at the end would then pass whether or not the fixtures were
  // scoped correctly.
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { targetId: { in: [...c5Ids, c5Report.id] } },
        { adminId: u.superadmin.id, targetType: { in: ["USER", "REPORT"] }, targetId: { in: [...c5Ids, c5Report.id] } },
      ],
    },
  });
  await prisma.adminNote.deleteMany({ where: { OR: [{ userId: { in: c5Ids } }, { adminId: u.superadmin.id, userId: { in: c5Ids } }] } });
  await prisma.sharedSocialAccount.deleteMany({
    where: { OR: [{ ownerId: { in: c5Ids } }, { viewerId: { in: c5Ids } }, { exchangeId: c5Exchange.id }] },
  });
  await prisma.exchangeRequest.deleteMany({ where: { id: c5Exchange.id } });
  await prisma.socialAccount.deleteMany({ where: { userId: { in: c5Ids } } });
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: c5Ids } }, { blockedId: { in: c5Ids } }] },
  });
  await prisma.report.deleteMany({ where: { id: c5Report.id } });
  await prisma.connection.deleteMany({
    where: { OR: [{ id: { in: [c5ConnActive.id, c5ConnRemoved.id] } }, { userAId: { in: c5Ids } }, { userBId: { in: c5Ids } }] },
  });
  await prisma.conversation.deleteMany({ where: { id: c5Conversation.id } });
  await prisma.user.deleteMany({ where: { id: { in: c5Ids } } });

  const c5After = {
    users: await prisma.user.count(),
    connections: await prisma.connection.count(),
    conversations: await prisma.conversation.count(),
    exchanges: await prisma.exchangeRequest.count(),
    shares: await prisma.sharedSocialAccount.count(),
    socialAccounts: await prisma.socialAccount.count(),
    blocks: await prisma.block.count(),
    reports: await prisma.report.count(),
    notes: await prisma.adminNote.count(),
    audit: await prisma.adminAuditLog.count(),
  };
  const c5Leaks = Object.keys(c5Baseline).filter((key) => c5Baseline[key] !== c5After[key]);
  check(
    "C5 integration: every PW_INT fixture is removed and all ten tables are back to their pre-section state",
    c5Leaks.length === 0,
    c5Leaks.map((key) => `${key} ${c5Baseline[key]}->${c5After[key]}`).join(" ") || "clean",
  );

  // ------------------------------------------------------------- 11. cleanup
  const b5ReportIds = [b5ReportSuper.id, b5ReportMod.id, b5ReportNoWrite.id];
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminId: { in: ids } },
        { targetId: { in: ids } },
        { targetId: report.id },
        { targetId: { in: b5ReportIds } },
      ],
    },
  });
  // The SYSTEM rows this run produced, identified by id so no older machine
  // entry can be collaterally deleted.
  const systemRowsThisRun = await prisma.adminAuditLog.findMany({
    where: { action: "SYSTEM_USER_SUSPENSION_EXPIRED" },
    select: { id: true },
  });
  const staleSystemIds = systemRowsThisRun
    .map((r) => r.id)
    .filter((id) => !preexistingSystemIds.has(id));
  if (staleSystemIds.length > 0) {
    await prisma.adminAuditLog.deleteMany({ where: { id: { in: staleSystemIds } } });
  }
  await prisma.adminNote.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { userId: { in: ids } }] } });
  // The original `report` plus every Phase B5 fixture report.
  await prisma.report.deleteMany({ where: { id: { in: [report.id, ...b5ReportIds] } } });
  // Phase C2 and C3 both create `Connection` rows — C3's exchange points its
  // `connectionId` at one — so both have to be removed before the table can be
  // asserted back to its pre-run size. Deleting them explicitly (rather than
  // relying on the user cascade) is what makes the assertion below mean
  // something: a cascade would empty the table anyway and the check would pass
  // whether or not the fixtures were scoped correctly.
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: c2Ids } }, { userBId: { in: c2Ids } }] },
  });
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: c3Ids } }, { userBId: { in: c3Ids } }] },
  });
  const connectionsAfter = await prisma.connection.count();
  check(
    "C2 connections: fixtures removed and the connection table is back to zero rows",
    connectionsAfter === 0,
    `count=${connectionsAfter}`,
  );
  // Phase C3 exchange fixtures, in dependency order. `SharedSocialAccount`
  // cascades from both `ExchangeRequest` and `User`, and `SocialAccount` from
  // `User`, but each is deleted explicitly for the same reason as above.
  await prisma.sharedSocialAccount.deleteMany({
    where: {
      OR: [
        { ownerId: { in: c3Ids } },
        { viewerId: { in: c3Ids } },
        { exchangeId: { in: [c3Accepted.id, c3Pending.id] } },
      ],
    },
  });
  await prisma.exchangeRequest.deleteMany({ where: { id: { in: [c3Accepted.id, c3Pending.id] } } });
  await prisma.socialAccount.deleteMany({ where: { userId: { in: c3Ids } } });
  await prisma.message.deleteMany({ where: { conversationId: c3Conversation.id } });
  await prisma.conversation.deleteMany({ where: { id: c3Conversation.id } });

  // Phase C4 block fixtures, in dependency order.
  //
  // This runs **before** the C3 zero-assertions below on purpose: C4 creates a
  // `SocialAccount` of its own (the privacy fixture), and the C3 check asserts
  // the social-account table is back to zero rows. Cleaning C4 up afterwards
  // would make that check fail for a reason that has nothing to do with C3 —
  // exactly the ordering trap Phase C3 hit against C2's connection assertion.
  //
  // The blocks are deleted explicitly rather than left to the user cascade: a
  // cascade would empty the table anyway and the count assertion would then pass
  // whether or not the fixtures were scoped correctly.
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: c4Ids } }, { blockedId: { in: c4Ids } }] },
  });
  await prisma.socialAccount.deleteMany({ where: { userId: { in: c4Ids } } });
  const blocksAfter = await prisma.block.count();
  check(
    "C4 blocks: fixtures removed and the block table is back to zero rows",
    blocksAfter === 0,
    `count=${blocksAfter}`,
  );

  const exchangesAfter = await prisma.exchangeRequest.count();
  const sharesAfter = await prisma.sharedSocialAccount.count();
  const socialAccountsAfter = await prisma.socialAccount.count();
  check(
    "C3 exchanges: fixtures removed and the exchange/share/social-account tables are back to zero rows",
    exchangesAfter === 0 && sharesAfter === 0 && socialAccountsAfter === 0,
    `exchanges=${exchangesAfter} shares=${sharesAfter} socialAccounts=${socialAccountsAfter}`,
  );
  await prisma.adminUser.deleteMany({ where: { userId: { in: ids } } });
  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  check("all verification fixtures removed", removed.count === ids.length, `removed=${removed.count}/${ids.length}`);

  // The audit log must be exactly where it started: this script writes no
  // permanent history, machine rows included.
  const auditFinal = await prisma.adminAuditLog.count();
  check(
    "audit log returned to its pre-run size (SYSTEM rows cleaned up)",
    auditFinal === auditBefore,
    `before=${auditBefore} after=${auditFinal} systemRowsRemoved=${staleSystemIds.length}`,
  );

  // ---------------------------------------------------------------- report
  const pass = results.filter((r) => r.ok).length;
  console.log("\n================ PHASE A LIVE VERIFICATION ================");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `   <-- ${r.detail}`}`);
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  console.log("===========================================================\n");

  await prisma.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error("LIVE VERIFICATION CRASHED:", error);
  await prisma.$disconnect();
  process.exit(2);
});
