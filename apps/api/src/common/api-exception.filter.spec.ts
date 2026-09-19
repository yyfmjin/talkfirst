import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiExceptionFilter } from "./api-exception.filter";

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
 */

function makeHost() {
  const json = jest.fn((_body: unknown) => undefined);
  const status = jest.fn((_code: number) => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function emit(exception: unknown) {
  const { host, status, json } = makeHost();
  new ApiExceptionFilter().catch(exception, host);
  return {
    status: status.mock.calls[0][0],
    body: json.mock.calls[0][0] as {
      success: boolean;
      error: { code: string; message: string };
    },
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
