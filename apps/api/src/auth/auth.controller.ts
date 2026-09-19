import {
  Body,
  Controller,
  Get,
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
    return { success: true as const, data: session.user };
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
    return { success: true as const, data: session.user };
  }

  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async refresh(
    @Res({ passthrough: true }) response: Response,
  ) {
    const raw = response.req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const session = await this.authService.rotateRefresh(raw);
    this.attachSession(response, session.accessToken, session.refreshToken);
    return { success: true as const, data: session.user };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) response: Response) {
    const raw = response.req.cookies?.[REFRESH_COOKIE] as string | undefined;
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
    return { success: true as const, data: session.user };
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
}
