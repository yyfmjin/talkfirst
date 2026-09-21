import { PrismaClient } from "@prisma/client";
import { cleanup } from "../fixtures/profile";
import { cleanupChat } from "../fixtures/chat";

/**
 * Removes every fixture row the suite created.
 *
 * `cleanup()` is keyed on the `pw.pc14.` email prefix and `cleanupChat()` on
 * `pw.pc33.`, so they can never touch a real account, and they run even after a
 * failed run so the database is not left holding stale test data.
 */
export default async function globalTeardown() {
  const prisma = new PrismaClient();
  try {
    const removed = await cleanup(prisma);
    console.log(`[pc14] removed ${removed} profile fixture account(s)`);
    const removedChat = await cleanupChat(prisma);
    console.log(`[pc33] removed ${removedChat} chat fixture account(s)`);
  } finally {
    await prisma.$disconnect();
  }
}
