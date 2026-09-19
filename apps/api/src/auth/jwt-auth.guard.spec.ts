import { HttpException, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * Phase A+ — authentication error codes.
 *
 * The problem this fixes: `AuthGuard("jwt")` throws a bare
 * `UnauthorizedException("Unauthorized")` whenever the token is missing,
 * malformed, expired or badly signed. `ApiExceptionFilter` only forwards a
 * payload that already carries a domain `error.code`, so all of those collapsed
 * into the generic `HTTP_ERROR` and the client could not tell "not signed in"
 * from "session expired" from "account disabled".
 *
 * `JwtStrategy.validate()` already throws structured domain exceptions for the
 * account-state cases; those must survive untouched.
 */

const context = {} as never;

function codeOf(exception: unknown): string {
  const body = (exception as HttpException).getResponse() as {
    success: boolean;
    error: { code: string; message: string };
  };
  return body.error.code;
}

function bodyOf(exception: unknown) {
  return (exception as HttpException).getResponse() as {
    success: boolean;
    error: { code: string; message: string };
  };
}

describe("JwtAuthGuard — 401 envelope", () => {
  const guard = new JwtAuthGuard();

  it("no token -> 401 UNAUTHORIZED", () => {
    let thrown: unknown;
    try {
      guard.handleRequest(null, false, undefined, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException);
    expect(codeOf(thrown)).toBe("UNAUTHORIZED");
    expect((thrown as UnauthorizedException).getStatus()).toBe(401);
  });

  it("passport 'No auth token' info -> 401 UNAUTHORIZED", () => {
    let thrown: unknown;
    try {
      guard.handleRequest(null, false, { message: "No auth token" }, context);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe("UNAUTHORIZED");
    expect(bodyOf(thrown).error.message).toBe("Authentication required");
  });

  it("expired token -> 401 UNAUTHORIZED, message distinguishes expiry", () => {
    let thrown: unknown;
    try {
      guard.handleRequest(
        null,
        false,
        { name: "TokenExpiredError", message: "jwt expired" },
        context,
      );
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe("UNAUTHORIZED");
    // The code stays uniform per contract; the message lets a client decide to
    // try a refresh instead of bouncing to the login screen.
    expect(bodyOf(thrown).error.message).toBe("Access token has expired");
  });

  it("badly signed / malformed token -> 401 UNAUTHORIZED", () => {
    let thrown: unknown;
    try {
      guard.handleRequest(
        null,
        false,
        { name: "JsonWebTokenError", message: "invalid signature" },
        context,
      );
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe("UNAUTHORIZED");
    expect(bodyOf(thrown).error.message).toBe("invalid signature");
  });

  it("always emits the {success:false,error:{code,message}} envelope", () => {
    let thrown: unknown;
    try {
      guard.handleRequest(null, false, undefined, context);
    } catch (error) {
      thrown = error;
    }
    const body = bodyOf(thrown);
    expect(body.success).toBe(false);
    expect(typeof body.error.code).toBe("string");
    expect(typeof body.error.message).toBe("string");
  });

  it("a valid user passes straight through", () => {
    const user = { id: "u1", email: "a@b.test" };
    expect(guard.handleRequest(null, user, undefined, context)).toBe(user);
  });
});

describe("JwtAuthGuard — domain codes from JwtStrategy are preserved", () => {
  const guard = new JwtAuthGuard();

  it.each([
    ["USER_DISABLED", "This account is disabled"],
    ["USER_BANNED", "This account is banned"],
    ["INVALID_TOKEN", "Invalid token type"],
    ["USER_NOT_FOUND", "User not found"],
  ])("%s is re-thrown unchanged", (code, message) => {
    const original = new UnauthorizedException({
      success: false,
      error: { code, message },
    });

    let thrown: unknown;
    try {
      guard.handleRequest(original, false, undefined, context);
    } catch (error) {
      thrown = error;
    }

    // Not overwritten with UNAUTHORIZED — the specific code is more useful.
    expect(thrown).toBe(original);
    expect(codeOf(thrown)).toBe(code);
  });

  it("an unexpected non-HTTP error is not disguised as an auth failure", () => {
    const boom = new Error("database exploded");
    expect(() => guard.handleRequest(boom, false, undefined, context)).toThrow(boom);
  });
});
