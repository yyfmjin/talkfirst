import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";
import { ApiExceptionFilter } from "../common/api-exception.filter";
import { MomentsService } from "../moments/moments.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { NotificationService } from "../notifications/notification.service";
import { SocialSafetyController } from "./social-safety.controller";

/**
 * PC-2.5.2 — the report contract as the *client* sees it.
 *
 * A moment report shares `POST /reports` with a user report, so this runs over
 * real HTTP: the DTO surface, the target resolution and the status/code mapping
 * are the production ones. Two things a service-level test cannot prove are
 * covered here:
 *
 *  - `reporterId` is not a whitelisted field, so a forged reporter id is
 *    rejected before it can reach any query;
 *  - `reportedUserId` of a moment report is the *author*, read server-side, so
 *    a client cannot name an account other than the content's owner.
 */

const VIEWER = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const AUTHOR = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";
const MOMENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MESSAGE = "abcdefab-1234-4567-89ab-cdefabcdefab";
const COMMENT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

class AlwaysSignedInStrategy extends PassportStrategyBase {
  name = "jwt";

  authenticate() {
    this.success({ id: VIEWER, email: "viewer@example.test" });
  }
}

passport.use("jwt", new AlwaysSignedInStrategy());

describe("SocialSafetyController — report HTTP contract", () => {
  let app: INestApplication;
  let prisma: {
    user: { findUnique: jest.Mock };
    moment: { findUnique: jest.Mock };
    message: { findUnique: jest.Mock };
    momentComment: { findUnique: jest.Mock };
    report: { create: jest.Mock };
  };
  let moments: { resolveMomentAccess: jest.Mock };
  let base = "";

  /** An ACTIVE moment authored by AUTHOR, visible to the viewer. */
  function visibleMoment(authorId = AUTHOR) {
    prisma.moment.findUnique.mockResolvedValue({ userId: authorId, user: { status: "ACTIVE" } });
    moments.resolveMomentAccess.mockResolvedValue("allowed");
  }

  /**
   * A message the viewer may legitimately cite (audit P028): it exists, its
   * sender is the reported user, and the reporter is in its conversation.
   */
  function reportableMessage(
    overrides: { senderId?: string; members?: string[] } = {},
  ) {
    prisma.message.findUnique.mockResolvedValue({
      id: MESSAGE,
      senderId: overrides.senderId ?? OTHER,
      conversation: { members: (overrides.members ?? [VIEWER, OTHER]).map((userId) => ({ userId })) },
    });
  }

  beforeAll(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      moment: { findUnique: jest.fn() },
      message: { findUnique: jest.fn() },
      momentComment: { findUnique: jest.fn() },
      report: {
        create: jest.fn().mockResolvedValue({
          id: "r1",
          status: "OPEN",
          createdAt: new Date("2026-09-20T00:00:00.000Z"),
        }),
      },
    };
    moments = { resolveMomentAccess: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [SocialSafetyController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: SafetyService, useValue: {} },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: MomentsService, useValue: moments },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0);
    const url = await app.getUrl();
    base = `http://127.0.0.1:${url.slice(url.lastIndexOf(":") + 1)}/api/v1/reports`;
  });

  beforeEach(() => {
    // Echo the queried id so "report yourself" and "report someone else" are
    // distinguishable, exactly as the real lookup would be.
    prisma.user.findUnique
      .mockReset()
      .mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id }),
      );
    visibleMoment();
    // Default: no message pointer supplied, so the lookup must not silently
    // return a stale value from a previous test.
    prisma.message.findUnique.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    prisma.report.create.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(body: unknown) {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json()) as {
      success: boolean;
      data?: Record<string, unknown>;
      error?: { code?: string; message?: string };
    };
    return { response, body: parsed };
  }

  it("举报可见的 Moment -> 201，且响应只有最小契约字段", async () => {
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data ?? {}).sort()).toEqual(["createdAt", "id", "status"]);
  });

  it("reportedUserId 取自 Moment 作者（不是举报人），momentId 落库，messageId 为 null", async () => {
    await post({ momentId: MOMENT, reason: "Harassment" });
    expect(prisma.report.create).toHaveBeenCalledTimes(1);
    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId: VIEWER,
        reportedUserId: AUTHOR,
        momentId: MOMENT,
        messageId: null,
        commentId: null,
        reason: "Harassment",
        description: undefined,
      },
    });
    expect(moments.resolveMomentAccess).toHaveBeenCalledWith(VIEWER, AUTHOR);
  });

  it("响应不泄露双方 id、内部指针", async () => {
    const { body } = await post({ momentId: MOMENT, reason: "Other" });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(VIEWER);
    expect(serialized).not.toContain(AUTHOR);
    expect(serialized).not.toContain(MOMENT);
    expect(body.data).not.toHaveProperty("reportedUserId");
    expect(body.data).not.toHaveProperty("reporterId");
    expect(body.data).not.toHaveProperty("messageId");
  });

  it("伪造 reporterId 被白名单拦下：400 VALIDATION_ERROR，且从不落库", async () => {
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam", reporterId: OTHER });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("Moment 不存在 -> 404 MOMENT_NOT_FOUND，且不落库", async () => {
    prisma.moment.findUnique.mockResolvedValue(null);
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("MOMENT_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("作者已非 ACTIVE -> 404 MOMENT_NOT_FOUND", async () => {
    prisma.moment.findUnique.mockResolvedValue({ userId: AUTHOR, user: { status: "SUSPENDED" } });
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("MOMENT_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("无权访问的 Moment（private / 非连接 connections / Block）-> 403 MOMENT_LOCKED，且不落库", async () => {
    moments.resolveMomentAccess.mockResolvedValue("locked");
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("MOMENT_LOCKED");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("非 UUID 的 momentId -> 400 VALIDATION_ERROR，且从不落库", async () => {
    const { response, body } = await post({ momentId: "not-a-uuid", reason: "Spam" });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("非法 reason -> 403 INVALID_REASON（既有约定），且不落库", async () => {
    const { response, body } = await post({ momentId: MOMENT, reason: "spam" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("INVALID_REASON");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("同时给出 userId 与 momentId -> 400 INVALID_REPORT_TARGET", async () => {
    const { response, body } = await post({ userId: OTHER, momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("INVALID_REPORT_TARGET");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("没有任何 target -> 400 INVALID_REPORT_TARGET", async () => {
    const { response, body } = await post({ reason: "Spam" });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("INVALID_REPORT_TARGET");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("用户举报无回归：{ userId } -> 201，reportedUserId 仍来自该字段", async () => {
    const { response } = await post({ userId: OTHER, reason: "Spam" });
    expect(response.status).toBe(201);
    expect(prisma.report.create).toHaveBeenCalledWith({
      data: {
        reporterId: VIEWER,
        reportedUserId: OTHER,
        momentId: null,
        messageId: null,
        commentId: null,
        reason: "Spam",
        description: undefined,
      },
    });
  });

  it("消息举报无回归：momentId 缺省时 messageId 原样落库", async () => {
    // FIX (audit P028): a message pointer is now validated — it must exist, the
    // reporter must be in its conversation, and its sender must be the user the
    // report names. This fixture is the case that used to be accepted blindly.
    reportableMessage();
    await post({ userId: OTHER, messageId: MESSAGE, reason: "Scam" });
    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ momentId: null, messageId: MESSAGE }),
      }),
    );
  });

  it("消息不属于被举报人 -> 404 MESSAGE_NOT_FOUND，且不落库", async () => {
    // The defect this closes: any UUID could be attached as "evidence", and an
    // admin opening the report would read that message's content and its
    // sender's e-mail.
    reportableMessage({ senderId: "someone-else" });
    const { response, body } = await post({ userId: OTHER, messageId: MESSAGE, reason: "Scam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("MESSAGE_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("举报人不在该消息所在会话 -> 404 MESSAGE_NOT_FOUND，且不落库", async () => {
    reportableMessage({ members: ["stranger-a", "stranger-b"] });
    const { response, body } = await post({ userId: OTHER, messageId: MESSAGE, reason: "Scam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("MESSAGE_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("消息不存在 -> 404 MESSAGE_NOT_FOUND，且不落库", async () => {
    prisma.message.findUnique.mockResolvedValue(null);
    const { response, body } = await post({ userId: OTHER, messageId: MESSAGE, reason: "Scam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("MESSAGE_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("举报不存在的用户 -> 404 USER_NOT_FOUND", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const { response, body } = await post({ userId: OTHER, reason: "Spam" });
    expect(response.status).toBe(404);
    expect(body.error?.code).toBe("USER_NOT_FOUND");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("举报自己 -> 403 CANNOT_REPORT_SELF（既有约定）", async () => {
    const { response, body } = await post({ userId: VIEWER, reason: "Spam" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("CANNOT_REPORT_SELF");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("举报自己的 Moment -> 403 CANNOT_REPORT_SELF，且不落库", async () => {
    visibleMoment(VIEWER);
    const { response, body } = await post({ momentId: MOMENT, reason: "Spam" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("CANNOT_REPORT_SELF");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  /**
   * C2 — 评论举报。
   *
   * 评论既是目标又自带证据，所以它比动态举报多一道闸：管理端会读它的 `content`，
   * 而举报人必须**看得见那条动态**（`resolveMomentAccess`），否则任何人拿一个评论 id
   * 就能让管理员读到一条自己无权看的内容里的原话 —— 这正是 audit P028 在消息上报过的同一个洞。
   */
  describe("评论举报（C2）", () => {
    /**
     * 调用计数必须每次归零：外层的 `afterEach` 只清 `report.create`，
     * 而本文件前面十几个用例都调过 `resolveMomentAccess`，
     * 直接断言 `.not.toHaveBeenCalled()` 会被它们污染。
     * 只清调用、不清实现：外层 `beforeEach` 设的 `mockResolvedValue` 要留着。
     */
    beforeEach(() => {
      moments.resolveMomentAccess.mockClear();
    });

    /** OTHER 在 AUTHOR 的动态下留的一条可举报评论。 */
    function reportableComment(
      overrides: { authorStatus?: string; momentAuthor?: string; access?: string } = {},
    ) {
      prisma.momentComment.findUnique.mockResolvedValue({
        id: COMMENT,
        userId: OTHER,
        user: { status: overrides.authorStatus ?? "ACTIVE" },
        moment: { userId: overrides.momentAuthor ?? AUTHOR },
      });
      moments.resolveMomentAccess.mockResolvedValue(overrides.access ?? "allowed");
    }

    it("reportedUserId 取自评论作者，commentId 落库，另外两个目标为 null", async () => {
      reportableComment();

      const { response } = await post({ commentId: COMMENT, reason: "Harassment" });

      expect(response.status).toBe(201);
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId: VIEWER,
          reportedUserId: OTHER,
          momentId: null,
          messageId: null,
          commentId: COMMENT,
          reason: "Harassment",
          description: undefined,
        },
      });
      // 闸门用的是动态的可见性，且问的是**动态作者**，不是评论作者。
      expect(moments.resolveMomentAccess).toHaveBeenCalledWith(VIEWER, AUTHOR);
    });

    it("评论不存在 -> 404 COMMENT_NOT_FOUND，且不落库", async () => {
      prisma.momentComment.findUnique.mockResolvedValue(null);

      const { response, body } = await post({ commentId: COMMENT, reason: "Spam" });

      expect(response.status).toBe(404);
      expect(body.error?.code).toBe("COMMENT_NOT_FOUND");
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it("看不见那条动态 -> 404（不是 403），也就不会确认这个评论 id 存在", async () => {
      reportableComment({ access: "locked" });

      const { response, body } = await post({ commentId: COMMENT, reason: "Spam" });

      expect(response.status).toBe(404);
      expect(body.error?.code).toBe("COMMENT_NOT_FOUND");
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it("评论作者非 ACTIVE -> 404，且不查动态可见性", async () => {
      reportableComment({ authorStatus: "BANNED" });

      const { response, body } = await post({ commentId: COMMENT, reason: "Spam" });

      expect(response.status).toBe(404);
      expect(body.error?.code).toBe("COMMENT_NOT_FOUND");
      expect(moments.resolveMomentAccess).not.toHaveBeenCalled();
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it("commentId 与 momentId 同时给出 -> 400 INVALID_REPORT_TARGET（三个目标互斥）", async () => {
      reportableComment();

      const { response, body } = await post({
        commentId: COMMENT,
        momentId: MOMENT,
        reason: "Spam",
      });

      expect(response.status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REPORT_TARGET");
      expect(prisma.report.create).not.toHaveBeenCalled();
    });

    it("举报自己的评论 -> 403 CANNOT_REPORT_SELF", async () => {
      // 评论作者就是举报人自己。
      prisma.momentComment.findUnique.mockResolvedValue({
        id: COMMENT,
        userId: VIEWER,
        user: { status: "ACTIVE" },
        moment: { userId: AUTHOR },
      });
      moments.resolveMomentAccess.mockResolvedValue("allowed");

      const { response, body } = await post({ commentId: COMMENT, reason: "Spam" });

      expect(response.status).toBe(403);
      expect(body.error?.code).toBe("CANNOT_REPORT_SELF");
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });
});
