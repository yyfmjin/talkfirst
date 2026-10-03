import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentUser, type AuthUser } from "../current-user.decorator";
import { JwtAuthGuard } from "../jwt-auth.guard";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  refreshCookieOptions,
} from "../auth.constants";
import { DEV_PROVIDER_ID, readConfiguredProviders, readOAuthProviderConfig } from "./oauth-config";
import { LocalDevProvider } from "./local-dev-provider";
import { OAuthAccountService } from "./oauth-account.service";
import {
  OAUTH_STATE_TTL_SECONDS,
  oauthStateCookieName,
  safeRedirectTarget,
} from "./oauth-state";
import { OAuthService, isAccountExistsError } from "./oauth.service";
import { OAuthError } from "./oauth.types";
import { ValidationPipe } from "../../common/validation.pipe";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Google 快捷登录的两个端点。
 *
 * ## Why a redirect pair rather than a JSON endpoint
 *
 * The authorization-code + PKCE flow is inherently a browser redirect: the user
 * leaves this origin, consents at the provider, and comes back to a URL the
 * provider calls. So there are exactly two routes — "start" (302 out) and
 * "callback" (302 back in) — and both end in a redirect rather than a JSON body,
 * because the thing on the other end is a browser navigation, not `fetch`.
 *
 * ## The callback never leaks internals
 *
 * Everything that can go wrong is reflected back to the web app as an
 * `?oauth_error=<code>` parameter. The provider's own error text, the token
 * endpoint's response, and any stack never reach the browser: those name
 * configuration (client id, secret, redirect mismatch) and are exactly what an
 * attacker probing the deployment would want. The codes are the contract; the
 * human-readable copy lives in the web client.
 */

class BeginQueryDto {
  /**
   * Where to send the browser after a successful sign-in.
   *
   * Validated against the app origin in `safeRedirectTarget` — a `?next=` that
   * accepts anything is an open redirect, and it runs with the session cookie
   * already set.
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  redirectTo?: string;
}

@Controller("auth/oauth")
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly accounts: OAuthAccountService,
    private readonly localDev: LocalDevProvider,
  ) {}

  /**
   * Which providers this deployment offers.
   *
   * The login screen asks before rendering buttons: an unconfigured provider must
   * not be shown at all, rather than shown and then failing (which is what the
   * 「即将上线」 placeholders did).
   */
  @Get("providers")
  providers() {
    return { success: true as const, data: { providers: readConfiguredProviders() } };
  }

  /**
   * Start a sign-in.
   *
   * Throttled like the other credential endpoints: each request writes a cookie
   * and sends the user to Google, so an unbounded loop here is a way to make this
   * API an unwitting participant in provider-side rate limiting.
   */
  @Get(":provider/start")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  start(
    @Req() request: Request,
    @Res() response: Response,
    @Query(new ValidationPipe()) query: BeginQueryDto,
  ) {
    const provider = providerFrom(request);
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";

    try {
      const config = this.oauth.requireProviderConfig(provider);
      const { authorizationUrl, stateToken, flowState } = this.oauth.begin(provider, config, {
        redirectTo: query.redirectTo,
        appUrl,
      });

      response.cookie(oauthStateCookieName(provider), stateToken, stateCookieOptions());
      // `302` rather than `303`: this is a GET that must become a GET at the
      // provider, and 302 is what every OAuth client and browser expects here.
      response.redirect(authorizationUrl);
      // Kept for the analytics-free audit trail of "a sign-in was started".
      void flowState;
    } catch (error) {
      redirectWithError(response, appUrl, error);
    }
  }

  /**
   * The development stand-in's authorization page.
   *
   * Registered only for the `local` provider id, and only reachable while
   * `OAUTH_DEV_PROVIDER=true` — `requireLocalDev()` is what guarantees that,
   * because `readOAuthProviderConfig` throws for `local` outside development. A
   * production deployment therefore answers `404` for these three routes rather
   * than 403: there is nothing there to find.
   */
  @Get(":provider/authorize")
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  localAuthorize(
    @Req() request: Request,
    @Res() response: Response,
    @Query("state") state?: string,
    @Query("code_challenge") codeChallenge?: string,
    @Query("redirect_uri") redirectUri?: string,
    @Query("client_id") clientId?: string,
    @Query("nonce") nonce?: string,
  ) {
    this.requireLocalDev(providerFrom(request));
    response.type("html").send(
      this.localDev.authorizePage({
        state: state ?? "",
        codeChallenge: codeChallenge ?? "",
        redirectUri: redirectUri ?? "",
        clientId: clientId ?? "",
        nonce: nonce ? nonce : null,
      }),
    );
  }

  /** The form submit from that page: issues a code and bounces to our callback. */
  @Post(":provider/authorize")
  @HttpCode(302)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  localAuthorizeSubmit(
    @Req() request: Request,
    @Res() response: Response,
    @Body()
    body: {
      as?: string;
      state?: string;
      code_challenge?: string;
      redirect_uri?: string;
      client_id?: string;
      nonce?: string;
    },
  ) {
    const provider = providerFrom(request);
    this.requireLocalDev(provider);
    const config = this.oauth.requireProviderConfig(provider);

    try {
      const target = this.localDev.authorize({
        sub: body.as ?? "",
        state: body.state ?? "",
        codeChallenge: body.code_challenge ?? "",
        redirectUri: body.redirect_uri ?? "",
        clientId: body.client_id ?? "",
        nonce: body.nonce ? body.nonce : null,
        // The provider compares against its OWN registration, exactly like
        // Google: a redirect_uri that does not match is refused, not echoed.
        expectedRedirectUri: config.redirectUri,
        expectedClientId: config.clientId,
      });
      response.redirect(target);
    } catch (error) {
      // A 400 with the reason: this branch is a developer mistake (a mismatched
      // redirect_uri in a hand-written request), not a user-facing refusal.
      response.status(400).type("text").send(error instanceof Error ? error.message : "invalid request");
    }
  }

  /** The token endpoint `OAuthService` exchanges the code against. */
  @Post(":provider/token")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  localToken(
    @Req() request: Request,
    @Res() response: Response,
    @Body()
    body: {
      grant_type?: string;
      code?: string;
      redirect_uri?: string;
      client_id?: string;
      client_secret?: string;
      code_verifier?: string;
    },
  ) {
    const provider = providerFrom(request);
    this.requireLocalDev(provider);
    const config = this.oauth.requireProviderConfig(provider);

    const result = this.localDev.exchange({
      code: body.code ?? "",
      codeVerifier: body.code_verifier ?? "",
      clientId: body.client_id ?? "",
      clientSecret: body.client_secret ?? "",
      redirectUri: body.redirect_uri ?? "",
      // The issuer/audience this deployment's verifier will check, so a token that
      // passes here is a token that would pass against the real ones too.
      issuer: config.issuer,
      audience: config.clientId,
    });

    // Real token endpoints answer 400 with an error object; mirroring that is what
    // makes `exchangeCodeForIdentity`'s failure branch genuinely exercised.
    if ("error" in result) {
      response.status(400).json(result);
      return;
    }
    response.json(result);
  }

  /**
   * The JWKS document for the local key set.
   *
   * Served by the API itself, and that is the point: the verifier fetches its keys
   * over HTTP from a URL in config, so pointing it at `localhost` exercises the
   * real fetch-and-cache path instead of stubbing the key lookup.
   */
  @Get(":provider/jwks.json")
  localJwks(@Req() request: Request, @Res() response: Response) {
    this.requireLocalDev(providerFrom(request));
    response.json(this.localDev.jwks());
  }

  /**
   * Refuse everything local-provider unless it is switched on.
   *
   * `readOAuthProviderConfig` returns null for `local` when the flag is off, and
   * throws when this looks like production — both are a 404 here, because a
   * disabled development endpoint should not announce its existence.
   */
  private requireLocalDev(provider: string): void {
    if (provider !== DEV_PROVIDER_ID || !readOAuthProviderConfig(DEV_PROVIDER_ID)) {
      throw new NotFoundException({
        success: false,
        error: { code: "NOT_FOUND", message: "Cannot GET this route" },
      });
    }
  }

  /**
   * The provider sends the browser here.
   *
   * On success: the session cookies are set and the browser is sent on to the
   * app. On any refusal: the browser goes to the app's login screen with a code,
   * and NO cookie is written — a failed sign-in must never leave a session
   * behind.
   */
  @Get(":provider/callback")
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async callback(
    @Req() request: Request,
    @Res() response: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") providerError?: string,
  ) {
    const provider = providerFrom(request);
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const stateCookie = oauthStateCookieName(provider);

    try {
      const config = this.oauth.requireProviderConfig(provider);
      const result = await this.oauth.complete(provider, config, {
        code,
        state,
        stateToken: request.cookies?.[stateCookie] as string | undefined,
        providerError,
      });

      this.attachSession(response, result.accessToken, result.refreshToken);
      // The state is spent: clearing it here (and in the failure path) is what
      // makes it single-use, so a replayed callback finds no flow to complete.
      response.clearCookie(stateCookie, stateCookieOptions());
      response.redirect(result.redirectTo);
    } catch (error) {
      response.clearCookie(stateCookie, stateCookieOptions());
      redirectWithError(response, appUrl, error);
    }
  }

  /**
   * Which ways THIS signed-in user can enter their account.
   *
   * Exists so the web app can decide whether to offer "set a password" — an
   * account created through Google has none, and `hasPassword: false` is the only
   * honest way for the client to know that without a request that fails on
   * purpose.
   */
  @Get("me/methods")
  @UseGuards(JwtAuthGuard)
  async methods(@CurrentUser() user: AuthUser) {
    return { success: true as const, data: await this.accounts.methodsFor(user.id) };
  }

  /**
   * Endpoint reserved for the native-client exchange.
   *
   * Declared so the route exists and is throttled, but intentionally not
   * implemented yet: the mobile app (`apps/mobile`) has no Google sign-in, and an
   * endpoint built against a flow nobody can exercise would be untested code
   * pretending to be a feature. It answers `501` with a code the client can act
   * on instead of a silent 404.
   */
  @Post(":provider/exchange")
  @HttpCode(501)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  exchange() {
    return {
      success: false as const,
      error: {
        code: "NOT_IMPLEMENTED",
        message: "The native exchange flow is not implemented yet; use the web redirect flow",
      },
    };
  }

  private attachSession(response: Response, accessToken: string, refreshToken: string) {
    response.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions());
    response.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  }
}

/**
 * `:provider` from the path.
 *
 * Normalised to lower case because the route segment is matched case-insensitively
 * by some clients, and `Google` vs `google` would otherwise be two different
 * provider ids — one of which is not configured.
 */
function providerFrom(request: Request): string {
  const raw = (request.params as Record<string, string | undefined>).provider ?? "";
  return raw.toLowerCase();
}

/** The flow-state cookie: HttpOnly, short-lived, and scoped to the auth routes. */
function stateCookieOptions() {
  return {
    httpOnly: true,
    // `lax` so the cookie survives the provider's top-level redirect back to us;
    // `strict` would drop it on exactly the request that needs it.
    sameSite: "lax" as const,
    secure: accessCookieOptions().secure,
    path: "/api/v1/auth/oauth",
    maxAge: OAUTH_STATE_TTL_SECONDS * 1000,
  };
}

/**
 * Send the browser back to the app with a machine-readable failure code.
 *
 * The code is passed as a query parameter rather than in a JSON body because a
 * browser navigation cannot read a JSON body. No message from the refusal is
 * forwarded — see the controller comment.
 */
function redirectWithError(response: Response, appUrl: string, error: unknown) {
  const code = error instanceof OAuthError ? error.code : "OAUTH_FAILED";
  const target = new URL(safeRedirectTarget("/login", appUrl), appUrl);
  target.searchParams.set("oauth_error", code);
  if (isAccountExistsError(error)) {
    /**
     * The one refusal that needs to carry data: which ways the account can be
     * entered. Only booleans and provider names travel — never a credential.
     */
    target.searchParams.set("oauth_has_password", String(error.methods.hasPassword));
    if (error.methods.providers.length > 0) {
      target.searchParams.set("oauth_providers", error.methods.providers.join(","));
    }
  }
  response.redirect(target.toString());
}
