import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
} from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;

  @IsString()
  @MinLength(8, { message: "Password must be 8-72 characters" })
  @MaxLength(72, { message: "Password must be 8-72 characters" })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}

export class VerifyEmailDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Verification code must be 6 digits" })
  code!: string;
}

export class SendVerificationCodeDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 24, { message: "Nickname must be 2-24 characters" })
  nickname?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: "birthDate must be an ISO date string" })
  birthDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: "countryCode must be a 2-letter code" })
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  // PC-1.3 22: state / province / prefecture. An empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string;

  @IsOptional()
  @IsIn(["UNKNOWN", "MALE", "FEMALE", "OTHER"])
  gender?: "UNKNOWN" | "MALE" | "FEMALE" | "OTHER";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

export class LanguageItemDto {
  @IsString()
  @Matches(/^[a-z]{2,8}$/)
  code!: string;

  @IsIn(["NATIVE", "LEARNING"])
  type!: "NATIVE" | "LEARNING";

  @IsOptional()
  @IsIn(["BEGINNER", "INTERMEDIATE", "ADVANCED", "NATIVE"])
  level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "NATIVE";
}

export class UpdateLanguagesDto {
  @ValidateNested({ each: true })
  @Type(() => LanguageItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  items!: LanguageItemDto[];
}

export class UpdateInterestsDto {
  @IsString({ each: true })
  @ArrayMinSize(3, { message: "Select at least 3 interests" })
  @ArrayMaxSize(20)
  slugs!: string[];
}

export class UpdatePurposesDto {
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  slugs!: string[];
}

export class UpdatePreferredCountriesDto {
  @IsString({ each: true })
  @ArrayMaxSize(10)
  codes!: string[];
}

export class UpdateAvatarDto {
  // Loose at the DTO level for API compat; the real rule lives in
  // normalizeUploadUrl (https anywhere, http localhost only in dev).
  @IsString()
  @MaxLength(2000)
  avatarUrl!: string;
}
