import { PrismaClient } from "@prisma/client";
import { seed } from "../fixtures/profile";

/**
 * Seeds the three accounts every profile spec logs in as.
 *
 * Starts from a clean slate so a previous crashed run cannot leave a stale
 * attribute, visibility row or connection behind and silently change what a
 * test proves.
 */
export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    await seed(prisma);
    console.log("[pc14] seeded 3 profile fixture account(s)");
  } finally {
    await prisma.$disconnect();
  }
}
