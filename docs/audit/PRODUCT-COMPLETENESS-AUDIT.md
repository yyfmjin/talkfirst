# TALKFIRST — PRODUCT COMPLETENESS AUDIT

**Date:** 2026-09-19
**Scope:** read-only. No business code changed, no schema changed, no migration run, no SafetyService change, no feature added.
**Method:** read the real source (`apps/api`, `apps/web`, `apps/admin`, `packages/*`, `prisma`, `scripts`, `tests`, `docs`). Every claim below is backed by a file path and (where useful) a line number.

---

## 1. Executive Summary

TalkFirst is a **working end-to-end MVP**: auth → onboarding → discover → Say Hello → connect → chat (REST + Socket.IO) → contact exchange → moments, with a **complete RBAC admin console** (users / reports / moderation / risk / connections / exchanges / blocks / audit).

The product is **not feature-complete** in three concentrated areas:

1. **Content system is half-built.** Moments exist, but there is **no post-detail page or endpoint**, no replies, no comment pagination/deletion, no bookmarks, and — critically — **moments and comments cannot be reported** (the `Report` model only targets users + an optional message).
2. **Social platform integration is mock.** Platform binding writes a handle and then fabricates `source: "DEMO"` moments with hardcoded copy and Unsplash stock images. No real OAuth/API/sync exists.
3. **Notification & email verification loops are open.** Notifications have a DB model and a read endpoint, but no dedicated page, no real-time push, and several events don't emit notifications. Email verification exists but is **not enforced at registration** and cannot actually deliver a code (no SMTP; `Math.random` code generation).

**P0 (broken core / security / data loss / severe privilege escalation):** none identified in product-completeness terms. Core flows (register, login, discover, chat, exchange, moments, admin) are functional. The production-infrastructure P0s (HTTPS/reverse-proxy, database backup) belong to the separate *Production Readiness* audit and are **not** re-classified here.

**P1:** 10 items — post detail, comment/reply loop, content reporting, notification loop, email-verification loop, mock social sync, message read/delivered, password reset, bookmarks, admin content management.

**P2:** consistency/UX/test items. **P3:** polish.

---

## 2. Complete Feature Inventory

See `FEATURE_INVENTORY.md` (same directory) for the full per-feature matrix:

- feature, frontend route, frontend component, API endpoint, service, database model, admin page, permission, tests, status.

---

## 3. Missing Features

| # | Feature | Evidence |
|---|---|---|
| M1 | **Post detail page** (`/moments/[id]`) and `GET /moments/:id` | No route in `apps/web/src/app/moments/`; no `@Get(":id")` in `apps/api/src/moments/moments.controller.ts` (routes: platforms, feed, user/:id, bindings, settings, `:id/like`, `:id/comments`, POST `/moments`, DELETE `:id`). |
| M2 | **Comment replies** (二级评论) | `MomentComment` has no `parentId`; `CommentDto` only has `content` (`moments.controller.ts`). |
| M3 | **Comment pagination** | `listComments` uses `take: safeLimit` (`moments.service.ts:342-353`) but returns no cursor; frontend `toggleComments` fetches once (`moments/page.tsx:138-152`). |
| M4 | **Comment delete** | No `DELETE /moments/:id/comments/:commentId`; `MomentComment` delete path absent. |
| M5 | **Bookmarks / saved posts** | No `MomentBookmark` model in `schema.prisma`; no `/bookmarks` route; no UI. |
| M6 | **Report a moment or comment** | `Report` model has only `reporterId`, `reportedUserId`, `messageId`, `reason`, `description` (`schema.prisma:533-547`); `report()` only accepts `dto.userId` + optional `dto.messageId` (`social-safety.controller.ts:336-379`). |
| M7 | **Password reset / forgot-password** | No controller route; no `forgotPassword`/`resetPassword` in `auth.service.ts`; depends on missing SMTP. |
| M8 | **Message read / delivered receipts** | `Message` model has no `readAt`/`deliveredAt` (`schema.prisma:504-517`). |
| M9 | **Dedicated notifications page** | No `/notifications` route in `apps/web/src/app/`; notifications only surface in `components/tab-bar.tsx` badge and `app/messages/panels.tsx`. |
| M10 | **Admin content/comment/post management** | No routes/components in `apps/admin/src/app/` for content, posts, moments, or comments (only users/reports/moderation/risk/connections/exchanges/blocks/audit). |
| M11 | **Feature flags / announcements / popup / banner / ads / config** | No route, component, or API endpoint in either web or admin. |
| M12 | **Google / Apple SSO** | `apps/web/src/app/login/page.tsx` and `register/page.tsx` render "即将上线" placeholders; no backend OAuth. |

---

## 4. Partial Features

| # | Feature | Status | Evidence |
|---|---|---|---|
| P1 | **Email verification** | Partial | `VerificationService` (`verification.service.ts`) generates/verifies codes, but `register()` in `auth.service.ts:27-41` **never calls** `assertRecentVerification`, so verification is not enforced. No SMTP → code is never delivered in production (`verification.service.ts:25-28`). |
| P2 | **Code generation** | Weak | `newVerificationCode()` uses `Math.random()` (`common/crypto.ts:11-13`), not `crypto.randomInt`. |
| P3 | **Share** | Partial | `shareMoment` (`moments/page.tsx:185-198`) uses `navigator.share`/clipboard but shares the author profile URL `/moments/user/:userId`, not a post URL (post detail absent). |
| P4 | **Notifications** | Partial | Model + `GET /notifications` + `POST /notifications/read` exist (`social-safety.controller.ts:440-497`); no real-time push, no per-item read/delete, no pagination (`take: 50`). |
| P5 | **Translate** | Partial/stub | `translate.service.ts:133-142` falls back to a `local-demo` string when `TRANSLATION_API_URL`/`TRANSLATION_API_KEY` are absent (`translation.provider.ts:12-14` returns `null`). |
| P6 | **Uploads / S3** | Partial | `saveLocal` writes to local filesystem (`uploads.service.ts:57-67`); `presign` returns `STORAGE_NOT_CONFIGURED` without `STORAGE_ENDPOINT`/`STORAGE_SECRET_KEY` (`uploads.controller.ts:44-55`). Avatar/message-image use `saveLocal` (`uploads.controller.ts:79-81,114`). |
| P7 | **Onboarding social step** | Partial | `onboarding/social/page.tsx` is fire-and-forget, no binding logic; `/me/social` page is a placeholder. |
| P8 | **Social account sync** | Partial | `syncEnabled` flag exists on `SocialAccount`/`MomentPlatformBinding`, but no sync job/worker/OAuth; binding seeds demo moments only. |

---

## 5. Mock Features

| # | Feature | Evidence |
|---|---|---|
| K1 | **Social platform "sync"** | `bindPlatform` → `seedDemoMoments()` (`moments.service.ts:110,496-566`): hardcoded copy, Unsplash URLs, `Math.random()` counts, `source: "DEMO"`. |
| K2 | **External translation** | `translation.provider.ts:12-14` returns `null` without env; `translate.service.ts:133-142` returns "（演示翻译…）". |
| K3 | **SSO buttons** | Google/Apple buttons are "即将上线" placeholders (`login/page.tsx`, `register/page.tsx`). |
| K4 | **Verification delivery** | "no SMTP provider configured yet" (`verification.service.ts:25`); `devCode` returned only outside production. |

---

## 6. Broken Features

None identified as hard-broken. The `DEMO` moments are correctly labelled `source: "DEMO"` / `isDemo: true` (`moments.service.ts:449-450`) so they cannot be mistaken for real sync. Items below are "incomplete", not "crashed".

---

## 7. Content System Gaps

- **Post detail:** missing (M1). There is no single-post view; likes/comments are inline on the feed card or the user profile page only.
- **Comment count consistency:** `commentCount` is denormalized and incremented on `addComment` (`moments.service.ts:373`) but there is no delete, so no drift today; the absent delete is itself the gap.
- **Comment permission:** `assertCanInteract` gates comment/like on `resolveMomentAccess` (private/connections/everyone + block) (`moments.service.ts:71-74,35-62`) — consistent.
- **Comment notification:** emitted on add (`moments.service.ts:376-386`); **no** comment report, **no** reply, **no** comment delete.
- **Author status change:** moments are cascade-deleted with the user (`Moment.user` onDelete Cascade). No explicit "hide all content on ban" exists beyond account-level blocking via JWT (non-ACTIVE → 401).

---

## 8. Comment System Gaps

- No reply / threading (no `parentId`).
- No pagination (flat `take` only).
- No delete / edit.
- No like on comments.
- Cannot be reported (no `commentId` in `Report`).
- Not visible in Admin (no comments management).

---

## 9. Post Detail Gaps

- No `GET /moments/:id` endpoint and no `/moments/[id]` page.
- Deep-linking/sharing a specific post is impossible (share targets the profile).
- Comments/author info are only reachable through the feed or profile; there is no standalone permalink.

---

## 10. Social Platform Gaps

See `SOCIAL_PLATFORM_MATRIX.md` for the full matrix.

- Real `SocialPlatform` enum (from `schema.prisma:85-98`): `INSTAGRAM, TELEGRAM, WHATSAPP, DISCORD, X, TIKTOK, WECHAT, QQ, STEAM, YOUTUBE, FACEBOOK, TALKFIRST`.
- `MomentsService.MOMENT_PLATFORMS` only exposes a subset (`TALKFIRST, INSTAGRAM, X, TIKTOK, YOUTUBE, FACEBOOK`) for binding (`moments.service.ts:5-12`).
- No OAuth, no API sync, no credential storage, no scraping; binding is a handle string + demo seeding.
- `syncEnabled` toggles UI only, not a real sync.

---

## 11. Admin Gaps

See `Admin` section in `FEATURE_INVENTORY.md`.

- Admin is a **read-only + user-moderation** console. It has no:
  - Content / moment / post management.
  - Comment management.
  - Social platform management/configuration.
  - Feature flags, announcements, popup, banner, promotion/ads, system configuration.
- `moderation` page is a reports queue (`apps/admin/src/app/moderation/page.tsx`: `ReportItem`, `STATUS_BADGE` OPEN/REVIEWING/RESOLVED/REJECTED, maps to `/admin/reports`).
- `audit` page has no loading/empty state (`audit/page.tsx`).

---

## 12. UI/UX Gaps

See `UIUX_AUDIT.md`.

- Shared primitives are thin: `components/ui.tsx` (`GradientButton`, `OutlineButton`, `SmallButton`, `Field`) and `components/tab-bar.tsx`; most pages hand-roll their own cards/modals/confirmations.
- No dedicated toast system; success/error surfaces vary per page (inline text vs `window.confirm` vs `window.alert`).
- `/me` page has a plain-text "加载中…" with no skeleton/spinner (`me/page.tsx:44`).
- Admin `audit` page lacks loading/empty treatment.

---

## 13. Popup / Interaction Gaps

See `INTERACTION_AUDIT.md`.

- Confirmations are inconsistent: moment delete uses `window.confirm` (`moments/page.tsx:173`); admin uses a `ConfirmDialog` component; block/report in chat use inline panels.
- No unified loading/disabled/ESC/outside-click contract across modals.

---

## 14. Advertising / Promotion Gaps

- **MISSING entirely.** No placement, campaign, creative, schedule, target, priority, impression, click, or enable/disable model, API, or UI. No schema exists for it (no change proposed here).

---

## 15. Mobile Gaps

- The web app is a **single 390px phone shell** (`components/phone-shell.tsx`) that stretches full-screen below `sm` breakpoint; there is no 375/390/430/768/1440-specific responsive pass beyond that shell.
- No mobile-specific e2e coverage; no visual regression baseline.

---

## 16. Notification Gaps

See `FEATURE_INVENTORY.md` → Notifications.

| Event | Notification emitted? |
|---|---|
| Say Hello sent | Yes — `connections.service.ts:156` |
| Connection accepted | Yes — `connections.service.ts:259` |
| Connection rejected/cancelled | **No** |
| Exchange requested | Yes — `exchange.service.ts:152` |
| Exchange accepted | Yes — `exchange.service.ts:271` |
| Exchange rejected/cancelled | **No** |
| Moment liked | Yes — `moments.service.ts:328-338` |
| Moment commented | Yes — `moments.service.ts:376-386` |
| Moment published | **No** |
| REST text/image message | Yes — `social-safety.controller.ts:210,263` |
| WS text message | Yes — `chat.gateway.ts:214` |
| WS image message | **No** (emit only, no `notification.create`) |
| Report created | **No** |
| Block/unblock | **No** |
| Any admin action | **No** (writes `AdminAuditLog` only) |

- No real-time push (polling only via badge + messages panel), no per-item read/delete, no pagination.

---

## 17. Permission Gaps

See the matrix in `FEATURE_INVENTORY.md`.

- **RBAC** is complete and enforced (JwtAuthGuard → AdminGuard → PermissionGuard; `permissions.ts` role→permission map).
- **User status** is enforced at request time and WS connect time (`jwt.strategy.ts:36-47`, `chat-auth.service.ts:30-31`).
- **Inconsistency:** `login()` and `rotateRefresh()` only reject `BANNED`, not `DISABLED`/`SUSPENDED` (`auth.service.ts:52-57,108-113`), so a disabled/suspended user can still obtain/refresh tokens — those tokens are then rejected at every endpoint. Not an IDOR, but an inconsistent gate.
- No IDOR or horizontal/vertical escalation identified in user-owned resources (messages, moments, connections, exchanges, blocks, reports) — confirmed by existing specs (`moments-access.spec.ts`, `exchange-privacy.spec.ts`, `block-guard.spec.ts`).

---

## 18. Privacy Gaps

- Moment visibility is enforced (`resolveMomentAccess` → private/connections/everyone + block) (`moments.service.ts:35-62`).
- Shared social accounts are per-pair authorized (`SharedSocialAccount`) and never inferable from `SocialAccount` visibility (`schema.prisma:344-365`).
- Sensitive-content filter masks emails/phone-like numbers (`moments.service.ts:462-465`).
- **No identified privacy leak.** The known `Math.random` verification code is a security-hardening issue, not a privacy leak.

---

## 19. Test Gaps

See `TEST_COVERAGE_GAPS.md`.

- API: 23 spec files (auth guard, exception filter, block guard, discover filter, exchange privacy, health, moments access, safety autoflag, upload url, user status scheduler, users avatar, 12 admin specs).
- Admin: 13 Playwright e2e specs + smoke.
- Web: **only** `test/smoke.test.mjs` — no Playwright/e2e for the user-facing app (discover, moments, chat, notifications, onboarding).

---

## 20. Data/API Gaps

- `commentCount`/`likeCount` denormalized on `Moment`; no reconcile/backfill script.
- `Report.messageId` is an un-indexed, non-FK UUID column (`schema.prisma:539`) — no FK to `Message`.
- `ExchangeRequest.connectionId` is a bare UUID with no FK (`schema.prisma:633`).
- `Notification.data` is a free-text JSON string (`schema.prisma:624`) with no schema.
- No `GET /moments/:id`, no comment delete/report endpoints (mirrors frontend gaps).

---

## 21. P0

**None.** No broken core flow, no data-loss vector, no security bypass, no privilege escalation was found in the product layer. (The two production-infrastructure P0s — HTTPS/reverse-proxy and database backup — are tracked in the separate Production Readiness audit and remain out of scope here.)

---

## 22. P1

1. **Post detail missing** — no `GET /moments/:id`, no `/moments/[id]` page (breaks content permalink/deep-link loop).
2. **Comment loop incomplete** — no replies, no pagination, no delete, no comment report.
3. **Content reporting missing** — moments and comments cannot be reported; `Report` only targets users + optional message.
4. **Notification loop incomplete** — no dedicated page, no real-time push, no per-item read/delete/pagination, and multiple events don't emit notifications.
5. **Email verification not enforced + weak RNG + no SMTP** — `register()` skips verification; `Math.random` code; no delivery in production.
6. **Social platform sync is mock** — no real OAuth/API; demo content stands in for a core product promise.
7. **Message read/delivered receipts missing** — no `readAt`/`deliveredAt`.
8. **Password reset/change missing** — no forgot/reset flow.
9. **Bookmarks missing** — no model/route/UI.
10. **Admin content management missing** — cannot moderate/remove individual moments or comments.

---

## 23. P2

- Comment/like count drift risk from denormalized counters (no reconcile).
- Share UX shares a profile URL instead of a post URL (consequence of P1-1).
- Google/Apple SSO placeholders.
- `login`/`refresh` status gate inconsistency (DISABLED/SUSPENDED not rejected at login).
- Translate `local-demo` fallback when no external provider env.
- Presence/typing/WS rate-limit are single-instance in-memory (`presence.service.ts:12-13`, `chat.gateway.ts:261-273`).
- Discover scoring N+1 risk (already noted in prior audits).
- Admin `audit` page lacks loading/empty state.
- `Report.messageId` and `ExchangeRequest.connectionId` lack FK constraints.
- Stale README; onboarding/social and `/me/social` are placeholder pages.

---

## 24. P3

- UI copy/component consistency (toast vs inline vs `window.confirm`).
- Accessibility polish across modals (ESC/outside-click/focus trap).
- Mobile visual regression baseline and finer responsive breakpoints.
- Notification UI refinements (per-item actions, grouping).

---

### Scope Confirmation

- schema changed: **NO**
- migration added: **NO**
- SafetyService changed: **NO**
- business code changed: **NO**
- features added: **NO**
- tests deleted/weakened: **NO**

---

PRODUCT AUDIT COMPLETE
