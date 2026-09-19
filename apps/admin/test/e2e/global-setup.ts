import { PrismaClient } from "@prisma/client";
import { cleanup, seed } from "../fixtures/admin-roles";

/**
 * Seeds the role accounts the browser tests log in as.
 *
 * Starts from a clean slate so a previous crashed run cannot leave a stale
 * `isActive` flag behind and silently change what a test is proving.
 */
export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    await cleanup(prisma);
    const ids = await seed(prisma);
    console.log(`[e2e] seeded ${Object.keys(ids).length} admin role fixture(s)`);
  } finally {
    await prisma.$disconnect();
  }
}
