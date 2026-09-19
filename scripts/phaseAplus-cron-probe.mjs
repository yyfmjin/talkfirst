/**
 * Phase A+ — does the @Cron trigger actually fire in a live process?
 *
 * The scheduler's *logic* is covered by unit tests and by the live E2E script
 * (which invokes `releaseExpiredSuspensions()` directly against real
 * PostgreSQL). Neither proves that the `@Cron` decorator is wired up: that
 * needs `ScheduleModule.forRoot()`, a registered provider, and a running event
 * loop. A missing registration would leave every other test green while nothing
 * ever ran in production.
 *
 * This probe therefore does no manual invocation at all. It creates an expired
 * suspension, then simply waits for the application to notice on its own.
 *
 * Requires the API to be running on :4000.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const TAG = "cronprobe";
const prisma = new PrismaClient();

const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });

/** Poll until `predicate` holds or the deadline passes. */
async function waitFor(predicate, timeoutMs, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main() {
  const email = `${TAG}.expired@example.test`;

  // Clean any residue from a previous aborted run. Scoped strictly to this
  // probe's own fixture — never an unscoped deleteMany, which Prisma treats as
  // "match everything".
  const stale = await prisma.user.findMany({
    where: { email: { startsWith: `${TAG}.` } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const staleIds = stale.map((u) => u.id);
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: staleIds } } });
    await prisma.adminNote.deleteMany({ where: { userId: { in: staleIds } } });
    await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
  }

  const deadline = new Date(Date.now() - 60_000);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "$2a$10$cronprobeplaceholderplaceholderplaceholder00",
      emailVerified: true,
      status: "SUSPENDED",
      suspendedUntil: deadline,
      banReason: "cron probe",
      nickname: "Cron probe",
      countryCode: "US",
    },
    select: { id: true },
  });

  const before = await prisma.user.findUnique({
    where: { id: user.id },
    select: { status: true, updatedAt: true },
  });
  check("fixture starts SUSPENDED with an expired deadline", before.status === "SUSPENDED", before.status);

  const auditBefore = await prisma.adminAuditLog.count();

  // No invocation — just wait. EVERY_MINUTE means the next tick is <= 60s away.
  console.log("waiting up to 100s for the application's own cron tick (no manual call)…");
  const started = Date.now();
  const flipped = await waitFor(async () => {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true },
    });
    return row?.status === "ACTIVE";
  }, 100_000);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  check("the live @Cron tick released the expired suspension on its own", flipped, `after ${elapsed}s`);

  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: { status: true, suspendedUntil: true, bannedAt: true, banReason: true, updatedAt: true },
  });
  check(
    "released row has every status column cleared",
    after.status === "ACTIVE" &&
      after.suspendedUntil === null &&
      after.bannedAt === null &&
      after.banReason === null,
    JSON.stringify(after),
  );
  check(
    "the row was written by the scheduler, not by the fixture",
    after.updatedAt.getTime() > before.updatedAt.getTime(),
    `before=${before.updatedAt.toISOString()} after=${after.updatedAt.toISOString()}`,
  );

  const auditAfter = await prisma.adminAuditLog.count();
  check(
    "auto-recovery wrote NO audit row (machine action, no system actor)",
    auditAfter === auditBefore,
    `before=${auditBefore} after=${auditAfter}`,
  );

  // The sweep must not have disturbed anything else.
  const banned = await prisma.user.count({ where: { status: "BANNED" } });
  check("BANNED users untouched by the live sweep", banned === 2, `banned=${banned}`);

  // Cleanup.
  await prisma.adminAuditLog.deleteMany({ where: { targetId: user.id } });
  await prisma.adminNote.deleteMany({ where: { userId: user.id } });
  const removed = await prisma.user.deleteMany({ where: { email: { startsWith: `${TAG}.` } } });
  check("probe fixture removed", removed.count === 1, `removed=${removed.count}`);

  const pass = results.filter((r) => r.ok).length;
  console.log("\n============ LIVE @Cron PROBE ============");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  <-- ${r.detail}`}`);
  console.log(`\n${pass}/${results.length} checks passed`);
  console.log("=========================================\n");

  await prisma.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error("CRON PROBE CRASHED:", error);
  await prisma.$disconnect();
  process.exit(2);
});
