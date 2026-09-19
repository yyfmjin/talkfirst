# SOCIAL_PLATFORM_MATRIX

Generated from the real `SocialPlatform` enum in `prisma/schema.prisma:85-98`, **not** from the brief. No platform was added or removed.

## Enum (authoritative)

`INSTAGRAM, TELEGRAM, WHATSAPP, DISCORD, X, TIKTOK, WECHAT, QQ, STEAM, YOUTUBE, FACEBOOK, TALKFIRST`

## Per-platform capabilities

| Platform | Bind (handle) | Unbind | Edit | Delete | Sort | Hide | Verify | profile URL | OAuth | Real sync | Admin config |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INSTAGRAM | ✓ (`MomentPlatformBinding`) | ✓ | ✓ (toggle syncEnabled) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (mock) | ✗ (demo) | ✗ |
| X | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (mock) | ✗ (demo) | ✗ |
| TIKTOK | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (mock) | ✗ (demo) | ✗ |
| YOUTUBE | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (mock) | ✗ (demo) | ✗ |
| FACEBOOK | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ (mock) | ✗ (demo) | ✗ |
| TALKFIRST | (native, compose only) | — | — | — | ✗ | ✗ | ✗ | ✗ | — | — | ✗ |
| TELEGRAM | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| WHATSAPP | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| DISCORD | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| WECHAT | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| QQ | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| STEAM | enum-only | — | — | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Notes

- **Moment binding** only exposes a subset: `TALKFIRST, INSTAGRAM, X, TIKTOK, YOUTUBE, FACEBOOK` (`moments.service.ts:5-12`). The other six enum values exist in the schema but have no binding UI/endpoint path (they can still be used in `SocialAccount` handle storage).
- **Social account handles** (`SocialAccount`) support the full enum via `PUT /users/me/social-accounts` (`exchange.controller.ts`), for contact exchange.
- **No platform has OAuth.** Binding stores a free-text handle and `syncEnabled`, then `seedDemoMoments` fabricates `source:"DEMO"` rows with hardcoded copy + Unsplash URLs (`moments.service.ts:496-566`).
- **No verification** of handles, **no profile URL**, **no sort/hide**, **no admin configuration** for any platform.
- `syncEnabled` is a UI flag only — no worker, no sync job, no credential storage.

## Status

- Binding/CRUD: **PARTIAL** (handle storage + toggle + demo seed).
- OAuth / API sync: **MOCK**.
- Admin configuration: **MISSING**.
