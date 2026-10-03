import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { UuidParamPipe } from "./uuid-param.pipe";

/**
 * The pipe on its own, because nothing else in the suite can see this contract.
 *
 * Every id-addressed member route looks its row up by a `uuid` column. Prisma
 * answers a non-UUID with `PrismaClientKnownRequestError` (P2023), which is not
 * an `HttpException`, so `ApiExceptionFilter` classified it as an unexpected
 * failure and the caller received `500 INTERNAL_ERROR` for what is plainly a
 * malformed request. The controller specs could not catch it: they either call
 * the handler method directly — pipes never run on a direct call — or drive a
 * mocked Prisma that returns `null` for any key and never parses a UUID.
 *
 * So the wire contract is pinned here: a rejection is the project's standard
 * `VALIDATION_ERROR` envelope with the offending parameter named, and a
 * well-formed UUID passes through untouched.
 */

const LOWER = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const UPPER = "3F1A2B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B";
const NIL = "00000000-0000-0000-0000-000000000000";

/**
 * The metadata Nest hands a parameter pipe. `data` is the parameter name, and
 * it is what the error's `details` key must be built from.
 */
function param(data?: string): ArgumentMetadata {
  return { type: "param", metatype: String, data };
}

/** Runs the pipe and returns the `BadRequestException` it must produce. */
function rejection(value: string, data?: string): BadRequestException {
  try {
    new UuidParamPipe().transform(value, param(data));
  } catch (error) {
    if (error instanceof BadRequestException) return error;
    throw error;
  }
  throw new Error(`expected ${value} to be rejected`);
}

describe("UuidParamPipe — 非法路径 id 是 400，而不是 Prisma 的 500", () => {
  it("合法小写 UUID -> 原样返回，不做任何改写", () => {
    expect(new UuidParamPipe().transform(LOWER, param("id"))).toBe(LOWER);
  });

  it("大写 UUID 与 nil UUID -> 原样返回（只校验形状，不缩小数据库接受的集合）", () => {
    for (const value of [UPPER, NIL]) {
      expect(new UuidParamPipe().transform(value, param("id"))).toBe(value);
    }
  });

  it("非 UUID -> 400 VALIDATION_ERROR，且 details 以 metadata.data 为键", () => {
    const error = rejection("not-a-uuid", "blockerId");
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid path parameter",
        details: { blockerId: ["blockerId must be a UUID"] },
      },
    });
  });

  it("缺段、多字符或缺分隔符同样被拒（锚定整串，而不是子串匹配）", () => {
    const malformed = [
      "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5", // 最后一段少一个字符
      "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5bz", // 最后一段多一个字符
      "3f1a2b4c5d6e4f708a9b0c1d2e3f4a5b", // 缺少分隔符
      `${LOWER}-extra`, // 尾部多余内容
    ];

    for (const value of malformed) {
      const error = rejection(value, "id");
      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
  });

  it('metadata.data 缺省时以 "id" 作为 details 的键名', () => {
    const body = rejection("not-a-uuid").getResponse() as {
      error: { details: Record<string, string[]> };
    };
    expect(Object.keys(body.error.details)).toEqual(["id"]);
    expect(body.error.details.id).toEqual(["id must be a UUID"]);
  });
});
