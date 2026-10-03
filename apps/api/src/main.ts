import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { config as loadEnvFile } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "path";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import {
  assertDeviceSaltConfigured,
  assertSecretConfigured,
  assertThrottleMultiplierSafe,
  assertTrustProxyConfigured,
  isProductionDeployment,
} from "./common/security-config";
import { assertMailConfigurationForProduction } from "./mail/mail.config";
import { assertOAuthConfiguration } from "./auth/oauth/oauth-config";
import { trustProxySetting } from "./security/client-ip";
import { createAccessLogMiddleware } from "./security/access-log.middleware";
import { AccessLogService } from "./security/access-log.service";
import { DeviceIdentityService } from "./security/device-identity.service";
import { SecurityModule } from "./security/security.module";
import { createRequestIdMiddleware } from "./security/request-id.middleware";
import { createIpBanMiddleware } from "./security/ip-ban.middleware";
import { IpBanService } from "./security/ip-ban.service";
import { applySecurityHeaders } from "./security/security-headers";
import { uploadRoot as resolveUploadRoot } from "./uploads/upload-paths";
import { assertTokenEncryptionKeyConfigured } from "./social-sync/token-crypto.service";

/**
 * Load `.env` BEFORE anything reads configuration.
 *
 * This is load-bearing, and getting it wrong is a self-inflicted outage: the
 * guards below run before `NestFactory.create(AppModule)`, and `ConfigModule`
 * (which is what normally populates `process.env` from `.env`) only initialises
 * *inside* that call. Without this, `node dist/main.js` sees `NODE_ENV` unset,
 * `security-config.ts` correctly classifies an unset `NODE_ENV` as a production
 * deployment, and the API refuses to boot over the placeholder
 * `change-me-in-development` secrets in `.env` — the exact file it never read.
 *
 * `dotenv` does not overwrite variables that are already set, so a real
 * deployment's environment (Docker, systemd, the shell) always wins and this is a
 * no-op there. Candidates are tried in the same order `ConfigModule.forRoot`'
 * `envFilePath: ["../../.env", ".env"]` declares, with the repo root added for the
 * case where the process is started from `apps/api`.
 */
function loadEnvironment(): void {
  /**
   * `__dirname` is `apps/api/dist` under `node dist/main.js`, so two levels up is
   * `apps/api` and three is the repo root — where `.env` actually lives. Both are
   * tried, plus the caller's cwd, and `resolve()` normalises them so a relative
   * cwd cannot produce a surprising path.
   */
  const candidates = [
    resolve(__dirname, "..", "..", "..", ".env"),
    resolve(__dirname, "..", "..", ".env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    loadEnvFile({ path });
    return;
  }
}

async function bootstrap() {
  loadEnvironment();

  /**
   * FIX (audit P007) — configuration is validated on EVERY start, not only when
   * `NODE_ENV` happens to be `production`.
   *
   * The old guard was `if (NODE_ENV === "production")`, so a process started
   * without that variable skipped it entirely and fell through to
   * `"change-me-in-development"` as the JWT signing key (see the three fallbacks
   * this replaces). Now the *developmental* mode is what must be stated
   * explicitly, and anything else must present real secrets.
   *
   * `loadEnvironment()` above is what makes "explicitly stated" true for a local
   * run: without it the `.env` that says `NODE_ENV=development` had not been read
   * yet, and every local start looked like a misconfigured production one.
   */
  assertSecretConfigured(["JWT_SECRET", "JWT_REFRESH_SECRET"]);
  assertThrottleMultiplierSafe();
  // Phase O1: without this the device identifier is silently disabled and every
  // `deviceHash` column stays NULL — see the guard for why that must not be a
  // production default.
  assertDeviceSaltConfigured();
  /**
   * Social sync: third-party OAuth tokens are stored encrypted, so the key that
   * protects them must exist. Unlike the JWT secrets there is deliberately NO
   * usable development fallback in production — a deployment that skipped this
   * would encrypt real members' social credentials with a key committed to the
   * source tree, and a leaked dump would then be decryptable by anyone with the
   * repository.
   */
  assertTokenEncryptionKeyConfigured();
  // Phase O1-5: the fallback of "trust 1 proxy hop" lets any caller forge the
  // address recorded in `AccessLog.ip` when no proxy is actually present, so the
  // topology must be stated rather than assumed.
  assertTrustProxyConfigured();
  /**
   * Google sign-in: refuse to boot on a half-configured provider.
   *
   * Every failure it catches is one that would otherwise reach a member as an
   * unactionable error: `OAUTH_PROVIDERS` naming a provider whose credentials are
   * missing, a `redirect_uri` Google will reject (plain http on a real host), or
   * the development stand-in left switched on. Same philosophy as the secret
   * checks above — "will not boot, and says why" beats "boots and fails later".
   */
  assertOAuthConfiguration();
  // `isProductionDeployment()` is exactly `!allowsInsecureDefaults()`, so this
  // branch also covers "development defaults are allowed but verification is
  // enforced", which needs no mail configuration.
  if (isProductionDeployment()) {
    // SEC-005: enforcement without a way to deliver the code would lock every new
    // account out permanently, so refuse to boot instead.
    assertMailConfigurationForProduction();
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix("api/v1");
  // SEC-004: registered before any route so error responses get the headers too.
  applySecurityHeaders(app);
  // Security Audit Center (P1): the reverse proxy terminates TLS, so Express must
  // be told how many hops to trust before `req.ip` means anything (see
  // `client-ip.ts`). Registered first so a requestId exists before any other
  // middleware, guard or interceptor runs.
  app.set("trust proxy", trustProxySetting());
  app.use(createRequestIdMiddleware());
  const securityModule = app.select(SecurityModule);
  /**
   * IP bans. Registered AFTER the request-id middleware (so `getRequestContext()`
   * already carries the address this middleware reads through `getClientIp`) and
   * BEFORE access logging, so a refused request still produces an audit row. That
   * ordering is the whole audit requirement: a ban whose refusals were invisible
   * could not be told apart from a ban that never fired.
   */
  app.use(createIpBanMiddleware(securityModule.get(IpBanService)));
  // Phase O1: access logging must be a middleware, not an interceptor. Guards run
  // *before* interceptors, so an interceptor never saw a 401/403 rejection or an
  // unmatched 404 — exactly the traffic an audit trail exists to capture. Placed
  // after the request-id middleware so `getRequestContext()` (requestId/ip/path)
  // is populated, and before the routes so it wraps every response. It listens on
  // `res.on("finish")`, so body parsing does not need to have happened yet.
  app.use(
    createAccessLogMiddleware(
      securityModule.get(AccessLogService),
      securityModule.get(DeviceIdentityService),
    ),
  );
  app.use(cookieParser());
  // Base64 image uploads (avatar / chat image) exceed Express' 100kb default.
  app.use(json({ limit: "8mb" }));
  app.use(urlencoded({ extended: true, limit: "8mb" }));
  app.useGlobalFilters(new ApiExceptionFilter());
  // Static uploads live outside the API prefix: /uploads/* vs /api/v1/uploads/*.
  // FIX (audit P004): must resolve to the SAME directory `UploadsService.saveLocal`
  // writes to, so `UPLOAD_DIR` is honoured here too (docker-compose mounts a named
  // volume at /app/uploads and sets it). Hard-coding `process.cwd()` here is what
  // let writes and reads drift apart.
  app.useStaticAssets(uploadRoot(), { prefix: "/uploads/" });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const adminUrl = process.env.ADMIN_URL ?? "http://localhost:3001";
  app.enableCors({
    origin: [appUrl, adminUrl],
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
}

/**
 * The upload directory now has ONE definition, in `uploads/upload-paths.ts`.
 *
 * It used to be declared here AND as a private method on `UploadsService`, kept in
 * step only by a comment asking future editors to keep them in step — the exact
 * arrangement audit P004 was meant to remove. This wrapper is kept so the call
 * site above still reads locally.
 */
function uploadRoot(): string {
  return resolveUploadRoot();
}

void bootstrap();
