# FEATURE_INVENTORY

Machine-readable inventory of every feature. `status` ∈ {COMPLETE, PARTIAL, MOCK, MISSING, BROKEN, UNKNOWN}. No subjective scoring.

Legend: route = frontend route; component = frontend component(s); endpoint = API route; service = Nest service; model = Prisma model; admin = admin page; perm = required admin permission; tests = test files.

---

## Auth

| Feature | route | component | endpoint | service | model | admin | perm | tests | status |
|---|---|---|---|---|---|---|---|---|---|
| Register | `/register` | `app/register/page.tsx` | `POST /auth/register` | `AuthService.register` | `User`, `RefreshToken` | — | — | — | COMPLETE |
| Login | `/login` | `app/login/page.tsx` | `POST /auth/login` | `AuthService.login` | `User`, `RefreshToken` | — | — | — | COMPLETE |
| Refresh | — | `lib/api.ts`, `lib/chat-socket.ts` | `POST /auth/refresh` | `AuthService.rotateRefresh` | `RefreshToken` | — | — | `jwt-auth.guard.spec.ts` | COMPLETE |
| Logout | — | `lib/api.ts` | `POST /auth/logout` | `AuthService.logout` | `RefreshToken` | — | — | — | COMPLETE |
| Email verify | `/verify` | `app/verify/page.tsx` | `POST /auth/send-verification-code`, `POST /auth/verify-email` | `VerificationService` | `VerificationCode` | — | — | — | PARTIAL (not enforced on register; no SMTP; `Math.random`) |
| SSO (Google/Apple) | — | placeholder buttons | — | — | — | — | — | — | MISSING |
| Password reset/change | — | — | — | — | — | — | — | — | MISSING |

---

## Onboarding / Profile

| Feature | route | component | endpoint | service | model | status |
|---|---|---|---|---|---|---|
| Avatar | `/onboarding/avatar` | `avatar/page.tsx` | `PUT /users/me/avatar`, `POST /uploads/avatar` | `UsersService.updateAvatar`, `UploadsService` | `User` | COMPLETE |
| Basic profile | `/onboarding/profile` | `profile/page.tsx` | `PATCH /users/me` | `UsersService.updateProfile` | `User` | COMPLETE |
| Interests | `/onboarding/interests` | `interests/page.tsx` | `PUT /users/me/interests`, `GET /meta/interests` | `UsersService.replaceInterests` | `Interest`, `UserInterest` | COMPLETE |
| Languages | `/onboarding/languages` | `languages/page.tsx` | `PUT /users/me/languages`, `GET /meta/languages` | `UsersService.replaceLanguages` | `Language`, `UserLanguage` | COMPLETE |
| Purposes | `/onboarding/purposes` | `purposes/page.tsx` | `PUT /users/me/purposes`, `GET /meta/purposes` | `UsersService.replacePurposes` | `Purpose`, `UserPurpose` | COMPLETE |
| Countries | `/onboarding/countries` | `countries/page.tsx` | `PUT /users/me/preferred-countries`, `GET /meta/countries` | `UsersService.replacePreferredCountries` | `Country`, `UserPreferredCountry` | COMPLETE |
| Social (onboarding) | `/onboarding/social` | `social/page.tsx` | (none) | — | — | MISSING (placeholder) |
| My card | `/me` | `me/page.tsx` | `GET /users/me` | `UsersService.getFullCard` | `User` | COMPLETE |
| Safety center | `/me/safety` | `me/safety/page.tsx` | `GET /blocks`, `GET /reports/mine`, `DELETE /blocks/:userId` | (controller inline) | `Block`, `Report` | COMPLETE |
| Social accounts (me) | `/me/social` | `me/social/page.tsx` | (none) | — | — | MISSING (placeholder) |
| Delete account | — | — | `DELETE /users/me` | `UsersService` | `User` | COMPLETE |

---

## Discover / Say Hello / Connections

| Feature | route | endpoint | service | model | status |
|---|---|---|---|---|---|
| Recommendations | `/discover` | `GET /discover/recommendations` | `DiscoverService.getRecommendations` | `User`, `DiscoverView` | COMPLETE |
| Mark viewed | `/discover` | `POST /discover/views/:userId` | `DiscoverService.markViewed` | `DiscoverView` | COMPLETE |
| Say Hello templates | `/discover` | `GET /connections/templates` | `ConnectionsService.listTemplates` | — | COMPLETE |
| Send request | `/discover` | `POST /connections/requests` | `ConnectionsService.sendRequest` | `ConnectionRequest` | COMPLETE |
| Incoming/sent | `/messages` | `GET /connections/requests/incoming|sent` | `ConnectionsService.listIncoming/listSent` | `ConnectionRequest` | COMPLETE |
| Respond | `/messages` | `POST /connections/requests/:id/respond` | `ConnectionsService.respond` | `ConnectionRequest`, `Connection` | COMPLETE |
| Cancel | `/messages` | `DELETE /connections/requests/:id` | `ConnectionsService.cancelRequest` | `ConnectionRequest` | COMPLETE |
| Connections list | `/connections` | `GET /connections` | `ConnectionsService.listConnections` | `Connection` | COMPLETE |
| Remove connection | `/connections` | `DELETE /connections/:id` | `ConnectionsService.removeConnection` | `Connection` | COMPLETE |

---

## Chat / Messages

| Feature | route | endpoint / WS | service | model | status |
|---|---|---|---|---|---|
| Conversation list | `/messages` | `GET /conversations` | (controller inline) | `Conversation`, `ConversationMember` | COMPLETE |
| Message history | `/messages/[id]` | `GET /conversations/:id/messages` | (controller inline) | `Message` | COMPLETE |
| Send text (REST) | `/messages/[id]` | `POST /conversations/:id/messages` | (controller inline) | `Message` | COMPLETE |
| Send image (REST) | `/messages/[id]` | `POST /conversations/:id/messages/image` | (controller inline) | `Message` | COMPLETE |
| Send (WS) | `/messages/[id]` | `/chat` ns: `conversation.join/leave`, `message.send`, `typing` | `ChatGateway` | `Message` | COMPLETE |
| Delete (24h) | `/messages/[id]` | `DELETE /messages/:id` | (controller inline) | `Message` | COMPLETE |
| Translate | `/messages/[id]` | `POST /messages/:id/translate` | `TranslateService` | `MessageTranslation` | PARTIAL (demo fallback) |
| Typing | `/messages/[id]` | WS `typing` | `PresenceService` | — | COMPLETE |
| Presence | — | `GET /presence/online` | `PresenceService` | — | COMPLETE (single-instance memory) |
| Read/delivered receipts | — | — | — | — | MISSING |

---

## Contact Exchange / Social Accounts

| Feature | route | endpoint | service | model | status |
|---|---|---|---|---|---|
| Platforms | `/messages/[id]/connect` | `GET /exchange/platforms` | `ExchangeService.platformLabels` | — | COMPLETE |
| My accounts | — | `GET/PUT/DELETE /users/me/social-accounts[...]` | `ExchangeService` | `SocialAccount` | COMPLETE |
| Exchange eligibility | — | `GET /conversations/:id/exchange` | `ExchangeService.eligibility` | `ExchangeRequest` | COMPLETE |
| Request exchange | — | `POST /conversations/:id/exchange` | `ExchangeService.request` | `ExchangeRequest` | COMPLETE |
| Respond/cancel | — | `POST /exchange/:id/respond|cancel` | `ExchangeService.respond/cancel` | `ExchangeRequest` | COMPLETE |
| Shared contacts | — | `GET /conversations/:id/exchange/contacts` | `ExchangeService.sharedContacts` | `SharedSocialAccount` | COMPLETE |

---

## Moments

| Feature | route | endpoint | service | model | status |
|---|---|---|---|---|---|
| Feed | `/moments` | `GET /moments/feed` | `MomentsService.feed` | `Moment` | COMPLETE |
| Compose | `/moments/compose` | `POST /moments` | `MomentsService.publish` | `Moment` | COMPLETE |
| User moments | `/moments/user/[id]` | `GET /moments/user/:id` | `MomentsService.userMoments` | `Moment` | COMPLETE |
| **Post detail** | — | — | — | — | **MISSING** |
| Like | `/moments`, `/moments/user/[id]` | `POST /moments/:id/like` | `MomentsService.toggleLike` | `MomentLike` | COMPLETE |
| Comments | inline | `GET/POST /moments/:id/comments` | `MomentsService.listComments/addComment` | `MomentComment` | PARTIAL (no reply/pagination/delete) |
| Platform binding | `/moments/settings` | `GET/POST/DELETE/PATCH /moments/bindings[...]` | `MomentsService` | `MomentPlatformBinding`, `MomentSetting` | PARTIAL (mock sync) |
| Settings | `/moments/settings` | `GET/PATCH /moments/settings` | `MomentsService.mySetting/updateSetting` | `MomentSetting` | COMPLETE |
| Delete moment | `/moments` | `DELETE /moments/:id` | `MomentsService.remove` | `Moment` | COMPLETE |
| **Bookmark** | — | — | — | — | **MISSING** |
| **Share** | `/moments` | (client `navigator.share`) | — | — | PARTIAL (profile URL only) |

---

## Safety / Reports / Blocks

| Feature | route | endpoint | service | model | status |
|---|---|---|---|---|---|
| Text scan | `/messages/[id]` | `POST /messages/safety-scan` | `SafetyService.scanText` | — | COMPLETE |
| Report user | `/messages/[id]`, `/me/safety` | `POST /reports`, `GET /reports/mine` | (controller inline) | `Report` | PARTIAL (user+message only; no moment/comment) |
| Block | `/messages/[id]` | `POST /blocks`, `GET /blocks`, `DELETE /blocks/:userId` | (controller inline) | `Block` | COMPLETE |

---

## Notifications

| Feature | route | endpoint | service | model | status |
|---|---|---|---|---|---|
| List + unread | `/messages` (panel) | `GET /notifications` | (controller inline) | `Notification` | PARTIAL |
| Mark read | `/messages` (panel) | `POST /notifications/read` | (controller inline) | `Notification` | PARTIAL |
| Badge | `components/tab-bar.tsx` | `GET /notifications` | — | `Notification` | PARTIAL |
| **Dedicated page** | — | — | — | — | MISSING |
| **Real-time push** | — | — | — | — | MISSING |

---

## Admin

| Feature | route | endpoint | perm | status |
|---|---|---|---|---|
| Dashboard | `/dashboard` | `GET /admin/dashboard` | `dashboard:read` | COMPLETE |
| Me / session | — | `GET /admin/me` | — | COMPLETE |
| Users list | `/users` | `GET /admin/users` | `users:read` | COMPLETE |
| User detail | `/users/[id]` | `GET /admin/users/:id` | `users:read` | COMPLETE |
| Set status | `/users/[id]` | `POST/PATCH /admin/users/:id/status` | `users:write` | COMPLETE |
| Notes | `/users/[id]` | `POST /admin/users/:id/notes` | `users:write` | COMPLETE |
| Reports | `/reports` | `GET /admin/reports`, `GET /admin/reports/:id` | `reports:read` | COMPLETE |
| Review report | `/reports/[id]`, `/moderation/[id]` | `POST /admin/reports/:id/review` | `reports:write` | COMPLETE |
| Moderation queue | `/moderation` | `GET /admin/reports` (queue) | `reports:read` | COMPLETE |
| Audit | `/audit` | `GET /admin/audit` | `audit:read` | COMPLETE |
| Risk | `/risk` | `GET /admin/risk` | `risk:read` | COMPLETE |
| Connections | `/connections` | `GET /admin/connections[...]` | `connections:read` | COMPLETE |
| Exchanges | `/exchanges` | `GET /admin/exchanges[...]` | `exchanges:read` | COMPLETE |
| Blocks | `/blocks` | `GET /admin/blocks[...]` | `blocks:read` | COMPLETE |
| **Content management** | — | — | — | MISSING |
| **Comment management** | — | — | — | MISSING |
| **Post management** | — | — | — | MISSING |
| **Social platform config** | — | — | — | MISSING |
| **Feature flags** | — | — | — | MISSING |
| **Announcements** | — | — | — | MISSING |
| **Popup/Banner/Promotion/Ads** | — | — | — | MISSING |
| **System config** | — | — | — | MISSING |

---

## Permission matrix (owner / connection / public / admin / moderator / blocked / suspended / banned)

| Resource | Owner | Connection | Public | Admin | Moderator | Blocked | Suspended | Banned |
|---|---|---|---|---|---|---|---|---|
| Moment view (everyone) | RW | R | R | — | — | ✗ | ✗ (401) | ✗ (401) |
| Moment view (connections) | RW | R | ✗ | — | — | ✗ | ✗ | ✗ |
| Moment view (private) | RW | ✗ | ✗ | — | — | ✗ | ✗ | ✗ |
| Comment | RW | R/W* | R/W* | — | — | ✗ | ✗ | ✗ |
| Message (conversation) | RW (own) | — | ✗ | read-only relation domain | — | ✗ (block guard) | ✗ | ✗ |
| Connection | own | — | ✗ | read-only | — | ✗ | ✗ | ✗ |
| Exchange | own | — | ✗ | read-only | — | ✗ | ✗ | ✗ |
| Block | own | — | ✗ | read-only | — | ✗ | ✗ | ✗ |
| Report | own | — | ✗ | RW (review) | review | ✗ | ✗ | ✗ |
| SocialAccount handle | owner | shared-via-exchange | ✗ | read-only | — | ✗ | ✗ | ✗ |

\* Comment/like gated by `resolveMomentAccess` + block; non-ACTIVE users rejected at JWT/WS layer.

---

## Status matrix (ACTIVE / DISABLED / SUSPENDED / BANNED)

| Action | ACTIVE | DISABLED | SUSPENDED | BANNED |
|---|---|---|---|---|
| Login (obtain token) | ✓ | ⚠ (not rejected; token blocked later) | ⚠ (same) | ✗ (`USER_BANNED`) |
| Refresh token | ✓ | ⚠ (not rejected) | ⚠ (not rejected) | ✗ (`USER_BANNED`) |
| Any HTTP (JWT) | ✓ | ✗ `USER_DISABLED` | ✗ `USER_DISABLED` | ✗ `USER_BANNED` |
| WebSocket connect | ✓ | ✗ `USER_DISABLED` | ✗ `USER_DISABLED` | ✗ `USER_BANNED` |
| Discover/moments/chat | ✓ | ✗ | ✗ | ✗ |

**Inconsistency:** login/refresh only reject BANNED (`auth.service.ts:52-57,108-113`); DISABLED/SUSPENDED are only rejected at the request/WS layer (`jwt.strategy.ts:42-47`, `chat-auth.service.ts:30-31`).
