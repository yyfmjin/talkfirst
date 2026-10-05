import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * G10（`docs/P0-00-BASELINE.md` §G）—— 探活与就绪是两件事，之前只有前者。
 *
 * `/health` 过去只固定返回 `ok`，于是一个「数据库连不上、但进程还活着」的实例
 * 在编排眼里是健康的。**但不能**简单地把 DB ping 加进 `/health`：
 * `docker-compose.yml` 的 api healthcheck 探的就是它，而健康检查失败会让
 * `depends_on: condition: service_healthy` 的 web / admin 永远不启动，
 * `docker ps` 也会显示 unhealthy —— 数据库抖一下就等于整栈被判死。
 * 存活探针的语义恰恰是「这个进程该不该重启」，数据库不在它的判据里。
 *
 * 所以拆成两个：
 *
 *   `GET /api/v1/health`        存活：进程活着就 200。**不碰任何外部依赖。**
 *   `GET /api/v1/health/ready`  就绪：真的 ping 一次数据库；2s 内没回来即视为不可用，
 *                               返回 503 + `error.code = "NOT_READY"`。
 *
 * **运维该探哪一个**：就绪。`docker-compose.yml` 的 api healthcheck 与
 * `scripts/deploy-pull.sh` 部署后的自检都已改成它。存活探针留给「这个进程要不要
 * 重启」——把两者混为一谈就是 G10 原本的病症。
 *
 * 手写而不引 `@nestjs/terminus`：这里只需要一次 `SELECT 1`，而 terminus 会带来
 * 一棵新依赖树**以及它自己的响应形状** —— 那会让仓库既有的 `{success, data}`
 * 封套出现第二种写法（`api-exception.filter.ts` 的约定是「用 `error.code` 说清
 * 发生了什么」）。
 */

/**
 * 就绪探测的等待上限。
 *
 * 导出是为了让用例能推进假定时器，而不是真的等两秒 —— 用例里出现 `sleep(2000)`
 * 会让这个套件在 CI 上变成拖后腿的那个。
 */
export const READY_TIMEOUT_MS = 2000;

@Controller("health")
export class HealthController {
  private readonly logger = new Logger("Health");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 存活探针。刻意保持无依赖：它回答的只是「这个进程还在跑吗」。
   */
  @Get()
  check() {
    return {
      success: true,
      data: {
        status: "ok" as const,
        service: "talkfirst-api",
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * 就绪探针：能对外服务（即数据库可达）才算就绪。
   */
  @Get("ready")
  async ready() {
    const startedAt = Date.now();
    try {
      await this.pingDatabase();
    } catch (error) {
      /**
       * 只记**错误类型**，不记 message：Prisma 的初始化错误里会带上连接目标，
       * 而 `DATABASE_URL` 是一条带凭据的 URL。探活端点不该成为凭据外泄的入口。
       */
      this.logger.warn(`readiness probe failed: ${errorKind(error)}`);
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: "NOT_READY",
          // 同样不带上底层错误文本。
          message: "Database is not reachable",
        },
      });
    }

    return {
      success: true,
      data: {
        status: "ready" as const,
        service: "talkfirst-api",
        timestamp: new Date().toISOString(),
        // 延迟一并给出：编排只看状态码，但它对定位「慢慢变坏的库」有用。
        database: { status: "up" as const, latencyMs: Date.now() - startedAt },
      },
    };
  }

  /**
   * `SELECT 1`，带超时。
   *
   * `Promise.race` 只是让**探针自己**不再等下去，底层那条连接仍然挂着 ——
   * 对探活来说这就够了：调用方拿到 503 就会去处理，而请求不会被无限期占用。
   */
  private async pingDatabase(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("readiness probe timed out")), READY_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function errorKind(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}
