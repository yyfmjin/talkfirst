import { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiExceptionFilter } from "../common/api-exception.filter";
import { MomentsService } from "../moments/moments.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { NotificationService } from "../notifications/notification.service";
import { SocialSafetyController } from "./social-safety.controller";

/**
 * PC-2.5.2 — the unauthenticated branch of `POST /reports`.
 *
 * With no session the route must answer `401 UNAUTHORIZED` and no report may be
 * written. It runs over real HTTP on an ephemeral port, so the guard binding,
 * the controller decorators and `ApiExceptionFilter` are the production ones.
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

describe("SocialSafetyController — POST /reports without a session", () => {
  let app: INestApplication;
  let prisma: { report: { create: jest.Mock } };
  let base = "";

  beforeAll(async () => {
    prisma = { report: { create: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      controllers: [SocialSafetyController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: SafetyService, useValue: {} },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: MomentsService, useValue: { resolveMomentAccess: jest.fn() } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0);
    const url = await app.getUrl();
    base = `http://127.0.0.1:${url.slice(url.lastIndexOf(":") + 1)}/api/v1/reports`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("guard 绑定在 controller 上，举报路由不能匿名进入", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, SocialSafetyController) ??
      []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
  });

  it("匿名举报 Moment -> 401 UNAUTHORIZED，且从不落库", async () => {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        momentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        reason: "Spam",
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(prisma.report.create).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("Spam");
  });
});
