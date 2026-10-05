import { ServiceUnavailableException } from "@nestjs/common";

import { HealthController, READY_TIMEOUT_MS } from "./health.controller";

/**
 * G10 — 存活与就绪拆开之后的契约。
 *
 * 关注点只有两个：**存活探针不许碰数据库**（否则数据库抖动会变成「进程该重启」），
 * 而**就绪探针必须在数据库不可用时给出 503**（否则「DB 挂了但进程活着」会被判健康，
 * 这正是 G10 记下来的病症）。
 */

type PingPrisma = { $queryRaw: jest.Mock };

function makePrisma(ping: () => Promise<unknown> = async () => [{ "?column?": 1 }]) {
  return { $queryRaw: jest.fn(ping) } satisfies PingPrisma;
}

describe("HealthController", () => {
  describe("存活（GET /health）", () => {
    it("返回成功载荷，且**不触碰数据库**", () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma as never);

      const result = controller.check();

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("ok");
      expect(result.data.service).toBe("talkfirst-api");
      // 这一条是 G10 的核心：存活判据里不能有数据库。
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe("就绪（GET /health/ready）", () => {
    it("数据库可达时报告 ready，并给出延迟", async () => {
      const prisma = makePrisma();
      const controller = new HealthController(prisma as never);

      const result = await controller.ready();

      expect(result.success).toBe(true);
      expect(result.data.status).toBe("ready");
      expect(result.data.database.status).toBe("up");
      expect(typeof result.data.database.latencyMs).toBe("number");
      expect(result.data.database.latencyMs).toBeGreaterThanOrEqual(0);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it("数据库查询失败时抛 503，且不把底层错误文本带出去", async () => {
      /**
       * 底层错误刻意做成「像 Prisma 真实会抛的那样」：带连接目标与凭据。
       * 探活端点是最可能被外部（编排、监控、甚至公网）打的地方，
       * 它不该成为凭据外泄的入口。
       */
      const leaky = new Error(
        "Can't reach database server at `db.internal:5432`: postgresql://talkfirst:sup3r-s3cret@db.internal:5432/talkfirst",
      );
      leaky.name = "PrismaClientInitializationError";
      const prisma = makePrisma(async () => {
        throw leaky;
      });
      const controller = new HealthController(prisma as never);

      /**
       * 用 `then(onFulfilled, onRejected)` 而不是 `.catch()`：后者会把「成功载荷」
       * 也带进推断出的联合类型，于是 `getStatus()` 在类型上不存在。
       * 这里要的是「一定走拒绝分支」，所以显式把成功情形变成 null。
       */
      const caught = await controller.ready().then(
        () => null,
        (error: unknown) => error,
      );
      expect(caught).toBeInstanceOf(ServiceUnavailableException);

      const exception = caught as ServiceUnavailableException;
      expect(exception.getStatus()).toBe(503);
      const body = exception.getResponse() as {
        success: boolean;
        error: { code: string; message: string };
      };
      // 封套与全站一致：`error.code` 说清发生了什么。
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("NOT_READY");

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("sup3r-s3cret");
      expect(serialized).not.toContain("postgresql://");
      expect(serialized).not.toContain("db.internal");
    });

    it("数据库不回应时在 READY_TIMEOUT_MS 后判为不可用（不等成永恒）", async () => {
      jest.useFakeTimers();
      try {
        // 一个永不作数的查询：模拟「连接建立着但没有任何响应」。
        const prisma = makePrisma(() => new Promise(() => {}));
        const controller = new HealthController(prisma as never);

        const assertion = expect(controller.ready()).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        jest.advanceTimersByTime(READY_TIMEOUT_MS);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
