import { Injectable } from "@nestjs/common";

/**
 * In-memory presence + typing state.
 *
 * Phase 6 keeps this in the API process (single instance). When TalkFirst
 * scales to multiple API instances this must move to Redis pub/sub +
 * key expiry; the gateway API below is already shaped for that migration.
 */
@Injectable()
export class PresenceService {
  private readonly onlineUsers = new Map<string, { sockets: Set<string>; lastSeen: Date }>();
  private readonly typingByConversation = new Map<string, Map<string, number>>();

  markOnline(userId: string, socketId: string) {
    const entry = this.onlineUsers.get(userId) ?? { sockets: new Set<string>(), lastSeen: new Date() };
    entry.sockets.add(socketId);
    entry.lastSeen = new Date();
    this.onlineUsers.set(userId, entry);
  }

  markOffline(userId: string, socketId: string) {
    const entry = this.onlineUsers.get(userId);
    if (!entry) return false;
    entry.sockets.delete(socketId);
    entry.lastSeen = new Date();
    if (entry.sockets.size === 0) {
      this.onlineUsers.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId: string) {
    return this.onlineUsers.has(userId);
  }

  lastSeen(userId: string) {
    return this.onlineUsers.get(userId)?.lastSeen ?? null;
  }

  setTyping(conversationId: string, userId: string) {
    const expiresAt = Date.now() + 5000;
    const current = this.typingByConversation.get(conversationId) ?? new Map<string, number>();
    current.set(userId, expiresAt);
    this.typingByConversation.set(conversationId, current);
  }

  clearTyping(conversationId: string, userId: string) {
    this.typingByConversation.get(conversationId)?.delete(userId);
  }

  typingUsers(conversationId: string, excludeUserId?: string) {
    const current = this.typingByConversation.get(conversationId);
    if (!current) return [];
    const now = Date.now();
    const users: string[] = [];
    for (const [userId, expiresAt] of current.entries()) {
      if (expiresAt < now) {
        current.delete(userId);
        continue;
      }
      if (userId !== excludeUserId) users.push(userId);
    }
    return users;
  }
}
