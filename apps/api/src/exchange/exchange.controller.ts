import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateExchangeDto,
  RespondExchangeDto,
  UpsertSocialAccountDto,
} from "./exchange.dto";
import { ExchangeService } from "./exchange.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class ExchangeController {
  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("exchange/platforms")
  platforms() {
    const labels = this.exchangeService.platformLabels();
    return {
      success: true as const,
      data: Object.entries(labels).map(([id, label]) => ({ id, label })),
    };
  }

  @Get("users/me/social-accounts")
  myAccounts(@CurrentUser() user: AuthUser) {
    return this.prisma.socialAccount
      .findMany({ where: { userId: user.id }, orderBy: { platform: "asc" } })
      .then((data) => ({ success: true as const, data }));
  }

  @Put("users/me/social-accounts")
  upsertAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpsertSocialAccountDto,
  ) {
    const handle = dto.handle.trim();
    if (!handle) {
      return Promise.resolve({
        success: false as const,
        error: { code: "INVALID_HANDLE", message: "Handle is required" },
      });
    }
    return this.prisma.socialAccount
      .upsert({
        where: { userId_platform: { userId: user.id, platform: dto.platform } },
        update: { handle },
        create: { userId: user.id, platform: dto.platform, handle },
      })
      .then((data) => ({ success: true as const, data }));
  }

  @Delete("users/me/social-accounts/:platform")
  removeAccount(@CurrentUser() user: AuthUser, @Param("platform") platform: string) {
    return this.prisma.socialAccount
      .deleteMany({ where: { userId: user.id, platform: platform as never } })
      .then((data) => ({ success: true as const, data }));
  }

  @Get("conversations/:id/exchange")
  eligibility(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.exchangeService
      .eligibility(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("conversations/:id/exchange")
  request(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ValidationPipe()) dto: CreateExchangeDto,
  ) {
    return this.exchangeService
      .request(user.id, id, dto.platforms, dto.message)
      .then((data) => ({ success: true as const, data }));
  }

  @Get("conversations/:id/exchange/contacts")
  contacts(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.exchangeService
      .sharedContacts(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("exchange/:id/respond")
  respond(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ValidationPipe()) dto: RespondExchangeDto,
  ) {
    return this.exchangeService
      .respond(user.id, id, dto.action)
      .then((data) => ({ success: true as const, data }));
  }

  @Post("exchange/:id/cancel")
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.exchangeService
      .cancel(user.id, id)
      .then((data) => ({ success: true as const, data }));
  }
}
