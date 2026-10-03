import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { isProfileComplete } from "../users/profile-completion";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ACCESS_SECRET,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./auth.constants";
import { newRawToken, sha256Hex } from "../common/crypto";
import { jwtSecretOrDevFallback } from "../common/security-config";
import { SecurityEventService } from "../security/security-event.service";
import { DeviceIdentityService } from "../security/device-identity.service";
import {
  RiskLevel,
  SecurityEventSource,
  SecurityEventType,
} from "../security/security.constants";
import { reasonCodeOf } from "../security/error-reason";
import { getRequestContext } from "../security/request-context";
import { hashEmail, maskEmail } from "../security/privacy";
import { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from "./auth.dto";
import { emailVerificationEnforced } from "./email-verification.policy";
import { LoginAttemptService } from "./login-attempt.service";
import { SessionService } from "./session.service";
import { VerificationService } from "./verification.service";

/**
 * FEATURE (post-audit) — the `VerificationCode.purpose` that isolates the
 * password-reset codes from every other use of the same table.
 *
 * `purpose` is a plain string column and `VerificationService` takes it as an
 * argument, so a distinct value gives complete isolation with no schema change:
 * a `REGISTER` code can never be spent on a reset and vice versa. Declared here
 * rather than inline so the controller, the service and any future caller
 * cannot drift onto two different spellings.
 */
export const PASSWORD_RESET_PURPOSE = "RESET";

/**
 * SEC-005 — a throwaway bcrypt hash whose only purpose is to make the
 * "unknown e-mail" branch cost the same as a real password comparison, so
 * response time cannot be used to enumerate accounts. It is not a credential
 * for any account; generated once via `bcryptjs.hashSync(..., 12)`.
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$vpEdu5xYEq4S1poYXQADKOKVaXhNWoRAPKEoExY8JM0IEanOcKo4C";

/**
 * SEC-003-B — thrown when a rotation lost the race for its token.
 *
 * It never leaves this module: the public failure is a plain
 * `INVALID_REFRESH_TOKEN`. Throwing it from inside the transaction is what rolls
 * the just-created successor back, so a losing request cannot leave a live
 * orphan token behind.
 */
class RefreshRotationConflictError extends Error {}

/** The single `INVALID_REFRESH_TOKEN` refusal, shared by every invalid path. */
function invalidRefreshToken(): UnauthorizedException {
  return new UnauthorizedException({
    success: false,
    error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired" },
  });
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    // Security Audit Center (P1). Optional so an isolated unit test can build the
    // service without pulling in the audit infrastructure.
    private readonly securityEvents?: SecurityEventService,
    // SEC-001. Optional-with-default for the same reason: a unit test that does
    // not care about lock-outs can omit it. Nest still injects the singleton.
    private readonly loginAttempts: LoginAttemptService = new LoginAttemptService(),
    /**
     * FEATURE (post-audit) — needed by the password-reset flow, which reuses the
     * `VerificationCode` table with a distinct `purpose`. Optional for the same
     * reason as `securityEvents` and `loginAttempts`: every pre-existing spec
     * builds this service by hand and none of them touch the reset path, so
     * requiring it would force edits to suites that have nothing to do with it.
     */
    private readonly verificationService?: VerificationService,
    /**
     * Phase O1 — device observation. Optional for the same reason as the others
     * above: pre-existing specs construct this service by hand and must not be
     * forced to know about device tracking. See `recordDeviceLogin`.
     */
    private readonly devices?: DeviceIdentityService,
    /**
     * The single owner of session issuance — see `SessionService`.
     *
     * Optional only so the pre-existing hand-built specs keep compiling; the DI
     * container always injects it (it is a provider in this module). Every path
     * that actually issues a session goes through `issueSession` below, which
     * fails loudly rather than quietly inventing a second session mechanism if it
     * is somehow absent.
     */
    private readonly sessions?: SessionService,
  ) {}

  /**
   * Phase O1 — records the device↔account association on a successful login.
   *
   * This is the **only** caller allowed to pass `bumpLoginCount: true`, because
   * this is the only place an authentication has actually succeeded. The
   * `DeviceUser.loginCount` column therefore means what its name says.
   *
   * Deliberately awaited but fault-isolated: `DeviceIdentityService.record()`
   * never throws, so a broken device table cannot turn a valid login into a 500.
   * Awaited rather than `void`-ed so the write is ordered before the response in
   * the common case; the cost is one upsert, not a transaction.
   */
  private async recordDeviceLogin(userId: string): Promise<void> {
    await this.devices?.record({
      userAgent: getRequestContext()?.userAgent,
      userId,
      bumpLoginCount: true,
    });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ConflictException({
          success: false,
          error: { code: "EMAIL_TAKEN", message: "Email is already registered" },
        });
      }
      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = await this.prisma.user.create({
        data: { email, passwordHash, lastActiveAt: new Date() },
      });
      const session = await this.issueSession(user);
      await this.securityEvents?.record({
        type: SecurityEventType.REGISTER_SUCCESS,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
        detail: { emailMasked: maskEmail(email) },
      });
      return session;
    } catch (error) {
      // Never the password, and never the raw address — see `privacy.ts`.
      await this.securityEvents?.record({
        type: SecurityEventType.REGISTER_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.LOW,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          emailHash: hashEmail(email),
          reasonCode: reasonCodeOf(error, "REGISTER_FAILED"),
        },
      });
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    try {
      // SEC-001. Refuse before touching the database: the budget is keyed on the
      // submitted e-mail and counts unknown addresses the same as real ones, so a
      // lock says nothing about whether the account exists.
      const lock = this.loginAttempts.check(email);
      if (lock.locked) {
        // The crossing failure already raised BRUTE_FORCE_DETECTED; repeating it
        // on every blocked retry would be one event per packet. The refusal still
        // lands in the audit trail via the LOGIN_FAILED written by the catch below.
        throw new HttpException(
          {
            success: false,
            error: {
              code: "TOO_MANY_ATTEMPTS",
              message: "Too many sign-in attempts. Please try again later.",
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        // SEC-005: spend the same bcrypt work as a real comparison so an unknown
        // address cannot be distinguished from a wrong password by timing.
        await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
        await this.recordCredentialFailure(email, false);
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" },
        });
      }
      /**
       * A NULL `passwordHash` means the account has no password at all — it was
       * created through Google sign-in. That must NOT short-circuit: falling
       * straight to `INVALID_CREDENTIALS` would answer measurably faster than a
       * real comparison, and response time is exactly how SEC-005's dummy hash
       * prevents account enumeration. So the same throwaway hash is spent here,
       * which is why this reads as "compare against nothing, on purpose".
       *
       * `user.passwordHash ?? DUMMY_PASSWORD_HASH` also keeps a null hash from
       * ever reaching bcrypt, which throws on a non-string input.
       */
      const valid = await bcrypt.compare(dto.password, user.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!valid || !user.passwordHash) {
        await this.recordCredentialFailure(email, user.isAdmin);
        throw new UnauthorizedException({
          success: false,
          error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" },
        });
      }
      // SEC-005: only after the password is proven do we reveal the account-state
      // verdict. A banned/disabled account reached with a *wrong* password now
      // stays `INVALID_CREDENTIALS`, so status probing needs a valid password.
      this.assertSessionable(user.status);
      if (emailVerificationEnforced() && !user.emailVerified) {
        // Refused *before* any session exists: no access token and, crucially, no
        // new refresh-token row is written for an unverified account.
        throw new HttpException(
          {
            success: false,
            error: {
              code: "EMAIL_NOT_VERIFIED",
              message: "Verify your email address to continue",
            },
          },
          HttpStatus.FORBIDDEN,
        );
      }
      // A correct password clears the budget so an honest user is never punished
      // for earlier typos once they get in.
      this.loginAttempts.reset(email);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });
      const session = await this.issueSession(user);
      await this.securityEvents?.record({
        type: SecurityEventType.LOGIN_SUCCESS,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
      });
      await this.recordDeviceLogin(user.id);
      return session;
    } catch (error) {
      // A failed login deliberately carries no `userId`: the point of the event
      // is to spot attempts against addresses that may not exist.
      await this.securityEvents?.record({
        type: SecurityEventType.LOGIN_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          emailHash: hashEmail(email),
          reasonCode: reasonCodeOf(error, "LOGIN_FAILED"),
        },
      });
      throw error;
    }
  }

  /**
   * SEC-001 — book one credential failure and raise `BRUTE_FORCE_DETECTED` on
   * the failure that crosses the threshold (not on every subsequent refusal,
   * which would flood the log with duplicates of one event).
   */
  private async recordCredentialFailure(email: string, isAdmin: boolean) {
    const outcome = this.loginAttempts.recordFailure(email, isAdmin);
    if (!outcome.lockedNow) return;
    await this.securityEvents?.record({
      type: SecurityEventType.BRUTE_FORCE_DETECTED,
      source: SecurityEventSource.AUTH,
      riskLevel: RiskLevel.HIGH,
      success: false,
      detail: {
        emailMasked: maskEmail(email),
        emailHash: hashEmail(email),
        reasonCode: "ACCOUNT_LOCKED",
        failures: outcome.failures,
        lockMs: outcome.retryAfterMs,
      },
    });
  }

  /**
   * SEC-002 — the one place that decides whether an account may hold a session.
   *
   * `JwtStrategy` already refuses anything that is not `ACTIVE`, so a session
   * minted for a `DISABLED`/`SUSPENDED` account would authenticate and then 401 on
   * every subsequent call. Both halves now share this rule: only `ACTIVE` is
   * sessionable. `BANNED` keeps its dedicated code so the client can say "banned"
   * rather than the generic "disabled"; the other states collapse to the same
   * `USER_DISABLED` shape `JwtStrategy` emits.
   */
  private assertSessionable(status: User["status"]) {
    if (status === "BANNED") {
      throw new UnauthorizedException({
        success: false,
        error: { code: "USER_BANNED", message: "This account is banned" },
      });
    }
    if (status !== "ACTIVE") {
      throw new UnauthorizedException({
        success: false,
        error: { code: "USER_DISABLED", message: "This account is disabled" },
      });
    }
  }

  /**
   * Mint a session for a user whose identity has already been proven.
   *
   * Delegates to `SessionService`, the single owner of session issuance for every
   * login path — including Google sign-in, which proves the identity through the
   * provider instead of a password but must end in exactly the same session, so
   * that SEC-003-B's refresh-token reuse detection keeps seeing one chain.
   *
   * It stays on this class because `register`, `login` and `changePassword` read
   * naturally as this service's own responsibility, and the specs that exercise
   * them drive `AuthService` directly.
   *
   * The absence of `SessionService` is a WIRING BUG, not a configuration: it is a
   * provider of this module, so it cannot legitimately be missing. Throwing beats
   * falling back to an inline implementation, which is how a second, subtly
   * different session would get created the moment someone built this by hand.
   */
  async issueSession(user: User) {
    if (!this.sessions) {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Session issuance is not available",
        },
      });
    }
    return this.sessions.issue(user);
  }

  /**
   * Phase O1 — device association for a sign-in that did not go through
   * `login()`. Exposed so the OAuth path records the device with the same
   * `bumpLoginCount` semantics as a password login.
   */
  async recordSuccessfulSignIn(userId: string): Promise<void> {
    await this.sessions?.recordDevice(userId);
  }

  private async signAccessToken(user: User): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, email: user.email, type: "access" },
      {
        secret: jwtSecretOrDevFallback(JWT_ACCESS_SECRET),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  private refreshExpiresAt(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }

  /**
   * SEC-003-B — tear down every live refresh token for a user.
   *
   * Called when a rotated token is replayed: that can only happen if a copy was
   * stolen, so the honest client's sessions are revoked too and both parties must
   * re-authenticate. `replacedById` is deliberately **not** written here — these
   * are active revocations, not rotations, so a later replay of one of them must
   * stay an ordinary `INVALID_REFRESH_TOKEN`.
   *
   * The event carries only a reason code and a count; never a token, hash or the
   * successor reference.
   */
  private async revokeUserSessions(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.securityEvents?.record({
      type: SecurityEventType.SESSION_REVOKED,
      source: SecurityEventSource.AUTH,
      riskLevel: RiskLevel.HIGH,
      userId,
      success: false,
      detail: { reason, revokedCount: result.count },
    });
    return result.count;
  }

  async rotateRefresh(rawRefreshToken: string | undefined) {
    try {
      if (!rawRefreshToken) {
        throw new UnauthorizedException({
          success: false,
          error: { code: "NO_REFRESH_TOKEN", message: "Missing refresh token" },
        });
      }
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: sha256Hex(rawRefreshToken) },
        include: { user: true },
      });
      if (!record) {
        throw invalidRefreshToken();
      }
      // SEC-003-B — a token revoked *because it was rotated* is being replayed.
      // Only a copy of a token the honest client already traded in can produce
      // this, so it is treated as theft: the whole family is torn down.
      if (record.revokedAt) {
        if (record.replacedById) {
          await this.revokeUserSessions(record.userId, "refresh_token_reuse");
          throw new UnauthorizedException({
            success: false,
            error: {
              code: "TOKEN_REUSE_DETECTED",
              message: "Refresh token has already been used. Please sign in again.",
            },
          });
        }
        // Revoked deliberately (logout / password change / admin): nothing to see.
        throw invalidRefreshToken();
      }
      if (record.expiresAt < new Date()) {
        throw invalidRefreshToken();
      }
      this.assertSessionable(record.user.status);

      // SEC-003-B — rotation is one transaction around a conditional claim, so two
      // requests presenting the same token cannot both mint a successor. The
      // `revokedAt: null` predicate makes exactly one of them the winner; the
      // loser's throw rolls its own successor back, leaving no live orphan.
      const refreshToken = newRawToken();
      await this.prisma.$transaction(async (tx) => {
        const successor = await tx.refreshToken.create({
          data: {
            userId: record.userId,
            tokenHash: sha256Hex(refreshToken),
            expiresAt: this.refreshExpiresAt(),
          },
        });
        const claimed = await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: successor.id },
        });
        if (claimed.count !== 1) {
          throw new RefreshRotationConflictError();
        }
      });

      const accessToken = await this.signAccessToken(record.user);
      await this.securityEvents?.record({
        type: SecurityEventType.TOKEN_REFRESH,
        source: SecurityEventSource.AUTH,
        userId: record.user.id,
        success: true,
      });
      return { accessToken, refreshToken, user: this.toPublicUser(record.user) };
    } catch (error) {
      // The raw refresh token is never recorded — only that a rotation failed.
      await this.securityEvents?.record({
        type: SecurityEventType.TOKEN_REFRESH_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: { reasonCode: reasonCodeOf(error, "TOKEN_REFRESH_FAILED") },
      });
      if (error instanceof RefreshRotationConflictError) {
        // A concurrent rotation won. This request is simply invalid; the raw token
        // is not logged and its successor was rolled back with the transaction.
        throw invalidRefreshToken();
      }
      throw error;
    }
  }

  /**
   * Change the password — or, for an account that has none, SET the first one.
   *
   * Google-only accounts have `passwordHash === null` and no way to prove a
   * current password, so the "verify the old one" step cannot run. Requiring it
   * unconditionally is what would make a password permanently impossible to add,
   * and the honest alternative to a password this member does not have is the
   * session they are already holding: this route is behind `JwtAuthGuard`, so
   * reaching it at all proves they control the account.
   *
   * The two comparisons near the top are ordered around that fact:
   *
   *  - `PASSWORD_MISMATCH` is a pure input check and runs first, unchanged.
   *  - `PASSWORD_UNCHANGED` compares the new password against the CURRENT one, so
   *    it can only mean anything when a current one exists. For a first-time set
   *    the client has nothing to send in `currentPassword` except an empty
   *    string, which would otherwise trip this rule and refuse the only request
   *    that can give the account a password.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    try {
      if (dto.newPassword !== dto.confirmPassword) {
        throw new BadRequestException({
          success: false,
          error: { code: "PASSWORD_MISMATCH", message: "New password and confirmation do not match" },
        });
      }

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundException({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }

      /**
       * `null` here means "no password yet", and a non-empty string is the only
       * other possibility — so the branch below needs no cast: assigning to a
       * local narrows the type once instead of asserting at the comparison.
       */
      const currentHash = user.passwordHash;

      if (currentHash && dto.newPassword === dto.currentPassword) {
        throw new BadRequestException({
          success: false,
          error: { code: "PASSWORD_UNCHANGED", message: "New password must differ from current password" },
        });
      }

      if (currentHash) {
        const valid = await bcrypt.compare(dto.currentPassword, currentHash);
        if (!valid) {
          throw new UnauthorizedException({
            success: false,
            error: { code: "INVALID_CREDENTIALS", message: "Current password is incorrect" },
          });
        }
      }

      const passwordHash = await bcrypt.hash(dto.newPassword, 12);
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
        this.prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      const updated = await this.prisma.user.findUnique({ where: { id: userId } });
      const session = await this.issueSession(updated!);
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_CHANGED,
        source: SecurityEventSource.AUTH,
        userId,
        success: true,
      });
      return session;
    } catch (error) {
      const reasonCode = reasonCodeOf(error, "PASSWORD_CHANGE_FAILED");
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_CHANGE_FAILED,
        source: SecurityEventSource.AUTH,
        // A wrong current password is a meaningful signal; a validation slip is not.
        riskLevel: reasonCode === "INVALID_CREDENTIALS" ? RiskLevel.MEDIUM : RiskLevel.LOW,
        userId,
        success: false,
        detail: { reasonCode },
      });
      throw error;
    }
  }

  async logout(rawRefreshToken: string | undefined) {
    if (rawRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256Hex(rawRefreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.securityEvents?.record({
      type: SecurityEventType.LOGOUT,
      source: SecurityEventSource.AUTH,
      success: true,
    });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return this.toPublicUser(user);
  }

  /**
   * FEATURE (post-audit) — "I forgot my password", step 1: request a code.
   *
   * There was no recovery path at all: a user who forgot their password could
   * only be rescued by an administrator with database access. This is the first
   * half; `resetPassword` below is the second.
   *
   * ## Why it answers identically for every address
   *
   * The endpoint is unauthenticated, so its response is an **account-existence
   * oracle** unless it is carefully neutral. It therefore returns the same
   * `{ sent: true }` for an address with an account, an address without one, and
   * an address that is currently rate-limited — the last case matters because a
   * different answer there would also reveal that somebody had recently asked.
   *
   * ## Why it reuses `VerificationCode` with `purpose = "RESET"`
   *
   * `VerificationCode.purpose` is already a plain string column (schema line
   * ~275) and `VerificationService` takes it as a parameter, so a distinct
   * purpose gives complete isolation from the registration flow — a REGISTER
   * code can never be spent here and vice versa — with no schema change. The
   * send-side budget (60s per address, 5/hour per address) and the 5-attempt cap
   * are inherited unchanged, which is exactly the brute-force envelope this flow
   * needs.
   *
   * ## Why the code is not returned to the caller
   *
   * `VerificationService.sendCode` hands the code back outside production so the
   * registration flow can be exercised locally. That is acceptable for a flow
   * reached from an authenticated session; it is NOT acceptable here, because
   * anyone could then reset anyone else's password. The reset path therefore
   * discards `devCode` and says so explicitly.
   */
  async requestPasswordReset(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    // Neutral success shape, reused for every outcome below.
    const neutral = { sent: true as const };
    const verification = this.requireVerificationService();

    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      // Nothing is sent. The caller cannot tell this apart from the success case
      // *except* by timing, which the throttler and the mail transport dominate.
      return neutral;
    }

    try {
      const result = await verification.sendCode(email, PASSWORD_RESET_PURPOSE);
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_RESET_REQUESTED,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
        // Never the code, and never the raw address.
        detail: { emailMasked: maskEmail(email), purpose: PASSWORD_RESET_PURPOSE },
      });
      // `result.devCode` is deliberately dropped — see the docblock. Nothing is
      // returned to the caller beyond the neutral shape.
      void result;
    } catch (error) {
      // A per-address budget refusal must not become an existence oracle, so it
      // still answers `{ sent: true }`. It stays in the audit trail, and the
      // caller learns the real reason only by trying to *use* a code.
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_RESET_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        userId: user.id,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          reasonCode: reasonCodeOf(error, "PASSWORD_RESET_REQUEST_FAILED"),
        },
      });
    }
    return neutral;
  }

  /**
   * FEATURE (post-audit) — "I forgot my password", step 2: spend the code.
   *
   * Order matters and is deliberate:
   *
   *  1. `verifyCode` proves the code and CONSUMES it (single-use, inside a
   *     transaction with a conditional claim — see `VerificationService`).
   *  2. only then is the password rotated, in the same request.
   *  3. **every live session is revoked.** A password reset is the one action
   *     whose entire purpose is "the old credential is not trustworthy any
   *     more"; leaving an attacker's refresh token alive would defeat it. The
   *     caller is not given a session either — they sign in again with the new
   *     password, which is also what makes the reset auditable as a fresh login.
   *
   * A success also clears the login lockout budget for that address, so a user
   * who forgot their password (and therefore failed several logins) is not kept
   * out after legitimately proving ownership of the mailbox.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const verification = this.requireVerificationService();
    // Optional-with-default for the same reason as the verification service: a
    // hand-built spec may omit it. The reset path must not assume otherwise.
    const attempts = this.loginAttempts;
    try {
      await verification.verifyCode(email, dto.code, PASSWORD_RESET_PURPOSE);

      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        // The code was valid but the account vanished between the two steps.
        // `verifyCode` already consumed the code, so this is a genuine dead end;
        // answer with the same code the verify step uses so nothing new leaks.
        throw new BadRequestException({
          success: false,
          error: { code: "CODE_INVALID", message: "Verification code is invalid or expired" },
        });
      }

      const passwordHash = await bcrypt.hash(dto.newPassword, 12);
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash, emailVerified: true },
        });
      } catch (error) {
        // The account was deleted between the `findUnique` above and this write,
        // so Prisma raises P2025 ("record not found"). Left unhandled it would
        // surface as an opaque 500 — and, worse, it would answer *differently*
        // from the "code invalid" path. This endpoint must not become an
        // account-existence oracle: the code was already consumed by
        // `verifyCode`, so the honest and non-leaking answer is the same
        // `CODE_INVALID` the verify step uses.
        if (isRecordNotFound(error)) {
          throw new BadRequestException({
            success: false,
            error: { code: "CODE_INVALID", message: "Verification code is invalid or expired" },
          });
        }
        throw error;
      }
      await this.revokeUserSessions(user.id, "password_reset");
      // Prove ownership of the mailbox and the lockout budget is cleared: a user
      // who forgot their password has almost certainly failed several logins, and
      // keeping them locked out after a successful reset would be perverse.
      attempts?.reset(email);

      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_RESET_SUCCESS,
        source: SecurityEventSource.AUTH,
        userId: user.id,
        success: true,
        detail: { emailMasked: maskEmail(email) },
      });
      return { reset: true as const };
    } catch (error) {
      await this.securityEvents?.record({
        type: SecurityEventType.PASSWORD_RESET_FAILED,
        source: SecurityEventSource.AUTH,
        riskLevel: RiskLevel.MEDIUM,
        success: false,
        detail: {
          emailMasked: maskEmail(email),
          reasonCode: reasonCodeOf(error, "PASSWORD_RESET_FAILED"),
        },
      });
      throw error;
    }
  }

  /**
   * The reset flow cannot work without the verification service, and the
   * constructor keeps it optional only so that pre-existing specs which build
   * this class by hand do not have to change. Anything that actually *calls* the
   * reset path therefore resolves it through here, which fails loudly (503, an
   * `HttpException` the global filter understands) instead of throwing a
   * `TypeError` that would surface as an opaque 500.
   */
  private requireVerificationService(): VerificationService {
    if (!this.verificationService) {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Password reset is not available right now",
        },
      });
    }
    return this.verificationService;
  }

  toPublicUser(user: User) {    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
      isAdmin: user.isAdmin,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      birthDate: user.birthDate,
      countryCode: user.countryCode,
      city: user.city,
      gender: user.gender,
      bio: user.bio,
      profileCompleted: isProfileComplete(user),
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
    };
  }

  /**
   * SEC-005 — read back the account whose verification just succeeded.
   *
   * The `emailVerified` flag is flipped inside `VerificationService.verifyCode`'s
   * transaction, so this is idempotent and must never throw `P2025`: an address
   * with no account is not an error, and a 500 here would itself confirm that the
   * address does not exist.
   */
  async markEmailVerified(email: string) {
    const normalized = email.trim().toLowerCase();
    await this.prisma.user.updateMany({
      where: { email: normalized },
      data: { emailVerified: true },
    });
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    return user ? this.toPublicUser(user) : null;
  }
}

/**
 * True when Prisma reports that the target row of a write no longer exists.
 *
 * Detected structurally (`code === "P2025"`) rather than with
 * `instanceof Prisma.PrismaClientKnownRequestError`, because that requires the
 * generated client namespace at runtime and would couple this hot path to it for
 * a single check. Any object carrying the code is the same signal.
 */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  );
}
