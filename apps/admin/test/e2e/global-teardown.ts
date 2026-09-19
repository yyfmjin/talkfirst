import { PrismaClient } from "@prisma/client";
import { cleanup } from "../fixtures/admin-roles";

/**
 * Removes every fixture row the suite created.
 *
 * The browser tests are read-only against the admin API, so the only residue is
 * the seeded accounts and their open report. `cleanup()` is keyed on the `pw.`
 * email prefix, so it can never touch a real account.
 */
export default async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    const removed = await cleanup(prisma);
    console.log(`[e2e] removed ${removed} admin role fixture user(s)`);
  } finally {
    await prisma.$disconnect();
  }
}
