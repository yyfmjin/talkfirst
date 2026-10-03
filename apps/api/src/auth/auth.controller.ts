import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { Throttle } from "@nestjs/throttler";
import { JwtService } from "@nestjs/jwt";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { VerificationService } from "./verification.service";
import {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  SendVerificationCodeDto,
  VerifyEmailDto,
} from "./auth.dto";
import { ValidationPipe } from "../common/validation.pipe";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  accessCookieOptions,
  clearCookieOptions,
  refreshCookieOptions,
} from "./auth.constants";
import { CurrentUser, type AuthUser } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly verificationService: VerificationService,
  ) {}

  private attachSession(response: Response, accessToken: string, refreshToken: string) {
    response.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions());
    response.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  }

  private clearSession(response: Response) {
    response.cookie(ACCESS_COOKIE, "", { ...accessCookieOptions(), maxAge: 0 });
    response.cookie(REFRESH_COOKIE, "", { ...clearCookieOptions(), maxAge: 0 });
  }

  /**
   * Resolve the refresh token for non-browser (mobile/native) clients.
   *
   * Browsers keep the token in an HttpOnly cookie. Native clients cannot, so
   * they send it explicitly via the `x-refresh-token` header or the request
   * body. Cookie still wins when present so the web flow is unchanged.
   */
  private extractRefreshToken(
    response: Response,
    headerToken: string | undefined,
    bodyToken: string | undefined,
  ): string | undefined {
    const cookie = response.req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (cookie) return cookie;
    if (headerToken) return headerToken;
    return bodyToken;
  }

  @Post("register")
  @HttpCode(201)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async register(
    @Body(new ValidationPipe()) dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
    if (requireVerification) {
      await this.verificationService.assertRecentVerification(dto.email, "REGISTER");
    }
    const session = await this.authService.register(dto);
    this.attachSession(response, session.accessToken, session.refreshToken);
    return {
      success: true as const,
      data: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async login(
    @Body(new ValidationPipe()) dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(dto);
    this.attachSession(response, session.accessToken, session.refreshToken);
    return {
      success: true as const,
      data: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async refresh(
    @Body() body: { refreshToken?: string } | undefined,
    @Headers("x-refresh-token") headerRefreshToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const raw = this.extractRefreshToken(response, headerRefreshToken, body?.refreshToken);
    const session = await this.authService.rotateRefresh(raw);
    this.attachSession(response, session.accessToken, session.refreshToken);
    return {
      success: true as const,
      data: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Body() body: { refreshToken?: string } | undefined,
    @Headers("x-refresh-token") headerRefreshToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const raw = this.extractRefreshToken(response, headerRefreshToken, body?.refreshToken);
    await this.authService.logout(raw);
    this.clearSession(response);
    return { success: true as const, data: { ok: true } };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.authService.me(user.id);
    return { success: true as const, data: profile };
  }

  @Post("password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.changePassword(user.id, dto);
    this.attachSession(response, session.accessToken, session.refreshToken);
    return {
      success: true as const,
      data: session.user,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  @Post("send-verification-code")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async sendVerificationCode(@Body(new ValidationPipe()) dto: SendVerificationCodeDto) {
    const result = await this.verificationService.sendCode(dto.email, "REGISTER");
    return { success: true as const, data: result };
  }

  @Post("verify-email")
  @HttpCode(200)
  @Throttle({ default: { limit: 50, ttl: 60000 } })
  async verifyEmail(
    @Body(new ValidationPipe()) dto: VerifyEmailDto,
  ) {
    await this.verificationService.verifyCode(dto.email, dto.code, "REGISTER");
    const user = await this.authService.markEmailVerified(dto.email);
    return { success: true as const, data: user };
  }

  /**
   * FEATURE (post-audit) — "I forgot my password", step 1.
   *
   * There was no recovery path: a user who forgot their password could not get
   * back in at all. Both endpoints are unauthenticated by necessity, so both are
   * throttled tightly and both answer neutrally (see the service).
   *
   * 10/min per IP here rather than the 20 used for registration codes: this
   * endpoint can be pointed at *anyone's* address, whereas the registration one
   * is normally used for one's own. The per-address budget (5/hour) sits
   * underneath it in `VerificationService`.
   */
  @Post("password/forgot")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async forgotPassword(@Body(new ValidationPipe()) dto: RequestPasswordResetDto) {
    const data = await this.authService.requestPasswordReset(dto.email);
    return { success: true as const, data };
  }

  /**
   * FEATURE (post-audit) — "I forgot my password", step 2.
   *
   * No session is issued on success: every live refresh token is revoked (that
   * is the point of a reset), and the client sends the user to the normal sign-in
   * form so the new credential is exercised exactly like any other login.
   */
  @Post("password/reset")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async resetPassword(@Body(new ValidationPipe()) dto: ResetPasswordDto) {
    const data = await this.authService.resetPassword(dto);
    return { success: true as const, data };
  }
}
