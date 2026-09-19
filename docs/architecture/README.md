# Architecture

Phase 2/3 (current):

- `apps/web` renders mobile-first screens and calls the real API via `src/lib/api.ts`.
  - `register` / `login` call `POST /auth/register` and `POST /auth/login`.
  - `verify` calls `POST /auth/send-verification-code` and `POST /auth/verify-email`.
  - `onboarding/*` persist via `PATCH /users/me`, avatar, languages, interests,
    purposes, preferred-countries endpoints.
  - Session state lives in `SessionProvider` (`src/lib/session.tsx`); auth state is
    carried by HttpOnly cookies, so cross-origin dev login requires the same
    browser session (credentials: include).
- `apps/api` exposes:
  - `GET /api/v1/health`
  - `POST /api/v1/auth/*` (register, login, refresh, logout, me, verification)
  - `GET/PATCH/DELETE/PUT /api/v1/users/me*` (protected by Passport JWT, guard
    reads the access cookie or `Authorization: Bearer`)
  - `GET /api/v1/meta/*` (interests, purposes, languages, countries)
- PostgreSQL schema (`prisma/schema.prisma`) holds the full MVP core models:
  users, verification codes, refresh tokens, languages, interests, purposes,
  countries, social accounts, connection requests, connections, conversations,
  messages, reports, blocks, notifications.
- Seed (`prisma/seed.ts`) loads 18 interests, 7 purposes, 20 languages and
  20 countries.
- A project-local PostgreSQL 18 instance can run on port 5433 when Docker is
  unavailable; see `README.md` and `.env`.
