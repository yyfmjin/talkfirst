import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExceptionFilter } from "./api-exception.filter";
import { ERROR_CODE_HEADER } from "../security/access-log.middleware";

/** Keep the constant local: every call below is about this one header. */
const HEADER = ERROR_CODE_HEADER;

/**
 * Phase A+ — the error envelope contract.
 *
 * `ApiExceptionFilter` forwards a payload verbatim only when it already carries
 * a domain `error.code`. Everything else used to fall through to the generic
 * `HTTP_ERROR`, which meant a bare `UnauthorizedException` — exactly what
 * `AuthGuard("jwt")` throws for a missing or expired token — was
 * indistinguishable from any other HTTP failure.
 *
 * A 401 now always carries `UNAUTHORIZED`. That is the only change: statuses,
 * the envelope shape, and every other code are untouched.
 *
 * Phase O1 adds a second, internal output: the filter echoes the domain code on
 * `ERROR_CODE_HEADER` so `AccessLogMiddleware` — which only sees a status code on
 * `res.on("finish")` — can record the real code, while no client ever receives
 * it. That header is committed with `writeHead` (the one call that writes the
 * status line and headers together) and deleted from the response object before
 * any body is written, which is the only sequence that works once the response
 * has been handed to Express — see the "响应头" suite below.
 */

/**
 * A fake response that behaves like the small part of Express/Node the filter
 * relies on:
 *
 *  - `setHeader` stores the header, exactly like `res.setHeader` does (Node keeps
 *    named response headers as own properties of the response object);
 *  - `status(...).json(...)` ends the response and fires `finish`, which is when
 *    `AccessLogMiddleware` reads the header back through `getHeader`;
 *  - afterwards, deleting the property is the only thing that still works.
 *
 * The header is therefore asserted at three moments: right after `catch()`, at
 * `finish`, and after the deferred cleanup has run.
 */
function makeHost() {
  const store: Record<string, string> = {};
  /** Set once the body has been "sent" — the point of no return for headers. */
  let sent = false;
  let finished = false;
  const finishListeners: Array<() => void> = [];

  /**
   * Assigned once, immediately after the Proxy below — but it has to be declared
   * first, because the fake mirrors Node: `setHeader` stores a named header both
   * in the header store and as an own property of the response object, and that
   * property is what the filter deletes later. `prefer-const` cannot see the
   * single assignment through the callback that closes over it.
   */
  // eslint-disable-next-line prefer-const
  let response: Record<string, unknown>;

  const json = jest.fn((body: unknown) => {
    sent = true;
    // Express ends the response here; a real `res` would now throw on
    // `setHeader`/`removeHeader`, which is why the cleanup must not run yet.
    finished = true;
    for (const listener of finishListeners) listener();
    return body;
  });
  const status = jest.fn((_code: number) => ({ json }));
  const setHeader = jest.fn((name: string, value: string) => {
    if (sent) throw new Error("Cannot set headers after they are sent to the client");
    store[name.toLowerCase()] = value;
    response[name] = value;
  });
  const getHeader = jest.fn((name: string) => store[name.toLowerCase()]);
  const removeHeader = jest.fn((name: string) => {
    if (sent) throw new Error("Cannot remove headers after they are sent to the client");
    delete store[name.toLowerCase()];
  });
  const once = jest.fn((event: string, listener: () => void) => {
    if (event === "finish") finishListeners.push(listener);
  });

  response = new Proxy(
    { status, setHeader, getHeader, removeHeader, once },
    {
      get(target, property) {
        if (property === HEADER) return store[HEADER.toLowerCase()];
        return Reflect.get(target, property);
      },
      deleteProperty(target, property) {
        if (property === HEADER) delete store[HEADER.toLowerCase()];
        return Reflect.deleteProperty(target, property);
      },
    },
  ) as unknown as Record<string, unknown>;

  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return {
    host,
    response,
    status,
    /** Straight off the live header store. */
    headerValue: () => store[HEADER.toLowerCase()],
    getHeader,
    isFinished: () => finished,
  };
}

type Envelope = {
  success: boolean;
  error: { code: string; message: string };
};

function emit(exception: unknown) {
  const harness = makeHost();
  new ApiExceptionFilter().catch(exception, harness.host);
  const jsonMock = (harness.status.mock.results[0]?.value as { json: jest.Mock }).json;
  return {
    harness,
    status: harness.status.mock.calls[0][0] as number,
    body: jsonMock.mock.calls[0][0] as Envelope,
    /** What was echoed, read straight off the live header store. */
    headerImmediately: harness.headerValue(),
    /**
     * What `AccessLogMiddleware` would write into the `errorCode` column: the
     * header, read through `getHeader` while handling `finish`. The finish event
     * has already fired by the time `catch()` returns (the fake fires it from
     * `json`), so this is exactly the value the audit row would carry.
     */
    headerAtFinish: harness.getHeader(HEADER) as string | undefined,
  };
}

describe("ApiExceptionFilter — 401 gets a domain code", () => {
  it("bare UnauthorizedException -> 401 UNAUTHORIZED (was HTTP_ERROR)", () => {
    const { status, body } = emit(new UnauthorizedException("Unauthorized"));
    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("bare UnauthorizedException with no message still gets a usable message", () => {
    const { body } = emit(new UnauthorizedException());
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBeTruthy();
  });

  it("structured UnauthorizedException keeps its own specific code", () => {
    const { status, body } = emit(
      new UnauthorizedException({
        success: false,
        error: { code: "USER_DISABLED", message: "This account is disabled" },
      }),
    );
    expect(status).toBe(401);
    // Passthrough must win over the generic 401 mapping.
    expect(body.error.code).toBe("USER_DISABLED");
  });
});

describe("ApiExceptionFilter — everything else is unchanged", () => {
  it("bare 403 still uses HTTP_ERROR", () => {
    const { status, body } = emit(new ForbiddenException("nope"));
    expect(status).toBe(403);
    expect(body.error.code).toBe("HTTP_ERROR");
  });

  it("structured 400 passes through", () => {
    const { status, body } = emit(
      new BadRequestException({
        success: false,
        error: { code: "REASON_REQUIRED", message: "A reason is required" },
      }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe("REASON_REQUIRED");
  });

  it("an unexpected error is still a 500 INTERNAL_ERROR", () => {
    const { status, body } = emit(new Error("kaboom"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    // Never leak the internal message.
    expect(body.error.message).not.toContain("kaboom");
  });
});

describe("ApiExceptionFilter — 内部错误码回显（Phase O1）", () => {
  it("把领域错误码写到内部头，供访问日志中间件读取", () => {
    const { body, headerImmediately } = emit(
      new ForbiddenException({
        success: false,
        error: { code: "PERMISSION_DENIED", message: "nope" },
      }),
    );
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(headerImmediately).toBe("PERMISSION_DENIED");
  });

  it("不透传 payload 的裸异常也会回显推导出的码", () => {
    // A bare UnauthorizedException is handled by the 401 mapping, not passthrough,
    // so this is the branch where the echoed code is computed rather than copied.
    const { headerImmediately } = emit(new UnauthorizedException());
    expect(headerImmediately).toBe("UNAUTHORIZED");
  });

  it("访问日志在 finish 时仍能读到错误码（不能提前删掉）", () => {
    const { headerAtFinish } = emit(
      new ForbiddenException({ success: false, error: { code: "MOMENT_FORBIDDEN", message: "no" } }),
    );
    // This is the whole point of the deferred cleanup: `AccessLogMiddleware` reads
    // the header when the response finishes, so a synchronous removal would have
    // silently downgraded every logged error code to the status-derived fallback.
    expect(headerAtFinish).toBe("MOMENT_FORBIDDEN");
  });
});

/**
 * 内部头必须在响应结束后安全收尾。
 *
 * `removeHeader` throws `ERR_HTTP_HEADERS_SENT` once the response has been sent,
 * so it can never be used here; and removing the header *earlier* would break the
 * access log, which reads it at `finish`. The property is therefore deleted on the
 * next turn of the event loop. These tests pin both halves of that trade-off: the
 * value survives long enough to be logged, and it does not survive the request.
 */
describe("ApiExceptionFilter — 响应结束后清理内部头", () => {
  it("清理被延后到事件循环的下一轮，之后响应对象上不再有该头", async () => {
    const { headerImmediately, headerAtFinish, harness } = emit(
      new BadRequestException({ success: false, error: { code: "VALIDATION_ERROR", message: "bad" } }),
    );

    // Still readable while the response is being finished…
    expect(headerImmediately).toBe("VALIDATION_ERROR");
    expect(headerAtFinish).toBe("VALIDATION_ERROR");

    // …and gone once the deferred cleanup has run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.headerValue()).toBeUndefined();
    expect(harness.getHeader(HEADER)).toBeUndefined();
  });

  it("清理不依赖 removeHeader —— 响应发出后调用它会抛错", () => {
    const { harness } = emit(
      new ForbiddenException({ success: false, error: { code: "COMMENT_FORBIDDEN", message: "no" } }),
    );
    // The fake mirrors Node: after `json()` the response is sent, and this is the
    // call the old implementation made, which is what produced the error log.
    expect(harness.isFinished()).toBe(true);
  });

  it("response.setHeader 抛错时仍然返回正常信封，不出现第二个异常", () => {
    const json = jest.fn((_body: unknown) => undefined);
    const status = jest.fn((_code: number) => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status,
          // What a partially-sent response does.
          setHeader: jest.fn(() => {
            throw Object.assign(new Error("Cannot set headers after they are sent to the client"), {
              code: "ERR_HTTP_HEADERS_SENT",
            });
          }),
          getHeader: jest.fn(),
          once: jest.fn(),
        }),
      }),
    } as unknown as ArgumentsHost;

    // A diagnostic header is never worth failing the answer for.
    expect(() =>
      new ApiExceptionFilter().catch(
        new ForbiddenException({ success: false, error: { code: "COMMENT_FORBIDDEN", message: "no" } }),
        host,
      ),
    ).not.toThrow();

    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0]).toMatchObject({
      success: false,
      error: { code: "COMMENT_FORBIDDEN" },
    });
  });
});
