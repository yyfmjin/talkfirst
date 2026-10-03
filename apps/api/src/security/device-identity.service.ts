import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { deviceHash, userAgentFingerprint } from "./device-hash";

/**
 * Phase O1 — the device-observation writer.
 *
 * ## Why this file exists
 *
 * `DeviceIdentity` and `DeviceUser` shipped with the Security Audit Center (P1)
 * schema and had **zero code references** anywhere in the repository: never
 * written, never read. `deviceHash()` was implemented and correct, but its only
 * consumers were the `deviceHash` columns on `AccessLog` / `SecurityEvent`, so
 * the two tables that actually model "one device, many accounts" stayed empty.
 * Configuring `SECURITY_DEVICE_SALT` alone would not have changed that.
 *
 * ## What it records
 *
 * - `DeviceIdentity` — one row per distinct device identifier: first/last seen,
 *   plus a bounded list of hashed User-Agents seen on it.
 * - `DeviceUser` — the device↔account association, with a login counter.
 *
 * ## Why `loginCount` is opt-in
 *
 * The column is called `loginCount`, so it may only be incremented on an actual
 * successful authentication. Discovery traffic (any authenticated request) is
 * what makes `DeviceUser` useful for "which accounts share this device", but it
 * is emphatically *not* a login. `bumpLoginCount` therefore defaults to `false`
 * and is passed `true` by exactly one caller — the login success path in
 * `AuthService`. A counter that silently counted requests would be worse than
 * no counter, because it would look authoritative while being meaningless.
 *
 * ## Fault isolation
 *
 * Mirrors `AccessLogService` / `SecurityEventService`: `record()` never throws.
 * Auditing is observability, so a broken device table must not fail a login or
 * change a response. Callers can safely `void` it from a hot path.
 *
 * ## Privacy
 *
 * `deviceHash` is a salted hash of a normalised User-Agent. As the schema says,
 * it is a correlation signal and **not** a fingerprint: UA strings collide and
 * are trivially spoofed, so nothing here may be used on its own to conclude that
 * a user or device is malicious.
 */

/** Upper bound on the hashed-UA list kept per device. */
const MAX_USER_AGENT_FINGERPRINTS = 20;

export interface DeviceObservation {
  userAgent?: string | null;
  /** The authenticated account seen on this device, when there is one. */
  userId?: string | null;
  /** True only on an actual successful authentication. See the class doc. */
  bumpLoginCount?: boolean;
}

@Injectable()
export class DeviceIdentityService {
  private readonly logger = new Logger("DeviceIdentity");

  constructor(private readonly prisma: PrismaService) {}

  /** True when device identification is configured for this process. */
  isEnabled(): boolean {
    return Boolean(process.env.SECURITY_DEVICE_SALT?.trim());
  }

  /**
   * Records one device observation. Never throws.
   *
   * Does nothing when the salt is unset (device identification disabled) or
   * when the User-Agent is missing — there is nothing to identify in either
   * case, and inventing an identifier would be worse than recording none.
   */
  async record(observation: DeviceObservation): Promise<void> {
    const hash = deviceHash(observation.userAgent);
    if (!hash) return;

    try {
      const fingerprint = userAgentFingerprint(observation.userAgent);
      await this.touchDevice(hash, fingerprint);
      if (observation.userId) {
        await this.touchAssociation(hash, observation.userId, observation.bumpLoginCount === true);
      }
    } catch (error) {
      this.logger.error(
        `Failed to record device observation: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  /** Upserts the device row and appends the hashed UA to its bounded list. */
  private async touchDevice(deviceHashValue: string, fingerprint?: string): Promise<void> {
    const existing = await this.prisma.deviceIdentity.findUnique({
      where: { deviceHash: deviceHashValue },
      select: { userAgents: true },
    });

    const agents = mergeFingerprint(existing?.userAgents, fingerprint);

    await this.prisma.deviceIdentity.upsert({
      where: { deviceHash: deviceHashValue },
      // `firstSeenAt` is deliberately absent from `update`: it must survive.
      update: { lastSeenAt: new Date(), ...(agents ? { userAgents: agents } : {}) },
      create: {
        deviceHash: deviceHashValue,
        ...(agents ? { userAgents: agents } : {}),
      },
    });
  }

  /** Upserts the device↔account association, incrementing the login counter. */
  private async touchAssociation(
    deviceHashValue: string,
    userId: string,
    bumpLoginCount: boolean,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.deviceUser.upsert({
      where: { deviceHash_userId: { deviceHash: deviceHashValue, userId } },
      update: {
        lastSeenAt: now,
        ...(bumpLoginCount ? { loginCount: { increment: 1 } } : {}),
      },
      create: {
        deviceHash: deviceHashValue,
        userId,
        firstSeenAt: now,
        lastSeenAt: now,
        loginCount: bumpLoginCount ? 1 : 0,
      },
    });
  }
}

/**
 * Appends `fingerprint` to a previously stored list, newest first, capped.
 *
 * Returns `undefined` when there is nothing to store, so the caller can omit the
 * column entirely rather than overwrite an existing list with an empty one —
 * a request without a User-Agent must not erase what earlier requests recorded.
 */
function mergeFingerprint(
  existing: unknown,
  fingerprint: string | undefined,
): string[] | undefined {
  const previous = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];

  if (!fingerprint) return previous.length > 0 ? previous : undefined;
  if (previous.includes(fingerprint)) return previous;

  return [fingerprint, ...previous].slice(0, MAX_USER_AGENT_FINGERPRINTS);
}
