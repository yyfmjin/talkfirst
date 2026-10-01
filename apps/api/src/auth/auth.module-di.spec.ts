import { Test } from "@nestjs/testing";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { SecurityModule } from "../security/security.module";
import { AuthModule } from "./auth.module";
import { AuthService } from "./auth.service";
import { LoginAttemptService } from "./login-attempt.service";

/**
 * SEC-001 — the extra dependency must actually be injectable.
 *
 * Type-checking alone cannot catch a Nest DI wiring mistake. This test caught a
 * real one: `LoginAttemptService` takes a policy and a clock, which the container
 * read as injection tokens and could not resolve. The provider is therefore
 * registered by factory, and this boots the real `AuthModule` graph — with the
 * database swapped for a stub — to prove the wiring compiles.
 */
describe("AuthService — 依赖注入（SEC-001）", () => {
  it("AuthModule 容器可以解析并注入 LoginAttemptService", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, SecurityModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    expect(moduleRef.get(LoginAttemptService)).toBeInstanceOf(LoginAttemptService);
  });
});
