import { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiExceptionFilter } from "../common/api-exception.filter";
import { MomentsController } from "./moments.controller";
import { MomentsService } from "./moments.service";

/**
 * PC-2.2 — the unauthenticated branch of the comment routes.
 *
 * The service specs prove the authorization gate runs before the thread query.
 * This one proves the gate is reached at all: with no session, both comment
 * routes must answer `401 UNAUTHORIZED` and the service must never be called.
 * It runs over real HTTP on an ephemeral port, so the guard binding, the
 * controller decorators and `ApiExceptionFilter` are the production ones.
 */

// `passport-jwt` fails with "No auth token" when nothing is presented.
// Registering a stub under the same name reproduces that branch without
// dragging the real JwtStrategy (and its Prisma/config deps) into the module.
class NoTokenStrategy extends PassportStrategyBase {
  name = "jwt";

  authenticate() {
    this.fail({ message: "No auth token" }, 401);
  }
}

passport.use("jwt", new NoTokenStrategy());

describe("MomentsController — comment routes without a session", () => {
  let app: INestApplication;
  let service: { listComments: jest.Mock; addComment: jest.Mock };
  let base = "";

  beforeAll(async () => {
    service = {
      listComments: jest.fn().mockResolvedValue([]),
      addComment: jest.fn().mockResolvedValue({ id: "c1" }),
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

  afterAll(async () => {
    await app.close();
  });

  it("guard 绑定在 controller 上，任何 moment 路由都不能匿名进入", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, MomentsController) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it("GET 评论 -> 401 UNAUTHORIZED，且从不读取评论", async () => {
    const response = await fetch(base);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(service.listComments).not.toHaveBeenCalled();
  });

  it("POST 评论 -> 401 UNAUTHORIZED，且不写入任何内容", async () => {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "anonymous write" }),
    });
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(service.addComment).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("anonymous write");
  });
});
