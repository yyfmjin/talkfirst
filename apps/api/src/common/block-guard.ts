import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Minimum shape needed to run the check. Accepts either the root PrismaService
 * or an interactive-transaction client (`Prisma.TransactionClient`), so the same
 * helper works inside and outside `$transaction`.
 */
export type BlockCheckClient = Pick<PrismaService, "block">;

/** Standard error body returned for every blocked interaction. */
export const BLOCKED_ERROR = {
  success: false as const,
  error: { code: "BLOCKED", message: "You cannot message each other" },
};

/**
 * P0-2: single source of truth for "may these two users interact?".
 *
 * A block in EITHER direction must stop the interaction — a user who has been
 * blocked must not be able to keep sending, and the blocker must not be able to
 * keep sending either. Previously only the REST text path and the WebSocket
 * text path performed this check, so image messages slipped through on both
 * transports.
 *
 * @throws ForbiddenException with code `BLOCKED` when a block exists.
 */
export async function assertNotBlocked(
  prisma: BlockCheckClient,
  userAId: string,
  userBId: string | null | undefined,
): Promise<void> {
  if (!userBId || userAId === userBId) return;
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { blockerId: true },
  });
  if (blocked) {
    throw new ForbiddenException(BLOCKED_ERROR);
  }
}

/** Boolean variant for callers that prefer branching over throwing. */
export async function isBlockedBetween(
  prisma: BlockCheckClient,
  userAId: string,
  userBId: string | null | undefined,
): Promise<boolean> {
  if (!userBId || userAId === userBId) return false;
  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { blockerId: true },
  });
  return Boolean(blocked);
}
