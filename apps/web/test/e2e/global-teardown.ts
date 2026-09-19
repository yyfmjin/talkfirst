import { PrismaClient } from "@prisma/client";
import { cleanup } from "../fixtures/profile";

/**
 * Removes every fixture row the suite created.
 *
 * `cleanup()` is keyed on the `pw.pc14.` email prefix, so it can never touch a
 * real account, and it runs even after a failed run so the database is not left
 * holding stale test data.
 */
export default async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    const removed = await cleanup(prisma);
    console.log(`[pc14] removed ${removed} profile fixture account(s)`);
  } finally {
    await prisma.$disconnect();
  }
}
