/**
 * PC-1.3 profile attribute DTOs.
 *
 * `ValidationPipe` runs with `whitelist: true` + `forbidNonWhitelisted: true`,
 * so `userId` / `ownerId` / server-derived fields such as `labelKey`,
 * `reviewStatus` or `source` cannot reach the service at all: presence is a
 * 400. Ownership always comes from the JWT subject.
 */
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  PROFILE_VISIBILITY_FIELD_WHITELIST,
  type VisibilityTier,
} from "./profile-visibility.constants";

export const ATTRIBUTE_KIND_VALUES = ["ABOUT_ME", "LOOKING_FOR"] as const;
export type AttributeKindValue = (typeof ATTRIBUTE_KIND_VALUES)[number];

export const ATTRIBUTE_VISIBILITY_VALUES = ["PUBLIC", "CONNECTIONS", "PRIVATE"] as const;

export class CreateUserAttributeDto {
  /** Enum membership is enforced here and re-checked in the service. */
  @IsIn([...ATTRIBUTE_KIND_VALUES])
  kind!: AttributeKindValue;

  /** SYSTEM branch: the catalog entry being selected. */
  @IsOptional()
  @IsUUID()
  definitionId?: string;

  /** CUSTOM branch: the user-authored label. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  value?: string;
}

export class UpdateUserAttributeDto {
  /** Only CUSTOM rows may be renamed. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  value?: string;

  @IsOptional()
  @IsIn([...ATTRIBUTE_VISIBILITY_VALUES])
  visibility?: VisibilityTier;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdateFieldVisibilityDto {
  /** Closed whitelist — an unknown key is a 400, never a junk row. */
  @IsIn([...PROFILE_VISIBILITY_FIELD_WHITELIST])
  fieldKey!: string;

  @IsIn([...ATTRIBUTE_VISIBILITY_VALUES])
  visibility!: VisibilityTier;
}
