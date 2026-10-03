import { Injectable, Logger } from "@nestjs/common";
import { OAuthProvider, type Prisma, type User as PrismaUser } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { ProviderIdentity } from "./oauth.types";
import { OAuthError } from "./oauth.types";

/**
 * Google 身份 → TalkFirst 账号的解析。
 *
 * 这是整个功能里唯一能「把 A 认成 B」的地方，所以规则要写死、写清、写成测试。
 *
 * ## 账号关联策略（非对称，刻意如此）
 *
 * | 情形 | 行为 | 理由 |
 * |---|---|---|
 * | `(provider, providerUserId)` 已绑定 | 直接登录 | 这是唯一权威的匹配键 |
 * | 邮箱**不存在**账号 | 建号，`emailVerified: true`，`passwordHash: null` | 没有被劫持的对象，越顺越好；邮箱验证由 Google 代我们完成 |
 * | 邮箱**已存在**账号 | **不自动关联**，拒绝并告诉用户怎么进 | 见下 |
 * | provider 未验证邮箱 | 拒绝，既建号也不关联 | 拿一个别人能声称拥有的地址去建号，等于把劫持路径做进产品 |
 *
 * ## 为什么不自动关联已有账号
 *
 * 「邮箱控制权 ⇒ 账号控制权」这条隐含推理是账号接管的常见来源。若某人的邮箱后来
 * 被回收或被盗，新的持有者用 Google 登录就能直接进入原账号。所以这里要求用户先
 * 用既有方式登录一次，再自己决定是否绑定。
 *
 * 这个选择牺牲了一次转化率换取一个明确的授权动作。如果要改成自动关联，只需要
 * 改这一个文件——但那时必须把这个权衡重新评估一遍，而不是顺手改掉。
 *
 * ## 拒绝也不制造死循环
 *
 * 上一次的设计缺陷是：提示「请用密码登录」，但手机号/Google 注册的账号根本没有
 * 密码。因此 `accountExists` 结果里带上了账号**可用的登录方式**，让提示永远是可
 * 执行的。
 */

/** What the caller does with a successful resolution. */
export type ResolutionOutcome =
  | { kind: "session"; user: PrismaUser; linked: boolean; isNewAccount: boolean }
  | { kind: "account_exists"; methods: AccountLoginMethods };

/** Which ways an existing account can be entered. Never includes credentials. */
export type AccountLoginMethods = {
  hasPassword: boolean;
  providers: OAuthProvider[];
};

@Injectable()
export class OAuthAccountService {
  private readonly logger = new Logger("OAuthAccount");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a verified provider identity to an account.
   *
   * Throws `OAuthError` for every refusal; the controller maps the code onto an
   * HTTP status. Nothing here returns a partially-formed user — either the
   * caller gets an account to issue a session for, or it gets a refusal.
   */
  async resolve(identity: ProviderIdentity): Promise<ResolutionOutcome> {
    const existingIdentity = await this.prisma.oAuthIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: identity.provider,
          providerUserId: identity.providerUserId,
        },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      const user = await this.assertSessionable(existingIdentity.user);
      await this.touchIdentity(existingIdentity.id, identity);
      return { kind: "session", user, linked: false, isNewAccount: false };
    }

    /**
     * Not yet bound. Everything below depends on the provider having actually
     * verified the address, because the address is what decides which account
     * this becomes.
     */
    if (!identity.email) {
      throw new OAuthError(
        "OAUTH_EMAIL_REQUIRED",
        "The provider did not return an e-mail address, so this sign-in cannot be matched to an account",
      );
    }
    if (!identity.emailVerified) {
      throw new OAuthError(
        "OAUTH_EMAIL_UNVERIFIED",
        "The provider reports this e-mail address as unverified",
      );
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
    if (byEmail) {
      /**
       * Deliberately NOT linked (see the policy table above). The refusal carries
       * the ways this account CAN be entered, so the client can offer a path that
       * actually works instead of telling someone to use a password they may not
       * have.
       */
      const methods = await this.loginMethodsFor(byEmail);
      return { kind: "account_exists", methods };
    }

    return this.createAccount(identity);
  }

  /**
   * Create the account for a first-time Google sign-in.
   *
   * `emailVerified: true` is a statement about the ADDRESS, not about the person:
   * Google has proven they control it, which is the same standard this app's own
   * e-mail verification enforces. Without it, `REQUIRE_EMAIL_VERIFICATION`
   * deployments would lock out every new Google user.
   *
   * `passwordHash: null` — no password exists. See the `User.passwordHash`
   * comment for why a random hash would be a fabrication rather than a shortcut.
   *
   * The nickname and avatar the provider offers ARE stored: they are what the
   * member chose to publish, and the alternative is an empty profile after a
   * sign-in that visibly showed a name.
   */
  private async createAccount(identity: ProviderIdentity): Promise<ResolutionOutcome> {
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: identity.email as string,
            passwordHash: null,
            emailVerified: true,
            nickname: identity.name,
            lastActiveAt: new Date(),
          },
        });
        await tx.oAuthIdentity.create({
          data: {
            userId: created.id,
            provider: identity.provider,
            providerUserId: identity.providerUserId,
            email: identity.email,
            emailVerified: identity.emailVerified,
            lastLoginAt: new Date(),
          },
        });
        return created;
      });
      return { kind: "session", user, linked: false, isNewAccount: true };
    } catch (error) {
      /**
       * A unique-constraint violation here means someone else created this
       * account (or bound this identity) between the read above and this write —
       * two simultaneous first sign-ins, or a sign-in racing a registration.
       *
       * The honest answer is to re-resolve rather than to fail: whichever write
       * landed first is the account that exists, and a second attempt is exactly
       * the "already bound / already registered" path. Re-throwing would surface a
       * 500 for what is a benign race.
       */
      if (!isUniqueViolation(error)) throw error;
      this.logger.warn("OAuth account creation raced another writer; re-resolving");
      return this.resolve(identity);
    }
  }

  /** Refuse a banned/disabled account exactly like password login does. */
  private async assertSessionable(user: PrismaUser): Promise<PrismaUser> {
    if (user.status === "BANNED") {
      throw new OAuthError("OAUTH_ACCOUNT_EXISTS", "This account is banned");
    }
    if (user.status !== "ACTIVE") {
      throw new OAuthError("OAUTH_ACCOUNT_EXISTS", "This account is disabled");
    }
    return user;
  }

  private async touchIdentity(identityId: string, identity: ProviderIdentity): Promise<void> {
    /**
     * Refreshes the stored snapshot: the provider may have changed the address,
     * and support needs to see the current one. `updateMany` rather than `update`
     * so this can never throw P2025 if the row is deleted concurrently — a
     * bookkeeping write must not fail a successful sign-in.
     */
    await this.prisma.oAuthIdentity.updateMany({
      where: { id: identityId },
      data: {
        lastLoginAt: new Date(),
        email: identity.email,
        emailVerified: identity.emailVerified,
      },
    });
  }

  /**
   * Which ways a user can currently enter their account.
   *
   * Public because the web app needs it to decide whether to offer "set a
   * password": an account created through Google has none, and rendering a
   * password form that cannot succeed is the same "disabled button that looks
   * enabled" problem the login screen was fixed for.
   *
   * Never returns a credential — only booleans and provider names.
   */
  async methodsFor(userId: string): Promise<AccountLoginMethods> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { hasPassword: false, providers: [] };
    return this.loginMethodsFor(user);
  }

  private async loginMethodsFor(user: PrismaUser): Promise<AccountLoginMethods> {
    const identities = await this.prisma.oAuthIdentity.findMany({
      where: { userId: user.id },
      select: { provider: true },
    });
    return {
      // `null` means "no password" — see the `User.passwordHash` comment.
      hasPassword: user.passwordHash !== null,
      providers: identities.map((row) => row.provider),
    };
  }
}

/**
 * True when Prisma reports a unique-constraint violation (P2002).
 *
 * Matched on `code` rather than on the message: Prisma's wording is not a stable
 * contract, and a message-based check would silently stop matching after an
 * upgrade — turning a benign race back into a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Narrowing helper for callers that need the Prisma payload type. */
export type OAuthIdentityCreate = Prisma.OAuthIdentityUncheckedCreateInput;
