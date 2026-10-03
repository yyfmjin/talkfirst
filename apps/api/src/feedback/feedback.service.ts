import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AppSettingsService, isPlausibleEmail } from "./app-settings.service";

/**
 * Member feedback and the team's replies.
 *
 * ## The shape, and why it is not a ticket system
 *
 * One member message, one team reply, four states. A real support product adds threads,
 * assignment, SLAs and categories-of-category; none of that was asked for, and building
 * it speculatively would produce a queue nobody has agreed how to work. What is here is
 * the smallest thing that answers "a member told us something, and we can answer them
 * and show that we answered".
 *
 * ## Why the body is bounded but generous
 *
 * 4000 characters is roughly a page of prose. A cap is necessary — an unbounded text
 * column on a public endpoint is a free storage DoS — but a tight one would make the
 * feature useless for an actual bug report with steps to reproduce.
 *
 * ## Why the address is resolved server-side
 *
 * The reply-to address is stored on the row at submission time rather than read from the
 * account at reply time. The member may want a different address, may change their
 * account address later, and the reply must go where they asked. `null` means "no
 * address was supplied", which the admin queue renders as such rather than guessing.
 */

export const FEEDBACK_MAX_BODY = 4000;

export type FeedbackKind = "SUGGESTION" | "BUG" | "COMPLAINT" | "OTHER";
export type FeedbackStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

const KINDS: readonly FeedbackKind[] = ["SUGGESTION", "BUG", "COMPLAINT", "OTHER"];
const STATUSES: readonly FeedbackStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  /** What the submission form needs to render itself. */
  async submissionContext() {
    return { supportEmail: await this.settings.supportEmail(), maxBody: FEEDBACK_MAX_BODY };
  }

  /**
   * Records a submission.
   *
   * A member may attach an address that differs from their account's, and an
   * unauthenticated caller would in principle be able to submit — the controller
   * requires a session today, but nothing here depends on one, which keeps the door open
   * without a schema change.
   */
  async submit(
    userId: string | null,
    input: { body: string; kind?: string; contactEmail?: string | null; source?: string | null },
  ) {
    const body = (input.body ?? "").trim();
    if (!body) {
      throw new BadRequestException({
        success: false,
        error: { code: "FEEDBACK_EMPTY", message: "请填写反馈内容" },
      });
    }
    if (body.length > FEEDBACK_MAX_BODY) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "FEEDBACK_TOO_LONG",
          message: `反馈内容不能超过 ${FEEDBACK_MAX_BODY} 字`,
        },
      });
    }

    const contactEmail = (input.contactEmail ?? "").trim();
    if (contactEmail && !isPlausibleEmail(contactEmail)) {
      throw new BadRequestException({
        success: false,
        error: { code: "FEEDBACK_EMAIL_INVALID", message: "联系邮箱格式不正确" },
      });
    }

    // An unknown kind is coerced rather than rejected: the enum is a triage aid, and
    // refusing a submission over it would lose the message to save a label.
    const kind = isFeedbackKind(input.kind) ? input.kind : "OTHER";

    const created = await this.prisma.feedback.create({
      data: {
        userId,
        kind,
        body,
        contactEmail: contactEmail || null,
        source: input.source?.trim().slice(0, 128) || null,
      },
      select: { id: true, createdAt: true },
    });

    return { id: created.id, createdAt: created.createdAt };
  }

  /** The member's own submissions, newest first, with any reply. */
  async listMine(userId: string, page = 1, pageSize = 20) {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safeSize = Math.min(Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20, 50);

    const [items, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: {
          id: true,
          kind: true,
          body: true,
          status: true,
          replyBody: true,
          repliedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.feedback.count({ where: { userId } }),
    ]);

    return {
      items,
      total,
      page: safePage,
      pageSize: safeSize,
      totalPages: Math.max(1, Math.ceil(total / safeSize)),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Admin                                                                  */
  /* ---------------------------------------------------------------------- */

  async listForAdmin(query: {
    status?: string;
    kind?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    const page = Number.isFinite(query.page) && (query.page as number) > 0 ? (query.page as number) : 1;
    const pageSize = Math.min(
      Number.isFinite(query.pageSize) && (query.pageSize as number) > 0 ? (query.pageSize as number) : 50,
      200,
    );

    const where: Record<string, unknown> = {};
    // An unrecognised filter is ignored rather than rejected, matching the other admin
    // reads: a typo shows the unfiltered list rather than an error or an empty page.
    if (isFeedbackStatus(query.status)) where.status = query.status;
    if (isFeedbackKind(query.kind)) where.kind = query.kind;

    const [rows, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          kind: true,
          body: true,
          contactEmail: true,
          source: true,
          status: true,
          replyBody: true,
          repliedAt: true,
          repliedById: true,
          createdAt: true,
          userId: true,
          user: { select: { id: true, nickname: true, email: true } },
        },
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return {
      items: rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async adminCounts() {
    const [open, inProgress] = await Promise.all([
      this.prisma.feedback.count({ where: { status: "OPEN" } }),
      this.prisma.feedback.count({ where: { status: "IN_PROGRESS" } }),
    ]);
    return { open, inProgress, total: open + inProgress };
  }

  /**
   * Changes status and/or writes the reply.
   *
   * A reply is only recorded when one is actually supplied — sending an empty string
   * means "do not touch the reply", not "erase it". Erasing an answer a member has
   * already read would be surprising, and a status-only change is the common case.
   */
  async review(
    id: string,
    input: { status?: string; replyBody?: string | null },
    actor: { adminUserId: string | null },
  ) {
    const existing = await this.prisma.feedback.findUnique({
      where: { id },
      select: { id: true, status: true, replyBody: true },
    });
    if (!existing) {
      throw new NotFoundException({
        success: false,
        error: { code: "FEEDBACK_NOT_FOUND", message: "No such feedback" },
      });
    }

    const data: Record<string, unknown> = {};

    if (input.status !== undefined) {
      if (!isFeedbackStatus(input.status)) {
        throw new BadRequestException({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Unknown feedback status" },
        });
      }
      data.status = input.status;
    }

    const reply = (input.replyBody ?? "").trim();
    if (reply) {
      if (reply.length > FEEDBACK_MAX_BODY) {
        throw new BadRequestException({
          success: false,
          error: { code: "FEEDBACK_REPLY_TOO_LONG", message: `回复不能超过 ${FEEDBACK_MAX_BODY} 字` },
        });
      }
      data.replyBody = reply;
      data.repliedAt = new Date();
      data.repliedById = actor.adminUserId;
      // Answering a message is what moves it out of the untouched pile, unless the
      // caller explicitly chose a different state.
      if (data.status === undefined) data.status = "RESOLVED";
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Nothing to change" },
      });
    }

    return this.prisma.feedback.update({
      where: { id },
      data,
      select: { id: true, status: true, replyBody: true, repliedAt: true },
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Settings                                                               */
  /* ---------------------------------------------------------------------- */

  async readSupportEmailSetting() {
    return { supportEmail: await this.settings.supportEmail() };
  }

  async writeSupportEmailSetting(value: string | null, adminUserId: string | null) {
    return { supportEmail: await this.settings.setSupportEmail(value, adminUserId) };
  }
}
