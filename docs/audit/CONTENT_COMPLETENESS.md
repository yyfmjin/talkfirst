# CONTENT_COMPLETENESS

Content system audit: Post, Post Detail, Comment, Reply, Like, Bookmark, Share, Report.

---

## Post

| Concern | Status | Evidence |
|---|---|---|
| Create | COMPLETE | `POST /moments` → `MomentsService.publish` (`moments.service.ts:390-453`); content max 2000, safety-scan, images ≤9 (http(s) only), video URL validated, tags normalized. |
| Read (feed) | COMPLETE | `GET /moments/feed` → `MomentsService.feed` with visibility + sensitive filter + demo labelling. |
| Read (own/user) | COMPLETE | `GET /moments/user/:id` → `MomentsService.userMoments`. |
| **Read (single post)** | **MISSING** | no `GET /moments/:id`, no `/moments/[id]` page. |
| Update | MISSING | no `PATCH /moments/:id`. |
| Delete | COMPLETE | `DELETE /moments/:id` → `MomentsService.remove` (owner only). |
| Permission | COMPLETE | `resolveMomentAccess` (private/connections/everyone + block). |
| Empty / loading / error | COMPLETE | feed has skeleton / `EmptyFeed` / error+retry (`moments/page.tsx:286-295`). |
| Mobile | COMPLETE | single phone shell. |
| Notification (publish) | **MISSING** | no notification on publish. |
| Admin | **MISSING** | no moment management in admin. |
| Audit | MISSING | no audit trail on moment content. |
| Tests | PARTIAL | `moments-access.spec.ts` only (visibility), not publish/delete CRUD. |

---

## Post Detail

| Concern | Status |
|---|---|
| Route `/moments/[id]` | MISSING |
| Endpoint `GET /moments/:id` | MISSING |
| Permalink / deep link | MISSING (share points at profile) |
| Author info | PARTIAL (only via feed/profile) |
| Related/comments inline | PARTIAL (inline on feed card only) |

---

## Comment

| Concern | Status | Evidence |
|---|---|---|
| Create | COMPLETE | `POST /moments/:id/comments` → `addComment` (`moments.service.ts:355-388`), content ≤500, safety-scan, increments `commentCount`. |
| Read | COMPLETE | `GET /moments/:id/comments` → `listComments` (`moments.service.ts:342-353`), author select. |
| Update | MISSING | no edit. |
| Delete | MISSING | no delete endpoint. |
| Permission | COMPLETE | `assertCanInteract` gates on moment access + block. |
| **Reply (二级)** | **MISSING** | no `parentId`; `CommentDto` has only `content`. |
| **Pagination** | **MISSING** | flat `take` ≤50, no cursor; frontend fetches once. |
| Like comment | MISSING | no model/endpoint. |
| **Report comment** | **MISSING** | `Report` has no `commentId`. |
| Notification | COMPLETE | `MOMENT_COMMENT` on add (`moments.service.ts:376-386`). |
| Admin | MISSING | no comment management. |
| Count consistency | PARTIAL | `commentCount` incremented on add, never reconciled; no delete so no drift yet. |
| Tests | MISSING | no comment CRUD tests. |

---

## Reply

- **MISSING entirely.** No parentId, no reply endpoint, no reply UI.

---

## Like

| Concern | Status | Evidence |
|---|---|---|
| Toggle | COMPLETE | `POST /moments/:id/like` → `toggleLike` (`moments.service.ts:310-340`), transactional, decrement/increment `likeCount`. |
| Optimistic UI | COMPLETE | `moments/page.tsx:110-136` (optimistic + reconcile). |
| Notification | COMPLETE | `MOMENT_LIKE` when owner ≠ liker. |
| Count consistency | PARTIAL | denormalized `likeCount`, no reconcile. |
| Tests | MISSING | no like toggle spec. |

---

## Bookmark

- **MISSING entirely.** No `MomentBookmark` model, no route, no UI, no endpoint.

---

## Share

| Concern | Status | Evidence |
|---|---|---|
| Client share | PARTIAL | `shareMoment` (`moments/page.tsx:185-198`) uses `navigator.share` / clipboard. |
| Shared target | **WRONG TARGET** | shares `/moments/user/:userId` (profile) because no post detail exists. |
| Backend share model/tracking | MISSING | no share model, no endpoint. |

---

## Report

| Concern | Status | Evidence |
|---|---|---|
| Report user | COMPLETE | `POST /reports` (`social-safety.controller.ts:336-379`), reason allowlist, self-report blocked. |
| Report message | PARTIAL | optional `messageId` accepted. |
| **Report moment** | **MISSING** | `Report` has no `momentId`. |
| **Report comment** | **MISSING** | `Report` has no `commentId`. |
| My reports | COMPLETE | `GET /reports/mine`. |
| Admin review | COMPLETE | `GET /admin/reports`, `POST /admin/reports/:id/review`. |
| Notification on report | MISSING | no notification emitted on report. |
| Tests | PARTIAL | admin-reports specs only; no user report e2e. |

---

## Content moderation (admin)

- User-level: complete (ban/disable/suspend, notes, audit).
- Content-level: **missing** — no ability to remove/hide a specific Moment or Comment from the admin console.
