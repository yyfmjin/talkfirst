import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { AiService, AiUnavailableError } from "./ai.service";

/** 会话历史里带进 LLM 的条数上限（也限制上下文体积）。 */
const HISTORY_LIMIT = 20;
/** 每次 GET 返回的消息条数。 */
const MESSAGE_PAGE = 50;

export type UpsertCompanionInput = {
  name: string;
  userNickname: string;
  stylePreset?: string;
  personality?: string;
  greeting?: string;
};

@Injectable()
export class AiCompanionService {
  private readonly logger = new Logger(AiCompanionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly ai: AiService,
  ) {}

  /** 当前用户的 AI 朋友全量状态（无 → null）。 */
  async getForUser(userId: string) {
    const companion = await this.prisma.aiCompanion.findUnique({ where: { userId } });
    if (!companion) return null;
    const conversation = await this.prisma.conversation.findFirst({
      where: { type: "AI", aiCompanionId: companion.id },
      orderBy: { createdAt: "asc" },
    });
    if (!conversation) return { companion, conversationId: null, messages: [] };

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: MESSAGE_PAGE,
    });
    return {
      companion,
      conversationId: conversation.id,
      messages: messages.map((message) => this.toClientMessage(message)),
    };
  }

  /**
   * 创建或更新 AI 朋友。
   * 首次创建时同时建 AI 会话 + 成员行，并在有开场白时写入第一条 AI 消息；
   * 会话已存在且一条消息都没有时，更新开场白会补写那一条。
   */
  async upsert(userId: string, input: UpsertCompanionInput) {
    const name = input.name.trim();
    const userNickname = input.userNickname.trim();
    const greeting = input.greeting?.trim() || null;
    const stylePreset = input.stylePreset?.trim() || null;
    const personality = input.personality?.trim() || null;

    const companion = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiCompanion.upsert({
        where: { userId },
        create: {
          userId,
          name,
          userNickname,
          stylePreset,
          personality,
          greeting,
        },
        update: { name, userNickname, stylePreset, personality, greeting },
      });

      let conversation = await tx.conversation.findFirst({
        where: { type: "AI", aiCompanionId: created.id },
        include: { messages: { where: { deletedAt: null }, take: 1 } },
      });
      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            type: "AI",
            aiCompanionId: created.id,
            members: { create: { userId, lastReadAt: new Date() } },
          },
          include: { messages: { where: { deletedAt: null }, take: 1 } },
        });
      }
      if (greeting && conversation.messages.length === 0) {
        await tx.message.create({
          data: { conversationId: conversation.id, senderKind: "AI", type: "TEXT", content: greeting },
        });
      }
      return created;
    });

    return this.getForUser(companion.userId);
  }

  async remove(userId: string) {
    const companion = await this.prisma.aiCompanion.findUnique({ where: { userId } });
    if (!companion) throw new NotFoundException({ success: false, error: { code: "COMPANION_NOT_FOUND" } });
    // 会话经 aiCompanionId 外键级联删除，消息与成员随会话级联。
    await this.prisma.aiCompanion.delete({ where: { userId } });
    return { success: true as const };
  }

  /**
   * 发一条消息：存用户消息 → 调 LLM → 存 AI 回复，一次返回两条。
   * LLM 失败时用户消息仍保留（回复字段为 null），客户端可走 `/reply` 重试。
   */
  async sendMessage(userId: string, content: string) {
    const ctx = await this.assertConversation(userId);
    const trimmed = content.trim();
    if (!trimmed) throw new ForbiddenException({ success: false, error: { code: "EMPTY_MESSAGE" } });

    const scan = this.safety.scanText(trimmed);
    if (scan.blocked) {
      throw new ForbiddenException({
        success: false,
        error: { code: "MESSAGE_BLOCKED", message: "This message cannot be sent" },
      });
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: ctx.conversation.id, senderId: userId, senderKind: "USER", type: "TEXT", content: trimmed },
      });
      await tx.conversation.update({ where: { id: ctx.conversation.id }, data: { updatedAt: new Date() } });
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: ctx.conversation.id, userId } },
        data: { lastReadAt: new Date() },
      });
      return created;
    });

    const reply = await this.generateReply(userId, ctx.conversation.id, ctx.companion, message.id);
    return {
      success: true as const,
      data: { message: this.toClientMessage(message), reply: reply ? this.toClientMessage(reply) : null },
    };
  }

  /** 对最后一条「用户消息」重试生成 AI 回复（回复没接上时用）。 */
  async retryReply(userId: string) {
    const ctx = await this.assertConversation(userId);
    const last = await this.prisma.message.findFirst({
      where: { conversationId: ctx.conversation.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!last || last.senderKind !== "USER") {
      throw new NotFoundException({ success: false, error: { code: "NOTHING_TO_RETRY" } });
    }
    const reply = await this.generateReply(userId, ctx.conversation.id, ctx.companion, last.id);
    return {
      success: true as const,
      data: { message: this.toClientMessage(last), reply: reply ? this.toClientMessage(reply) : null },
    };
  }

  /** 会话读到位（打开 AI 聊天页时顺手消未读）。 */
  async markRead(userId: string) {
    const ctx = await this.assertConversation(userId);
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: ctx.conversation.id, userId } },
      data: { lastReadAt: new Date() },
    });
    return { success: true as const };
  }

  /* ───────────────────────── 内部 ───────────────────────── */

  private async assertConversation(userId: string) {
    const companion = await this.prisma.aiCompanion.findUnique({ where: { userId } });
    if (!companion) {
      throw new NotFoundException({
        success: false,
        error: { code: "COMPANION_NOT_FOUND", message: "还没有创建 AI 朋友" },
      });
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: { type: "AI", aiCompanionId: companion.id },
      orderBy: { createdAt: "asc" },
    });
    if (!conversation) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "AI 会话不存在" },
      });
    }
    return { companion, conversation };
  }

  /** 生成并落库一条 AI 回复。LLM 失败返回 null（不落库）。 */
  private async generateReply(
    userId: string,
    conversationId: string,
    companion: { name: string; userNickname: string; stylePreset: string | null; personality: string | null },
    afterMessageId: string,
  ) {
    try {
      const [historyRows, user] = await Promise.all([
        this.prisma.message.findMany({
          where: { conversationId, deletedAt: null, createdAt: { lt: new Date() }, id: { not: afterMessageId } },
          orderBy: { createdAt: "desc" },
          take: HISTORY_LIMIT,
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            nickname: true,
            countryCode: true,
            birthDate: true,
            gender: true,
            bio: true,
            languages: { include: { language: { select: { name: true } } } },
            interests: { include: { interest: { select: { name: true } } } },
            purposes: { include: { purpose: { select: { name: true } } } },
          },
        }),
      ]);

      const history = historyRows
        .reverse()
        .filter((row) => row.senderKind === "USER" || row.senderKind === "AI")
        .map((row) => ({
          role: (row.senderKind === "AI" ? "assistant" : "user") as "user" | "assistant",
          content: row.content,
        }));

      const userText = (await this.prisma.message.findUnique({ where: { id: afterMessageId } }))?.content;
      if (!userText) return null;

      let age: number | null = null;
      if (user?.birthDate) {
        const now = new Date();
        const birth = new Date(user.birthDate);
        age = now.getFullYear() - birth.getFullYear();
        if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) {
          age -= 1;
        }
      }

      const country = user?.countryCode
        ? await this.prisma.country.findUnique({ where: { code: user.countryCode }, select: { name: true } })
        : null;

      const system = this.ai.buildSystemPrompt(
        {
          name: companion.name,
          userNickname: companion.userNickname,
          stylePreset: companion.stylePreset,
          personality: companion.personality,
        },
        {
          nickname: user?.nickname ?? null,
          countryName: country?.name ?? null,
          age,
          gender: user?.gender && user.gender !== "UNKNOWN" ? user.gender : null,
          bio: user?.bio ?? null,
          languages: user?.languages.map((item) => item.language.name) ?? [],
          interests: user?.interests.map((item) => item.interest.name) ?? [],
          purposes: user?.purposes.map((item) => item.purpose.name) ?? [],
        },
      );

      let replyContent = await this.ai.chat(system, history, userText);
      const replyScan = this.safety.scanText(replyContent);
      if (replyScan.blocked) {
        replyContent = "这个话题我们先跳过吧，聊点别的？";
      }

      const reply = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: { conversationId, senderKind: "AI", type: "TEXT", content: replyContent },
        });
        await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
        return created;
      });
      return reply;
    } catch (error) {
      if (error instanceof AiUnavailableError) {
        this.logger.warn(`ai reply failed (${error.code}): ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  private toClientMessage(message: {
    id: string;
    conversationId: string;
    senderId: string | null;
    senderKind: string;
    content: string;
    type: string;
    createdAt: Date;
    deletedAt: Date | null;
  }) {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderKind: message.senderKind,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt,
    };
  }
}
