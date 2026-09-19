import { IsEmail, IsString, Matches, MaxLength, MinLength } from "class-validator";

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

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: "Password must be 8-72 characters" })
  @MaxLength(72, { message: "Password must be 8-72 characters" })
  newPassword!: string;

  @IsString()
  @MinLength(8, { message: "Password must be 8-72 characters" })
  @MaxLength(72, { message: "Password must be 8-72 characters" })
  confirmPassword!: string;
}
