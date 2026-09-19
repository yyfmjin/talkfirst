# PROFILE ATTRIBUTE SCHEMA DESIGN (PC-1.1)

Status: **DESIGN ONLY** — this document does not change `prisma/schema.prisma`,
does not add a migration, and does not change business code.

Scope of the design:

1. Custom attributes (user-authored tags such as 慢热 / 夜猫子 / City Pop)
2. Custom looking-for (user-authored intent such as 语言交换 / 游戏好友)
3. Region (state / province level, between `countryCode` and `city`)
4. Per-field visibility (`PUBLIC` / `CONNECTIONS` / `PRIVATE`)

Inputs actually read for this design:

- `prisma/schema.prisma` (User, Interest, UserInterest, Purpose, UserPurpose,
  Language, UserLanguage, Country, UserPreferredCountry, SocialAccount,
  SharedSocialAccount, MomentSetting, and all enums)
- `apps/api/src/users/*` (`UsersService.getPublicProfile`,
  `UsersService.getFullCard`, `UsersController`, `UpdateProfileDto`)
- `apps/api/src/auth/*` (JWT access/refresh model, password change)
- `apps/api/src/discover/discover.service.ts` (scoring inputs and filters)
- `apps/web/src/lib/profile.ts`, `apps/web/src/components/profile-preview-card.tsx`,
  `apps/web/src/app/profile/[id]/page.tsx`, `apps/web/src/app/me/edit/page.tsx`

Hard constraints honoured by this document:

- `prisma/schema.prisma` is **not** modified.
- No migration is created or executed.
- `SafetyService` is **not** modified.
- The `SharedSocialAccount` authorization model is **not** altered. Profile
  visibility and social-handle visibility remain two separate systems.

---

## 1. Current Schema

### 1.1 Scalar profile fields on `User`

| Field | Type | Nullable | Notes |
| --- | --- | --- | --- |
| `nickname` | `String` | yes | length validated in DTO (2–24) |
| `avatarUrl` | `String` | yes | single URL, no version/history |
| `birthDate` | `DateTime @db.Date` | yes | age is derived, not stored |
| `countryCode` | `String @db.Char(2)` | yes | ISO-3166-1 alpha-2, indexed |
| `city` | `String` | yes | free text, max 80 in DTO |
| `gender` | `Gender` | no (default `UNKNOWN`) | enum |
| `bio` | `String @db.VarChar(500)` | yes | single free-text block |
| `lastActiveAt` | `DateTime` | yes | drives Discover activity score |
| `status` | `UserStatus` | no (default `ACTIVE`) | indexed |

`User` indexes today: `@@index([status])`, `@@index([countryCode])`,
`@@index([createdAt])`.

**There is no `region` field. There is no visibility field of any kind.**

### 1.2 Catalog + join models — the existing "system attribute" mechanism

Today every profile attribute is *catalog-backed many-to-many*: a shared,
server-owned definition table plus a per-user join table.

| Concept | Catalog model | Join model | Join key | Catalog delete rule |
| --- | --- | --- | --- | --- |
| Interests | `Interest` (`slug` unique, `name`, `nameZh?`, `category`, `sort`) | `UserInterest` | `@@id([userId, interestId])` | `Cascade` on both FKs |
| Purposes | `Purpose` (`slug` unique, `name`, `nameZh?`, `sort`) | `UserPurpose` | `@@id([userId, purposeId])` | `Cascade` on both FKs |
| Languages | `Language` (`code` unique VarChar(8), `name`, `nativeName?`) | `UserLanguage` (+ `type`, `level`) | `@@unique([userId, languageCode, type])` | `Restrict` on the `Language` FK |
| Preferred countries | `Country` (`code` unique Char(2), `name`, `flag?`) | `UserPreferredCountry` | `@@id([userId, countryCode])` | `Cascade` on both FKs |

Observations that matter for the design:

- Catalog tables are **seeded and server-owned**. A user can only select an
  existing row; there is no path for a user to author a new label.
- `UserLanguage` is the only join table carrying payload columns (`type`,
  `level`), which is why it uses a surrogate `id` + composite unique instead of
  a composite primary key.
- `Interest.category` already exists as a grouping column, but no API or UI
  exposes or filters on it today.
- Deletion semantics are inconsistent: `Cascade` for interests / purposes /
  countries, `Restrict` for languages.
- `Purpose` is the closest existing thing to "intent", but it is a coarse
  product-level enum (7 seeded values), not a statement of who the user wants
  to meet.

### 1.3 Adjacent models that must NOT be conflated with profile visibility

| Model | Owns | Why it stays independent |
| --- | --- | --- |
| `SharedSocialAccount` | per-pair authorization for ONE handle (`ownerId`, `viewerId`, `platform`, `socialAccountId`, `exchangeId`, `@@unique([ownerId, viewerId, platform])`) | The schema comment declares it "the single source of truth for who may see whose handle"; `SocialAccount` deliberately has no visibility column |
| `MomentSetting.visibleTo` | Moments feed visibility (`VarChar(16)`, default `"everyone"`) | Governs moments, not profile fields |
| `Block` | relationship-level denial | Must override every profile visibility tier |

Therefore a profile-field visibility feature must:

- never gate a `SocialAccount.handle`,
- never imply authorization for a `SharedSocialAccount` row,
- never override `Block`.

### 1.4 Enums already present

`UserStatus`, `Gender`, `LanguageType`, `LanguageLevel`, `SocialPlatform`,
`RequestStatus`, `ConnectionStatus`, `ExchangeStatus`, `MessageType`,
`ReportStatus`, `MomentSource`, `AdminRole`, `AuditActorType`.

There is **no** `Visibility` enum, **no** attribute-kind enum, and **no**
moderation/review-status enum usable for user-authored profile content.

---

## 2. Current Profile Capability

Legend: `DB` model/column exists · `API` endpoint exists · `WEB` UI exists ·
`ADMIN` admin surface exists.

| Capability | DB | API | WEB | ADMIN | Validation | Privacy control | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avatar | yes (`avatarUrl`) | `PUT /users/me/avatar` | onboarding + `/me/edit` | view only | MIME/size at upload | none | PARTIAL |
| Nickname | yes | `PATCH /users/me` | yes | view only | 2–24 | none | COMPLETE |
| Birth date | yes | `PATCH /users/me` | yes | view only | ISO date | none | COMPLETE |
| Age | derived | derived | yes | view only | — | none | COMPLETE |
| Country | yes | `PATCH /users/me` | yes | filter | 2-letter | none | COMPLETE |
| Region | **no** | **no** | **no** | **no** | — | — | MISSING |
| City | yes | `PATCH /users/me` | yes | view only | max 80 | none | COMPLETE |
| Bio | yes | `PATCH /users/me` | yes | view only | max 500 | none | COMPLETE |
| Gender | yes | `PATCH /users/me` | yes | view only | enum | none | COMPLETE |
| Interests (system) | yes | `PUT /users/me/interests` | yes | view only | min 3, max 20 | none | COMPLETE |
| Languages (system) | yes | `PUT /users/me/languages` | yes | view only | min 1, max 8 | none | COMPLETE |
| Purposes (system) | yes | `PUT /users/me/purposes` | yes | view only | min 1, max 7 | none | COMPLETE |
| Preferred countries | yes | `PUT /users/me/preferred-countries` | yes | view only | max 10 | none | COMPLETE |
| **Custom attributes** | **no** | **no** | **no** | **no** | — | — | MISSING |
| **Custom looking-for** | **no** | **no** | **no** | **no** | — | — | MISSING |
| **Per-field visibility** | **no** | **no** | **no** | **no** | — | — | MISSING |
| Public profile read | yes | `GET /users/:id` | `/profile/[id]` | yes | — | Block + status only | PARTIAL |
| Password change | yes | `PUT /auth/password` | `/me/password` | n/a | yes | n/a | COMPLETE |
| Profile preview card | yes | reuses `GET /users/:id` | shared component | n/a | — | Block + status only | COMPLETE |

Sanitization that already holds today and must be preserved by any new field:
`UsersService.getPublicProfile` never emits `email`, `emailVerified`, `isAdmin`
or raw `status`; it also enforces Block in both directions and converts a
non-`ACTIVE` target (unless self) into `404 USER_NOT_FOUND`.
`getFullCard` is self-only and may include those fields.

---

## 3. Schema Gap

The four PARTIAL/MISSING items inherited from PC-1 share one root cause:
**every profile attribute today is either a `User` scalar or a row pointing at a
server-owned catalog. There is no table that stores a user-authored label, and
there is no place to attach an access tier to any field.**

| # | Gap | Why the current schema cannot express it | Blocked capability |
| --- | --- | --- | --- |
| G1 | No user-authored label storage | `Interest` / `Purpose` rows are seeded and shared; letting a user insert one would mutate global state for every account | Custom attributes |
| G2 | No ABOUT_ME vs LOOKING_FOR split | `bio` (VarChar 500) is one block; `purposes` is a 7-value coarse enum | Custom looking-for |
| G3 | No sub-country geography | only `countryCode` (Char 2) + `city` free text; no ISO-3166-2 dataset exists in the repo | Region |
| G4 | No access tier on any profile field | no visibility-like enum anywhere in the schema | Per-field visibility |
| G5 | No moderation state for user-authored profile content | `ReportStatus` is report-scoped; there is no row-level review state for a profile attribute | Safe custom content |
| G6 | Catalog attributes are not groupable for privacy | visibility must be per-attribute or per-group; the only group-ish column is `Interest.category` | Consistent privacy model |

Explicit non-gaps (nothing proposed for these):

- `SharedSocialAccount` already answers "who may see whose handle" and stays as is.
- `MomentSetting.visibleTo` already answers moments visibility and stays as is.
- Block enforcement is relationship-level and already implemented in
  `getPublicProfile`; new fields must inherit it rather than re-implement it.

---

## 4. Custom Attribute Model

### 4.1 Principles

1. Do not add a database column per attribute. Attribute *values* live in rows.
2. A user-authored label must never be written into a shared catalog row.
3. Every user-authored row must be attributable (`source`) so moderation and
   Admin can distinguish "the product shipped this tag" from "this user typed
   this tag".
4. Labels must be stored in a normalized form so duplicates are rejected by the
   database, not only by the service.
5. About-me and looking-for are the same *shape* but different *kinds*; they can
   share one table if `kind` is part of the uniqueness key.

### 4.2 Common conceptual shape (proposed, not implemented)

| Concept | Field | Why |
| --- | --- | --- |
| Ownership | `userId` | always taken from the JWT subject, never from the request body |
| Kind | `kind` (`ABOUT_ME` \| `LOOKING_FOR`) | keeps "my interests" and "who I want to meet" separate (requirement §6) |
| Label | `label` (display, original casing) | what the user typed, e.g. `City Pop`, `慢热` |
| Dedupe key | `labelKey` (normalized) | trim + collapse inner whitespace + casefold; uniqueness is enforced on this, not on `label` |
| Value | `value?` | optional free-text detail; `null` means the label is self-contained |
| Source | `source` (`SYSTEM` \| `CUSTOM`) / `definitionId?` | distinguishes shipped tags from user tags |
| Visibility | `visibility` (`PUBLIC` \| `CONNECTIONS` \| `PRIVATE`) | per-row privacy tier |
| Order | `sortOrder` int | stable user-controlled ordering; never rely on `createdAt` for display order |
| Review | `reviewStatus` (`PENDING` \| `APPROVED` \| `REJECTED` \| `HIDDEN`) | moderation gate for user-authored rows |
| Lifecycle | `createdAt`, `updatedAt` | audit + Admin sorting |

### 4.3 Normalization and limits (service-level, enforced in DTO)

| Rule | Value | Rationale |
| --- | --- | --- |
| `label` max length | 32 chars | Tags are short; 慢热 / 夜猫子 / City Pop all fit |
| `value` max length | 80 chars | Free-text detail stays small so it cannot become a `bio` clone |
| Max rows per `kind` per user | 10 | Bounds profile payload and Discover join width |
| Duplicate handling | unique on `(userId, kind, labelKey)` | Reject with `409`, not silent dedupe |
| Forbidden content | run through `SafetyService.scanText` before persist | Custom labels are user text and must not bypass existing safety scanning |
| Empty / whitespace-only | rejected in DTO | Avoid junk rows |

`SafetyService` is **called**, never modified. Note as a known limitation (out of
scope here): its current `recordAutoFlag` path returns early for HIGH-risk
results, so a HIGH label should be treated as "block the write" in the caller
rather than relying on auto-flag persistence.

---

## 5. Looking For Model

### 5.1 The separation requirement

"My interests" (`ABOUT_ME`) and "who I want to meet" (`LOOKING_FOR`) must not
share a field, a table row, or a uniqueness key across kinds. Concretely:

| Statement | Kind | Example |
| --- | --- | --- |
| 我喜欢 City Pop / 桌游 | `ABOUT_ME` | describes me |
| 我想认识会日语的人 / 寻找游戏好友 | `LOOKING_FOR` | describes the other person |

The existing `Purpose` catalog is a *third*, separate thing: it is the
product-level "why I am on TalkFirst" enum (7 seeded values). It should not be
extended into a free-text looking-for channel, and looking-for should not
re-use `UserPurpose` rows.

| Concept | Nature | Cardinality | Authored by | Where it lives today |
| --- | --- | --- | --- | --- |
| `Purpose` | coarse product intent | 1–7 selected | product (seed) | `Purpose` + `UserPurpose` |
| `ABOUT_ME` attribute | self-description tag | 0–10 | user | does not exist |
| `LOOKING_FOR` attribute | counterpart-description tag | 0–10 | user | does not exist |

### 5.2 Shape options compared (no recommendation implied)

| Shape | Storage | Pros | Cons |
| --- | --- | --- | --- |
| Free-text only | one row per statement in the shared attribute table | highest expressiveness; zero catalog maintenance; no cold-start problem | not filterable without text search; typos fragment the data; harder to moderate at scale |
| Catalog multi-select | new catalog table + join | filterable and cleanly moderatable; consistent i18n via `nameZh` | users can only ask for what the product anticipated; requires curation |
| Hybrid (catalog + custom rows in one table) | one table with `source` discriminator | catalog rows are filterable, custom rows capture the long tail; single read path | more logic in the service; needs a rule for promoting popular custom labels into the catalog |

### 5.3 Product examples mapped to the shape

| User statement | Kind | Suggested representation |
| --- | --- | --- |
| 语言交换 | `LOOKING_FOR` | could ship as a `SYSTEM` definition (predictable, filterable) |
| 游戏好友 | `LOOKING_FOR` | could ship as a `SYSTEM` definition |
| 同城朋友 | `LOOKING_FOR` | custom row, `value` may hold a city hint |
| 旅行伙伴 | `LOOKING_FOR` | could ship as a `SYSTEM` definition |
| 想认识海外朋友 | `LOOKING_FOR` | custom row |
| 想认识会日语的人 | `LOOKING_FOR` | custom row, `value` = `日语` |
| 慢热 / 夜猫子 | `ABOUT_ME` | custom row |
| 喜欢长聊天 | `ABOUT_ME` | custom row |
| City Pop / 桌游 | `ABOUT_ME` | custom row |

Nothing above is implemented in this phase; the table exists to show that both
options in §12/§13 can store every example.

---

## 6. Visibility Model

### 6.1 Tiers

| Tier | Meaning | Visible to |
| --- | --- | --- |
| `PUBLIC` | default for new profile content | any authenticated viewer not blocked |
| `CONNECTIONS` | shared only with accepted connections | the owner + users with an `ACTIVE` `Connection` to the owner |
| `PRIVATE` | owner-only | the owner; never rendered on any public surface |

Defaults: everything defaults to `PUBLIC` unless the owner changes it. This
keeps existing behaviour for accounts that never touch the setting.

### 6.2 Evaluation order (must be identical on every read path)

1. **Self** — the owner always sees their full profile, including `PRIVATE`.
2. **Block** — if a `Block` exists in either direction, return the existing
   `403 BLOCKED` behaviour and disclose nothing. This runs *before* any
   visibility logic so a `PUBLIC` row cannot leak past a block.
3. **Target status** — a non-`ACTIVE` target remains `404 USER_NOT_FOUND`
   (existing rule, unchanged).
4. **Tier** — apply `PUBLIC` / `CONNECTIONS` / `PRIVATE` per field or per group.
5. **Connection check** — `CONNECTIONS` requires an accepted `Connection`;
   a pending `ConnectionRequest` is **not** sufficient.

### 6.3 Surfaces the model applies to

| Surface | `PUBLIC` | `CONNECTIONS` | `PRIVATE` |
| --- | --- | --- | --- |
| Profile detail (`/profile/[id]`) | shown | shown only if connected | hidden |
| Profile preview card | shown | shown only if connected | hidden |
| Discover candidate card | shown | **not shown** (viewer is by definition not yet connected) | hidden |
| Admin moderation view | shown | shown | shown, but only for `CUSTOM` rows, only under existing RBAC, and only to decide on a report |

The Discover rule is deliberate: a `CONNECTIONS`-only attribute has no meaning
on a card shown to a stranger, so it must be omitted rather than "upgraded" to
public.

### 6.4 Hard boundaries

- **Social handles are out of scope.** `SocialAccount` / `SharedSocialAccount`
  keep their existing per-pair authorization. A profile attribute set to
  `PUBLIC` must never be interpreted as authorization to reveal a handle, and
  the profile visibility model must not be stored on `SocialAccount`.
- **Moments are out of scope.** `MomentSetting.visibleTo` is untouched.
- **Moderation is not blocked by visibility.** A `PRIVATE` custom attribute is
  still reviewable when reported; visibility protects it from other users, not
  from the safety process.

### 6.5 Two levels of granularity

| Level | Description | Consequence |
| --- | --- | --- |
| Group-level | one tier per attribute family (bio, city, birth date, interests, languages, purposes, preferred countries, custom attributes) | fewer rows and a simpler editor; cannot hide a single interest while showing the rest |
| Per-field | one tier per field, extensible to new fields without schema change | a richer editor and a bigger settings UI; more rows to read |

Both levels can be built without touching existing tables — §12 and §13 differ
mainly here.

---

## 7. Region Model

### 7.1 What exists

`User.countryCode` (`Char(2)`, ISO-3166-1) plus `User.city` (free text, max 80).
There is no state / province level and **no ISO-3166-2 dataset anywhere in the
repository** (the seed contains countries, languages, interests and purposes
only).

### 7.2 Is `region` worth an independent field?

| Option | Shape | Assessment |
| --- | --- | --- |
| Free-text `region` column on `User` | `region String? @db.VarChar(80)` | Minimal: one nullable column, no join, no dataset, no seed. Matches how `city` already works. Not normalized, so it cannot be filtered reliably. |
| `Region` catalog + join | `Region(id, code, countryCode, name)` mirroring `Country`, joined via `UserRegion` | Normalized and filterable, but requires shipping and maintaining an ISO-3166-2 dataset plus a seed, and the seed would be unreviewed for many jurisdictions. Heavier than the user-visible benefit today. |
| Nothing (reuse `city`) | users type "Bavaria" into the city box | No schema change at all, but corrupts the `city` field's meaning and breaks any future city-level logic. |

### 7.3 Proposed minimal shape

Add one nullable, indexed-on-demand column:

- `region String? @db.VarChar(80)` — optional, sibling of `city`, same length cap
  as `city`'s DTO rule.
- Display order is `city, region, country`, and each part is omitted when empty.
- Validation: trim, max 80, no enum; empty string is normalized to `null`.
- Indexing: **no index initially.** Nothing queries region today. If a Discover
  or Admin filter on region is ever added, add `@@index([region])` at that point
  rather than paying write cost now.
- Privacy: region belongs to the same "location" group as `countryCode` and
  `city`, so a group-level visibility setting covers all three consistently.
  A per-field model may split them if required later.

### 7.4 Migration impact of the minimal shape

A nullable `ADD COLUMN` with no default is metadata-only in PostgreSQL 11+ and
does not rewrite the table; existing rows read as `NULL`, which the UI already
handles for optional fields. No backfill is required.

---

## 8. Discover Compatibility

### 8.1 What Discover does today (verified)

- Scoring constants: `LANGUAGE_SCORE 30`, `INTEREST_SCORE 25`, `PURPOSE_SCORE 20`,
  `COUNTRY_SCORE 15`, `ACTIVITY_SCORE 10`, total capped at 100.
- Candidate query: `status = ACTIVE`, `nickname != null`, `birthDate != null`,
  `take: 200`, with `languages`, `interests`, `purposes`, `preferredCountries`
  included; scoring and sorting happen in memory.
- Exclusions: self, everyone already viewed today (daily limit 20 via
  `DiscoverView`), all Blocks in either direction, and all `ACTIVE` connections.
- Card payload: `id`, `nickname`, `avatarUrl`, `countryCode`, `countryName`,
  `countryFlag`, `age`, `bio`, `languages`, `interests`, `purposes`,
  `matchScore`, `matchReasons`. **`city` and `gender` are already not returned.**
- Filters: `all`, `language` (purpose slug `language-exchange`, or a language
  reason), `gaming` (a hardcoded interest-slug allowlist:
  `minecraft`, `valorant`, `gta`, `steam`, `nintendo`, `gaming`).

### 8.2 How each new capability would fit

| Capability | Fit with Discover | Consequence |
| --- | --- | --- |
| Custom `ABOUT_ME` attributes | join compatible — the candidate `include` gains one relation | enables tag-overlap scoring, but only if the tag set is comparable; free-text labels fragment |
| Custom `LOOKING_FOR` attributes | join compatible | enables intent matching ("both want 语言交换"), which is a stronger signal than the coarse `purpose` enum |
| `region` | trivially compatible — one more scalar in the card `select` | no scoring change needed unless a region filter is added later |
| Per-field visibility | **must** be applied inside Discover | Discover candidates are strangers, so a `CONNECTIONS`-tier attribute must be omitted, never downgraded to public |

### 8.3 Two concrete design consequences

1. **The `gaming` filter is a hardcoded slug allowlist inside the service.**
   Custom attributes therefore cannot participate in filtering at all unless the
   tag gains a searchable/metadata identity (which is the difference between the
   two options in §12 and §13). Adding a user-typed tag can never make it
   filterable on its own.
2. **Candidate volume is bounded at 200 with in-memory scoring.** Adding a
   relation to the candidate `include` increases per-candidate payload for every
   request. Any implementation should `select` only the attribute columns it
   scores on and filter visibility in the `where` clause, so private rows are
   never fetched into application memory.

### 8.4 Out of scope here

No matching algorithm, weight change, scoring change, filter change, or query
change is proposed by this document. Only the data shape is designed.

---

## 9. Admin Compatibility

### 9.1 What the Admin console already provides (verified)

- Permission strings today: `dashboard:read`, `users:*`, `reports:*`,
  `moderation:read|write`, `risk:read`, `connections:*`, `exchanges:*`,
  `blocks:*`, `audit:read|export`, `settings:read|write`, `admins:*`.
  **There is no `content:*` permission.**
- Roles: `SUPER_ADMIN` (all), `MODERATOR` (moderation + users, no settings /
  admins / exchange / block writes), `SUPPORT` (view + disable/enable only),
  `ANALYST` (read-only everywhere), `CONTENT_MANAGER` (moderation only).
- `AdminAuditLog` supports non-UUID targets: `targetType String? @db.VarChar(32)`
  and `targetId String? @db.VarChar(128)`, plus `before`/`after` JSON snapshots,
  `reason`, `ip`, `userAgent`, and a `SYSTEM` actor type for automated actions.
- Connections / Exchanges / Blocks / Risk are **read-only relation domains**;
  Social handles are never surfaced through admin listing surfaces.

### 9.2 Admin capabilities this design enables (design only, not implemented)

| Capability | Natural permission | Audit target | Option A | Option B |
| --- | --- | --- | --- | --- |
| View a user's profile attributes | `users:read` | not audited (read) | yes | yes |
| Review pending custom attributes | `moderation:read` \| `moderation:write` | `PROFILE_ATTRIBUTE` | yes | yes |
| Hide / reject a violating custom attribute | `moderation:write` | `PROFILE_ATTRIBUTE` + `before`/`after` | yes | yes |
| List system tags (interests / purposes) | `settings:read` | not audited (read) | yes (existing catalogs) | yes (definitions) |
| Disable a system tag | `settings:write` (SUPER_ADMIN only today) | `ATTRIBUTE_DEFINITION` | only for `Interest` / `Purpose` rows; needs an `isActive` column or an equivalent availability list | native via `AttributeDefinition.isActive` |
| Manage system tags (label, category, order) | `settings:write` | `ATTRIBUTE_DEFINITION` | today = re-seed; no admin surface | native CRUD on the definition catalog |
| Promote a popular custom label into the system catalog | `settings:write` | `ATTRIBUTE_DEFINITION` | not expressible (custom rows have no catalog identity) | one row insert + backfill of matching `UserAttribute.definitionId` |

Compatibility notes that constrain any implementation:

- `AdminAuditLog.action` is `VarChar(64)` and `targetType` is `VarChar(32)`; new
  action and target names must fit.
- The design must not add profile attributes to the read-only relation domains
  (Connections / Exchanges / Blocks / Risk) — they are not relations of a user.
- The admin view of attributes must not join through `SocialAccount` or
  `SharedSocialAccount`. Profile attributes and social handles stay separate.
- Disabling a system tag needs an explicit decision on already-selected rows:
  *keep but stop offering* (historical data intact, no longer selectable) versus
  *strip from users* (a destructive write). The design supports either; only the
  first is non-destructive and is the one assumed here.

---

## 10. Moderation Considerations

### 10.1 Where attribution comes from

Moderation needs to know whether a row was authored by a user or shipped by the
product. That comes from the source discriminator:

- Option A: `UserAttribute` contains **only** user-authored rows, so the source
  is implicit; system tags remain `Interest` / `Purpose` catalog rows.
- Option B: an explicit `source` (`SYSTEM` \| `CUSTOM`) plus an optional
  `definitionId` makes the distinction a column, and makes a promoted label
  traceable back to the definition it came from.

Without a source discriminator, an admin cannot tell a user-typed tag from a
product tag, and cannot act on the former without accidentally touching the
latter.

### 10.2 Review state

A row-level review state is required because a custom attribute can be the
subject of a moderation decision, and `ReportStatus` is report-scoped.

| State | Meaning | Publicly visible |
| --- | --- | --- |
| `PENDING` | awaiting review | policy-dependent (see below) |
| `APPROVED` | cleared | yes, subject to the visibility tier |
| `REJECTED` | rejected at write/review time | no |
| `HIDDEN` | was visible, now withdrawn after a report | no |

Two write policies are possible and the choice is a product decision:

| Policy | Behaviour | Consequence |
| --- | --- | --- |
| `APPROVED` by default | every write is live immediately; safety scanning runs *before* persist and may set a different state | zero friction for users; a bad row can be publicly visible until a report arrives |
| `PENDING` by default | the row is visible only to its owner until reviewed | no window of exposure; requires moderator throughput or the queue backs up |

### 10.3 Content classes to consider

| Class | Example | Detectable with today's tooling |
| --- | --- | --- |
| Sensitive / adult | sexual solicitations in a tag | partially — `SafetyService.scanText` HIGH/MEDIUM patterns |
| Advertising / spam | "加微信 buy followers" | partially — `hasContactLeak` / `hasExternalLink` |
| Contact information | phone, WeChat id, URL in a tag | yes — `hasContactLeak`, `hasExternalLink` |
| Illegal content | anything `scanText` marks `blocked` | yes — `blocked` result |
| Harassment | a slur used as a "tag" | depends on keyword coverage; no AI classification exists |

### 10.4 Constraints and known limitations

- `SafetyService` is **not modified** by this design. It is called before
  persisting a custom attribute; a `blocked` result must reject the write.
- Known (out of scope, recorded for the implementer): `recordAutoFlag` currently
  returns early for HIGH-risk text, so the caller must not rely on a persisted
  auto-flag to represent a HIGH result. Block the write instead.
- **Attribute-level reporting is not representable today.** `Report` is
  user-scoped (`reporterId`, `reportedUserId`) with an optional `messageId`, and
  has no generic `targetType` / `targetId`. Reporting a single attribute would
  therefore either (a) file a user-level report with the attribute quoted in
  `description`, or (b) require a new column — which is out of scope here and is
  listed in §15 as an open question.
- Non-`APPROVED` rows must be filtered out of every non-owner read path
  (profile detail, preview card, Discover) in the same query that applies
  visibility, so a hidden row is never loaded and then discarded in application
  code.

---

## 11. Migration Plan

No migration is created or executed in this phase. This section specifies what a
future migration would have to satisfy.

### 11.1 Preserving existing Language / Interest / Purpose / PreferredCountry data

**Nothing moves.** Under both options:

- `Language`, `Interest`, `Purpose`, `Country` keep their exact table shape,
  columns, unique constraints and seeded rows.
- `UserLanguage`, `UserInterest`, `UserPurpose`, `UserPreferredCountry` are
  untouched — no column added, no key changed, no FK altered.
- No enum is modified, so no `ALTER TYPE` is needed and no value ordering risk
  exists.
- Existing user selections therefore remain valid and readable with zero data
  migration, and a rollback of the new migration cannot corrupt them.

The only interaction is *additive*: a future UI may choose to show custom
attributes next to the existing catalog selections.

### 11.2 Additive object specification (shared by both options)

| Object | Nullability / default | Keys and indexes | Delete behaviour |
| --- | --- | --- | --- |
| `User.region` | nullable, no default (`ADD COLUMN` without default = metadata-only in PostgreSQL 11+) | no index initially; add `@@index([region])` only when a query needs it | n/a |
| `UserAttribute.userId` | not null | `@@index([userId, kind])`; `@@index([reviewStatus])` for the admin queue | `onDelete: Cascade` from `User` — a deleted user must not leave orphan rows |
| `UserAttribute.label` | not null, `VarChar(32)` | — | — |
| `UserAttribute.labelKey` | not null, normalized | `@@unique([userId, kind, labelKey])` | — |
| `UserAttribute.value` | nullable, `VarChar(80)` | — | — |
| `UserAttribute.sortOrder` | not null, default `0` | — | — |
| `UserAttribute.visibility` | not null, default `PUBLIC` | — | — |
| `UserAttribute.reviewStatus` | not null, default per §10.2 policy | `@@index([reviewStatus])` | — |
| `ProfileVisibility` (Option A) | row created lazily; absent row = all defaults | `@@id([userId])` | `onDelete: Cascade` |
| `ProfileFieldVisibility` (Option B) | row created lazily per field | `@@id([userId, fieldKey])` | `onDelete: Cascade` |
| `AttributeDefinition` (Option B) | `isActive` default `true` | `@@unique([key])`; `@@index([kind, isActive])` | referenced by `UserAttribute.definitionId` with `onDelete: SetNull` so deleting a definition never destroys user data |

### 11.3 Backfill

**No backfill is required.**

- Existing users have no custom attributes, and an absent row means "nothing to
  show" — the correct meaning.
- An absent `ProfileVisibility` row means "all fields `PUBLIC`", which is exactly
  today's behaviour, so no bulk write is needed to preserve it.
- `region` is `NULL` for existing rows and the UI already omits absent optional
  fields.

If a future requirement wants explicit visibility rows for every user, that
backfill is a separate, idempotent job — not part of the schema migration.

### 11.4 Production strategy and a local-environment caveat

- Production must use a **tracked** migration path (`prisma migrate deploy`
  against a database whose `_prisma_migrations` table is authoritative).
- The local test database on port `5433` currently has **no `_prisma_migrations`
  table**. That is a test-environment fact and must not be carried into
  production: production needs a database where every applied migration is
  recorded, so the next deploy can be verified rather than guessed.
- Because all new objects are additive (new tables, new enum types, one nullable
  column, new indexes), a failed application deploy can be rolled back by
  redeploying the previous image while leaving the new schema in place —
  the old code simply never reads the new tables.

### 11.5 Post-migration verification (to be run when implemented)

1. `prisma migrate status` — no drift, no pending migration.
2. `prisma validate` and `prisma generate` succeed.
3. Row counts unchanged for `User`, `UserInterest`, `UserPurpose`,
   `UserLanguage`, `UserPreferredCountry` (proves existing data was preserved).
4. `SELECT count(*) FROM "Interest" / "Purpose" / "Language" / "Country"` equals
   the pre-migration counts (proves catalog seeds were not duplicated).
5. The new tables exist with their unique constraint and indexes
   (check `pg_indexes` for the `(userId, kind, labelKey)` unique index).

---

## 12. Option A — Minimal Schema

Idea: keep the existing catalogs exactly where they are (they already provide
"system tags"), add **one** table for user-authored attributes, **one** row per
user for visibility, and **one** nullable column for region.

### 12.1 Illustrative shape (pseudocode, NOT applied to schema.prisma)

```
enum AttributeKind    { ABOUT_ME, LOOKING_FOR }
enum Visibility       { PUBLIC, CONNECTIONS, PRIVATE }
enum ReviewStatus     { PENDING, APPROVED, REJECTED, HIDDEN }

// User
region  String?  @db.VarChar(80)

model UserAttribute {                 // user-authored rows only
  id           String        @id @default(uuid()) @db.Uuid
  userId       String        @db.Uuid
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind         AttributeKind
  label        String        @db.VarChar(32)
  labelKey     String        @db.VarChar(32)   // normalized: trim + collapse + casefold
  value        String?       @db.VarChar(80)
  visibility   Visibility    @default(PUBLIC)
  sortOrder    Int           @default(0)
  reviewStatus ReviewStatus  @default(APPROVED)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([userId, kind, labelKey])
  @@index([userId, kind])
  @@index([reviewStatus])
}

model ProfileVisibility {             // one row per user, created lazily
  userId            String     @id @db.Uuid
  user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  bio               Visibility @default(PUBLIC)
  location          Visibility @default(PUBLIC)   // countryCode + region + city
  birthDate         Visibility @default(PUBLIC)
  interests         Visibility @default(PUBLIC)
  languages         Visibility @default(PUBLIC)
  purposes          Visibility @default(PUBLIC)
  preferredCountries Visibility @default(PUBLIC)
  attributes        Visibility @default(PUBLIC)   // ABOUT_ME + LOOKING_FOR
  updatedAt         DateTime   @updatedAt
}
```

### 12.2 Counts

| Item | Count |
| --- | --- |
| New tables | 2 (`UserAttribute`, `ProfileVisibility`) |
| New enum types | 3 (`AttributeKind`, `Visibility`, `ReviewStatus`) |
| Changed existing tables | 1 (`User` + `region`) |
| New relations on `User` | 2 |
| Backfill jobs | 0 |

### 12.3 Properties

- **Fields per attribute row:** 1 label + 1 normalized key + 1 optional value +
  1 kind + 1 visibility + 1 sort + 1 review state = the target field set from the
  requirements (`Attribute / Category / Label / Value / Source / Visibility /
  SortOrder`), with `Category` supplied by `kind` and `Source` implicit.
- **Query complexity:** one additional indexed join for a profile read
  (`WHERE userId = ? AND kind = ? AND reviewStatus = 'APPROVED' AND
  (visibility = 'PUBLIC' OR userId = :viewer OR :viewerIsConnected)`), plus one
  single-row lookup for visibility. No recursion, no aggregates.
- **Discover fit:** the candidate `include` gains one relation and a `where` on
  visibility + review state. Tag-overlap scoring is possible against
  `labelKey` for custom rows and against existing catalog slugs for system rows.
  Filtering by category is possible only for `kind`, not for a finer taxonomy.
- **Admin fit:** supports the review queue (`reviewStatus` + `@@index`)
  unchanged from the design. "Disable a system tag" applies to `Interest` /
  `Purpose` rows and would need an availability mechanism (an `isActive` column
  on those catalogs, or a service-level deny-list) because `UserAttribute` holds
  no system rows. Promoting a custom label into the system catalog is not
  expressible.
- **Future extensibility:** adding a new *custom* kind requires only a new enum
  value. Adding a new *visibility-governed field* requires a new column on
  `ProfileVisibility` (a schema change). Adding a new *concept group* (for
  example a structured taxonomy for tags) requires a new table.
- **Duplication risk:** the concept "tag with category" exists twice — once as
  `Interest.category` + `Interest.sort` and once as `UserAttribute.kind` +
  `sortOrder`. A search UI has to union two sources to show one list.

---

## 13. Option B — Extensible Schema

Idea: introduce a single **attribute definition catalog** that can hold both
product-shipped tags and promoted user tags, store every user selection as a row
pointing at a definition (or carrying an inline label for un-promoted custom
tags), and make visibility **per field** so new fields never require a schema
change.

### 13.1 Illustrative shape (pseudocode, NOT applied to schema.prisma)

```
enum AttributeKind      { ABOUT_ME, LOOKING_FOR }
enum AttributeSource    { SYSTEM, CUSTOM }
enum AttributeValueType { BOOLEAN, TEXT, SINGLE_SELECT, MULTI_SELECT }
enum Visibility         { PUBLIC, CONNECTIONS, PRIVATE }
enum ReviewStatus       { PENDING, APPROVED, REJECTED, HIDDEN }

// User
region  String?  @db.VarChar(80)

model AttributeDefinition {           // system tags + promoted user tags
  id          String             @id @default(uuid()) @db.Uuid
  key         String             @unique @db.VarChar(64)   // stable machine key
  scope       AttributeSource    @default(SYSTEM)
  kind        AttributeKind
  category    String             @db.VarChar(32)           // taxonomy group
  label       String             @db.VarChar(32)
  labelZh     String?            @db.VarChar(32)
  valueType   AttributeValueType @default(BOOLEAN)
  sort        Int                @default(0)
  isActive    Boolean            @default(true)
  isSearchable Boolean           @default(true)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  userAttributes UserAttribute[]

  @@index([kind, isActive])
  @@index([category])
}

model UserAttribute {                 // one row per selection
  id           String             @id @default(uuid()) @db.Uuid
  userId       String             @db.Uuid
  user         User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind         AttributeKind
  definitionId String?            @db.Uuid                 // set for SYSTEM / promoted
  definition   AttributeDefinition? @relation(fields: [definitionId], references: [id], onDelete: SetNull)
  label        String?            @db.VarChar(32)          // set for un-promoted CUSTOM
  labelKey     String?            @db.VarChar(32)
  value        String?            @db.VarChar(80)
  visibility   Visibility         @default(PUBLIC)
  sortOrder    Int                @default(0)
  reviewStatus ReviewStatus       @default(PENDING)
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  @@unique([userId, definitionId])
  @@unique([userId, kind, labelKey])
  @@index([userId, kind])
  @@index([reviewStatus])
  @@index([definitionId])
}

model ProfileFieldVisibility {        // per-field rows, lazily created
  userId    String     @db.Uuid
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  fieldKey  String     @db.VarChar(32)   // "bio" | "city" | "region" | "birthDate" | ...
  visibility Visibility @default(PUBLIC)
  updatedAt DateTime   @updatedAt

  @@id([userId, fieldKey])
  @@index([fieldKey, visibility])
}
```

### 13.2 Counts

| Item | Count |
| --- | --- |
| New tables | 3 (`AttributeDefinition`, `UserAttribute`, `ProfileFieldVisibility`) |
| New enum types | 5 |
| Changed existing tables | 1 (`User` + `region`) |
| New relations on `User` | 2 |
| Backfill jobs | 0 required (optional promotion backfill, see §13.3) |

### 13.3 Properties

- **Fields per definition:** `key`, `scope`, `kind`, `category`, `label`,
  `labelZh`, `valueType`, `sort`, `isActive`, `isSearchable` — a first-class
  taxonomy an admin can edit without a deploy.
- **Query complexity:** a profile read joins `UserAttribute` and, for display
  labels, `AttributeDefinition` (one extra join vs Option A). A visibility read
  becomes a small set of rows (`WHERE userId = ?`) instead of a single row.
  Filtering by category or searchable tags is a direct indexed predicate.
- **Discover fit:** supports scoring on `labelKey` (custom) and on
  `AttributeDefinition.key` (system) through the same join, and supports
  category-level facets (`WHERE definition.category = ? AND isActive`) that
  Option A cannot express. `isSearchable` gives an explicit opt-out for noisy
  free-text tags, which the current hardcoded `gaming` slug allowlist has no
  equivalent for.
- **Admin fit:** every capability in §9.2 is native — list definitions, disable a
  tag by `isActive`, edit labels/categories/order, review the custom queue, hide
  a violating row, and promote a custom label by creating a definition and
  setting `definitionId` on the matching rows.
- **Migration coupling to existing catalogs:** the new catalog is additive; the
  existing `Interest` / `Purpose` / `Language` / `Country` tables can remain the
  source of truth for their own domains, with the new definitions used only for
  attribute tags. A later, separate unification step (mapping `Interest.slug` →
  `AttributeDefinition.key`) is possible but optional and out of scope here.
- **Unique-constraint nuance:** `@@unique([userId, definitionId])` and
  `@@unique([userId, kind, labelKey])` coexist; PostgreSQL treats `NULL`s as
  distinct, so a row with `definitionId = NULL` is governed by the label key,
  and a row with a definition is governed by the definition. The service must
  pick exactly one path per write.
- **Delete behaviour:** `onDelete: SetNull` on `definitionId` means removing a
  definition degrades its rows to custom-style rows rather than deleting user
  data; genuine deletion of a user still cascades from `User`.

---

## 14. Recommendation-neutral Comparison

No score, no ranking, no "preferred" label. The table states what each option
does and what it costs.

| Dimension | Option A (minimal) | Option B (extensible) |
| --- | --- | --- |
| New tables | 2 | 3 |
| New enum types | 3 | 5 |
| Existing table changes | `User.region` only | `User.region` only |
| System tag ownership | stays in `Interest` / `Purpose` (seeded, no admin surface) | `AttributeDefinition`, admin-editable per row |
| `Interest` / `Purpose` data | fully untouched, still authoritative | untouched by default; optional later unification |
| Custom attribute storage | own table, source implicit | own table, `source` + optional `definitionId` explicit |
| Visibility granularity | group-level, fixed columns | per-field rows, extensible without schema change |
| Adding a new visibility-governed field | requires a schema change | requires no schema change |
| Adding a new tag category | not expressible | one definition row |
| Disabling a shipped tag | needs an availability mechanism on the existing catalogs (extra column or deny-list) | `isActive = false` |
| Promoting a user tag to system | not expressible | create a definition + set `definitionId` |
| Profile read cost | 1 extra indexed join + 1 single-row lookup | 1 extra join (attribute + definition) + a small visibility query |
| Discover category facets | not expressible | indexed predicate on `definition.category` |
| Searchable/filter guard | none (every custom label equally noisy) | `isSearchable` per definition |
| Moderation review queue | supported (`reviewStatus` + index) | supported (`reviewStatus` + index) |
| Admin surface size | small (review queue + existing catalogs) | larger (definition CRUD + review queue + per-field visibility) |
| Backfill required | none | none (optional promotion backfill) |
| Rollback surface | 2 tables + 1 column to drop | 3 tables + 1 column to drop |
| Service-layer complexity | lower: one attribute table, one visibility row | higher: two write paths (definition-backed vs inline label), definition lifecycle |
| Risk of concept duplication | `(kind, label)` vs `Interest.category` / `Purpose` remain two parallel taxonomies | single taxonomy for tags; still separate from `Interest` unless unified |
| Coupling to `SharedSocialAccount` | none — social handles excluded from `ProfileVisibility` | none — social handles excluded from `ProfileFieldVisibility` |
| Coupling to `SafetyService` | none (called, not changed) | none (called, not changed) |

### 14.1 Decisions that determine the choice

The two options differ only where the following product questions are already
answered:

| Question | Answer that favours A | Answer that favours B |
| --- | --- | --- |
| Will an admin need to change the tag taxonomy without a deploy? | no | yes |
| Will regions/fields beyond the current set ever need their own visibility? | no | yes |
| Is the tag set expected to grow through user-authored content? | no | yes |
| Is tag-level filtering in Discover a near-term requirement? | no | yes |
| Is minimizing new schema surface the priority for this milestone? | yes | no |

### 14.2 What is identical in both

- No column is added per attribute.
- `ABOUT_ME` and `LOOKING_FOR` are separated by `kind`.
- Existing `Language` / `Interest` / `Purpose` / `PreferredCountry` data is
  preserved with zero data migration.
- `User.region` is a nullable free-text column.
- `SharedSocialAccount` and `MomentSetting.visibleTo` are untouched.
- `SafetyService` is called before persisting user-authored text and is not
  modified.
- Block enforcement runs before visibility on every read path.

---

## 15. Open Questions

Each item below must be answered before implementation starts. None of them is
answered by this document, and none of them changes the schema today.

### 15.1 Product decisions

| # | Question | Why it blocks implementation |
| --- | --- | --- |
| Q1 | Default review policy for a new custom attribute: `APPROVED` (instant, retro-moderated) or `PENDING` (owner-only until reviewed)? | Determines the column default and whether the profile editor needs a "pending" state |
| Q2 | Maximum custom attributes per kind per user (proposed 10) — and is there a separate cap for `ABOUT_ME` vs `LOOKING_FOR`? | Drives DTO validation and profile payload size |
| Q3 | Is `LOOKING_FOR` free-text only, catalog-driven, or hybrid (§5.2)? | Determines whether Option A is even sufficient |
| Q4 | Are the five `LOOKING_FOR` examples (语言交换 / 游戏好友 / 同城朋友 / 旅行伙伴 / 想认识海外朋友) product-shipped tags or user-typed examples? | Decides whether a definition catalog is needed on day one |
| Q5 | Must a user be able to hide one interest while showing the rest, or is hiding the whole "interests" group enough? | Group-level (A) vs per-field (B) |
| Q6 | Should `bio` become multiple sections (about me / looking for) or stay one block with attributes separate? | Affects whether `bio` needs its own visibility and length rules |
| Q7 | Is `gender` meant to be visible at all, and does it need a tier? | It is currently collected but absent from Discover output |

### 15.2 Schema and data decisions

| # | Question | Why it blocks implementation |
| --- | --- | --- |
| Q8 | Keep the existing `Interest` / `Purpose` catalogs authoritative, or unify them into one definition catalog? | The single largest structural difference between the two options |
| Q9 | Should existing user-authored content (for example `bio`) be backfilled into attribute rows, or left as scalars? | A backfill is a destructive-shaped write and needs explicit approval |
| Q10 | When a system tag is disabled, are existing user selections kept but unlisted, or stripped? | Only "kept but unlisted" is non-destructive; the other needs a data migration |
| Q11 | Does `region` need to be filterable (index) within the next milestone? | An index is cheap to add but not free to maintain if never queried |
| Q12 | Should `UserAttribute.labelKey` normalization use Unicode casefolding and NFKC? | Determines whether `Café` and `CAFÉ` are one tag or two |
| Q13 | Should custom attributes be searchable by other users, or is profile-display only? | Determines whether the label needs a search index and a `isSearchable` equivalent |

### 15.3 Moderation and Admin decisions

| # | Question | Why it blocks implementation |
| --- | --- | --- |
| Q14 | Is attribute-level reporting required, or is a user-level `Report` with the attribute quoted in `description` acceptable? | `Report` has no generic `targetType` / `targetId` today (see §10.4) |
| Q15 | Which role may hide a violating attribute — `CONTENT_MANAGER`, `MODERATOR`, or `SUPER_ADMIN` only? | Maps to the existing `moderation:*` vs `settings:*` split |
| Q16 | Should tag taxonomy changes be audited as `ATTRIBUTE_DEFINITION` targets under the existing `AdminAuditLog`? | `targetType` is `VarChar(32)`; the name must be chosen before the first write |
| Q17 | Does disabling a tag need a user-facing notification? | No notification path exists for taxonomy changes |
| Q18 | Should a custom attribute that fails safety scanning be rejected with an existing error code, or does it need a new one? | Error envelopes are part of the public API contract |

### 15.4 Sequencing questions

| # | Question | Why it blocks implementation |
| --- | --- | --- |
| Q19 | Does this work wait for the P1 items already recorded (S3 storage, SMTP, Redis rate limiting, health check)? | Profile attributes must not ship on top of an unverified storage/notification stack |
| Q20 | Is a per-field visibility settings UI in scope for the first increment, or is the schema added first with group-level defaults? | Determines whether the schema lands with or ahead of the editor |

---

## Closing statement

This document is a design artifact only.

- `prisma/schema.prisma` was not modified.
- No migration was created or executed.
- No business code, DTO, service, controller, or component was changed.
- `SafetyService` and the `SharedSocialAccount` authorization model were not
  touched.
- Nothing in §12 or §13 has been implemented.

Implementation requires an explicit decision on §14.1 and the closure of the
blocking questions in §15, after which a single option is chosen and a migration
is proposed for approval.

