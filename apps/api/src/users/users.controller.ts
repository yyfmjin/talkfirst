import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { ValidationPipe } from "../common/validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import {
  UpdateAvatarDto,
  UpdateInterestsDto,
  UpdateLanguagesDto,
  UpdatePreferredCountriesDto,
  UpdateProfileDto,
  UpdatePurposesDto,
} from "../users/users.dto";
import {
  CreateUserAttributeDto,
  UpdateFieldVisibilityDto,
  UpdateUserAttributeDto,
} from "./profile-attributes.dto";
import { ProfileAttributesService } from "./profile-attributes.service";
import { UsersService } from "./users.service";

function asValidationError(code: string, message: string) {
  return { success: false, error: { code, message } };
}

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly attributesService: ProfileAttributesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("me")
  async me(@CurrentUser() user: AuthUser) {
    return { success: true as const, data: await this.usersService.getFullCard(user.id) };
  }

  // --- PC-1.3 profile attributes -------------------------------------------
  // Ownership is always the JWT subject: no route below accepts a user id from
  // the body, path or query, so a crafted request cannot reach another account.

  @Get("me/attributes")
  async myAttributes(@CurrentUser() user: AuthUser) {
    return { success: true as const, data: await this.attributesService.listMine(user.id) };
  }

  @Post("me/attributes")
  async createAttribute(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: CreateUserAttributeDto,
  ) {
    return { success: true as const, data: await this.attributesService.create(user.id, dto) };
  }

  @Patch("me/attributes/:id")
  async updateAttribute(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ValidationPipe()) dto: UpdateUserAttributeDto,
  ) {
    return { success: true as const, data: await this.attributesService.update(user.id, id, dto) };
  }

  @Delete("me/attributes/:id")
  async deleteAttribute(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return { success: true as const, data: await this.attributesService.remove(user.id, id) };
  }

  @Get("me/profile-field-visibility")
  async profileFieldVisibility(@CurrentUser() user: AuthUser) {
    return {
      success: true as const,
      data: await this.attributesService.listFieldVisibility(user.id),
    };
  }

  @Put("me/profile-field-visibility")
  async updateProfileFieldVisibility(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdateFieldVisibilityDto,
  ) {
    return {
      success: true as const,
      data: await this.attributesService.setFieldVisibility(user.id, dto.fieldKey, dto.visibility),
    };
  }

  @Get(":id")
  async publicProfile(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const data = await this.usersService.getPublicProfile(id, user.id);
    return { success: true as const, data };
  }

  @Patch("me")
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdateProfileDto,
  ) {
    try {
      const data = await this.usersService.updateProfile(user.id, dto);
      return { success: true as const, data };
    } catch (error) {
      if ((error as { code?: string }).code === "P2025") {
        throw new NotFoundException(asValidationError("USER_NOT_FOUND", "User not found"));
      }
      throw error;
    }
  }

  @Delete("me")
  async deleteAccount(@CurrentUser() user: AuthUser) {
    await this.prisma.user.delete({ where: { id: user.id } });
    return { success: true as const, data: { ok: true } };
  }

  @Put("me/avatar")
  async updateAvatar(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdateAvatarDto,
  ) {
    try {
      const data = await this.usersService.updateAvatar(user.id, dto.avatarUrl);
      return { success: true as const, data };
    } catch (error) {
      if ((error as { code?: string }).code === "INVALID_IMAGE") {
        throw new BadRequestException(
          asValidationError("INVALID_IMAGE", "Image must be an https URL"),
        );
      }
      throw error;
    }
  }

  @Put("me/languages")
  async updateLanguages(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdateLanguagesDto,
  ) {
    try {
      const data = await this.usersService.replaceLanguages(user.id, dto.items);
      return { success: true as const, data };
    } catch {
      throw new BadRequestException(asValidationError("UNKNOWN_LANGUAGE_CODE", "Unknown language code"));
    }
  }

  @Put("me/interests")
  async updateInterests(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdateInterestsDto,
  ) {
    try {
      const data = await this.usersService.replaceInterests(user.id, dto.slugs);
      return { success: true as const, data };
    } catch {
      throw new BadRequestException(asValidationError("UNKNOWN_INTEREST_SLUG", "Unknown interest slug"));
    }
  }

  @Put("me/purposes")
  async updatePurposes(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdatePurposesDto,
  ) {
    try {
      const data = await this.usersService.replacePurposes(user.id, dto.slugs);
      return { success: true as const, data };
    } catch {
      throw new BadRequestException(asValidationError("UNKNOWN_PURPOSE_SLUG", "Unknown purpose slug"));
    }
  }

  @Put("me/preferred-countries")
  async updatePreferredCountries(
    @CurrentUser() user: AuthUser,
    @Body(new ValidationPipe()) dto: UpdatePreferredCountriesDto,
  ) {
    try {
      const data = await this.usersService.replacePreferredCountries(user.id, dto.codes);
      return { success: true as const, data };
    } catch {
      throw new BadRequestException(asValidationError("UNKNOWN_COUNTRY_CODE", "Unknown country code"));
    }
  }
}
