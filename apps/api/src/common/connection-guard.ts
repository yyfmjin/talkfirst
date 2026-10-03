import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Minimum shape needed to run the checks in this file. Accepts either the root
 * PrismaService or an interactive-transaction client, so the same helper works
 * inside and outside `$transaction`.
 */
export type ConnectionCheckClient = Pick<PrismaService, "conversationMember" | "connection" | "user">;

/** Standard error body for "the conversation is not open for messages". */
export const CONNECTION_REMOVED_ERROR = {
  success: false as const,
  error: {
    code: "CONNECTION_REMOVED",
    message: "This connection was removed, so this conversation is closed",
  },
};

/** Standard error body for "your account may not send right now". */
export function accountRestrictedError(status: string) {
  const code =
    status === "BANNED" ? "USER_BANNED" : status === "SUSPENDED" ? "USER_SUSPENDED" : "USER_DISABLED";
  return {
    success: false as const,
    error: { code, message: "Your account may not send messages right now" },
  };
}

/**
 * FIX (audit P003): is the conversation between these two users still open?
 *
 * Membership alone was the only guard on every message path, so after a
 * connection was removed the conversation row (and its members) stayed in place
 * and the pair could keep messaging each other indefinitely — even though the
 * connection list no longer showed the relationship at all.
 *
 * Removal is soft (`Connection.status = REMOVED`), and the conversation is
 * intentionally kept so history is not destroyed; the relationship state is
 * therefore the only thing that can close it.
 *
 * A conversation with no `Connection` row at all (none currently exist — every
 * conversation is created together with its connection) is treated as closed
 * rather than open, so a future conversation type cannot inherit messaging by
 * accident.
 */
export async function assertConnectionActive(
  prisma: ConnectionCheckClient,
  conversationId: string,
  userId: string,
  peerId: string,
): Promise<void> {
  const [userAId, userBId] = [userId, peerId].sort();
  const connection = await prisma.connection.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { status: true },
  });
  // `conversationId` is accepted so the signature stays honest about what the
  // rule is scoped to, and so a future per-conversation policy has a place to
  // live; today the pair is the unit of the relationship.
  void conversationId;
  if (!connection || connection.status !== "ACTIVE") {
    throw new ForbiddenException(CONNECTION_REMOVED_ERROR);
  }
}

/**
 * FIX (audit P002): re-read the sender's account status on every send.
 *
 * Account status used to be read exactly once — during the Socket.IO handshake
 * (`chat-auth.service.ts`). A user banned, suspended or disabled *after*
 * connecting kept a fully working socket and could keep sending and receiving.
 * HTTP was already safe because `JwtStrategy.validate()` re-reads the row per
 * request; the socket had no equivalent.
 *
 * Returns the fresh status so callers can act on it (the gateway closes the
 * socket when the account is no longer ACTIVE).
 */
export async function requireActiveAccount(
  prisma: ConnectionCheckClient,
  userId: string,
): Promise<"ACTIVE" | "DISABLED" | "BANNED" | "SUSPENDED"> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  if (!user) {
    throw new NotFoundException({
      success: false,
      error: { code: "USER_NOT_FOUND", message: "User not found" },
    });
  }
  if (user.status !== "ACTIVE") {
    throw new ForbiddenException(accountRestrictedError(user.status));
  }
  return user.status;
}
