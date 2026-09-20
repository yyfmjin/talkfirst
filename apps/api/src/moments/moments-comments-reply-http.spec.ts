import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";
import { ApiExceptionFilter } from "../common/api-exception.filter";
import { MomentsController } from "./moments.controller";
import { MomentsService } from "./moments.service";

/**
 * PC-2.3.2 — the reply contract as the *client* sees it.
 *
 * The service specs pin the domain rules. This one runs over real HTTP so the
 * DTO surface and the status/code mapping are the production ones, and so the
 * two things a service-level test cannot prove are covered:
 *
 *  - `parentCommentId` is a whitelisted field while `userId` is not, so a
 *    forged owner id is rejected before it can reach any query;
 *  - every comment rejection answers `403` with a stable `error.code`, which is
 *    the precedent set by `EMPTY_COMMENT` rather than a new status per case.
 */

const VIEWER = "u-viewer";

class AlwaysSignedInStrategy extends PassportStrategyBase {
  name = "jwt";

  authenticate() {
    this.success({ id: VIEWER, email: "viewer@example.test" });
  }
}

passport.use("jwt", new AlwaysSignedInStrategy());

describe("MomentsController — comment reply HTTP contract", () => {
  let app: INestApplication;
  let service: { listComments: jest.Mock; addComment: jest.Mock };
  let base = "";

  beforeAll(async () => {
    service = {
      listComments: jest.fn().mockResolvedValue([]),
      addComment: jest.fn().mockResolvedValue({ id: "c1", content: "hi", parentCommentId: null }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [MomentsController],
      providers: [{ provide: MomentsService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0);
    const url = await app.getUrl();
    base = `http://127.0.0.1:${url.slice(url.lastIndexOf(":") + 1)}/api/v1/moments/m1/comments`;
  });

  afterEach(() => {
    service.addComment.mockClear();
    service.addComment.mockResolvedValue({ id: "c1", content: "hi", parentCommentId: null });
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
      error?: { code?: string; message?: string };
    };
    return { response, body: parsed };
  }

  it("伪造 userId 被白名单拦下：400 VALIDATION_ERROR，且从不调用 service", async () => {
    const { response, body } = await post({ content: "hi", userId: "someone-else" });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(service.addComment).not.toHaveBeenCalled();
  });

  it("非 UUID 的 parentCommentId：400 VALIDATION_ERROR，且从不调用 service", async () => {
    const { response, body } = await post({ content: "hi", parentCommentId: "not-a-uuid" });
    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(service.addComment).not.toHaveBeenCalled();
  });

  it("合法回复：parentCommentId 透传给 service，作者仍取自 JWT", async () => {
    const parent = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    const { response } = await post({ content: "我也是", parentCommentId: parent });
    expect(response.status).toBe(201);
    expect(service.addComment).toHaveBeenCalledWith(VIEWER, "m1", "我也是", parent);
  });

  it("未带 parentCommentId 的一级评论：缺省透传 null", async () => {
    const { response } = await post({ content: "很喜欢这个地方！" });
    expect(response.status).toBe(201);
    expect(service.addComment).toHaveBeenCalledWith(VIEWER, "m1", "很喜欢这个地方！", null);
  });

  it("parentCommentId 显式为 null 时按一级评论处理", async () => {
    const { response } = await post({ content: "hi", parentCommentId: null });
    expect(response.status).toBe(201);
    expect(service.addComment).toHaveBeenCalledWith(VIEWER, "m1", "hi", null);
  });

  it("父评论不可回复 -> 403 COMMENT_PARENT_INVALID，且不泄漏内部错误", async () => {
    const error = new Error("COMMENT_PARENT_INVALID") as Error & { code?: string };
    error.code = "COMMENT_PARENT_INVALID";
    service.addComment.mockRejectedValue(error);

    const { response, body } = await post({ content: "hi", parentCommentId: "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("COMMENT_PARENT_INVALID");
    expect(body.error?.message).toBe("Parent comment cannot be replied to");
    expect(JSON.stringify(body)).not.toContain("at ");
  });

  it("空评论仍然是 403 EMPTY_COMMENT，且文案未回归", async () => {
    const error = new Error("EMPTY_COMMENT") as Error & { code?: string };
    error.code = "EMPTY_COMMENT";
    service.addComment.mockRejectedValue(error);

    const { response, body } = await post({ content: "   " });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("EMPTY_COMMENT");
    expect(body.error?.message).toBe("Comment is empty");
  });

  it("Safety 拦截仍然是 403 COMMENT_BLOCKED", async () => {
    const error = new Error("COMMENT_BLOCKED") as Error & { code?: string };
    error.code = "COMMENT_BLOCKED";
    service.addComment.mockRejectedValue(error);

    const { response, body } = await post({ content: "make money fast" });
    expect(response.status).toBe(403);
    expect(body.error?.code).toBe("COMMENT_BLOCKED");
    expect(body.error?.message).toBe("Comment blocked");
  });
});
