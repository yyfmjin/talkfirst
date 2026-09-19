import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Phase A+ browser-test fixtures.
 *
 * The admin console is only meaningful against a real API with real role
 * accounts, so the browser tests seed their own. Everything here is keyed on a
 * `pw.` email prefix and is created idempotently — `cleanup()` removes exactly
 * those rows and nothing else.
 */

export const PASSWORD = "PhaseAplus!2026";

export type FixtureKey =
  | "superadmin"
  | "analyst"
  | "support"
  | "moderator"
  | "contentManager"
  | "inactive"
  | "victim";

type FixtureSpec = {
  email: string;
  role: "SUPER_ADMIN" | "MODERATOR" | "SUPPORT" | "ANALYST" | "CONTENT_MANAGER";
  /** AdminUser.isActive — false models a soft-disabled administrator. */
  adminActive?: boolean;
  /** User.isAdmin — kept true so the ADMIN_INACTIVE path is what rejects. */
  isAdmin?: boolean;
  /**
   * Whether an AdminUser row is created. `false` models an ordinary member —
   * the detail-screen status tests need a target that is not itself an
   * administrator, otherwise rule (4) in `AdminService.setStatus` (only a
   * SUPER_ADMIN may modify an active admin) would reject every other role.
   */
  admin?: boolean;
};

export const ACCOUNTS: Record<FixtureKey, FixtureSpec> = {
  superadmin: { email: "pw.superadmin@example.test", role: "SUPER_ADMIN" },
  analyst: { email: "pw.analyst@example.test", role: "ANALYST" },
  support: { email: "pw.support@example.test", role: "SUPPORT" },
  moderator: { email: "pw.moderator@example.test", role: "MODERATOR" },
  // Phase B5: an ACTIVE CONTENT_MANAGER. Until B5 the only CONTENT_MANAGER in
  // this fixture set was `inactive` (deactivated), so the role's actual
  // permissions were never exercised through a real session. B5's regression
  // requires proving this role can read reports and *cannot* review them or
  // change a user's status — which needs a session that can log in.
  contentManager: { email: "pw.contentmanager@example.test", role: "CONTENT_MANAGER" },
  // AdminUser row exists but is deactivated, while User.isAdmin stays true:
  // proves ADMIN_INACTIVE wins over the legacy fallback in the browser too.
  inactive: {
    email: "pw.inactive@example.test",
    role: "CONTENT_MANAGER",
    adminActive: false,
    isAdmin: true,
  },
  // A plain member, used as the target of detail-screen status actions.
  victim: {
    email: "pw.victim@example.test",
    role: "SUPPORT",
    admin: false,
    isAdmin: false,
  },
};

export const FIXTURE_EMAILS = Object.values(ACCOUNTS).map((a) => a.email);

/** The id of each seeded fixture account, keyed by its `FixtureKey`. */
export type SeedIds = Record<FixtureKey, string>;

/**
 * Writes one human and one machine audit row for the audit screen to render.
 *
 * The machine row is the interesting one: `actorType = SYSTEM` with
 * `adminId = null`. It is written through Prisma rather than the API because no
 * admin endpoint can create one — the only producer is the suspension-expiry
 * scheduler, which cannot be triggered on demand from a browser test. The
 * database CHECK guarantees this row is a legal SYSTEM row, so the fixture
 * cannot accidentally model an impossible state.
 *
 * Returns the row ids so the spec can address them precisely.
 */
export async function seedAuditRows(
  prisma: PrismaClient,
  ids: SeedIds,
): Promise<AuditFixtureIds> {
  // Idempotent: a crashed previous run must not leave duplicates behind.
  await prisma.adminAuditLog.deleteMany({
    where: { action: { startsWith: AUDIT_FIXTURE_PREFIX } },
  });

  const humanRow = await prisma.adminAuditLog.create({
    data: {
      actorType: "USER",
      adminId: ids.superadmin,
      action: `${AUDIT_FIXTURE_PREFIX}HUMAN_ACTION`,
      targetType: "USER",
      targetId: ids.victim,
      reason: "audit UI fixture",
      detail: "audit UI fixture — human action",
    },
    select: { id: true },
  });

  const systemRow = await prisma.adminAuditLog.create({
    data: {
      actorType: "SYSTEM",
      adminId: null,
      action: `${AUDIT_FIXTURE_PREFIX}SYSTEM_ACTION`,
      targetType: "USER",
      // Deliberately null: a batch sweep has no single target, and this is the
      // shape that used to crash the page via `adminId.slice(...)`.
      targetId: null,
      before: { status: "SUSPENDED" },
      after: { status: "ACTIVE" },
      detail: "audit UI fixture — machine action",
    },
    select: { id: true },
  });

  return { humanRow: humanRow.id, systemRow: systemRow.id };
}

/** Removes the audit rows written by `seedAuditRows`. */
export async function cleanupAuditRows(prisma: PrismaClient): Promise<number> {
  const { count } = await prisma.adminAuditLog.deleteMany({
    where: { action: { startsWith: AUDIT_FIXTURE_PREFIX } },
  });
  return count;
}

/** Marker so the seeded report is identifiable and never confused with real data. */
const REPORT_DESCRIPTION = "phase A+ browser fixture";

/**
 * Action prefix for audit rows the audit-UI spec writes directly.
 *
 * The audit screen has to render both kinds of actor, and the SYSTEM kind can
 * only exist if something writes it — no UI path produces one. So the spec
 * inserts the two rows itself, marked with this prefix so cleanup can remove
 * exactly them and nothing else. `AdminAuditLog.action` is `VarChar(64)`, so the
 * prefix is kept short.
 */
export const AUDIT_FIXTURE_PREFIX = "PW_AUDIT_UI_";

/** The two audit rows the audit-UI spec asserts on. */
export type AuditFixtureIds = { humanRow: string; systemRow: string };

export async function seed(prisma: PrismaClient): Promise<SeedIds> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids = {} as SeedIds;

  for (const key of Object.keys(ACCOUNTS) as FixtureKey[]) {
    const spec = ACCOUNTS[key];
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: {
        passwordHash,
        status: "ACTIVE",
        isAdmin: spec.isAdmin ?? true,
        bannedAt: null,
        banReason: null,
        suspendedUntil: null,
      },
      create: {
        email: spec.email,
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        nickname: `PW ${key}`,
        countryCode: "US",
        isAdmin: spec.isAdmin ?? true,
      },
      select: { id: true },
    });

    if (spec.admin === false) {
      // Ordinary member: make sure no stale AdminUser row survives a re-seed.
      await prisma.adminUser.deleteMany({ where: { userId: user.id } });
    } else {
      await prisma.adminUser.upsert({
        where: { userId: user.id },
        update: { role: spec.role, isActive: spec.adminActive ?? true },
        create: { userId: user.id, role: spec.role, isActive: spec.adminActive ?? true },
      });
    }

    ids[key] = user.id;
  }

  // The reports screen defaults to status=OPEN, so at least one open report must
  // exist for the moderator's review controls to render at all.
  const existing = await prisma.report.findFirst({
    where: { reporterId: ids.superadmin, reportedUserId: ids.support, reason: "HARASSMENT" },
    select: { id: true },
  });
  if (existing) {
    await prisma.report.update({
      where: { id: existing.id },
      data: { status: "OPEN", description: REPORT_DESCRIPTION },
    });
  } else {
    await prisma.report.create({
      data: {
        reporterId: ids.superadmin,
        reportedUserId: ids.support,
        reason: "HARASSMENT",
        description: REPORT_DESCRIPTION,
        status: "OPEN",
      },
    });
  }

  return ids;
}

/**
 * Removes every fixture row, in FK-safe order.
 *
 * Audit rows and notes reference the acting admin with `ON DELETE RESTRICT`, so
 * they are cleared first — otherwise a fixture that ever performed a write
 * would be undeletable.
 */
export async function cleanup(prisma: PrismaClient): Promise<number> {
  // First, by marker: a SYSTEM audit row has `adminId = null` *and*
  // `targetId = null`, so the id-scoped delete below is structurally unable to
  // see it. Without this the machine rows would accumulate run after run.
  await cleanupAuditRows(prisma);

  const users = await prisma.user.findMany({
    where: { email: { in: FIXTURE_EMAILS } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return 0;

  await prisma.adminAuditLog.deleteMany({
    where: { OR: [{ adminId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.adminNote.deleteMany({
    where: { OR: [{ adminId: { in: ids } }, { userId: { in: ids } }] },
  });
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: ids } }, { reportedUserId: { in: ids } }] },
  });
  await prisma.adminUser.deleteMany({ where: { userId: { in: ids } } });
  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return removed.count;
}
