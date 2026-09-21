import { PrismaClient } from "@prisma/client";
import { seed } from "../fixtures/profile";
import { seedChat } from "../fixtures/chat";

/**
 * Seeds the three accounts every profile spec logs in as, plus the conversation
 * the chat specs drive.
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
    await seedChat(prisma);
    console.log("[pc33] seeded 2 chat fixture account(s) and 1 conversation");
  } finally {
    await prisma.$disconnect();
  }
}
