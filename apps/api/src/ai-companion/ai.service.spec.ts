import { AiService, AiUnavailableError } from "./ai.service";

/**
 * AI 调用的降级链。
 *
 * 这一组用例来自一次线上故障（2026-10-16）：用户报「AI 聊天一开始能用、现在不能用了」，
 * 服务端日志里全是 `TimeoutError`。原因是**第一次尝试抛出的异常直接冒出了整个函数**——
 * 超时/网络错误不属于「上游返回了可重试状态码」，于是降级链形同虚设：
 * 第一个模型一慢，后面的模型根本没被调用。所以这里把「抛错也要继续降级」钉死。
 */

const realFetch = globalThis.fetch;

function jsonResponse(content: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function timeoutError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

beforeEach(() => {
  process.env.AI_API_KEY = "test-key";
  process.env.AI_API_URL = "https://example.invalid/v1";
  process.env.AI_MODEL = "model-a,model-b";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.AI_API_KEY;
  delete process.env.AI_API_URL;
  delete process.env.AI_MODEL;
});

describe("AiService.chat — 降级链", () => {
  it("第一个模型超时不吞掉整次请求，会继续试下一个模型", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (_url: string, init: { body?: unknown }) => {
      const model = JSON.parse(String(init.body)).model as string;
      calls.push(model);
      if (model === "model-a") throw timeoutError();
      return jsonResponse("你好呀");
    }) as unknown as typeof fetch;

    const reply = await new AiService().chat("system", [], "hi");

    expect(reply).toBe("你好呀");
    expect(calls).toEqual(["model-a", "model-b"]);
  });

  it("可重试的上游状态码同样继续降级（503 是 Gemini 常见形态）", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (_url: string, init: { body?: unknown }) => {
      const model = JSON.parse(String(init.body)).model as string;
      calls.push(model);
      return model === "model-a" ? jsonResponse("", 503) : jsonResponse("ok");
    }) as unknown as typeof fetch;

    await new AiService().chat("system", [], "hi");

    expect(calls).toEqual(["model-a", "model-b"]);
  });

  it("不可重试的状态码（400）不浪费第二次尝试", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (_url: string, init: { body?: unknown }) => {
      calls.push(JSON.parse(String(init.body)).model as string);
      return jsonResponse("", 400);
    }) as unknown as typeof fetch;

    await expect(new AiService().chat("system", [], "hi")).rejects.toMatchObject({
      code: "AI_UPSTREAM_ERROR",
    });
    expect(calls).toEqual(["model-a"]);
  });

  it("全部尝试都失败时抛 AI_UPSTREAM_TIMEOUT（带原始错误信息）", async () => {
    globalThis.fetch = (async () => {
      throw timeoutError();
    }) as unknown as typeof fetch;

    const failure = await new AiService().chat("system", [], "hi").catch((error) => error);

    expect(failure).toBeInstanceOf(AiUnavailableError);
    expect((failure as AiUnavailableError).code).toBe("AI_UPSTREAM_TIMEOUT");
    expect((failure as Error).message).toContain("timeout");
  });

  it("上游返回空回复时抛 AI_EMPTY_REPLY（不把空字符串当成回复）", async () => {
    globalThis.fetch = (async () => jsonResponse("   ")) as unknown as typeof fetch;

    await expect(new AiService().chat("system", [], "hi")).rejects.toMatchObject({
      code: "AI_EMPTY_REPLY",
    });
  });

  it("没有配置 key 时直接拒绝，不发请求", async () => {
    delete process.env.AI_API_KEY;
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return jsonResponse("x");
    }) as unknown as typeof fetch;

    await expect(new AiService().chat("system", [], "hi")).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
    });
    expect(called).toBe(0);
  });
});
