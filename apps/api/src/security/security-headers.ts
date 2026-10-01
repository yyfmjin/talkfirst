import type { INestApplication } from "@nestjs/common";
import helmet, { type HelmetOptions } from "helmet";

/**
 * SEC-004 — security response headers.
 *
 * Registered once in `main.ts` so every response carries them, including the
 * ones produced by `ApiExceptionFilter`.
 *
 * Three of helmet's defaults are deliberately overridden, each for a reason that
 * a plain `app.use(helmet())` would get wrong:
 *
 *  - `crossOriginResourcePolicy` defaults to `same-origin`, which would make the
 *    browser refuse to render `/uploads/*` (avatars, moment and chat images)
 *    inside the member app. The API and the web app are different origins in
 *    every environment — `api.talkfirst.ccwu.cc` vs `talkfirst.ccwu.cc` in
 *    production, `:4000` vs `:3000` locally — so it has to be `cross-origin`.
 *  - `crossOriginEmbedderPolicy` blocks those same cross-origin subresources
 *    when enabled. Helmet 8 leaves it off; the choice is pinned here so a future
 *    helmet default flip cannot silently break every avatar.
 *  - `contentSecurityPolicy` is off. This process answers with JSON or a static
 *    upload and never with an HTML document, so a CSP protects nothing here, and
 *    helmet's default policy adds `upgrade-insecure-requests` — which would
 *    rewrite the plain-HTTP dev origins to HTTPS. The CSP that matters is the
 *    one on the documents, and it lives in each Next.js app's `next.config.ts`.
 *
 * `includeSubDomains` is safe for a dedicated `api.*` hostname. `preload` is off
 * because joining the preload list is an operational decision, not a code one.
 */
export function securityHeaderOptions(): HelmetOptions {
  return {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    frameguard: { action: "deny" },
  };
}

/** Kept separate from the options so tests can boot an app with the real thing. */
export function applySecurityHeaders(app: INestApplication): void {
  app.use(helmet(securityHeaderOptions()));
}
