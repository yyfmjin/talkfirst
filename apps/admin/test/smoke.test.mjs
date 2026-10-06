import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

test("admin login page guards non-admin accounts", () => {
  const source = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  assert.match(source, /\/admin\/me/);
  assert.match(source, /isAdmin/);
});

test("admin console calls the real paged admin APIs", () => {
  const users = readFileSync(new URL("../src/app/users/page.tsx", import.meta.url), "utf8");
  const reports = readFileSync(new URL("../src/app/reports/page.tsx", import.meta.url), "utf8");
  assert.match(users, /\/admin\/users\?/);
  assert.match(reports, /\/admin\/reports\?/);
});

// Phase B4: the reports queue gained reason / target / reporter / reportedUser /
// date filters, and its landing state is no longer `status=OPEN`.
//
// Two contracts are worth pinning here, and a source assertion is the right tool
// because they are about *what the page sends*, not what it renders:
//
//   1. Filtering is the backend's job. Every control must become a query
//      parameter rather than a client-side filter over one fetched page.
//   2. 「全部状态」 is a UI-only value and must never reach the API. Sending
//      `status=ALL` would be a 400 (`ALL` is not a `ReportStatus`), so the
//      page has to omit the parameter instead of forwarding the label.
test("reports list sends every Phase B4 filter to the API", () => {
  const reports = readFileSync(new URL("../src/app/reports/page.tsx", import.meta.url), "utf8");

  for (const param of [
    "status",
    "reason",
    "targetType",
    "reporter",
    "reportedUser",
    "createdFrom",
    "createdTo",
  ]) {
    assert.match(reports, new RegExp(`params\\.set\\("${param}"`), `missing query parameter ${param}`);
  }

  // 「全部」 is a label, not a status: it is filtered out before the request is
  // built. If this ever becomes an unconditional `params.set("status", ...)`,
  // the default view would 400 on load.
  assert.match(reports, /filters\.status !== "ALL"/);
  // Pagination comes from the API's own totalPages, so a zero-row result is
  // "no pages" rather than 「第 1 / 0 页」.
  assert.match(reports, /totalPages/);
  // `createdTo` is a literal `lte` on the wire, so the date input's day is
  // completed here — the only place that knows the operator picked a date.
  assert.match(reports, /T23:59:59\.999Z/);
  // The Phase B4 empty-state distinction must survive: a filtered miss and a
  // genuinely empty queue are different problems with different copy.
  assert.match(reports, /没有符合当前筛选条件的举报/);
  assert.match(reports, /系统中还没有任何举报/);
  // A report has no `targetType` column, so the badge is derived from messageId.
  assert.match(reports, /report-target-badge/);
});

// Phase B2: the users list gained country / date-range / sort filters. The
// contract worth pinning here is that the *backend* does the filtering — the
// page must send these as query parameters rather than fetching a page and
// hiding rows, which would make `total` and the page count describe a
// different set than the one on screen.
test("users list sends every Phase B2 filter to the API", () => {
  const users = readFileSync(new URL("../src/app/users/page.tsx", import.meta.url), "utf8");

  for (const param of ["search", "status", "country", "createdFrom", "createdTo", "sort"]) {
    assert.match(users, new RegExp(`params\\.set\\("${param}"`), `missing query parameter ${param}`);
  }
  // Pagination comes from the API's own totalPages, so a zero-row result is
  // "no pages" rather than 「第 1 / 0 页」.
  assert.match(users, /totalPages/);
  assert.match(users, /暂无用户/);
  // Every row states its status, its creation time and its last activity.
  assert.match(users, /status-badge/);
  assert.match(users, /创建 /);
  assert.match(users, /最近活跃 /);
  // The Phase A write surfaces must survive the rework.
  assert.match(users, /\/admin\/users\/\$\{user\.id\}\/status`, "POST"/);
  assert.match(users, /写一条内部备注…/);
});

// Phase B1: the dashboard moved from `/` to `/dashboard`. `/` is now a
// redirect, so the old route keeps working for the login screen and for the
// shared `loginAndLand()` helper.
// Phase B3: the user detail page gained aggregate cards and an audit summary.
// The contract worth pinning is that the console shows *counts* (computed by
// the backend) rather than list lengths, and that the audit renderer respects
// the SYSTEM vs USER actor distinction.
test("user detail renders Phase B3 aggregates and audit actor types", () => {
  const detail = readFileSync(new URL("../src/app/users/[id]/page.tsx", import.meta.url), "utf8");

  assert.match(detail, /profileCompletion/);
  assert.match(detail, /connectionCount/);
  assert.match(detail, /reportsReceivedCount/);
  assert.match(detail, /reportsMadeCount/);
  assert.match(detail, /blocksMadeCount/);
  assert.match(detail, /blocksReceivedCount/);
  assert.match(detail, /socialAccountCount/);
  assert.match(detail, /auditSummary/);
  // The UI must not expose raw database field names.
  assert.match(detail, /资料完整度/);
  assert.match(detail, /收到举报/);
  assert.match(detail, /发出举报/);
  assert.match(detail, /被封锁/);
  assert.match(detail, /封锁他人/);
  assert.match(detail, /社交账号/);
  // SYSTEM rows render as 「系统 · 自动」; USER rows show the admin id.
  assert.match(detail, /系统 · 自动/);
  assert.match(detail, /actorType === "SYSTEM"/);
  // Status action stays POST — PATCH is an API-only addition this phase.
  assert.match(detail, /\/admin\/users\/\$\{userId\}\/status`, "POST"/);
});

test("dashboard reads the real dashboard API and lives at /dashboard", () => {
  const dashboard = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  const root = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /\/admin\/dashboard/);
  // The SYSTEM actor must be rendered from `actorType`, never from `adminId`.
  assert.match(dashboard, /actorType === "SYSTEM"/);
  assert.match(root, /redirect\("\/dashboard"\)/);
});

// Phase B5: the moderation workbench reuses the Reports API rather than adding a
// second backend. Two contracts are worth pinning at the source level, because
// they are about *which endpoint the page calls*, not about what it renders:
//
//   1. It must call `/admin/reports`, not `/admin/moderation`. A parallel
//      endpoint would be two URLs over one implementation, and gating it on
//      `moderation:read` would take Reports access away from SUPPORT and
//      ANALYST, who hold `reports:read` today.
//   2. Enforcement must go through the existing user-status endpoint. A
//      `/admin/moderation/:id/ban` route would be a second set of status rules.
test("phase B5: the moderation workbench reuses the reports and status APIs", () => {
  const queue = readFileSync(new URL("../src/app/moderation/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(
    new URL("../src/app/moderation/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  // Reads the real reports queue. `status` is sent as a single value — the API
  // takes one, and an unknown value is silently ignored, so a multi-value status
  // would quietly return every report instead of erroring. Asserted as an actual
  // `params.set` call: a bare `/OPEN,REVIEWING/` match would also hit the comment
  // that explains why the multi-value form is avoided.
  assert.match(queue, /\/admin\/reports\?/);
  assert.match(queue, /params\.set\("status", status\)/);
  assert.doesNotMatch(queue, /params\.set\("status",\s*"[^"]*,/);

  // No moderation endpoint is ever *called*. Matched against a call/import
  // position rather than a bare substring, because both files explain in prose
  // that no such endpoint exists — and that explanation would match a loose
  // pattern, failing the test for documenting the very rule it enforces.
  for (const source of [queue, detail]) {
    assert.doesNotMatch(source, /apiFetch<[^>]*>\("\/admin\/moderation/);
    assert.doesNotMatch(source, /apiSend\("\/admin\/moderation/);
  }

  // Detail reads one report; review and enforcement reuse the existing routes.
  assert.match(detail, /\/admin\/reports\/\$\{reportId\}/);
  assert.match(detail, /\/admin\/reports\/\$\{reportId\}\/review`, "POST"/);
  assert.match(detail, /\/admin\/users\/\$\{data\.reportedUser\.id\}\/status`, "POST"/);

  // The target type is derived, never read: there is no `targetType` column.
  //
  // FIX (Phase O0): this assertion used to require the *inline* ternary
  // `item.messageId ? "MESSAGE" : "USER"` in the page body. The derivation was
  // later moved to the shared `lib/report-target.ts` helper (so the reports
  // queue, the moderation queue and both detail screens cannot drift apart) and
  // the page now calls `deriveReportTargetType(item)`. The assertion therefore
  // failed against correct code, and because `package.json` runs this file
  // before `playwright test`, that single stale regex made the ENTIRE admin
  // suite unreachable through `npm test` — the same failure mode audit P005(t)
  // already fixed once for the nav literal.
  //
  // What actually matters is the invariant, not the syntax that expresses it:
  // the page must derive the type through the shared helper (never a local
  // re-implementation of the rule), and it must expose which type it derived.
  // Asserting the helper is used also captures a guarantee the old ternary
  // never had — MOMENT reports are classified correctly.
  assert.match(queue, /import\s*\{[^}]*deriveReportTargetType[^}]*\}\s*from\s*"@\/lib\/report-target"/);
  assert.match(queue, /const target = deriveReportTargetType\(item\)/);
  // A local re-implementation is what the shared helper exists to prevent.
  assert.doesNotMatch(queue, /item\.messageId \? "MESSAGE" : "USER"/);
  assert.match(queue, /data-target-type=\{target\}/);
  assert.match(queue, /moderation-target-badge/);

  // History is the audit log, and a SYSTEM row is rendered from `actorType`
  // before `adminId` is touched (a SYSTEM row has a NULL adminId).
  assert.match(detail, /actorType === "SYSTEM"/);
  assert.match(detail, /系统 · 自动/);

  // Both message-unavailable reasons stay distinct, and neither may 500.
  assert.match(detail, /该消息已被删除/);
  assert.match(detail, /这条举报没有关联消息/);

  // 「第 1 / 0 页」 must never render: totalPages is the API's ceiling and is 0
  // for an empty result set.
  assert.match(queue, /totalPages/);
  assert.match(queue, /暂无待处理举报/);
});

// Phase B5: the workbench gate is `reports:read`, not `moderation:read`. This is
// an access-preservation contract, not a cosmetic one — `moderation:read` is
// held by three roles while `reports:read` is held by all five, so keying the
// nav entry on the former would silently remove the page from SUPPORT and
// ANALYST. The two permissions are also left defined and unused on purpose.
test("phase B5: the nav entry preserves reports:read and does not activate moderation:read", () => {
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");

  const navLine = shell.split("\n").find((line) => line.includes('"/moderation"'));
  assert.ok(navLine, "the moderation nav entry is missing");
  assert.match(navLine, /reports:read/);
  assert.doesNotMatch(navLine, /moderation:read/);
});

// Phase C1: the Risk Center is an *overview of facts that already exist*, not a
// risk engine. Three source-level contracts carry that definition, and each of
// them is the kind of thing a later "let's make it look smarter" change would
// quietly break:
//
//   1. One read endpoint. `GET /admin/risk` is the entire API surface. A
//      `/admin/risk/:id` or `/admin/risk/score` would imply a Risk domain that
//      has no tables behind it.
//   2. No invented severity. There is no `riskLevel` column anywhere in the
//      schema and no scoring algorithm. `riskScore` / `riskLevel` appearing in
//      the page would mean a number is being made up and shown to an operator
//      as fact.
//   3. The self-report signal keeps its honest label. It is a *signal awaiting
//      review*, not a verdict: a real report whose reporter and reported user
//      happen to be the same account.
test("phase C1: the risk page calls exactly one read endpoint and invents no severity", () => {
  const risk = readFileSync(new URL("../src/app/risk/page.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");

  // (1) The only Endpoint the page may touch is `/admin/risk`. Matched in a
  // call position so the doc comments that explain *why* the other routes are
  // absent do not match a bare substring.
  assert.match(risk, /apiFetch<[^>]*>\("\/admin\/risk"/);
  for (const forbidden of [
    "/admin/risk/",
    "/admin/riskScore",
    "/admin/risk-level",
    "/admin/moderation",
  ]) {
    assert.doesNotMatch(
      risk,
      new RegExp(`api(Fetch|Send)\\(\\"[^"]*${forbidden.replace(/[/\\-]/g, "\\$&")}`),
      `the risk page must not call ${forbidden}`,
    );
  }
  // It is a read-only view: the page issues no write at all.
  assert.doesNotMatch(risk, /apiSend\(/);

  // (2) No fabricated severity. These identifiers do not exist in the Prisma
  // schema, so any occurrence is a locally invented value.
  for (const invented of ["riskScore", "riskLevel", "riskTier", "高风险", "中风险", "低风险"]) {
    assert.doesNotMatch(risk, new RegExp(invented), `the risk page must not invent ${invented}`);
  }
  // What it renders instead is the stored status, plus an explicit disclaimer
  // that counts are not a rating.
  assert.match(risk, /不构成风险评级/);

  // (3) The ambiguous self-report signal keeps its narrow, unjudging wording.
  assert.match(risk, /待核查异常举报/);
  assert.doesNotMatch(risk, /机器举报|恶意用户|诈骗/);

  // Gating: `risk:read` only. `risk:write` does not exist and must not be sent.
  const navLine = shell.split("\n").find((line) => line.includes('"/risk"'));
  assert.ok(navLine, "the risk nav entry is missing");
  assert.match(navLine, /risk:read/);
  assert.doesNotMatch(navLine, /risk:write/);

  // Every KPI card carries a per-label test id. A browser test cannot locate
  // "the card that holds this label" by filtering an ancestor `div` — the KPI
  // grid contains every label, so the filter matches the grid and the value
  // read back belongs to whichever card happens to be first. The key is what
  // makes the browser assertion bind a number to its own label, so it is a
  // contract rather than a styling detail.
  assert.match(risk, /data-testid=\{`risk-kpi-\$\{label\}`\}/);
});

// Phase C1: the Risk page is a consumer of the shell's session context, which
// means it has to sit *inside* the provider. `<Shell>` renders
// `AdminSessionProvider`, so the provider is not an ancestor of a component
// that Shell itself renders — reading the session at the top of the page module
// throws on first render. The page therefore wraps an inner screen component.
// This is a source assertion because the failure mode is a runtime throw, not a
// type error, so `tsc --noEmit` does not catch it.
test("phase C1: the risk page reads the session inside the Shell provider", () => {
  const risk = readFileSync(new URL("../src/app/risk/page.tsx", import.meta.url), "utf8");

  // Exactly one default export, and no other named export: an extra export
  // breaks `next build` while leaving `tsc` happy.
  const exports = risk.match(/^\s*export\s+(?!(default|type|interface)\b)/gm) ?? [];
  assert.equal(exports.length, 0, "the page module must not have named exports");
  assert.match(risk, /export default function RiskPage\(\)/);
  // The default export delegates to an inner component that sits under Shell.
  assert.match(risk, /<Shell>/);
  assert.match(risk, /<RiskScreen\s*\/>/);
  assert.match(risk, /function RiskScreen\(\)/);
});

// Phase C2: the connections screens are read-only and must not reach into the
// neighbouring domains. A source assertion is the right tool for the second
// half, because "the page never calls an exchange endpoint" is a property of
// *what it sends*, which a rendered-UI test can only ever sample.
//
//   1. Both screens issue GETs only. `apiSend(` in either file would be a
//      mutation, and Phase C2 ships none — `connections:write` existing in the
//      matrix describes the role model, not an obligation to write.
//   2. No exchange (C3) or block (C4) surface. A `Connection` is a link between
//      two users; showing either party's social handles or block status would
//      be answering a question this phase was not asked.
//   3. `conversationId` renders as 「未关联」 when null. The column is
//      `String? @unique`, so null is legal stored data and must be shown as
//      such — not silently blanked.
test("phase C2: the connections screens are read-only and stay out of C3/C4", () => {
  const list = readFileSync(new URL("../src/app/connections/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(
    new URL("../src/app/connections/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");

  // (1) GET only, on both screens.
  for (const source of [list, detail]) {
    assert.doesNotMatch(source, /apiSend\(/, "the connections screens must not mutate");
    assert.doesNotMatch(source, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
  }
  // The list builds its query string into a template literal on the line below
  // the call, so whitespace is allowed between `(` and the backtick.
  assert.match(list, /apiFetch<ConnectionListResponse>\(\s*`\/admin\/connections/);
  assert.match(detail, /apiFetch<ConnectionDetailResponse>\(`\/admin\/connections\/\$\{id\}`/);

  // (2) No reach into the neighbouring phases.
  for (const source of [list, detail]) {
    for (const forbidden of [
      "/admin/exchanges",
      "/admin/blocks",
      "SharedSocialAccount",
      "SocialAccount",
      "handle",
    ]) {
      assert.doesNotMatch(
        source,
        new RegExp(forbidden),
        `the connections screens must not touch ${forbidden}`,
      );
    }
  }

  // (3) A null conversationId is stated, not blanked.
  assert.match(detail, /未关联/);

  // Gating: `connections:read` only, and it must sit between 风险中心 and
  // 审计日志 per the mandated nav order.
  const navLine = shell.split("\n").find((line) => line.includes('"/connections"'));
  assert.ok(navLine, "the connections nav entry is missing");
  assert.match(navLine, /connections:read/);
  assert.doesNotMatch(navLine, /connections:write/);
});

// Phase C2: both connection pages are consumers of the shell's session context,
// so each has to sit *inside* the provider the way the rest of the console
// does. The failure mode is a runtime throw on first render, which `tsc` does
// not catch — and `next build` fails on an extra named export while `tsc` does
// not, so both are asserted here.
test("phase C2: both connection pages read the session inside the Shell provider", () => {
  const pages = [
    ["../src/app/connections/page.tsx", "ConnectionsPage", "ConnectionsScreen"],
    ["../src/app/connections/[id]/page.tsx", "ConnectionDetailPage", "ConnectionDetailScreen"],
  ];

  for (const [path, outerName, innerName] of pages) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    // Exactly one default export, and no other named export.
    const named = source.match(/^\s*export\s+(?!(default|type|interface)\b)/gm) ?? [];
    assert.equal(named.length, 0, `${path} must not have named exports`);

    assert.match(source, new RegExp(`export default function ${outerName}\\(\\)`));
    assert.match(source, /<Shell>/);
    assert.match(source, new RegExp(`<${innerName}\\s*/>`));
    assert.match(source, new RegExp(`function ${innerName}\\(\\)`));
  }
});

/**
 * Removes block and line comments, so a source assertion is about the code
 * rather than about the prose around it.
 *
 * This exists for the Phase C3 privacy check below. The exchange screens
 * explain *why* a social handle is absent, so the word legitimately appears in
 * their documentation. Scanning the raw file would either fail on the comments
 * or force the comments to be vaguer than they should be — and neither is
 * right, because the invariant being pinned is about what the code does.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// Phase C3: the contact-exchange screens are read-only, and they never surface a
// social handle.
//
// A source assertion is the right tool for the privacy half: "this screen never
// names a shared account or its handle" is a property of what the file contains,
// which a rendered-UI test can only ever sample. The complementary guarantees —
// that the API does not return the handle either — are asserted in
// `admin-exchanges.spec.ts` (API) and `scripts/phaseA-rbac-verify.mjs` (real
// HTTP + real database).
test("phase C3: the exchange screens are read-only and never name a handle", () => {
  const list = readFileSync(new URL("../src/app/exchanges/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(
    new URL("../src/app/exchanges/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");

  // (1) GET only, on both screens. `exchanges:write` exists in the permission
  // matrix; Phase C3 ships no mutation, so `apiSend(` anywhere here is a defect.
  for (const source of [list, detail]) {
    assert.doesNotMatch(source, /apiSend\(/, "the exchange screens must not mutate");
    assert.doesNotMatch(source, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
  }
  // The list builds its query string in `buildPath` (so the same code serves
  // paging and filtering), the detail interpolates the id directly.
  assert.match(list, /apiFetch<ExchangeListResponse>\(buildPath\(/);
  assert.match(list, /`\/admin\/exchanges\$\{query/);
  assert.match(detail, /apiFetch<ExchangeDetailResponse>\(`\/admin\/exchanges\/\$\{id\}`/);

  // (2) The privacy invariant, asserted on code with the prose stripped. The
  // screens never reference a social account or its handle, so there is nothing
  // to render even if the API were to start returning one.
  for (const source of [stripComments(detail), stripComments(list)]) {
    for (const forbidden of ["handle", "socialAccount", "SocialAccount", "/admin/blocks"]) {
      assert.doesNotMatch(
        source,
        new RegExp(forbidden),
        `the exchange screens must not touch ${forbidden}`,
      );
    }
  }
  // The share *relation* is what is shown instead — owner granted, viewer
  // received — which is meaningful without the account behind it.
  assert.match(detail, /sharedAccounts/);
  assert.match(detail, /ownerId/);
  assert.match(detail, /viewerId/);

  // (3) The honest fallbacks. An exchange whose connectionId points at nothing,
  // and an exchange nobody has acted on, both have to say so rather than render
  // a blank or a plausible-looking row.
  assert.match(detail, /连接记录不可用/);
  assert.match(detail, /暂无处理记录/);
  assert.match(list, /暂无交换记录/);

  // (4) `createdTo` is widened to the end of the day. The API compares it
  // literally, so a bare date would silently mean midnight and exclude the whole
  // day the operator selected.
  assert.match(list, /T23:59:59\.999Z/);

  // (5) Every one of the four real `ExchangeStatus` values is offered, and no
  // invented one is — `EXPIRED` / `COMPLETED` / `REVOKED` are not stored states.
  for (const status of ["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"]) {
    assert.match(list, new RegExp(`"${status}"`));
  }
  for (const invented of ["EXPIRED", "COMPLETED", "REVOKED"]) {
    assert.doesNotMatch(list, new RegExp(`"${invented}"`));
  }

  // (6) Gating: `exchanges:read` only, and the entry sits between 连接 and
  // 审计日志 per the mandated nav order.
  const navLine = shell.split("\n").find((line) => line.includes('"/exchanges"'));
  assert.ok(navLine, "the exchanges nav entry is missing");
  assert.match(navLine, /exchanges:read/);
  assert.doesNotMatch(navLine, /exchanges:write/);

  const connectionsAt = shell.indexOf('"/connections"');
  const exchangesAt = shell.indexOf('"/exchanges"');
  const auditAt = shell.indexOf('"/audit"');
  assert.ok(
    connectionsAt > -1 && connectionsAt < exchangesAt && exchangesAt < auditAt,
    "the 交换 nav entry must sit between 连接 and 审计日志",
  );
});

// Phase C3: both exchange pages are consumers of the shell's session context, so
// each has to sit *inside* the provider the way the rest of the console does.
// The failure mode is a runtime throw on first render, which `tsc` does not
// catch — and `next build` fails on an extra named export while `tsc` does not,
// so both are asserted here.
test("phase C3: both exchange pages read the session inside the Shell provider", () => {
  const pages = [
    ["../src/app/exchanges/page.tsx", "ExchangesPage", "ExchangesScreen"],
    ["../src/app/exchanges/[id]/page.tsx", "ExchangeDetailPage", "ExchangeDetailScreen"],
  ];

  for (const [path, outerName, innerName] of pages) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    // Exactly one default export, and no other named export.
    const named = source.match(/^\s*export\s+(?!(default|type|interface)\b)/gm) ?? [];
    assert.equal(named.length, 0, `${path} must not have named exports`);

    assert.match(source, new RegExp(`export default function ${outerName}\\(\\)`));
    assert.match(source, /<Shell>/);
    assert.match(source, new RegExp(`<${innerName}\\s*/>`));
    assert.match(source, new RegExp(`function ${innerName}\\(\\)`));
  }
});

// Phase C4: the block screens are read-only, they never name a social account or
// a handle, and the direction is stated rather than implied.
//
// A source assertion is the right tool for the privacy half: "this screen never
// names a social account or its handle" is a property of what the file contains,
// which a rendered-UI test can only ever sample. The complementary guarantees —
// that the API does not return the handle either, and that a read writes no
// audit row — are asserted in `admin-blocks.spec.ts` (API) and
// `scripts/phaseA-rbac-verify.mjs` (real HTTP + real database).
test("phase C4: the block screens are read-only and never name a handle", () => {
  const list = readFileSync(new URL("../src/app/blocks/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(
    new URL("../src/app/blocks/[blockerId]/[blockedId]/page.tsx", import.meta.url),
    "utf8",
  );
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");

  // (1) GET only, on both screens. `blocks:write` exists in the permission
  // matrix; Phase C4 ships no mutation, so `apiSend(` anywhere here is a defect.
  for (const source of [list, detail]) {
    assert.doesNotMatch(source, /apiSend\(/, "the block screens must not mutate");
    assert.doesNotMatch(source, /method:\s*"(POST|PATCH|PUT|DELETE)"/);
  }
  // The list builds its query string in `buildPath` (so the same code serves
  // paging and filtering); the detail interpolates both halves of the key.
  assert.match(list, /apiFetch<BlockListResponse>\(buildPath\(/);
  assert.match(list, /`\/admin\/blocks\$\{query/);
  assert.match(
    detail,
    /apiFetch<BlockDetailResponse>\(\s*`\/admin\/blocks\/\$\{blockerId\}\/\$\{blockedId\}`/,
  );

  // (2) The privacy invariant, asserted on code with the prose stripped. A block
  // is not a social-account audit: these screens never reference a social
  // account or its handle, and never reach into a neighbouring domain.
  //
  // The field-level tokens are checked rather than the bare words `message` and
  // `conversation`, because `friendlyError` legitimately has a local variable
  // called `message` — a bare-word scan would fail on the error handler and
  // force the handler to be renamed to satisfy a test, which is backwards.
  for (const source of [stripComments(detail), stripComments(list)]) {
    for (const forbidden of [
      "handle",
      "socialAccount",
      "SocialAccount",
      "conversationId",
      "sharedAccounts",
      "/admin/exchanges",
      "/admin/connections",
    ]) {
      assert.doesNotMatch(
        source,
        new RegExp(forbidden),
        `the block screens must not touch ${forbidden}`,
      );
    }
  }

  // (3) There is no `id`. `Block` declares `@@id([blockerId, blockedId])`, so the
  // pair is the key, the link is pair-addressed, and no synthetic identifier is
  // ever rendered.
  assert.match(list, /item\.blockerId/);
  assert.match(list, /item\.blockedId/);
  assert.match(list, /href=\{`\/blocks\/\$\{item\.blockerId\}\/\$\{item\.blockedId\}`\}/);
  assert.doesNotMatch(list, /item\.id\b/, "a block has no single-column id");
  assert.doesNotMatch(detail, /params\.id\b/, "the detail route takes a pair, not an id");
  assert.match(detail, /params\.blockerId/);
  assert.match(detail, /params\.blockedId/);

  // (4) The direction is explicit. Both roles are labelled and the verb is
  // rendered, so the pair can never be read as unordered.
  for (const source of [list, detail]) {
    assert.match(source, /屏蔽方/);
    assert.match(source, /被屏蔽方/);
  }
  assert.match(detail, /屏蔽 ↓/);
  assert.match(list, /屏蔽 →/);

  // (5) No write control exists anywhere. 「查看」 is the only per-row action.
  for (const source of [list, detail]) {
    for (const verb of ["解封", "取消屏蔽", "删除", "恢复", "编辑"]) {
      assert.doesNotMatch(
        source,
        new RegExp(`>\\s*${verb}\\s*<`),
        `the block screens must not offer ${verb}`,
      );
    }
  }
  assert.match(list, />\s*查看\s*</);

  // (6) The honest empty states, and the end-of-day widening the API requires
  // because it compares `createdTo` literally.
  assert.match(list, /暂无屏蔽记录/);
  assert.match(detail, /暂无处理记录/);
  assert.match(list, /T23:59:59\.999Z/);

  // (7) Every sort key the API whitelists is offered, and no invented one is.
  for (const key of [
    "createdAt_desc",
    "createdAt_asc",
    "blocker_nickname_asc",
    "blocker_nickname_desc",
    "blocked_nickname_asc",
    "blocked_nickname_desc",
  ]) {
    assert.match(list, new RegExp(`"${key}"`));
  }

  // (8) Gating: `blocks:read` only, and the entry sits between 交换 and
  // 审计日志 per the mandated nav order.
  const navLine = shell.split("\n").find((line) => line.includes('"/blocks"'));
  assert.ok(navLine, "the blocks nav entry is missing");
  assert.match(navLine, /blocks:read/);
  assert.doesNotMatch(navLine, /blocks:write/);

  const exchangesAt = shell.indexOf('"/exchanges"');
  const blocksAt = shell.indexOf('"/blocks"');
  const auditAt = shell.indexOf('"/audit"');
  assert.ok(
    exchangesAt > -1 && exchangesAt < blocksAt && blocksAt < auditAt,
    "the 屏蔽 nav entry must sit between 交换 and 审计日志",
  );
});

// Phase C4: both block pages are consumers of the shell's session context, so
// each has to sit *inside* the provider the way the rest of the console does.
// The failure mode is a runtime throw on first render, which `tsc` does not
// catch — and `next build` fails on an extra named export while `tsc` does not,
// so both are asserted here.
test("phase C4: both block pages read the session inside the Shell provider", () => {
  const pages = [
    ["../src/app/blocks/page.tsx", "BlocksPage", "BlocksScreen"],
    [
      "../src/app/blocks/[blockerId]/[blockedId]/page.tsx",
      "BlockDetailPage",
      "BlockDetailScreen",
    ],
  ];

  for (const [path, outerName, innerName] of pages) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    // Exactly one default export, and no other named export.
    const named = source.match(/^\s*export\s+(?!(default|type|interface)\b)/gm) ?? [];
    assert.equal(named.length, 0, `${path} must not have named exports`);

    assert.match(source, new RegExp(`export default function ${outerName}\\(\\)`));
    assert.match(source, /<Shell>/);
    assert.match(source, new RegExp(`<${innerName}\\s*/>`));
    assert.match(source, new RegExp(`function ${innerName}\\(\\)`));
  }
});

// Phase C4: the API side of the contract. The admin app has no view of the
// NestJS controller, so this reads it directly — a source assertion is the right
// tool for "exactly two routes exist, and both are GET", which no runtime test
// can state as cheaply.
test("phase C4: the API exposes exactly two block routes, both read-only", () => {
  const controller = readFileSync(
    new URL("../../../apps/api/src/admin/admin.controller.ts", import.meta.url),
    "utf8",
  );
  const service = readFileSync(
    new URL("../../../apps/api/src/admin/admin.service.ts", import.meta.url),
    "utf8",
  );

  // (1) Two GET routes, both gated on blocks:read.
  assert.match(controller, /@Get\("blocks"\)\s*\n\s*@RequirePermission\("blocks:read"\)/);
  assert.match(
    controller,
    /@Get\("blocks\/:blockerId\/:blockedId"\)\s*\n\s*@RequirePermission\("blocks:read"\)/,
  );

  // (2) No mutation route exists under any spelling. `blocks:write` is present
  // in the permission matrix and deliberately unused.
  for (const method of ["Post", "Patch", "Put", "Delete"]) {
    const blockRoutes = controller.match(new RegExp(`@${method}\\("[^"]*block[^"]*"\\)`, "gi")) ?? [];
    assert.deepEqual(blockRoutes, [], `a block ${method.toUpperCase()} route must not exist`);
  }
  assert.doesNotMatch(controller, /@RequirePermission\("blocks:write"\)/);

  // (3) The detail route is pair-addressed, and no single-id block route exists.
  assert.doesNotMatch(controller, /@Get\("blocks\/:id"\)/);

  // (4) The service uses explicit selects and never an `include`, so no relation
  // can ride along by accident.
  for (const name of ["BLOCK_LIST_SELECT", "BLOCK_DETAIL_SELECT", "BLOCK_HISTORY_SELECT"]) {
    assert.match(service, new RegExp(`export const ${name} = \\{`));
  }
  for (const name of ["BLOCK_LIST_SELECT", "BLOCK_DETAIL_SELECT"]) {
    const start = service.indexOf(`export const ${name} = {`);
    const body = service.slice(start, service.indexOf("} as const", start));
    assert.doesNotMatch(body, /include/, `${name} must not include a relation wholesale`);
    assert.match(body, /blocker: \{ select: \{ id: true, nickname: true \} \}/);
    assert.match(body, /blocked: \{ select: \{ id: true, nickname: true \} \}/);
  }

  // (5) The composite key is the lookup key, not a fabricated id, and the 404
  // follows the existing `*_NOT_FOUND` convention.
  assert.match(service, /where: \{ blockerId_blockedId: \{ blockerId, blockedId \} \}/);
  assert.match(service, /code: "BLOCK_NOT_FOUND"/);
});

/* ------------------------------------------------------------------ *
 * Phase C5 — Integration
 *
 * C1–C4 each shipped one domain and each was verified on its own. C5 asks a
 * different question: do the finished domains agree *with each other*? Same
 * nine entries on the sidebar, same permission matrix on both sides of the
 * wire, no write route smuggled in beside a read one, and no schema or
 * migration churn while "integration" work was happening.
 *
 * A source assertion is the right tool for each of these because each is a
 * statement about the *shape of the codebase* — which routes exist, which
 * permissions are granted, how many models the schema declares — rather than
 * about one rendered page. The runtime half of the same contracts (real HTTP
 * against real PostgreSQL, with the API's own answers reconciled against
 * independent SQL) lives in `scripts/phaseA-rbac-verify.mjs`.
 * ------------------------------------------------------------------ */

const API_ADMIN_DIR = "../../../apps/api/src/admin";
const REPO_ROOT = "../../..";
const C5_ROLES = ["SUPER_ADMIN", "MODERATOR", "SUPPORT", "ANALYST", "CONTENT_MANAGER"];

/**
 * Slice one role's entry out of a `Record<AdminRole, ...>` literal.
 *
 * The slice runs from the role key to whichever comes first: the next role key,
 * or the record's closing `};`. That is what makes it safe to read both files
 * with one helper — the backend writes `SUPER_ADMIN: PERMISSIONS,` while the
 * frontend writes `SUPER_ADMIN: ALL,`, and the backend spells SUPPORT across
 * four lines where the frontend keeps it on one.
 */
function c5RoleBlock(source, recordName, role) {
  const recordAt = source.indexOf(recordName);
  assert.ok(recordAt > -1, `${recordName} is missing from the source`);
  const start = source.indexOf(`\n  ${role}:`, recordAt);
  assert.ok(start > -1, `${role} is missing from ${recordName}`);

  let end = source.indexOf("\n};", start);
  if (end === -1) end = source.length;
  for (const other of C5_ROLES) {
    if (other === role) continue;
    const at = source.indexOf(`\n  ${other}:`, start + 1);
    if (at > -1 && at < end) end = at;
  }
  return source.slice(start, end);
}

/**
 * Phase C5: every admin domain is reachable — a page exists for it, and the
 * API route that backs it is gated on the permission the sidebar advertises.
 *
 * The two halves are asserted together on purpose. Checking the pages alone
 * would miss a route that lost its `@RequirePermission`, and checking the
 * controller alone would miss a page added without a gate.
 */
test("phase C5: all nine admin domains have a page, and every data route is permission-gated", () => {
  const controller = readFileSync(new URL(`${API_ADMIN_DIR}/admin.controller.ts`, import.meta.url), "utf8");

  // `moderation` is the one deliberate exception: it has pages but no route of
  // its own, because it reuses `/admin/reports` (pinned by the Phase B5 test).
  const domains = [
    ["../src/app/dashboard/page.tsx", /@Get\("dashboard"\)\s*\n\s*@RequirePermission\("dashboard:read"\)/],
    ["../src/app/users/page.tsx", /@Get\("users"\)\s*\n\s*@RequirePermission\("users:read"\)/],
    ["../src/app/users/[id]/page.tsx", /@Get\("users\/:id"\)\s*\n\s*@RequirePermission\("users:read"\)/],
    ["../src/app/reports/page.tsx", /@Get\("reports"\)\s*\n\s*@RequirePermission\("reports:read"\)/],
    ["../src/app/reports/[id]/page.tsx", /@Get\("reports\/:id"\)\s*\n\s*@RequirePermission\("reports:read"\)/],
    ["../src/app/moderation/page.tsx", null],
    ["../src/app/moderation/[id]/page.tsx", null],
    ["../src/app/risk/page.tsx", /@Get\("risk"\)\s*\n\s*@RequirePermission\("risk:read"\)/],
    ["../src/app/connections/page.tsx", /@Get\("connections"\)\s*\n\s*@RequirePermission\("connections:read"\)/],
    ["../src/app/connections/[id]/page.tsx", /@Get\("connections\/:id"\)\s*\n\s*@RequirePermission\("connections:read"\)/],
    ["../src/app/exchanges/page.tsx", /@Get\("exchanges"\)\s*\n\s*@RequirePermission\("exchanges:read"\)/],
    ["../src/app/exchanges/[id]/page.tsx", /@Get\("exchanges\/:id"\)\s*\n\s*@RequirePermission\("exchanges:read"\)/],
    ["../src/app/blocks/page.tsx", /@Get\("blocks"\)\s*\n\s*@RequirePermission\("blocks:read"\)/],
    ["../src/app/blocks/[blockerId]/[blockedId]/page.tsx", /@Get\("blocks\/:blockerId\/:blockedId"\)\s*\n\s*@RequirePermission\("blocks:read"\)/],
    ["../src/app/audit/page.tsx", /@Get\("audit"\)\s*\n\s*@RequirePermission\("audit:read"\)/],
    // Phase O2 — the ops domain. Three routes, all `ops:read`; the list is the
    // one the page calls, so it is the one pinned against the page.
    [
      "../src/app/ops/access-logs/page.tsx",
      /@Get\("access-logs"\)\s*\n\s*@RequirePermission\("ops:read"\)/,
    ],
  ];

  for (const [page, route] of domains) {
    // `readFileSync` throws when the page is absent, which is the failure we want.
    readFileSync(new URL(page, import.meta.url), "utf8");
    if (route) assert.match(controller, route, `${page} has no matching permission-gated route`);
  }
});

/**
 * Phase C5: the sidebar lists exactly the nine domains, in the mandated order,
 * each against the permission it is gated on.
 *
 * FIX (audit P005): this assertion used to hard-code the flat nine-entry order
 * from before the sidebar was grouped into sections. When `shell.tsx` moved to
 * four titled groups, the expectation was not updated, so `assert.deepEqual`
 * failed on the SECOND element — and because `package.json` runs this file
 * before `playwright test`, the failure aborted the entire admin suite. The
 * nav could not be changed without also editing this literal, and once the
 * literal was stale nothing could run at all.
 *
 * The contract that actually matters is: the nine domains are all present,
 * exactly once each, in the documented order, each behind its own permission.
 * That is asserted here by comparing the *sequence* of hrefs and the
 * permission attached to each, which survives regrouping — the grouping itself
 * is pinned separately by `admin-shell-ui.spec.ts`.
 */
test("phase C5: the sidebar lists the documented domains in the mandated order", () => {
  const shell = readFileSync(new URL("../src/components/shell.tsx", import.meta.url), "utf8");
  const navStart = shell.indexOf("const NAV_GROUPS");
  assert.ok(navStart > -1, "the NAV_GROUPS table is missing");
  const navBlock = shell.slice(navStart, shell.indexOf("\n];", navStart));

  const entries = [...navBlock.matchAll(/href: "([^"]+)", label: "([^"]+)", permission: "([^"]+)"/g)].map(
    (match) => ({ href: match[1], label: match[2], permission: match[3] }),
  );

  // Every domain in the sidebar, with the permission each must advertise. Order
  // is the contract, so it is compared explicitly rather than sorted.
  assert.deepEqual(entries, [
    { href: "/dashboard", label: "仪表盘", permission: "dashboard:read" },
    { href: "/users", label: "用户", permission: "users:read" },
    { href: "/connections", label: "连接", permission: "connections:read" },
    { href: "/exchanges", label: "交换", permission: "exchanges:read" },
    { href: "/blocks", label: "屏蔽", permission: "blocks:read" },
    { href: "/reports", label: "举报", permission: "reports:read" },
    // `reports:read`, not `moderation:read` — see the Phase B5 test above.
    { href: "/moderation", label: "审核工作台", permission: "reports:read" },
    // The console side of the two post-O2 moderation domains. Both are gated on
    // `moderation:read`: content review is the `Moment.reviewStatus` queue, and
    // member feedback is answered by the same roles that handle reports.
    { href: "/moderation-moments", label: "内容审核", permission: "moderation:read" },
    { href: "/feedback", label: "意见反馈", permission: "moderation:read" },
    { href: "/risk", label: "风险中心", permission: "risk:read" },
    { href: "/audit", label: "审计日志", permission: "audit:read" },
    // The Discover category table is the first live user of the `settings:*` pair
    // that had been declared since Phase C5 but never wired to anything.
    { href: "/discover-categories", label: "发现页类别", permission: "settings:read" },
    // Phase O2 — site operations. `ops:read`, not `audit:read`: these rows carry
    // raw client IP and User-Agent, so the holder set is SUPER_ADMIN + ANALYST.
    { href: "/ops/access-logs", label: "访问日志", permission: "ops:read" },
    // Address bans are the one ops surface with a write route, so the nav is
    // gated on `ops:write`: ANALYST holds `ops:read` (it must) but is read-only
    // by design, and must not be shown a page it cannot use.
    { href: "/ops/ip-bans", label: "IP 封禁", permission: "ops:write" },
  ]);

  // Every advertised destination has a page behind it, so the sidebar cannot
  // point at a route that 404s.
  for (const { href } of entries) {
    readFileSync(new URL(`../src/app${href}/page.tsx`, import.meta.url), "utf8");
  }
});

/**
 * Phase C5: the permission matrix is unchanged, the three relationship domains
 * share one holder set, and the console's mirror of the matrix still matches
 * the backend's.
 *
 * This is the single most consequential thing an integration phase could get
 * wrong. A role quietly gaining `blocks:read` while the domains were wired
 * together would not fail any per-domain test — each domain would still behave
 * correctly for the roles it happened to be tested with — yet it would widen
 * who can see block relationships. So the whole matrix is pinned literally, and
 * both copies are compared against each other rather than each against itself.
 */
test("phase C5: the permission matrix is unchanged and mirrored on both sides", () => {
  const backend = readFileSync(new URL(`${API_ADMIN_DIR}/permissions.ts`, import.meta.url), "utf8");
  const frontend = readFileSync(new URL("../src/lib/permissions.ts", import.meta.url), "utf8");

  // The vocabulary itself: 22 permissions, and `risk:write` is not one of them.
  // Phase O2 added `ops:read` — the site-operations surface (HTTP access logs),
  // which carries raw client IP and User-Agent and is therefore narrower than
  // `audit:read`: SUPER_ADMIN and ANALYST only.
  //
  // The second addition is `ops:write`, and it is deliberately separate: ANALYST
  // holds `ops:read` and is read-only, so a single permission could not both let
  // ANALYST see access logs and let MODERATOR ban an address.
  const permStart = backend.indexOf("export const PERMISSIONS = [");
  assert.ok(permStart > -1, "the PERMISSIONS vocabulary is missing");
  const vocabulary = [
    ...backend.slice(permStart, backend.indexOf("] as const;", permStart)).matchAll(/"([a-z]+:[a-z]+)"/g),
  ].map((match) => match[1]);
  assert.equal(vocabulary.length, 22, "the permission vocabulary changed size");
  assert.ok(!vocabulary.includes("risk:write"), "risk:write must not exist — the Risk Centre is read-only");
  assert.ok(vocabulary.includes("ops:read"), "ops:read must exist — the ops console is gated on it");
  assert.ok(vocabulary.includes("ops:write"), "ops:write must exist — address bans are gated on it");

  const all = new Set(vocabulary);
  const expected = {
    SUPER_ADMIN: all,
    MODERATOR: new Set([
      "dashboard:read",
      "users:read",
      "users:write",
      "reports:read",
      "reports:write",
      "moderation:read",
      "moderation:write",
      "risk:read",
      "audit:read",
      // Banning an address is the same class of action as the account ban
      // `users:write` already grants this role.
      "ops:write",
    ]),
    SUPPORT: new Set(["dashboard:read", "users:read", "users:write", "reports:read", "audit:read"]),
    ANALYST: new Set([
      "dashboard:read",
      "users:read",
      "reports:read",
      "risk:read",
      "connections:read",
      "exchanges:read",
      "blocks:read",
      "audit:read",
      "settings:read",
      // Phase O2: the only non-super role that may read raw access-log data.
      "ops:read",
    ]),
    CONTENT_MANAGER: new Set([
      "dashboard:read",
      "users:read",
      "reports:read",
      "moderation:read",
      "moderation:write",
      "audit:read",
    ]),
  };

  /** Read a role's grants out of one file, resolving the `ALL` / `PERMISSIONS` shorthand. */
  const grants = (source, role) => {
    const block = c5RoleBlock(source, "ROLE_PERMISSIONS", role);
    if (/\bALL\b/.test(block) || /\bPERMISSIONS\b/.test(block)) return new Set(vocabulary);
    return new Set([...block.matchAll(/"([a-z]+:[a-z]+)"/g)].map((match) => match[1]));
  };

  for (const role of C5_ROLES) {
    assert.deepEqual(
      [...grants(backend, role)].sort(),
      [...expected[role]].sort(),
      `the backend matrix changed for ${role}`,
    );
    // The console's mirror is compared against the *backend's* answer, so a
    // drift in either file is caught — not just a drift in one of them.
    assert.deepEqual(
      [...grants(frontend, role)].sort(),
      [...grants(backend, role)].sort(),
      `the console mirror disagrees with the backend for ${role}`,
    );
  }

  // The three relationship domains are one holder set: SUPER_ADMIN + ANALYST.
  // They were shipped as three separate phases, so "they happen to agree today"
  // is worth pinning — a future phase granting one without the others would
  // make the sidebar and the API disagree about who can inspect relationships.
  const holders = (permission) => C5_ROLES.filter((role) => grants(backend, role).has(permission));
  assert.deepEqual(holders("connections:read"), ["SUPER_ADMIN", "ANALYST"]);
  assert.deepEqual(holders("exchanges:read"), holders("connections:read"));
  assert.deepEqual(holders("blocks:read"), holders("connections:read"));
  // And none of the three has a write grant that is actually in use — the
  // `:write` permissions exist in the matrix and are deliberately unused.
  assert.ok(holders("connections:write").every((role) => role === "SUPER_ADMIN"));

  // The status-action axis is a separate record and is mirrored too.
  const actions = (source, role) => [
    ...c5RoleBlock(source, "ROLE_ALLOWED_STATUS_ACTIONS", role).matchAll(/"([a-z]+)"/g),
  ].map((match) => match[1]).sort();
  for (const role of C5_ROLES) {
    assert.deepEqual(actions(frontend, role), actions(backend, role), `status actions drift for ${role}`);
  }
  // SUPPORT may not ban, MODERATOR may not ban, and neither read-only role may act.
  assert.deepEqual(actions(backend, "SUPPORT"), ["activate", "disable"]);
  assert.ok(!actions(backend, "MODERATOR").includes("ban"));
  assert.deepEqual(actions(backend, "ANALYST"), []);
  assert.deepEqual(actions(backend, "CONTENT_MANAGER"), []);
});

/**
 * Phase C5: no relationship domain gained a write route.
 *
 * `connections:write` / `exchanges:write` / `blocks:write` are present in the
 * permission matrix because the matrix describes which capability a role may
 * hold — not an obligation to ship the capability. C2/C3/C4 are inspection
 * consoles, and `connections` / `exchanges` / `blocks` / `risk` / `access-logs`
 * still hold no write route at all.
 *
 * The literal below is therefore no longer four routes: the content-moderation,
 * feedback, Discover-category and address-ban domains each added one. It is kept
 * as an explicit list rather than a count so that every new write surface has to
 * be named here on purpose.
 */
test("phase C5: no relationship domain gained a write route", () => {
  const controller = readFileSync(new URL(`${API_ADMIN_DIR}/admin.controller.ts`, import.meta.url), "utf8");

  const mutations = (controller.match(/@(Post|Patch|Put|Delete)\("[^"]*"\)/g) ?? []).sort();
  assert.deepEqual(
    mutations,
    [
      // The four C5-era routes.
      '@Patch("users/:id/status")',
      '@Post("reports/:id/review")',
      '@Post("users/:id/notes")',
      '@Post("users/:id/status")',
      // Content moderation: approving, rejecting or pulling a moment.
      '@Post("moments/:id/review")',
      // Member feedback: replying to a submission.
      '@Post("feedback/:id/review")',
      // Address bans: create and lift. `IpBan` rows are never deleted, so lifting
      // is the only way back and it is a write.
      '@Post("ip-bans")',
      '@Post("ip-bans/:id/lift")',
      // Discover categories: full CRUD, and the support address the member-facing
      // feedback page displays.
      '@Post("categories/discover")',
      '@Patch("categories/discover/:id")',
      '@Delete("categories/discover/:id")',
      '@Patch("settings/support-email")',
    ].sort(),
    "the set of admin write routes changed",
  );

  // Phase O2 adds the ops surface to the "read-only unless proven otherwise" set.
  // Access logs are an *audit record*: an editable audit trail is not an audit
  // trail, so no write route may exist here at all.
  for (const domain of ["connections", "exchanges", "blocks", "risk", "access-logs"]) {
    assert.doesNotMatch(
      controller,
      new RegExp(`@(Post|Patch|Put|Delete)\\("${domain}`),
      `a ${domain} write route must not exist`,
    );
    assert.doesNotMatch(
      controller,
      new RegExp(`@RequirePermission\\("${domain}:write"\\)`),
      `${domain}:write must not gate a live route`,
    );
  }

  // The relationship detail routes are UUID-addressed (C5 added the pipe), so a
  // malformed path segment is a 400 rather than a 500 from Prisma. Phase O2's
  // `access-logs/:id` was the eleventh such route; the moderation, feedback,
  // category (`:id`), address-ban lift and `moments/:id/review` routes bring it
  // to sixteen.
  const params = [...controller.matchAll(/@Param\("(\w+)", UuidParamPipe\)/g)].map((match) => match[1]);
  const UUID_ADDRESSED = [
    "blockedId",
    "blockerId",
    ...Array(14).fill("id"),
  ];
  assert.deepEqual(
    [...params].sort(),
    [...UUID_ADDRESSED].sort(),
    "every id-addressed route must carry the UUID guard",
  );
});

/**
 * Phase C5: no migration was added and the schema gained no model.
 *
 * The phase's hard rule is that integration work does not change the database.
 * Pinning the model/enum lists turns "we did not touch the schema" from a claim
 * into a checked fact — and it is the assertion that would catch a convenience
 * join table or a back-relation added to make a cross-domain query easier.
 *
 * FIX (Phase O0): this test used to assert `migrations.length === 16`, i.e. it
 * used the *total* migration count as a proxy for "C5 added none". That proxy
 * breaks on every legitimate later schema change: two migrations landed after
 * C5 (`security_audit_center_p1`, `refresh_token_reuse_detection`) and the
 * literal went stale, failing the assertion against a schema that was in fact
 * perfectly valid. Because `package.json` runs this file before
 * `playwright test`, one stale number made the entire admin suite unreachable
 * through `npm test` — the same failure mode as the nav literal (audit P005(t))
 * and the moderation assertion above.
 *
 * The invariant that matters is preserved and made explicit: C5 itself must not
 * have introduced a migration, and any migration added *after* the C5 baseline
 * must be named here, so schema changes still require a deliberate edit to this
 * list rather than sliding in under a bumped counter.
 */
test("phase C5: no migration was added and the schema gained no model", () => {
  const migrations = readdirSync(new URL(`${REPO_ROOT}/prisma/migrations`, import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  // The C5 migration set, established 2026-09-17. Everything at or before it is
  // the frozen baseline; anything after must be listed explicitly below.
  const C5_BASELINE = [
    "20260915083412_phase2_core_models",
    "20260915093221_phase4_discover",
    "20260915200039_phase5_connection_conversation",
    "20260915202602_phase7_exchange",
    "20260915211738_phase10_admin",
    "20260915224945_phase13_admin_console",
    "20260915231253_phase14_translate_cache",
    "20260915235218_phase15_moments",
    "20260917090000_phase15_foreign_keys_and_indexes",
    "20260917091500_phase16_social_platform_talkfirst",
    "20260917092000_phase16_shared_social_account",
    "20260917094000_phase16_drop_social_visibility",
    "20260917095500_phase16_moment_source",
    "20260917121000_phase17_admin_rbac_enums",
    "20260917121100_phase17_admin_rbac",
    "20260917153000_admin_audit_system_actor",
  ];
  assert.equal(C5_BASELINE.length, 16, "the C5 baseline literal was edited by accident");
  assert.deepEqual(
    migrations.slice(0, C5_BASELINE.length),
    C5_BASELINE,
    "the C5-era migration set changed; a historical migration must never be rewritten",
  );

  // Migrations added after C5, each deliberate and already applied. A new entry
  // here is the point at which an author must confirm they meant to touch the
  // schema — the pin is the edit, not a counter.
  const POST_C5_MIGRATIONS = [
    "20260919050334_profile_attributes",
    "20260919150844_comment_replies",
    "20260919233119_report_moment",
    "20261001085200_security_audit_center_p1",
    "20261002090000_refresh_token_reuse_detection",
    // Phase O2 — indexes only (no column change), for the ops read path:
    // `requestId` is the sole correlation key to SecurityEvent and had no index,
    // and `deviceHash`/`riskLevel`/`isAdmin`/`authenticated` are offered as
    // filters by the ops console.
    "20261002140000_ops_access_log_indexes",
    // Google sign-in — additive only: a new `OAuthProvider` enum and
    // `OAuthIdentity` table, plus `User.passwordHash` DROPPED NOT NULL so an
    // OAuth-only account has no fabricated credential. No column is removed and
    // no existing row is rewritten.
    "20261002151727_google_oauth_identity",
    // External social post sync — two new tables plus the enums behind them.
    // `SocialSyncAccount` / `SocialSyncPost` are named with that prefix because
    // the handle-sharing `SocialAccount` model already owned the plain name.
    "20261003094404_social_sync_accounts",
    // Address bans (`IpBan`, two-level) and the `AppSetting` key/value table that
    // makes the member-facing support address editable from the console.
    "20261003100633_ip_ban_and_app_setting",
    // Member feedback submissions and their admin replies.
    "20261003101958_feedback",
    // `Moment.reviewStatus` — the content-moderation queue. Existing rows keep
    // the default, so nothing is rewritten.
    "20261003102800_moment_review_status",
    // `DiscoverCategory`: the Discover filter tabs move from code constants to
    // rows, with the built-in pair kept as a fallback when the table is empty.
    "20261003104212_discover_categories",
    // A `CHECK (syncLimit BETWEEN 1 AND 3)` on `SocialSyncAccount`. Added as its
    // own migration rather than folded into the one above because that one had
    // already been applied; an applied migration is never edited.
    "20261003174412_social_sync_synclimit_check",
    // P0-02 — `User.username`: the account name used to sign in, NOT NULL and
    // unique, plus the backfill that gave every pre-existing account a generated
    // one. Additive, but it is a column with a constraint rather than an index, so
    // it belongs on this list for the same reason as the rest.
    "20261004120000_username_login_identifier",
    // C4 — `MomentBookmark`（收藏）。只新增一张表，不改既有列与行。
    "20261005120000_moment_bookmarks",
    // C3 — `ConversationMember.lastReadAt`（已读位置，未读数的基础）。
    // 可空列 + 回填既有行为迁移时刻（详见该迁移里的理由）。
    "20261005140000_conversation_member_last_read",
    // C2 — `Report.commentId`（评论举报的目标）。可空列 + 索引，全为 NULL。
    "20261005160000_report_comment_target",
    // 2026-10-06 — `AccessLog.channel`（渠道分流：后台默认只看成员流量）。
    // 纯加法：新增列（默认 'USER'）+ 索引，并把历史行按同一口径回填（先 OPS、再 ADMIN）。
    "20261006180000_access_log_channel",
  ];
  assert.deepEqual(
    migrations.slice(C5_BASELINE.length),
    POST_C5_MIGRATIONS,
    "a migration was added or removed without updating the post-C5 allowlist",
  );

  // Still enforced: the C5 phase itself contributed no migration.
  for (const name of migrations) {
    assert.doesNotMatch(name, /c5|integration/i, `a C5 migration was added: ${name}`);
  }

  const schema = readFileSync(new URL(`${REPO_ROOT}/prisma/schema.prisma`, import.meta.url), "utf8");
  const names = (keyword) =>
    (schema.match(new RegExp(`^${keyword} (\\w+) \\{`, "gm")) ?? [])
      .map((line) => line.replace(new RegExp(`^${keyword} | \\{`, "g"), ""))
      .sort();

  assert.deepEqual(names("model"), [
    "AccessLog",
    "AdminAuditLog",
    "AdminNote",
    "AdminUser",
    // Editable console settings — currently the member-facing support address.
    "AppSetting",
    "AttributeDefinition",
    "Block",
    "Connection",
    "ConnectionRequest",
    "Conversation",
    "ConversationMember",
    "Country",
    "DeviceIdentity",
    "DeviceUser",
    // Discover filter tabs, moved out of the code constants they used to live in.
    "DiscoverCategory",
    "DiscoverView",
    "ExchangeRequest",
    // Member feedback submissions and their replies.
    "Feedback",
    "Interest",
    // Two-level address bans (PRIMARY / SECONDARY), never deleted.
    "IpBan",
    "Language",
    "Message",
    "MessageTranslation",
    "Moment",
    // C4 — 收藏。
    "MomentBookmark",
    "MomentComment",
    "MomentLike",
    "MomentPlatformBinding",
    "MomentSetting",
    "Notification",
    "OAuthIdentity",
    "ProfileFieldVisibility",
    "Purpose",
    "RefreshToken",
    "Report",
    "SchemaMeta",
    "SecurityEvent",
    "SharedSocialAccount",
    "SocialAccount",
    // External social post sync. Prefixed `SocialSync*` because the
    // handle-sharing `SocialAccount` above already owned the plain name.
    "SocialSyncAccount",
    "SocialSyncPost",
    "User",
    "UserAttribute",
    "UserInterest",
    "UserLanguage",
    "UserPreferredCountry",
    "UserPurpose",
    "VerificationCode",
  ]);
  assert.deepEqual(names("enum"), [
    "AdminRole",
    "AttributeKind",
    "AttributeSource",
    "AttributeValueType",
    "AuditActorType",
    "ConnectionStatus",
    "ExchangeStatus",
    "FeedbackKind",
    "FeedbackStatus",
    "Gender",
    "IpBanLevel",
    "LanguageLevel",
    "LanguageType",
    "MessageType",
    "MomentSource",
    "OAuthProvider",
    "ReportStatus",
    "RequestStatus",
    "ReviewStatus",
    "SocialPlatform",
    "SocialSyncMediaType",
    "SocialSyncProvider",
    "SocialSyncStatus",
    "UserStatus",
    "Visibility",
  ]);
});
