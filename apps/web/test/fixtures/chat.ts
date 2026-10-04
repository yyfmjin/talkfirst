import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PASSWORD } from "./profile";

/**
 * PC-3.3 chat fixtures.
 *
 * The chat screen only does anything useful against a real conversation, and
 * the database has no conversation the test accounts belong to, so this module
 * seeds a self-contained one:
 *
 *   alice ── conversation ── bob      (2 members, a handful of messages)
 *
 * Everything is keyed on the `pw.pc33.` email prefix and `cleanupChat()` only
 * ever touches conversations that a fixture account is a member of, so real
 * data cannot be caught in the blast radius.
 */

export const CHAT_EMAILS = {
  alice: "pw.pc33.alice@example.test",
  bob: "pw.pc33.bob@example.test",
} as const;

export type ChatFixtureKey = keyof typeof CHAT_EMAILS;

export const CHAT_FIXTURE_EMAILS: string[] = Object.values(CHAT_EMAILS);

export const CHAT_NICKNAMES = {
  alice: "PW33 Alice",
  bob: "PW33 Bob",
} as const;

/** Deterministic history, oldest first — the same order the thread renders in. */
export const CHAT_MESSAGES = {
  bobHello: "PW33 你好，我是 Bob",
  aliceReply: "PW33 你好 Bob，很高兴认识你",
  bobFollowUp: "PW33 今天天气不错",
} as const;

export type ChatFixture = {
  aliceId: string;
  bobId: string;
  conversationId: string;
};

export async function cleanupChat(prisma: PrismaClient): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { in: CHAT_FIXTURE_EMAILS } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return 0;

  // Only conversations a fixture account actually belongs to are removed, so
  // pre-existing conversations between real users are never touched.
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId: { in: ids } } } },
    select: { id: true },
  });
  const conversationIds = conversations.map((conversation) => conversation.id);

  if (conversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  }

  // A fixture account may also have written into someone else's conversation.
  await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
  });
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] },
  });

  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return removed.count;
}

export async function seedChat(prisma: PrismaClient): Promise<ChatFixture> {
  await cleanupChat(prisma);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const make = (key: ChatFixtureKey) =>
    prisma.user.create({
      data: {
        email: CHAT_EMAILS[key],
        // P0-02 — required and unique. Derived from the fixture key for the same
        // reason as `profile.ts`.
        username: `chatuser${key}`,
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        nickname: CHAT_NICKNAMES[key],
        countryCode: key === "alice" ? "JP" : "US",
        bio: `PW33 ${key} bio`,
      },
      select: { id: true },
    });

  const alice = await make("alice");
  const bob = await make("bob");

  const conversation = await prisma.conversation.create({
    data: { members: { create: [{ userId: alice.id }, { userId: bob.id }] } },
    select: { id: true },
  });

  const history = [
    { senderId: bob.id, content: CHAT_MESSAGES.bobHello },
    { senderId: alice.id, content: CHAT_MESSAGES.aliceReply },
    { senderId: bob.id, content: CHAT_MESSAGES.bobFollowUp },
  ];
  // Fixed, ascending timestamps keep the rendered order deterministic.
  const base = Date.now() - history.length * 60_000;
  for (const [index, entry] of history.entries()) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: entry.senderId,
        content: entry.content,
        type: "TEXT",
        createdAt: new Date(base + index * 60_000),
      },
    });
  }

  return { aliceId: alice.id, bobId: bob.id, conversationId: conversation.id };
}

export async function resolveChatFixture(): Promise<ChatFixture> {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: CHAT_FIXTURE_EMAILS } },
      select: { id: true, email: true },
    });
    const alice = users.find((user) => user.email === CHAT_EMAILS.alice);
    const bob = users.find((user) => user.email === CHAT_EMAILS.bob);
    if (!alice || !bob) throw new Error("PC-3.3 chat fixture accounts are missing");
    const conversation = await prisma.conversation.findFirst({
      where: { members: { some: { userId: alice.id } } },
      select: { id: true },
    });
    if (!conversation) throw new Error("PC-3.3 chat fixture conversation is missing");
    return { aliceId: alice.id, bobId: bob.id, conversationId: conversation.id };
  } finally {
    await prisma.$disconnect();
  }
}
