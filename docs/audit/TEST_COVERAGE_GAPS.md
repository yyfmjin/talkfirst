# TEST_COVERAGE_GAPS

Coverage per layer: Unit / Integration / Real HTTP / Playwright / E2E.

---

## What exists

### API (Jest) — 23 spec files
- Auth guard: `auth/jwt-auth.guard.spec.ts`
- Exception filter: `common/api-exception.filter.spec.ts`
- Block guard: `common/block-guard.spec.ts`
- Discover filter: `discover/discover-filter.spec.ts`
- Exchange privacy: `exchange/exchange-privacy.spec.ts`
- Health: `health/health.controller.spec.ts`
- Moments access: `moments/moments-access.spec.ts`
- Safety autoflag: `safety/safety-autoflag.spec.ts`
- Upload URL: `uploads/upload-url.spec.ts`
- User status scheduler: `users/user-status.scheduler.spec.ts`
- Users avatar: `users/users-avatar.spec.ts`
- Admin (12): `admin-admin-*.spec.ts` (audit, blocks, connections, dashboard, exchanges, integration, rbac, reports, risk, user-detail, user-status, users)

### Admin (Playwright e2e) — 13 specs
- `test/e2e/admin-*.spec.ts` (audit-ui, blocks, connections, dashboard, exchanges, integration, moderation, rbac, report-detail, reports-ui, risk, user-detail, users) + `test/smoke.test.mjs`

### Web
- `test/smoke.test.mjs` only.

---

## Gaps by feature

| Feature | Unit | Integration | HTTP | Playwright | E2E |
|---|---|---|---|---|---|
| Register/login/logout | ✗ | ✗ | ✗ | ✗ | ✗ |
| Email verification | ✗ | ✗ | ✗ | ✗ | ✗ |
| Refresh rotation | ✗ (guard only) | ✗ | ✗ | ✗ | ✗ |
| Onboarding (all steps) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Discover / Say Hello | filter only | ✗ | ✗ | ✗ | ✗ |
| Chat (REST + WS) | block-guard only | ✗ | ✗ | ✗ | ✗ |
| WS block bypass (text/image) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Notifications | ✗ | ✗ | ✗ | ✗ | ✗ |
| Contact exchange | privacy only | ✗ | ✗ | ✗ | ✗ |
| Moments publish/delete | access only | ✗ | ✗ | ✗ | ✗ |
| Like / comment | ✗ | ✗ | ✗ | ✗ | ✗ |
| Uploads (avatar/message-image) | upload-url only | ✗ | ✗ | ✗ | ✗ |
| Presence / translate | ✗ | ✗ | ✗ | ✗ | ✗ |
| Report/block (user path) | ✗ | ✗ | ✗ | ✗ | ✗ |

---

## Gap classes

### No tests at all
- Auth flows (register/login/logout/verify), onboarding, discover, chat, notifications, exchange, moments CRUD, uploads, presence, translate.

### Permission tests missing
- Moment/comment/message ownership across statuses beyond the admin RBAC specs.

### Status tests missing
- DISABLED/SUSPENDED/BANNED at login/refresh boundary (only JWT/WS strategy paths are implicitly covered via admin specs).

### Privacy tests missing
- WS message/image block bypass regression test (prior fix exists in `chat.gateway.ts` via `assertNotBlocked`, but no dedicated spec guards it).

### Mobile tests missing
- No mobile/responsive e2e or visual regression.

---

## Summary

- API has good unit/integration coverage for admin, guards, filters, and a few privacy/access rules.
- Admin has full Playwright e2e.
- **Web has no e2e suite** — the entire user-facing product (discover, moments, chat, notifications, onboarding, exchange) is untested at the browser level.
