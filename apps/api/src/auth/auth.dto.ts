import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;

  /**
   * The account name used to sign in (P0-02). Optional: omitting it makes the
   * server generate one, which is what the onboarding flow does and what every
   * account created before this feature got.
   *
   * Only a loose upper bound is asserted here. The alphabet and the
   * reserved-word rules live in `common/username.ts` and are applied in the
   * service, so the failure carries the API's own code (`USERNAME_INVALID` vs
   * `USERNAME_RESERVED`) — a regex in the DTO could not tell those two apart, and
   * the UI has to, because one means "fix your typing" and the other means
   * "pick a different name".
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsString()
  @MinLength(8, { message: "Password must be 8-72 characters" })
  @MaxLength(72, { message: "Password must be 8-72 characters" })
  password!: string;
}

export class LoginDto {
  /**
   * Kept for clients that predate `identifier` — the admin console and the mobile
   * app both still post `{ email, password }`. `@IsEmail` stays on it so a
   * malformed address is still caught at the edge.
   */
  @IsOptional()
  @IsEmail({}, { message: "Invalid email address" })
  email?: string;

  /**
   * E-mail **or** account name: the sign-in form is one input.
   *
   * Free-form rather than `@IsEmail`, because a username is `[a-z0-9]` and must
   * not be pushed through e-mail validation. The service decides which one it
   * received — `@` is the discriminator, and it is unambiguous because a username
   * cannot contain one — and answers an empty value with `VALIDATION_ERROR`.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  identifier?: string;

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

/**
 * FEATURE (post-audit) — "I forgot my password", step 1.
 *
 * Only the address is taken. The response is deliberately identical whether or
 * not it belongs to an account (see `AuthService.requestPasswordReset`), so this
 * DTO must not add anything that could turn the endpoint into an oracle — for
 * example a "create the account if missing" flag.
 */
export class RequestPasswordResetDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;
}

/**
 * FEATURE (post-audit) — "I forgot my password", step 2.
 *
 * `newPassword` is length-bounded exactly like `RegisterDto` (8-72): 72 is
 * bcrypt's input limit, and silently truncating beyond it would mean a long
 * passphrase protected less than its owner believed. There is no
 * `confirmPassword` field — the confirmation is a client-side concern for a
 * single-use form, and duplicating it here would only give one more place for the
 * two to disagree.
 */
export class ResetPasswordDto {
  @IsEmail({}, { message: "Invalid email address" })
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Verification code must be 6 digits" })
  code!: string;

  @IsString()
  @MinLength(8, { message: "Password must be 8-72 characters" })
  @MaxLength(72, { message: "Password must be 8-72 characters" })
  newPassword!: string;
}
