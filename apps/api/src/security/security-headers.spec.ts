import type { INestApplication } from "@nestjs/common";
import { Controller, Get, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import helmet from "helmet";
import { applySecurityHeaders, securityHeaderOptions } from "./security-headers";

@Controller()
class ProbeController {
  @Get("probe")
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * SEC-004 — the headers must survive on a real response.
 *
 * Asserting against the `HelmetOptions` object would pass even if a typo used a
 * key helmet does not recognise (`hsts` vs `strictTransportSecurity`), or if the
 * middleware were registered in a position where something overwrote it. These
 * tests therefore boot a minimal Nest app with the same `applySecurityHeaders`
 * call `main.ts` makes, listen on a real socket and read the response headers
 * back off the wire.
 *
 * The two load-bearing assertions are:
 *  - `Cross-Origin-Resource-Policy: cross-origin` — helmet defaults to
 *    `same-origin`, which makes the browser refuse to show `/uploads/*` avatars,
 *    moment images and chat images inside the member app. Every other header
 *    here is a static value; this one is the difference between "hardened" and
 *    "images are broken".
 *  - no `Content-Security-Policy` — helmet's default policy carries
 *    `upgrade-insecure-requests`, which rewrites plain-HTTP dev origins to HTTPS.
 */
describe("SEC-004 安全响应头", () => {
  let app: INestApplication;
  let headers: Headers;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    applySecurityHeaders(app);
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/probe`);
    // Fail loudly here rather than letting every assertion below read `null`
    // off a 404 and look like a header misconfiguration.
    expect(response.status).toBe(200);
    headers = response.headers;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it("1. 关闭 MIME 嗅探", () => {
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("2. 禁止被任何来源嵌入（点击劫持）", () => {
    expect(headers.get("x-frame-options")).toBe("DENY");
  });

  it("3. 不透传 Referer 到下一条请求链", () => {
    expect(headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("4. HTTPS 强制生效一年且覆盖子域，不加入 preload 列表", () => {
    const hsts = headers.get("strict-transport-security");
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
    // preload 是对外承诺，不应该由代码顺手打开。
    expect(hsts).not.toContain("preload");
  });

  it("5. 允许成员端跨域展示 /uploads 图片（不能是 same-origin）", () => {
    expect(headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it("6. 不开启 COEP，否则同样的跨域图片会被二次拦截", () => {
    expect(headers.get("cross-origin-embedder-policy")).toBeNull();
  });

  it("7. JSON 接口不下发 CSP——默认策略里的 upgrade-insecure-requests 会打断本地 HTTP 调试", () => {
    expect(headers.get("content-security-policy")).toBeNull();
  });

  it("8. 不暴露后端实现框架", () => {
    expect(headers.get("x-powered-by")).toBeNull();
  });
});

/**
 * SEC-004 — 安全头不能把聊天打断。
 *
 * TalkFirst 的聊天是 Socket.IO（`chat.gateway.ts`，成员端用
 * `transports: ["websocket", "polling"]`）。安全头中间件最容易踩的坑是有人把
 * 它写成“拦截并处理所有请求”，于是 WebSocket 的 upgrade 被吞掉。
 *
 * 这里用和生产完全一致的拓扑验证：请求走 helmet 中间件，`upgrade` 事件由
 * `http.Server` 直接处理，中间件碰不到。只要升级仍然返回 101，就说明加头
 * 不会切断实时连接。轮询传输（XHR）本来就是普通请求，走 CORS，与本项无关。
 *
 * 端到端的 Socket.IO 房间/鉴权链路需要浏览器与完整服务，属于 NOT VERIFIED。
 */
describe("SEC-004 安全头不影响 WebSocket 升级", () => {
  let server: Server;
  let port = 0;
  // closeAllConnections() 只管理它自己接管的连接，升级后的 socket 已经脱离
  // HTTP 连接池，必须自己留着才能关。否则 server.close() 永远不会回调。
  let upgradedSocket: Duplex | undefined;

  beforeAll(async () => {
    const headers = helmet(securityHeaderOptions());
    server = createServer((request, response) => {
      headers(request, response, () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    // 与生产一致：Express 之外的 upgrade 监听只属于 HTTP server，不经过中间件。
    server.on("upgrade", (_request, socket) => {
      upgradedSocket = socket;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    // undici 的 fetch 会保持 keep-alive 连接，升级后的 socket 也不在池子里。
    upgradedSocket?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 15_000);

  function upgrade(): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "GET /chat/?EIO=4&transport=websocket HTTP/1.1\r\n" +
            `Host: 127.0.0.1:${port}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n",
        );
      });
      socket.setTimeout(5_000, () => {
        socket.destroy();
        reject(new Error("WebSocket 升级超时"));
      });
      socket.once("data", (chunk) => {
        socket.destroy();
        resolve(chunk.toString("utf8"));
      });
      socket.once("error", reject);
    });
  }

  it("1. 普通请求仍然拿到安全头", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/probe`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("2. 升级请求仍然返回 101", async () => {
    expect(await upgrade()).toMatch(/^HTTP\/1\.1 101 /);
  });
});
