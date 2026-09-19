# PC-1.4 PROFILE UI / UX — FINAL RESULT

**Date:** 2026-09-19
**Scope:** Web member app only (`apps/web`). Wires the PC-1.3 profile-attribute API
into the user-facing product; unifies every avatar entry point onto one profile
card.
**Not in scope (untouched):** `prisma/schema.prisma`, migrations, `SafetyService`,
Discover scoring, Notification, Comment/Reply backend, Admin CMS, Ads, Popup,
Banner, OAuth, S3, SMTP, Redis.

---

## Status

**COMPLETE** — with two documented, pre-existing defects repaired outside the
original scope (see *Known Issues → pre-existing*).

---

## Profile Edit

`/me/edit` (`apps/web/src/app/me/edit/page.tsx`) now edits **avatar, nickname,
birthDate, countryCode, region, city, gender, bio**.

- Prefill comes from `GET /users/me`, never from the session cache — the cache can
  be older than the database.
- On save the form **re-reads the server** (`GET /users/me`) instead of trusting
  the `PATCH` response, then refreshes the session user.
- Success and failure are surfaced through `data-testid="profile-saved"` /
  `data-testid="profile-error"`; loading state is a real skeleton, not plain text.
- Client-side validation mirrors the server (nickname 2–20, region ≤80, city ≤80,
  bio ≤500, age ≥18) so a member is told before a request fails.
- The avatar `PUT` is attempted **before** the profile `PATCH`; when it fails the
  `PATCH` never runs, which the suite asserts against the database.

## Password

`/me/password` already existed and was **not modified** in PC-1.4. It posts to
`POST /auth/password` with current / new / confirm and the page states that other
devices are signed out. It is listed here for completeness only.

## Profile Card

`apps/web/src/components/profile-preview-card.tsx` is the single card used by
every entry point; no page keeps a private copy.

Renders: avatar, nickname, age, `city · region · country`, bio, ABOUT_ME tags,
LOOKING_FOR tags, languages, interests, purposes. Actions: **Say Hello**,
**查看完整资料**; when the viewer is the owner it swaps to **编辑我的资料** /
**管理标签**; when connected, Say Hello becomes a disabled **已连接**.

Never rendered: `email`, `passwordHash`, tokens, OAuth data, social handles, and
the internal `definitionId` / `reviewStatus` / `source` fields. An automated test
asserts the card's text contains no `@`, no `example.test`, and none of
`password|token|oauth|handle`.

## Profile Detail

`/profile/[id]` (`apps/web/src/app/profile/[id]/page.tsx`) is the full page:
hero (avatar / nickname / age / place / bio) → **关于 TA** (attributes, languages,
interests) → **交友需求** (attributes, purposes, preferred countries) → actions.

Both sections are conditional *as a whole*: when nothing survived visibility the
heading is not rendered at all, so the page never discloses that a field exists
but is hidden. A test asserts the string `暂无` never appears.

## Custom Attributes

`/me/attributes` (739 lines) supports add / edit / delete for both kinds, via the
PC-1.3 API only.

- **System tab**: definitions from `GET /meta/attributes`, grouped by category,
  labelled via `labelZh`. Nothing is hardcoded.
- **Custom tab**: `label` (required, ≤32) + `value` (optional, ≤80).
- Editing a CUSTOM row allows label + value + visibility; a SYSTEM row allows
  visibility + sort only (the label is platform-owned).
- Reorder with ▲/▼ (`sortOrder`), delete behind a confirm step.
- Every mutation re-reads the server, so the screen can only ever show state the
  database actually holds.

`labelKey`, `definitionId`, `reviewStatus` and `source` are never sent by the
client — the server derives all of them.

## Looking For

LOOKING_FOR is a first-class sibling of ABOUT_ME throughout: separate section,
separate counter, separate system-tag pool, separate custom labels, and rendered
as its own block on both the card and the detail page. The two are never merged.

## Visibility

`/me/visibility` exposes all **13** whitelisted fields with the shared
`VisibilitySelect` 3-way control, worded in Chinese (公开 / 仅连接 / 仅自己) —
the raw enum names are never shown to members.

- `GET /users/me/profile-field-visibility` returns all 13 keys, so the screen
  never invents a default.
- No default rows are backfilled; setting a field back to 公开 is an ordinary API
  call, and the backend deletes its row.
- The screen states explicitly that blocking always wins, and that this setting
  does **not** affect social-account exchange or moment visibility.

## Region

`region` is editable (`≤80`, trimmed, `""` → `null`) and rendered between city and
country in the joined place line. A blank region simply drops out of the line; no
empty row is printed.

## Daily Attribute Editing

`/me/interests` (497 lines) lets an already-registered member edit **languages,
interests, purposes and preferred countries** outside onboarding, reusing the
existing replacement endpoints — no new API was added.

Each section saves independently, re-reads the server afterwards, and mirrors the
server constraint in the UI (languages 1–8, interests **≥3 / ≤20**, purposes 1–7,
countries ≤10).

## Avatar Integration

Every avatar / nickname entry point now opens the same `ProfilePreviewCard`:

| Entry point | Change |
|---|---|
| Discover card | avatar + nickname → card (`previewUserId` state) |
| Moments feed author | avatar + nickname → card |
| Moments comment author | avatar + nickname → card |
| Moments/user page | author + comment → card |
| Connections list | avatar + nickname → card |

No page implements its own profile fetch any more.

## Discover Integration

Discover reuses the shared component; its own data comes from the recommendation
payload, but any profile it opens goes through `GET /users/:id` exactly like the
other entry points. **No Discover scoring, weights or filters were changed**, and
gender is still not displayed in Discover.

## Moments Integration

The feed and the per-user page pass an `onProfile(userId)` callback down to the
card; comment authors are wired the same way. Moment visibility
(`MomentSetting.visibleTo`) is untouched.

## Connections Integration

Connections opens the card for the peer. The card's action slot correctly shows
**已连接** for an ACTIVE connection. Block and privacy rules are enforced by the
API, not by the card.

## Responsive

Verified in two Playwright projects: `Desktop Chrome` and `Pixel 5` (390 × 844).

The card is a **bottom sheet** below `sm` (`items-end`, rounded top corners, safe
area padding) and a centred dialog at `sm` and up. The suite asserts the geometry
rather than trusting the classnames: on phone the card's bottom edge must reach
the viewport bottom (±2px); on desktop it must be inset from both edges; either
way it may never exceed the viewport width or leave the screen vertically.

---

## Tests

### Jest (API)

```
Test Suites: 26 passed, 26 total
Tests:       683 passed, 683 total
```

### Playwright (`apps/web/test/e2e/profile.spec.ts`)

```
54 passed (1.1m)
```

27 tests × 2 projects (desktop + phone). The suite drives Chromium against a real
API and a real PostgreSQL on `localhost:5433`; `beforeEach` re-seeds the fixture
accounts so the file is order-independent despite half the tests mutating state.

Coverage: `/me/edit` prefill · nickname / region / bio persistence · avatar
failure path · languages · interests · purposes · preferred countries · custom
ABOUT_ME · custom LOOKING_FOR · label normalization · duplicate rejection · custom
delete · per-attribute visibility · per-field visibility · Discover avatar ·
Moments author avatar · Moments comment avatar · Connections avatar · self view ·
no-leak scan · `/profile/[id]` · connection vs stranger tiers · PRIVATE self-only ·
block > visibility · responsive geometry.

UI assertions are paired with direct Prisma assertions, so a screen that merely
*looks* right after an optimistic update cannot pass.

### Real E2E (HTTP + PostgreSQL)

`.local-data/pc14/verify.cjs` — **13/13 PASS** against a live API on `:4010` and
the real database, with Alice (owner), Bob (ACTIVE connection) and Carol
(stranger):


```
PASS 01-03  seed + alice(bio=CONNECTIONS, city=PRIVATE, region=PUBLIC) + 3 real logins
PASS 04-05  stranger: PUBLIC visible, CONNECTIONS + PRIVATE withheld, no secret key
PASS 06-07  connection: CONNECTIONS visible, PRIVATE still withheld, no secret key
PASS 08-09  self: every tier visible including PRIVATE, no secret key
PASS 10     PATCH /users/me region trims and "" becomes null
PASS 11     Block > visibility: blocked viewer gets 403 BLOCKED on PUBLIC fields
PASS 12     attribute API: owner groups + 20 active system definitions
PASS 13     visibility API: 13 fields, off-whitelist key rejected with 400
```

The recursive key scan rejects `email`, `passwordhash`, `tokenhash`,
`refreshtoken`, `accesstoken`, `oauth`, `handle`, `isadmin`, `ip`, `useragent` in
every profile response.

### Static

```
npm run typecheck       -> all 6 workspaces, exit 0
next lint (web)         -> 0 warnings, 0 errors
next build (web)        -> exit 0, new routes /me/attributes, /me/visibility, /me/interests
node --test (web smoke) -> 5/5 pass
```

---

## Schema

**UNCHANGED** - `prisma/schema.prisma` is still 771 lines.

## Migration

**UNCHANGED** - no migration was created or run. The latest remains
`20260919050334_profile_attributes`.

---

## Known Issues

### new

- `apps/web/package.json` gained `@playwright/test` plus `test:e2e` /
  `test:e2e:build` scripts, and `package-lock.json` was regenerated
  (`--package-lock-only`) to match.
- The Discover card still builds its own inline preview from the recommendation
  payload, so it is the one avatar entry point whose *inline* preview does not come
  from `GET /users/:id` (clicking through to the card does). Not a regression, just
  the remaining asymmetry.

### pre-existing (found, repaired, outside the original scope)

- `apps/api/src/users/profile-attributes.spec.ts` **did not compile**:
  `LOW_SCAN.reasons` was inferred as `never[]`, so `Partial<typeof LOW_SCAN>`
  rejected every real reason string. Because ts-jest type-checks, the whole file
  was silently not running - 36 PC-1.3 tests never executed. Fixed with an explicit
  `string[]` annotation.
- Once the file could run, one expectation proved wrong: "scans the value as well
  as the label" mocked every scan as blocked, so the service's short-circuit made
  the `"payload"` assertion unreachable. It now mocks only the value as blocked,
  which is what actually proves the value path is scanned.

  Both are test-file changes; **no API or service code was modified.**

### pre-existing (reported, not fixed - out of scope)

- **Discover ignores `ProfileFieldVisibility`.** `DiscoverService` reads the `User`
  table directly, so a field set to PRIVATE still shows on a Discover card. Privacy
  is enforced on `/profile/[id]` and `ProfilePreviewCard` only. This is the most
  important open item this phase surfaced.
- `apps/web/src/app/me/password/page.tsx` renders the raw `ApiRequestError.message`
  instead of routing through `friendlyErrorMessage`.
- Moments content loop gaps (no post detail, replies, pagination, delete, report)
  are unchanged and still open.

### environment-only

- Verification ran against **`localhost:5433/talkfirst`** only.
  **Production database state = UNKNOWN.**
- The local PostgreSQL instance is stopped by default; the API is served from
  `dist/main.js` (`npm run dev`'s watcher is unreliable here).
- The first Playwright run needed a fixture fix: `getByRole("button", { name: "登录" })`
  also matched the Google/Apple placeholders, so the login helper now uses
  `exact: true`.

---

## STOP

PC-1.4 COMPLETE.
STOP.
Do not enter PC-1.5.
